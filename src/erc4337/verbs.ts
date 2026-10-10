// ERC-4337 verbs (opt-in module). 4337 is never enabled by default and never
// auto-selected; these verbs are used only when the user explicitly asks for it.
//   account 4337 status | deploy-entrypoint | deploy-extension | enable | disable | deposit | withdraw
//   exec userop
//   bundler set <chain> <url|none>
import { encodeFunctionData, getAddress, isAddress, isHex, parseAbiItem, parseUnits, type Address, type Hex } from "viem";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import type { ParamDef, VerbContext } from "../core/types.ts";
import { OPERATION, executeAsProfile, type ExecCall, type ExecPath, type OperationType } from "../exec/transport.ts";
import { ENTRYPOINT_V06 } from "./constants.ts";
import { deployEntryPoint, entryPointStatus, nickFactoryGap, nickFactoryStatus } from "./entrypoint.ts";
import { deployExtension, deposit4337, disable4337, enable4337, hintForMissing, status4337, withdraw4337, type EpScopeMode } from "./extension.ts";
import { extensionAddressFor } from "./bytecode.ts";
import { BundlerClient, redactUrl, validateBundlerUrl } from "./bundler.ts";
import type { UserOpExecOptions } from "./transport.ts";
import type { AllowedCallInput } from "./lsp6.ts";
import "./transport.ts"; // registers the "userop" ExecTransport
import { controllerFor } from "../signer/select.ts";

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = { wei: 0, gwei: 9, ether: 18, eth: 18, lyx: 18, native: 18 };

/** "123" = wei; "0.5 ether" / "0.5eth" / "1 lyx" / "10 gwei" with an explicit unit. Decimals need a unit. */
export function parseAmount(raw: unknown, what = "value"): bigint {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) throw new UpError("BAD_ARGS", `${what} must be a non-negative integer in wei or carry a unit (e.g. "0.1 ether")`);
    return BigInt(raw);
  }
  const s = String(raw ?? "").trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(s);
  if (!m) throw new UpError("BAD_ARGS", `cannot parse ${what} "${raw}"`, { hint: 'use wei ("1000") or a unit ("0.1 ether", "10 gwei", "1 lyx")' });
  const unit = m[2] || "wei";
  if (!(unit in UNITS)) throw new UpError("BAD_ARGS", `unknown unit "${unit}" in ${what}`, { hint: `units: ${Object.keys(UNITS).join(", ")}` });
  if (unit === "wei" && m[1].includes(".")) throw new UpError("BAD_ARGS", `${what} "${raw}" has decimals but no unit`, { hint: 'add a unit, e.g. "0.1 ether"' });
  return parseUnits(m[1], UNITS[unit]);
}

function optBig(v: unknown, what: string): bigint | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return parseAmount(v, what);
}

function addr(v: unknown, what: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new UpError("BAD_ARGS", `${what} must be an address, got ${String(v)}`);
  return getAddress(v);
}

function hexArg(v: unknown, what: string): Hex {
  if (v === undefined || v === null || v === "") return "0x";
  if (typeof v !== "string" || !isHex(v)) throw new UpError("BAD_ARGS", `${what} must be 0x-prefixed hex`);
  return v as Hex;
}

const OPS: Record<string, OperationType> = { CALL: OPERATION.CALL, CREATE: OPERATION.CREATE, CREATE2: OPERATION.CREATE2, STATICCALL: OPERATION.STATICCALL };
const ZERO: Address = "0x0000000000000000000000000000000000000000";

function parseOperation(v: unknown): OperationType {
  if (v === undefined || v === null || v === "") return OPERATION.CALL;
  const k = String(v).toUpperCase();
  if (k === "DELEGATECALL" || k === "4") throw new UpError("NOT_SUPPORTED", "DELEGATECALL is always rejected by the Key Manager (DelegateCallDisallowedViaKeyManager)");
  if (/^[0-3]$/.test(k)) return Number(k) as OperationType;
  const op = OPS[k];
  if (op === undefined) throw new UpError("BAD_ARGS", `unknown operation "${v}" (CALL, STATICCALL, CREATE, CREATE2)`);
  return op;
}

