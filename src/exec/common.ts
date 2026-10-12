// Shared building blocks of the km / lsp0 / relay transports: payload builder,
// request validation, call decoding for confirmation blocks, consent with a
// complete confirmation block, receipt event decoding.
import {
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  formatEther,
  getAddress,
  parseAbiItem,
  zeroAddress,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { assetJson } from "../core/assets.ts";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { loadPolicy, policyAllows } from "../core/policy.ts";
import { KM_ABI, UP_ABI } from "../lsp/abis.ts";
import { classifyDataKey } from "../lsp/schemas.ts";
import { OPERATION, type ExecCall, type ExecOptions, type ExecOutcome, type ExecPath, type ExecRequest } from "./transport.ts";

/** Optional extras the account core understands on top of ExecRequest (structurally compatible). */
export interface ExecRequestExt extends ExecRequest {
  /** Verb name recorded in the consent/audit log (default "exec send"). */
  verb?: string;
  /** Force a risk class; default is derived from the payload (admin for permission/ownership/extension/URD changes). */
  risk?: "write" | "admin";
  /** ABI used to decode inner calls for the confirmation block. */
  abi?: Abi;
  /** Extra fields merged into the confirmation block (e.g. permission explanations). */
  summaryExtra?: Record<string, unknown>;
}

export interface ExecOptionsExt extends ExecOptions {
  /** Send msg.value from the controller EOA (direct paths only). Default: the profile pays call values from its own balance. */
  fundFromController?: boolean;
  /** Explicit LSP25 validity window (unix seconds); overrides validitySeconds. 0 end = no expiry. */
  validFrom?: bigint;
  validUntil?: bigint;
  /** Skip the relayer quota pre-check (relay). */
  skipQuota?: boolean;
}

export const OPERATION_NAMES: Record<number, string> = { 0: "CALL", 1: "CREATE", 2: "CREATE2", 3: "STATICCALL", 4: "DELEGATECALL" };

export interface DecodedCall {
  function?: string;
  args?: unknown[];
  source?: "abi" | "description" | "bundled-selector" | "value-transfer" | "unknown";
}

const SELECTORS = assetJson<Record<string, string[]>>("abis", "selectors.json");

/** Decodes calldata with a provided ABI or the bundled selector table (trust label in `source`). */
export function decodeCalldata(data: Hex, abi?: Abi): DecodedCall {
  if (!data || data === "0x") return { source: "value-transfer" };
  if (abi) {
    try {
      const d = decodeFunctionData({ abi, data });
      return { function: d.functionName, args: d.args ? [...(d.args as unknown[])] : [], source: "abi" };
    } catch {}
  }
  const sel = data.slice(0, 10).toLowerCase();
  for (const sig of SELECTORS[sel] ?? []) {
    try {
      const item = parseAbiItem(`function ${sig}`) as AbiFunction;
      const d = decodeFunctionData({ abi: [item], data });
      return { function: sig.replace(/\s+(payable|view|pure|nonpayable)?\s*(returns.*)?$/, ""), args: d.args ? [...(d.args as unknown[])] : [], source: "bundled-selector" };
    } catch {}
  }
  return { function: `unknown selector ${sel}`, source: "unknown" };
}

export function encodeUpExecute(c: ExecCall): Hex {
  return encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [BigInt(c.operation), c.to, c.value, c.data] });
}

export function encodeUpExecuteBatch(calls: ExecCall[]): Hex {
  return encodeFunctionData({ abi: UP_ABI, functionName: "executeBatch", args: [calls.map((c) => BigInt(c.operation)), calls.map((c) => c.to), calls.map((c) => c.value), calls.map((c) => c.data)] });
}

/** The UP-level payload: execute(...) for one call, executeBatch(...) for several, or the raw payload. */
export function upPayload(req: ExecRequest): Hex {
  if (req.payload && req.calls?.length) throw new UpError("BAD_ARGS", "pass either calls or a raw payload, not both");
  if (req.payload) return req.payload;
  if (!req.calls?.length) throw new UpError("BAD_ARGS", "nothing to execute: no calls and no payload");
  return req.calls.length === 1 ? encodeUpExecute(req.calls[0]) : encodeUpExecuteBatch(req.calls);
}

export type ProfilePayloadKind = "execute" | "executeBatch" | "setData" | "setDataBatch" | "ownership" | "unknown";

