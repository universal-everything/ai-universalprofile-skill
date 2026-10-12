// Generic contract interaction: resolve the function (discovered ABI, explicit
// --abi, or a full signature), encode, and apply the trust-ladder policy before
// anything is executed through the profile.
//
// Policy (abi-and-ecosystem-plan §2): a VALUE-MOVING call needs an ABI from
// rung ≤ 4 (bundled/onchain/exact/partial/proxy); otherwise (caller-supplied ABI
// that could not be matched on-chain, bare signature, selector guess) it is only
// built when the human approved this exact action (--approval "<their words>")
// after seeing the decoded call, the raw calldata and the trust label.
// A `guessed` ABI is never used for ANY state-changing call without approval,
// because even the function name is unverified.
//
// Value-moving (see valueMovingReason; names matched case-insensitively incl.
// suffixed variants): native value > 0; asset transfers (transfer*, safeTransfer*,
// send*, withdraw*, redeem*, burn*, deposit*, swap*, bridge*); spending rights
// (approve*, increaseAllowance, authorizeOperator, setApprovalForAll, permit*,
// setPreSignature); control (transferOwnership, acceptOwnership, renounceOwnership,
// upgrade*); call wrappers whose inner calls are not trusted (execute*, batch*,
// multicall*, aggregate*, handle*Ops); setData* writing an LSP6 permission,
// LSP17 extension or LSP1 delegate key (every bytes32 argument is inspected).
import { decodeFunctionData, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import type { ParamDef, TrustLabel, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { executeAsProfile, type ExecCall, type ExecOutcome, type ExecPath } from "../exec/transport.ts";
import { encodeCall, functionsOf, parseAbiInput, parseInteger, resolveFunction, toBaseUnits, type AbiSource, type EncodedCall } from "./codec.ts";
import { discoverAbi, isSignableTrust, standardAbi, type AbiRecord, type DiscoveryOptions } from "./discovery.ts";
import { dispatcherSelectors } from "./proxy.ts";
import { getCode } from "./read.ts";
import { isReadOnly, selectorOf } from "./signature.ts";

export const VIA_VALUES = ["auto", "km", "lsp0", "relay", "userop"] as const;

/** Execution params shared by every verb that acts as the profile. */
export const EXEC_PARAMS: ParamDef[] = [
  {
    name: "via",
    type: "string",
    description: "Execution path: auto (default), km (controller → KeyManager.execute), lsp0 (controller → UP.execute, LSP20), relay (LSP25 via a relayer), userop (ERC-4337, opt-in).",
    enum: VIA_VALUES,
    default: "auto",
  },
  { name: "relayer", type: "string", description: "relay path only: relayer name or base URL from config." },
];

/** Runs ERC725X calls as the profile through the shared transport layer (consent is requested by the transport). */
export async function runAsProfile(ctx: VerbContext, req: { chainId: number; profile: Address; calls: ExecCall[]; description: string }, a: Record<string, any>): Promise<ExecOutcome> {
  return executeAsProfile(ctx, req, { via: (a.via ?? "auto") as ExecPath, ...(a.relayer ? { relayer: String(a.relayer) } : {}) });
}

// ---------------------------------------------------------------------------
// Value-moving classification
// ---------------------------------------------------------------------------

/** Case-insensitive name patterns (prefix families cover *AndCall, *From, overloads, …). */
const MOVING_NAMES =
  /^(transfer\w*|safeTransfer\w*|safeBatchTransfer\w*|send\w*|operatorSend\w*|withdraw\w*|redeem\w*|burn\w*|deposit\w*|swap\w*|bridge\w*|approve\w*|increaseAllowance\w*|authorizeOperator\w*|setApprovalForAll\w*|permit\w*|setPreSignature|acceptOwnership|renounceOwnership|upgrade\w*|execute\w*|multicall\w*|batch\w*|aggregate\w*|handle\w*Ops)$/i;

const SET_DATA = /^setData\w*$/i;

/** ERC725Y key prefixes that grant control: LSP6 permissions/allowed calls/keys/controller list, LSP17 extensions, LSP1 delegates. */
const SENSITIVE_KEY_PREFIXES = [
  "0x4b80742de2bf", // AddressPermissions:* (Permissions 0x4b80742de2bf82acb3630000, AllowedCalls …393a64c7, AllowedERC725YDataKeys …866c2911)
  "0xdf30dba06db6a30e65354d9a64c60986", // AddressPermissions[] (length key and index keys)
  "0xcee78b4094da86011096", // LSP17Extension:<bytes4>
  "0x0cfc51aec37c55a4d0b1", // LSP1UniversalReceiverDelegate and LSP1UniversalReceiverDelegate:<bytes32>
];

export function isSensitiveDataKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PREFIXES.some((p) => k.startsWith(p));
}

/** Every bytes32 / bytes32[] argument value (setData variants carry their keys there). */
function bytes32Args(fn: Pick<AbiFunction, "inputs">, args: readonly unknown[]): string[] {
  const out: string[] = [];
  fn.inputs.forEach((p, i) => {
    if (p.type === "bytes32") out.push(String(args[i]));
    else if (/^bytes32\[\d*\]$/.test(p.type) && Array.isArray(args[i])) out.push(...(args[i] as unknown[]).map(String));
  });
  return out;
}

/**
 * Returns why a call is value-moving, or undefined if it is not. `data` is the
 * encoded calldata, used to inspect the keys of setData-style calls. Any
 * execute* / batch / multicall wrapper is value-moving (inner calls are not trusted).
 */
export function valueMovingReason(fn: Pick<AbiFunction, "name" | "inputs">, value: bigint, data?: Hex): string | undefined {
  if (value > 0n) return `sends ${value} wei of native value`;
  if (MOVING_NAMES.test(fn.name)) return `${fn.name}() moves assets, spending rights or control, or wraps other calls`;
  if (SET_DATA.test(fn.name)) {
    if (!data) return `${fn.name}() keys could not be inspected`;
    let args: readonly unknown[];
    try {
      args = (decodeFunctionData({ abi: [fn as AbiFunction], data }).args ?? []) as readonly unknown[];
    } catch {
      return `${fn.name}() calldata could not be inspected`;
    }
    const keys = bytes32Args(fn, args);
    if (!keys.length) return `${fn.name}() has no bytes32 key argument to inspect`;
    const hit = keys.find(isSensitiveDataKey);
    return hit ? `${fn.name}() writes a permission/extension/delegate key (${hit})` : undefined;
  }
  return undefined;
}

export function isValueMoving(fn: Pick<AbiFunction, "name" | "inputs">, value: bigint, data?: Hex): boolean {
  return valueMovingReason(fn, value, data) !== undefined;
}

/** "0.1" (native units), "1000wei", "2 gwei", "1e15 wei", "5lyx" / "5 native" (every native coin has 18 decimals, like ether). */
export function parseNativeValue(v: unknown): bigint {
  if (v === undefined || v === null || v === "") return 0n;
  const s = String(v).trim().replace(/\s*(lyxt|lyx|native)$/i, " ether");
  const n = /(wei|gwei|ether|eth)$/i.test(s) ? parseInteger(s, "--value") : toBaseUnits(s, 18, "--value");
  if (n < 0n) throw new UpError("BAD_ARGS", "--value must not be negative");
  return n;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedCall {
  target: Address;
  fn: AbiFunction;
  encoded: EncodedCall;
  trust: TrustLabel | "unknown";
  source: string;
  /** the discovery record when discovery ran */
  record?: AbiRecord;
  readOnly: boolean;
  warnings: string[];
}

export interface ResolveOptions extends DiscoveryOptions {
  fn: string;
  args?: unknown;
  abi?: unknown;
}

function covers(abi: Abi, std: Abi): boolean {
  const have = new Set(functionsOf(abi).map(selectorOf));
  return functionsOf(std).every((f) => have.has(selectorOf(f)));
}

/**
 * A bundled ABI named by the caller is promoted from "user" to "bundled" only
 * when the target matches it on-chain: (1) a standard detected on the target
 * (ERC-165, or the ERC-20 probes) is fully covered by the bundled ABI, and
 * (2) the called selector is present in the dispatcher of the target's runtime
 * code (the implementation's for proxies/clones).
 */
export async function matchBundledAbi(ctx: Pick<VerbContext, "rpc">, chainId: number, target: Address, src: AbiSource, fn: AbiFunction, record: AbiRecord | undefined): Promise<{ ok: true; evidence: string[] } | { ok: false; reason: string }> {
  if (record?.canonicalMismatch) return { ok: false, reason: "the code at this canonical address does not match the known deployment" };
  const standards = record?.standards ?? [];
  if (!standards.length) return { ok: false, reason: "no standard interface was detected on the target" };
  const matched = standards.filter((s) => covers(src.abi, standardAbi(s)));
  if (!matched.length) return { ok: false, reason: `the target's detected standard(s) ${standards.join(", ")} are not part of ${src.source}` };
  // only delegations verified on-chain (slots / ERC-1167) point at the code to inspect
  const verifiedProxy = record?.proxy?.isProxy && record.proxy.kind && record.proxy.kind !== "explorer" ? record.proxy.implementation : undefined;
  const codeAt = verifiedProxy ?? target;
  const code = await getCode(ctx, chainId, codeAt);
  const sel = selectorOf(fn);
  if (!dispatcherSelectors(code, 2000).includes(sel)) return { ok: false, reason: `selector ${sel} was not found in the runtime code at ${codeAt}` };
  return { ok: true, evidence: [`standard ${matched.join("+")} detected on-chain`, `selector ${sel} present in the runtime code`] };
}

/**
 * Resolves and encodes a call on `target`. Order: discovered ABI (trust ladder)
 * → explicit --abi → standalone full signature. The trust label is that of the
 * source that actually contains the selector.
 */
export async function resolveCall(ctx: VerbContext, chainId: number, target: Address, o: ResolveOptions): Promise<ResolvedCall> {
  const warnings: string[] = [];
  const argCount = Array.isArray(o.args) ? o.args.length : undefined;
  let record: AbiRecord | undefined;
  let discoveryError: string | undefined;
  try {
    record = await discoverAbi(ctx, chainId, target, o);
  } catch (e) {
    discoveryError = (e as Error).message;
    if ((e as UpError).code !== "ABI_NOT_FOUND") throw e;
  }
  const attempt = (abi: Abi) => {
    try {
      return resolveFunction(abi, o.fn, argCount, false);
    } catch (e) {
      if ((e as UpError).code === "ABI_NOT_FOUND") return undefined;
      throw e;
    }
  };
  if (record) {
    const hit = attempt(record.abi);
    if (hit) {
      const enc = encodeCall(hit.fn, o.args);
      if (record.trust === "guessed") warnings.push(`function ${enc.signature} was matched against a GUESSED ABI (selector database); its name and semantics are unverified`);
      return { target, fn: hit.fn, encoded: enc, trust: record.trust, source: record.source, record, readOnly: isReadOnly(hit.fn), warnings };
    }
  }
  if (o.abi !== undefined && o.abi !== "") {
    const src = parseAbiInput(o.abi);
    const hit = resolveFunction(src.abi, o.fn, argCount, false);
    const enc = encodeCall(hit.fn, o.args);
    let trust: TrustLabel = "user";
    let source = src.source;
    if (src.trust === "bundled") {
      const m = await matchBundledAbi(ctx, chainId, target, src, hit.fn, record);
      if (m.ok) {
        trust = "bundled";
        source = `${src.source} (matched on-chain: ${m.evidence.join("; ")})`;
      } else warnings.push(`bundled ABI ${src.source} could not be matched to ${target}: ${m.reason}; treated as caller-supplied`);
    } else warnings.push(`ABI supplied by the caller (${src.source}); it is not verified against the contract at ${target}`);
    if (record && trust === "user") warnings.push(`the ${record.trust} ABI discovered for ${target} (${record.source}) has no ${enc.signature}`);
    return { target, fn: hit.fn, encoded: enc, trust, source, record, readOnly: isReadOnly(hit.fn), warnings };
  }
  if (o.fn.includes("(")) {
    const hit = resolveFunction([], o.fn, argCount, true);
    const enc = encodeCall(hit.fn, o.args);
    warnings.push(`function given as a bare signature (${enc.signature}); not verified against the contract`);
    if (record) warnings.push(`the ${record.trust} ABI discovered for ${target} (${record.source}) does not contain ${enc.signature}`);
    return { target, fn: hit.fn, encoded: enc, trust: "user", source: "signature", record, readOnly: isReadOnly(hit.fn), warnings };
  }
  throw new UpError("ABI_NOT_FOUND", record ? `function "${o.fn}" not found in the ${record.trust} ABI of ${target} (${record.source})` : `cannot resolve "${o.fn}" for ${target}: ${discoveryError ?? "no ABI"}`, {
    hint: 'pass the full signature, e.g. --fn "transfer(address,uint256)", or an ABI with --abi; list known functions with: up abi functions <address>',
  });
}

/** Throws ABI_UNTRUSTED unless the policy is satisfied (see header). */
export function enforceTrustPolicy(ctx: VerbContext, call: ResolvedCall, value: bigint, raw: { to: Address; data: Hex }): { requiresApproval: boolean; reason?: string } {
  const moving = valueMovingReason(call.fn, value, raw.data);
  const trusted = call.trust !== "unknown" && isSignableTrust(call.trust);
  let reason: string | undefined;
  if (call.trust === "guessed") reason = "the function was identified from a selector database guess";
  else if (moving && !trusted) reason = `value-moving call (${moving}) with an ABI of trust "${call.trust}" (needs bundled/onchain/exact/partial/proxy)`;
  if (!reason) return { requiresApproval: false };
  if (ctx.flags.dryRun) return { requiresApproval: true, reason };
  if (!ctx.flags.approval || ctx.flags.approval.trim().length < 3) {
    throw new UpError("ABI_UNTRUSTED", `human approval required: ${reason}`, {
      hint: 'show the human the decoded call, raw calldata and trust label below; if they approve, re-run with --approval "<their exact words>"',
      details: { confirmation: { target: raw.to, value: value.toString(), call: call.encoded.description, signature: call.encoded.signature, calldata: raw.data, trust: call.trust, abiSource: call.source, warnings: call.warnings } },
    });
  }
  return { requiresApproval: true, reason };
}