function encodeFn(fn: string, args: unknown): Hex {
  let item;
  try {
    item = parseAbiItem(fn.trim().startsWith("function ") ? fn.trim() : `function ${fn.trim()}`);
  } catch (e) {
    throw new UpError("BAD_ARGS", `cannot parse --fn "${fn}" (${(e as Error).message})`, { hint: 'use a human-readable signature, e.g. "transfer(address to, uint256 amount)"' });
  }
  const list = args === undefined ? [] : Array.isArray(args) ? args : [args];
  try {
    return encodeFunctionData({ abi: [item], args: list } as any);
  } catch (e) {
    throw new UpError("BAD_ARGS", `cannot encode --args for ${fn}: ${(e as Error).message}`);
  }
}

function parseJsonArg(v: unknown, what: string): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new UpError("BAD_ARGS", `${what} must be valid JSON`);
  }
}

/** Same inputs as `exec send`: --to --value --data | --fn --args, or --calls '[{to,value,data,operation}]', or --payload (raw UP calldata). */
export function callsFromArgs(a: Record<string, any>): { calls?: ExecCall[]; payload?: Hex } {
  const hasCalls = a.calls !== undefined && a.calls !== null && a.calls !== "";
  if (a.payload) {
    if (hasCalls || a.to) throw new UpError("BAD_ARGS", "--payload cannot be combined with --to/--calls");
    return { payload: hexArg(a.payload, "--payload") };
  }
  if (hasCalls) {
    if (a.to) throw new UpError("BAD_ARGS", "use either --to/--value/--data or --calls, not both");
    const list = parseJsonArg(a.calls, "--calls");
    if (!Array.isArray(list) || list.length === 0) throw new UpError("BAD_ARGS", "--calls must be a non-empty JSON array of {to, value?, data?, operation?}");
    return {
      calls: list.map((c: any, i: number) => {
        const operation = parseOperation(c.operation);
        const data = c.fn ? encodeFn(c.fn, c.args) : hexArg(c.data, `calls[${i}].data`);
        const to = operation === OPERATION.CREATE || operation === OPERATION.CREATE2 ? ZERO : addr(c.to, `calls[${i}].to`);
        return { operation, to, value: optBig(c.value, `calls[${i}].value`) ?? 0n, data };
      }),
    };
  }
  const operation = parseOperation(a.operation);
  if (!a.to && operation !== OPERATION.CREATE && operation !== OPERATION.CREATE2) throw new UpError("BAD_ARGS", "missing --to (or --calls / --payload)");
  if (a.fn && a.data) throw new UpError("BAD_ARGS", "use either --data or --fn/--args");
  const data = a.fn ? encodeFn(a.fn, parseJsonArg(a.args, "--args")) : hexArg(a.data, "--data");
  const to = operation === OPERATION.CREATE || operation === OPERATION.CREATE2 ? ZERO : addr(a.to, "--to");
  return { calls: [{ operation, to, value: optBig(a.value, "--value") ?? 0n, data }] };
}

async function chainAndProfile(ctx: VerbContext, a: Record<string, any>): Promise<{ chainId: number; profile: Address }> {
  await ctx.config();
  const chainId = ctx.chainId(a.chain);
  return { chainId, profile: await ctx.profile(a.profile, chainId) };
}

/** --signer, else the agent's key for this chain (its chain-specific key, else the default key). */
async function signerAddress(ctx: VerbContext, a: Record<string, any>, chainId: number): Promise<Address> {
  if (a.signer) return addr(a.signer, "--signer");
  const c = controllerFor(await ctx.config(), chainId);
  if (c) return c.address;
  return (await ctx.signer(chainId)).address;
}

const VIA: ParamDef = { name: "via", type: "string", enum: ["km", "lsp0", "relay"], default: "km", description: "Execution path for the profile-side writes (default: km = controller → Key Manager)." };

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