export interface DecodedProfilePayload {
  kind: ProfilePayloadKind;
  /** Σ of ERC725X values the profile sends (0 for non-execute payloads) */
  totalValue: bigint;
  /** call targets (execute/executeBatch) or the new owner (transferOwnership) */
  targets: Address[];
  /** inner function selectors ("0x" for empty calldata) */
  innerSelectors: Hex[];
  /** keys written (setData/setDataBatch) */
  dataKeys?: Hex[];
  /** decoded ERC725X calls (execute/executeBatch) */
  calls?: ExecCall[];
  /** ownership function name */
  ownership?: "transferOwnership" | "acceptOwnership" | "renounceOwnership";
  /** admin if it changes control (LSP6/LSP17/LSP1-delegate keys, ownership) or is not understood */
  risk: "write" | "admin";
  selector: Hex;
}

const innerSel = (d: Hex): Hex => (d && d.length >= 10 ? (d.slice(0, 10).toLowerCase() as Hex) : "0x");

/**
 * Decodes raw Universal Profile calldata (what the Key Manager / relayer / EntryPoint
 * receives as `payload`) so consent sees the real value, targets and selectors.
 * Unknown payloads are classified admin (human approval required).
 */
export function decodeProfilePayload(payload: Hex): DecodedProfilePayload {
  const selector = (payload ?? "0x").slice(0, 10).toLowerCase() as Hex;
  const unknown: DecodedProfilePayload = { kind: "unknown", totalValue: 0n, targets: [], innerSelectors: [], risk: "admin", selector };
  let d;
  try {
    d = decodeFunctionData({ abi: UP_ABI, data: payload });
  } catch {
    return unknown;
  }
  const a = (d.args ?? []) as unknown as any[];
  switch (d.functionName) {
    case "execute": {
      const call: ExecCall = { operation: Number(a[0]) as ExecCall["operation"], to: getAddress(a[1]), value: BigInt(a[2]), data: a[3] as Hex };
      return { kind: "execute", totalValue: call.value, targets: [call.to], innerSelectors: [innerSel(call.data)], calls: [call], risk: "write", selector };
    }
    case "executeBatch": {
      const [ops, tos, values, datas] = a as [bigint[], Address[], bigint[], Hex[]];
      if (ops.length !== tos.length || tos.length !== values.length || values.length !== datas.length) return unknown;
      const calls: ExecCall[] = ops.map((op, i) => ({ operation: Number(op) as ExecCall["operation"], to: getAddress(tos[i]), value: BigInt(values[i]), data: datas[i] }));
      return { kind: "executeBatch", totalValue: calls.reduce((t, c) => t + c.value, 0n), targets: [...new Set(calls.map((c) => c.to))], innerSelectors: calls.map((c) => innerSel(c.data)), calls, risk: "write", selector };
    }
    case "setData":
      return { kind: "setData", totalValue: 0n, targets: [], innerSelectors: [], dataKeys: [a[0] as Hex], risk: classifyDataKey(a[0]).admin ? "admin" : "write", selector };
    case "setDataBatch": {
      const keys = a[0] as Hex[];
      return { kind: "setDataBatch", totalValue: 0n, targets: [], innerSelectors: [], dataKeys: keys, risk: keys.some((k) => classifyDataKey(k).admin) ? "admin" : "write", selector };
    }
    case "transferOwnership":
      return { kind: "ownership", ownership: "transferOwnership", totalValue: 0n, targets: [getAddress(a[0])], innerSelectors: [], risk: "admin", selector };
    case "acceptOwnership":
    case "renounceOwnership":
      return { kind: "ownership", ownership: d.functionName, totalValue: 0n, targets: [], innerSelectors: [], risk: "admin", selector };
    default:
      return unknown; // batchCalls, universalReceiver, … — not interpreted: human approval
  }
}

/** The ERC725X calls a request will execute: explicit calls, or those decoded from a raw execute/executeBatch payload. */
export function effectiveCalls(req: ExecRequest): ExecCall[] {
  if (req.calls?.length) return req.calls;
  if (req.payload) return decodeProfilePayload(req.payload).calls ?? [];
  return [];
}

/** Up-front refusals that would otherwise revert on chain (or be dangerous). Raw execute payloads are checked too. */
export function validateRequest(req: ExecRequest, keyManager?: Address): string[] {
  const warnings: string[] = [];
  if (req.payload && !/^0x([0-9a-fA-F]{2}){4,}$/.test(req.payload)) throw new UpError("BAD_ARGS", "payload must be hex calldata of at least 4 bytes");
  for (const c of effectiveCalls(req)) {
    if (!Object.values(OPERATION).includes(c.operation as any)) throw new UpError("BAD_ARGS", `unknown ERC725X operation ${c.operation}`);
    if (c.operation === OPERATION.DELEGATECALL) {
      throw new UpError("NOT_SUPPORTED", "DELEGATECALL is always rejected through the Key Manager (DelegateCallDisallowedViaKeyManager) and would run foreign code in the profile's storage", { hint: "use CALL" });
    }
    if (c.value < 0n) throw new UpError("BAD_ARGS", "value must be >= 0");
    if ((c.operation === OPERATION.CREATE || c.operation === OPERATION.CREATE2) && c.to !== zeroAddress) {
      throw new UpError("BAD_ARGS", "CREATE/CREATE2 require the zero address as target (ERC725X_CreateOperationsRequireEmptyRecipientAddress)");
    }
    if (c.operation === OPERATION.STATICCALL && c.value !== 0n) throw new UpError("BAD_ARGS", "STATICCALL cannot carry value (ERC725X_MsgValueDisallowedInStaticCall)");
    if (keyManager && getAddress(c.to) === getAddress(keyManager)) {
      throw new UpError("NOT_SUPPORTED", "the profile cannot call its own Key Manager through execute (CallingKeyManagerNotAllowed)", { hint: "send the payload to the Key Manager directly (the transports do this for you)" });
    }
    if (getAddress(c.to) === getAddress(req.profile) && c.data !== "0x") warnings.push("the profile calls itself: the inner call is checked against the profile's own (empty) permissions and will normally revert");
  }
  return warnings;
}

/** admin if the payload changes control (LSP6 keys, URD, extensions, ownership) or is not understood; otherwise write. */
export function payloadRisk(payload: Hex): "write" | "admin" {
  return decodeProfilePayload(payload).risk;
}

export interface CallView {
  operation: string;
  to: Address;
  value: string;
  valueFormatted: string;
  function?: string;
  args?: unknown[];
  decodedBy?: string;
  data: Hex;
}

export function callViews(req: ExecRequestExt, nativeSymbol: string): CallView[] {
  return (req.calls ?? []).map((c) => {
    const d = decodeCalldata(c.data, req.abi);
    return {
      operation: OPERATION_NAMES[c.operation] ?? String(c.operation),
      to: c.to,
      value: c.value.toString(),
      valueFormatted: `${formatEther(c.value)} ${nativeSymbol}`,
      function: d.function,
      args: d.args,
      decodedBy: d.source,
      data: c.data,
    };
  });
}

export function nativeSymbol(ctx: VerbContext, chainId: number): string {
  try {
    return ctx.registry.chain(chainId).nativeSymbol;
  } catch {
    return "native";
  }
}

export function chainName(ctx: VerbContext, chainId: number): string {
  try {
    return ctx.registry.chain(chainId).name;
  } catch {
    return `chain ${chainId}`;
  }
}

export const PATH_LABEL: Record<ExecPath, string> = {
  km: "direct Key Manager: controller EOA → KeyManager.execute(payload)",
  lsp0: "direct LSP0/LSP20: controller EOA → UniversalProfile, verified by the Key Manager (lsp20VerifyCall)",
  relay: "LSP25 relay: controller signs, relayer submits KeyManager.executeRelayCall",
  userop: "ERC-4337 UserOperation via EntryPoint + Extension4337",
};

export function totalValue(req: ExecRequest): bigint {
  return effectiveCalls(req).reduce((s, c) => s + c.value, 0n);
}

/** The complete confirmation block shown before any signature. */
export function confirmationBlock(
  ctx: VerbContext,
  req: ExecRequestExt,
  x: { path: ExecPath; keyManager?: Address; gasPayer: string; entry: { to: Address; data: Hex; value: bigint; function: string }; payload: Hex; signer: Address; extra?: Record<string, unknown>; warnings?: string[] },
): Record<string, unknown> {
  const sym = nativeSymbol(ctx, req.chainId);
  const tv = totalValue(req);
  const payloadDecoded = req.calls?.length ? undefined : decodeCalldata(x.payload);
  const raw = req.calls?.length ? undefined : decodeProfilePayload(x.payload);
  return {
    actor: req.profile,
    chainId: req.chainId,
    chain: chainName(ctx, req.chainId),
    keyManager: x.keyManager,
    path: x.path,
    entryPath: PATH_LABEL[x.path],
    signer: x.signer,
    gasPayer: x.gasPayer,
    description: req.description,
    totalValue: tv.toString(),
    totalValueFormatted: `${formatEther(tv)} ${sym}`,
    valueSource: x.entry.value > 0n ? `controller EOA ${x.signer} sends ${formatEther(x.entry.value)} ${sym} with the transaction` : tv > 0n ? "profile balance (ERC725X value field)" : "none",
    calls: req.calls?.length ? callViews(req, sym) : raw?.calls?.length ? callViews({ ...req, calls: raw.calls }, sym) : undefined,
    payloadKind: raw?.kind,
    payloadDataKeys: raw?.dataKeys,
    payloadFunction: payloadDecoded?.function,
    payloadArgs: payloadDecoded?.args,
    payload: x.payload,
    entry: { to: x.entry.to, function: x.entry.function, value: x.entry.value.toString(), calldata: x.entry.data },
    ...x.extra,
    ...req.summaryExtra,
    warnings: x.warnings?.length ? x.warnings : undefined,
  };
}