function stripRaw<T extends { raw?: unknown }>(s: T): Omit<T, "raw"> {
  const { raw: _raw, ...rest } = s;
  return rest;
}

// ---------------------------------------------------------------------------
// account 4337 status
// ---------------------------------------------------------------------------

defineVerb({
  name: "account 4337 status",
  group: "erc4337",
  summary: "Show whether ERC-4337 (opt-in) is usable for the profile on a chain: EntryPoint v0.6, Extension4337 deployed + linked, EntryPoint controller permissions, signer bit 23, deposit, bundler.",
  description: "Read-only. ERC-4337 is an opt-in module: it is never enabled by default. LSP25 relay is the primary gasless path.",
  risk: "read",
  params: [{ name: "signer", type: "string", description: "Controller whose 4337 permission (bit 23) to check. Default: the configured controller." }],
  examples: ["up account 4337 status --chain 4201 --profile 0x…"],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const s = await status4337(ctx, chainId, profile, await signerAddress(ctx, a, chainId));
    const cfg = await ctx.config();
    const bundlerUrl = cfg.bundlers?.[String(chainId)];
    const data = json({
      ...stripRaw(s),
      bundler: bundlerUrl ? { url: redactUrl(bundlerUrl), mode: "bundler" } : { url: null, mode: "self-bundle (controller EOA calls handleOps; not gasless)" },
      next: s.missing.length ? hintForMissing(s) : undefined,
    });
    const yes = (b: boolean) => (b ? "yes" : "no");
    const text = [
      `ERC-4337 on chain ${chainId} for ${s.profile}: ${s.enabled ? "ENABLED" : "not enabled"} (opt-in)`,
      `EntryPoint v0.6 ${s.entryPoint.address}: deployed ${yes(s.entryPoint.deployed)}, canonical ${yes(s.entryPoint.canonical)}; Nick factory ${yes(s.nickFactory.matches)}`,
      `Extension4337: expected ${s.extension.expected} (deployed ${yes(s.extension.deployed)}); linked ${s.extension.linked ?? "none"}${s.extension.linked ? ` (serves EntryPoint ${yes(s.extension.linkedMatches)})` : ""}`,
      `EntryPoint controller: ${s.entryPointController.isController ? s.entryPointController.permissionNames.join(", ") : "not a controller"}`,
      `Signer ${s.signer.address}: bit 23 ${yes(s.signer.has4337)}`,
      `Deposit: ${s.deposit} wei; bundler: ${bundlerUrl ? redactUrl(bundlerUrl) : "none (self-bundling)"}`,
      ...(s.missing.length ? [`Next: ${hintForMissing(s)}`] : []),
    ].join("\n");
    return { data, text };
  },
});

// ---------------------------------------------------------------------------
// deployments
// ---------------------------------------------------------------------------

defineVerb({
  name: "account 4337 deploy-entrypoint",
  group: "erc4337",
  summary: "Deploy the canonical ERC-4337 EntryPoint v0.6 (0x5FF137D4…2789) through Nick's CREATE2 factory where it is missing. Only on explicit user request.",
  description: "Sends the bundled @account-abstraction/contracts 0.6.0 creation code with salt 0 through 0x4e59b448…956C from the controller EOA (~5M gas). Pre-checks the factory; post-checks the runtime code hash.",
  risk: "admin",
  params: [],
  async run(ctx, a) {
    await ctx.config();
    const chainId = ctx.chainId(a.chain);
    const st = await entryPointStatus(ctx, chainId);
    if (st.deployed) {
      if (!st.canonical) throw new UpError("NOT_SUPPORTED", `${st.address} on chain ${chainId} holds non-canonical code (hash ${st.codeHash})`, { details: st });
      return { data: json({ chainId, status: "already-deployed", ...st }), text: `EntryPoint v0.6 already deployed at ${st.address} on chain ${chainId} (canonical code).` };
    }
    const f = await nickFactoryStatus(ctx, chainId);
    if (!f.matches) throw nickFactoryGap(chainId, f);
    const signer = await ctx.signer(chainId);
    await ctx.consent({ verb: "account 4337 deploy-entrypoint", risk: "admin", chainId, target: f.address, summary: { deploy: "EntryPoint v0.6", address: st.address, factory: f.address, salt: "0x00…00", gasPayer: `controller EOA ${signer.address}` } });
    const r = await deployEntryPoint(ctx, signer, chainId);
    return { data: json(r), text: r.status === "dry-run" ? `dry-run: EntryPoint v0.6 would be deployed at ${r.address}` : `EntryPoint v0.6 deployed at ${r.address} (tx ${r.txHash})` };
  },
});

defineVerb({
  name: "account 4337 deploy-extension",
  group: "erc4337",
  summary: "Deploy the bundled Extension4337(EntryPoint v0.6) deterministically through Nick's factory (same address on every chain). Only on explicit user request.",
  risk: "admin",
  params: [],
  async run(ctx, a) {
    await ctx.config();
    const chainId = ctx.chainId(a.chain);
    const ep = await entryPointStatus(ctx, chainId);
    const warnings = ep.deployed ? [] : [`EntryPoint v0.6 is not deployed on chain ${chainId} yet (up account 4337 deploy-entrypoint); the extension is not usable before that`];
    const expected = extensionAddressFor(ENTRYPOINT_V06);
    const signer = await ctx.signer(chainId);
    const existing = await ctx.rpc.request<Hex>(chainId, "eth_getCode", [expected, "latest"]);
    if (!existing || existing === "0x") {
      const f = await nickFactoryStatus(ctx, chainId);
      if (!f.matches) throw nickFactoryGap(chainId, f);
      await ctx.consent({ verb: "account 4337 deploy-extension", risk: "admin", chainId, target: f.address, summary: { deploy: "Extension4337", entryPoint: ENTRYPOINT_V06, address: expected, gasPayer: `controller EOA ${signer.address}` } });
    }
    const r = await deployExtension(ctx, signer, chainId, ENTRYPOINT_V06);
    return { data: json(r), warnings, text: r.status === "already-deployed" ? `Extension4337 already deployed at ${r.address}` : r.status === "dry-run" ? `dry-run: Extension4337 would be deployed at ${r.address}` : `Extension4337 deployed at ${r.address} (tx ${r.txHash})` };
  },
});

// ---------------------------------------------------------------------------
// enable / disable
// ---------------------------------------------------------------------------