/**
 * --fund-from-controller: the transaction itself carries the call value, paid from the agent's gas
 * money instead of the profile's balance. Only the human's own words cover that, never the policy.
 */
export function assertControllerValueApproved(ctx: VerbContext, entryValue: bigint, confirmation: Record<string, unknown>): void {
  if (entryValue === 0n || ctx.flags.dryRun || (ctx.flags.approval?.trim().length ?? 0) >= 3) return;
  throw new UpError("CONSENT_REQUIRED", "--fund-from-controller pays the call value from the agent's gas money instead of the profile's balance; only the human's own approval covers that", {
    hint: 'drop --fund-from-controller so the profile pays from its own balance (if it lacks the amount, ask the human to send it to the profile address); use it only when the human asked for exactly this, with --approval "<their exact words>"',
    details: { confirmation },
  });
}

/**
 * Asks for consent once for the whole request. For multi-target batches the
 * delegated policy is checked per call first (ConsentRequest carries one target),
 * unless a human approval string is present.
 */
export async function consentForRequest(ctx: VerbContext, req: ExecRequestExt, confirmation: Record<string, unknown>): Promise<void> {
  const payload = upPayload(req);
  const decoded = req.calls?.length ? undefined : decodeProfilePayload(payload);
  // never let a caller-supplied risk downgrade what the payload itself is
  const derived: "write" | "admin" = decoded ? decoded.risk : "write";
  const risk: "write" | "admin" = req.risk === "admin" || derived === "admin" ? "admin" : "write";
  const verb = req.verb ?? "exec send";
  const calls = effectiveCalls(req);
  if (calls.length > 1 && !ctx.flags.dryRun && !ctx.flags.approval) {
    const policy = await loadPolicy(ctx.home);
    for (const c of calls) {
      const v = policyAllows(policy, { verb, risk, chainId: req.chainId, summary: {}, value: c.value, target: c.to, selector: innerSel(c.data) });
      if (!v.ok) throw new UpError("POLICY_DENIED", `batch call outside the delegated policy: ${v.reason}`, { hint: "ask the human to approve this exact batch and pass their words with --approval", details: { confirmation } });
    }
  }
  const first = calls[0];
  const target = first ? first.to : decoded?.kind === "ownership" && decoded.targets[0] ? decoded.targets[0] : req.profile;
  const selector = first ? innerSel(first.data) : (payload.slice(0, 10).toLowerCase() as Hex);
  await ctx.consent({
    verb,
    risk,
    chainId: req.chainId,
    summary: decoded ? { ...confirmation, payloadDecoded: { kind: decoded.kind, totalValue: decoded.totalValue.toString(), targets: decoded.targets, innerSelectors: decoded.innerSelectors, dataKeys: decoded.dataKeys } } : confirmation,
    value: calls.reduce((s, c) => s + c.value, 0n),
    target,
    selector,
    calls: calls.map((c) => ({ target: c.to, selector: innerSel(c.data), value: c.value })),
  });
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export interface DecodedEvent {
  address: Address;
  event: string;
  args: Record<string, unknown>;
}

const EVENT_ABIS: Abi[] = [UP_ABI, KM_ABI];

export function decodeReceiptEvents(receipt: Pick<TransactionReceipt, "logs">): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const log of receipt.logs ?? []) {
    for (const abi of EVENT_ABIS) {
      try {
        const d = decodeEventLog({ abi, data: log.data, topics: log.topics as any, strict: false });
        out.push({ address: getAddress(log.address), event: String(d.eventName), args: (d.args ?? {}) as Record<string, unknown> });
        break;
      } catch {}
    }
  }
  return out;
}

export function outcomeText(o: ExecOutcome): string {
  const lines = [`${o.status === "dry-run" ? "DRY RUN (nothing signed or sent)" : o.status} via ${o.path} on chain ${o.chainId}`, `actor: ${o.profile}`, `gas payer: ${o.gasPayer}`];
  if (o.txHash) lines.push(`tx: ${o.txHash}${o.explorerUrl ? ` (${o.explorerUrl})` : ""}`);
  if (o.relayTaskId) lines.push(`relay task: ${o.relayTaskId}`);
  for (const w of o.warnings ?? []) lines.push(`warning: ${w}`);
  return lines.join("\n");
}