defineVerb({
  name: "account 4337 enable",
  group: "erc4337",
  summary: "Opt in to ERC-4337 for the profile on one chain: deploy EntryPoint v0.6 + Extension4337 if missing, link the extension, add the EntryPoint as a scoped controller, grant the signer bit 23, optionally deposit. One consolidated confirmation; done steps are skipped.",
  description:
    "Only when the user explicitly wants 4337 (LSP25 relay is the default gasless path). EntryPoint scope: mirror (default for a new EntryPoint controller: CALL/TRANSFERVALUE/STATICCALL/SETDATA restricted by the signer's own AllowedCalls/AllowedERC725YDataKeys; SUPER_* never mirrored), super (explicit SUPER_CALL/SUPER_TRANSFERVALUE/SUPER_STATICCALL/SUPER_SETDATA) or custom. Never grants CHANGEOWNER/ADDCONTROLLER/EDITPERMISSIONS/extension permissions to the EntryPoint.",
  risk: "admin",
  params: [
    { name: "ep-scope", type: "string", enum: ["mirror", "super", "custom"], description: "EntryPoint controller scope. Omit to keep an existing EntryPoint controller unchanged (new: mirror)." },
    { name: "ep-permissions", type: "string[]", description: "custom scope: permission names (subset of CALL, TRANSFERVALUE, STATICCALL, SETDATA, DEPLOY and SUPER_ variants)." },
    { name: "ep-allowed-calls", type: "json", description: 'custom scope: AllowedCalls entries [{"callTypes":["CALL","VALUE"],"address":"0x…","standard":"*","function":"*"}].' },
    { name: "ep-allowed-keys", type: "string[]", description: "custom scope: AllowedERC725YDataKeys (1-32 byte hex keys/prefixes)." },
    { name: "deposit", type: "string", description: 'Optional EntryPoint deposit after enabling (wei or with unit, e.g. "0.05 ether").' },
    { name: "deposit-from", type: "string", enum: ["profile", "controller"], default: "profile", description: "Deposit source: the profile balance (UP.execute → depositTo) or the controller EOA." },
    VIA,
  ],
  examples: ["up account 4337 enable --chain 4201 --ep-scope super --deposit '0.05 ether' --approval \"<human words>\""],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const signer = await ctx.signer(chainId);
    const rawCalls = a["ep-allowed-calls"] === undefined ? undefined : parseJsonArg(a["ep-allowed-calls"], "--ep-allowed-calls");
    const allowedCalls = rawCalls === undefined ? undefined : ((Array.isArray(rawCalls) ? rawCalls : [rawCalls]) as AllowedCallInput[]);
    const r = await enable4337(ctx, signer, {
      chainId,
      profile,
      scope: a["ep-scope"] as EpScopeMode | undefined,
      permissions: a["ep-permissions"],
      allowedCalls,
      allowedDataKeys: a["ep-allowed-keys"],
      deposit: optBig(a.deposit, "--deposit"),
      depositFrom: a["deposit-from"],
      via: a.via as ExecPath,
    });
    const data = json({ ...r, status: r.status ? stripRaw(r.status) : undefined });
    const text = [
      `ERC-4337 ${ctx.flags.dryRun ? "enable (dry-run)" : "enabled"} on chain ${chainId} for ${profile}`,
      ...r.steps.map((s) => `- ${s.step}: ${s.status}`),
      `EntryPoint scope (${r.scope.mode}): ${r.scope.permissionNames.join(", ")}`,
      ...(r.verification ? [`verification: ${r.verification.ok ? "ok" : "FAILED"} — ${r.verification.detail}`] : []),
    ].join("\n");
    return { data, text, warnings: r.warnings };
  },
});

defineVerb({
  name: "account 4337 disable",
  group: "erc4337",
  summary: "Turn ERC-4337 off for the profile on one chain: unlink Extension4337, remove the EntryPoint controller (and from AddressPermissions[]), remove bit 23 from the signer; optionally withdraw the EntryPoint deposit first.",
  risk: "admin",
  params: [
    { name: "withdraw", type: "boolean", default: false, description: "Withdraw the whole EntryPoint deposit first." },
    { name: "withdraw-to", type: "string", description: "Withdrawal recipient (default: the profile)." },
    { name: "keep-signer-permission", type: "boolean", default: false, description: "Keep bit 23 on the signer." },
    VIA,
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const signer = await ctx.signer(chainId);
    const r = await disable4337(ctx, signer, {
      chainId,
      profile,
      withdraw: a.withdraw,
      withdrawTo: a["withdraw-to"] ? addr(a["withdraw-to"], "--withdraw-to") : undefined,
      keepSignerPermission: a["keep-signer-permission"],
      via: a.via as ExecPath,
    });
    const data = json({ ...r, status: r.status ? stripRaw(r.status) : undefined });
    return { data, warnings: r.warnings, text: [`ERC-4337 ${ctx.flags.dryRun ? "disable (dry-run)" : "disabled"} on chain ${chainId} for ${profile}`, ...r.steps.map((s) => `- ${s.step}: ${s.status}`)].join("\n") };
  },
});

// ---------------------------------------------------------------------------
// deposit / withdraw
// ---------------------------------------------------------------------------

defineVerb({
  name: "account 4337 deposit",
  group: "erc4337",
  summary: "Fund the profile's EntryPoint v0.6 deposit (Extension4337 never pays prefund, so UserOperations need a deposit or a paymaster).",
  risk: "write",
  params: [
    { name: "amount", type: "string", required: true, positional: 0, description: 'Amount (wei or with unit, e.g. "0.05 ether").' },
    { name: "from", type: "string", enum: ["profile", "controller"], default: "profile", description: "profile: UP.execute(CALL, EntryPoint, amount, depositTo(UP)) from the profile balance; controller: the controller EOA pays from its own balance." },
    VIA,
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const signer = await ctx.signer(chainId);
    const ep = await entryPointStatus(ctx, chainId);
    if (!ep.canonical) throw new UpError("NOT_DEPLOYED", `EntryPoint v0.6 is not deployed on chain ${chainId}`, { hint: `only if the user wants 4337: up account 4337 enable --chain ${chainId}` });
    const r = await deposit4337(ctx, signer, { chainId, profile, amount: parseAmount(a.amount, "--amount"), from: a.from, via: a.via as ExecPath });
    return { data: json(r), text: `${ctx.flags.dryRun ? "dry-run: would deposit" : "deposited"} ${r.amount} wei to the EntryPoint for ${profile}${r.depositAfter !== undefined ? ` (deposit now ${r.depositAfter} wei)` : ""}` };
  },
});

defineVerb({
  name: "account 4337 withdraw",
  group: "erc4337",
  summary: "Withdraw from the profile's EntryPoint v0.6 deposit (UP.execute(CALL, EntryPoint, 0, withdrawTo(to, amount))).",
  risk: "write",
  params: [
    { name: "amount", type: "string", positional: 0, description: 'Amount (wei or with unit) or "all" (default).' },
    { name: "to", type: "string", description: "Recipient (default: the profile)." },
    VIA,
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const signer = await ctx.signer(chainId);
    const all = a.amount === undefined || String(a.amount).toLowerCase() === "all";
    const r = await withdraw4337(ctx, signer, { chainId, profile, amount: all ? undefined : parseAmount(a.amount, "--amount"), to: a.to ? addr(a.to, "--to") : undefined, via: a.via as ExecPath });
    return { data: json(r), text: `${ctx.flags.dryRun ? "dry-run: would withdraw" : "withdrew"} ${r.amount} wei from the EntryPoint deposit to ${r.to}` };
  },
});

// ---------------------------------------------------------------------------
// exec userop
// ---------------------------------------------------------------------------

defineVerb({
  name: "exec userop",
  group: "execute",
  summary: "Execute as the profile through an ERC-4337 v0.6 UserOperation (opt-in path; requires `account 4337 enable` on that chain). Uses the chain's bundler, else self-bundles (controller calls handleOps; not gasless).",
  description: "Same inputs as exec send: --to --value --data | --fn --args, or --calls JSON, or --payload (raw UP calldata such as setData). Gas is charged to the profile's EntryPoint deposit.",
  risk: "write",
  params: [
    { name: "to", type: "string", description: "Target address." },
    { name: "value", type: "string", description: 'Native value from the profile (wei or with unit, e.g. "0.1 ether").' },
    { name: "data", type: "string", description: "Calldata (hex)." },
    { name: "fn", type: "string", description: 'Function signature to encode, e.g. "transfer(address to, uint256 amount)".' },
    { name: "args", type: "json", description: "Arguments for --fn as a JSON array." },
    { name: "operation", type: "string", enum: ["CALL", "STATICCALL", "CREATE", "CREATE2"], description: "ERC725X operation (default CALL)." },
    { name: "calls", type: "json", description: 'Batch: [{"to":"0x…","value":"0","data":"0x…","operation":"CALL"}] → UP.executeBatch.' },
    { name: "payload", type: "string", description: "Raw UP calldata (e.g. setDataBatch) instead of calls." },
    { name: "bundler", type: "string", description: 'Bundler URL override for this call, or "none" to self-bundle.' },
    { name: "self-bundle", type: "boolean", description: "Ignore the configured bundler and self-bundle." },
    { name: "paymaster-and-data", type: "string", description: "paymasterAndData bytes from a paymaster service (default 0x = profile deposit pays)." },
    { name: "call-gas-limit", type: "string", description: "Override callGasLimit." },
    { name: "verification-gas-limit", type: "string", description: "Override verificationGasLimit." },
    { name: "pre-verification-gas", type: "string", description: "Override preVerificationGas." },
    { name: "max-fee-per-gas", type: "string", description: "Override maxFeePerGas (wei or with unit)." },
    { name: "max-priority-fee-per-gas", type: "string", description: "Override maxPriorityFeePerGas (wei or with unit)." },
  ],
  examples: ["up exec userop --chain 4201 --to 0x… --value '0.01 ether'", "up exec userop --chain 4201 --calls '[{\"to\":\"0x…\",\"value\":\"1000\"},{\"to\":\"0x…\",\"data\":\"0x…\"}]'"],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const req = { chainId, profile, ...callsFromArgs(a) };
    const opts: UserOpExecOptions = {
      via: "userop",
      userop: {
        bundlerUrl: a.bundler === undefined ? undefined : String(a.bundler).toLowerCase() === "none" ? null : a.bundler,
        selfBundle: a["self-bundle"],
        paymasterAndData: a["paymaster-and-data"] ? hexArg(a["paymaster-and-data"], "--paymaster-and-data") : undefined,
        gas: {
          callGasLimit: optBig(a["call-gas-limit"], "--call-gas-limit"),
          verificationGasLimit: optBig(a["verification-gas-limit"], "--verification-gas-limit"),
          preVerificationGas: optBig(a["pre-verification-gas"], "--pre-verification-gas"),
          maxFeePerGas: optBig(a["max-fee-per-gas"], "--max-fee-per-gas"),
          maxPriorityFeePerGas: optBig(a["max-priority-fee-per-gas"], "--max-priority-fee-per-gas"),
        },
      },
    };
    const out = await executeAsProfile(ctx, req, opts);
    const text =
      out.status === "dry-run"
        ? `dry-run: UserOperation ${out.userOpHash} validated (not sent). Gas payer: ${out.gasPayer}`
        : `UserOperation ${out.userOpHash} executed in ${out.txHash} (block ${out.blockNumber}). Gas payer: ${out.gasPayer}`;
    return { data: json(out), text, warnings: out.warnings };
  },
});

// ---------------------------------------------------------------------------
// bundler set
// ---------------------------------------------------------------------------

defineVerb({
  name: "bundler set",
  group: "erc4337",
  summary: 'Configure the ERC-4337 bundler RPC for a chain (used by exec userop); "none" removes it (self-bundling).',
  description: "The URL is stored in config.json (0600) and never printed in full (API keys in URLs are masked). Verified with eth_chainId and eth_supportedEntryPoints (must include EntryPoint v0.6).",
  risk: "local",
  params: [
    { name: "chain", type: "string", required: true, positional: 0, description: "Chain id or name." },
    { name: "url", type: "string", required: true, positional: 1, description: 'Bundler JSON-RPC URL (https), or "none".' },
    { name: "verify", type: "boolean", default: true, description: "Check chain id and EntryPoint v0.6 support before saving." },
  ],
  async run(ctx, a) {
    const cfg = await ctx.config();
    const chainId = ctx.chainId(a.chain);
    const bundlers = { ...(cfg.bundlers ?? {}) };
    const dry = ctx.flags.dryRun;
    if (String(a.url).toLowerCase() === "none") {
      delete bundlers[String(chainId)];
      if (!dry) await ctx.saveConfig({ ...cfg, bundlers });
      return { data: { chainId, bundler: null, mode: "self-bundle" }, text: `bundler removed for chain ${chainId}; exec userop will self-bundle (not gasless)` };
    }
    const url = validateBundlerUrl(String(a.url));
    let verified: unknown = undefined;
    if (a.verify) verified = await new BundlerClient(url).verify(chainId, ENTRYPOINT_V06);
    bundlers[String(chainId)] = url;
    if (!dry) await ctx.saveConfig({ ...cfg, bundlers });
    return { data: json({ chainId, bundler: redactUrl(url), verified, saved: !dry }), text: `${dry ? "dry-run: would set" : "set"} bundler for chain ${chainId} to ${redactUrl(url)}${a.verify ? " (verified: EntryPoint v0.6 supported)" : ""}` };
  },
});
