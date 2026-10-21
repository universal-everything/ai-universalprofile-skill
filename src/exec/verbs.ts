// Execute verbs: exec call / send / relay / batch / simulate / receipt, nonce.
import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import "./index.ts";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import type { ParamDef, VerbContext } from "../core/types.ts";
import { decodeRevert, explorerTxUrl, revertData } from "../chain/tx.ts";
import { UP_ABI } from "../lsp/abis.ts";
import { resolveKeyManager } from "../lsp/profile.ts";
import { ethCall } from "../lsp/read.ts";
import { defaultChannel, getRelayNonce, splitNonce } from "../lsp/lsp25.ts";
import { ensureRelayChannel, profileIdentityFor, relayChannelState, type RelayChannel } from "../lsp/relay-channel.ts";
import { listRelayers } from "../relayer/registry.ts";
import { controllerFor } from "../signer/select.ts";
import type { ExecCall, ExecPath } from "./transport.ts";
import { executeAuto } from "./auto.ts";
import { bareValueWarning, buildCall, buildCalls, type CallInput } from "./inputs.ts";
import { decodeReceiptEvents, outcomeText, type ExecOptionsExt, type ExecRequestExt } from "./common.ts";

export const CALL_PARAMS: ParamDef[] = [
  { name: "to", type: "string", description: "Target address the PROFILE calls (msg.sender at the target is the profile)." },
  { name: "value", type: "string", description: "Native value sent BY THE PROFILE from its own balance (never from the agent's key). Give a unit: 5lyx = 5 LYX, 0.1ether, 20gwei; a bare number is wei (5 = 5 wei)." },
  { name: "data", type: "string", description: "Raw calldata (hex). Alternative to --fn/--args." },
  { name: "fn", type: "string", description: 'Function to call: a signature like "transfer(address,uint256)" or, with --abi, a name.' },
  { name: "args", type: "json", description: 'Function arguments as a JSON array (big integers as decimal strings), e.g. ["0xabc…","1000"].' },
  { name: "abi", type: "string", description: "ABI for --fn and for decoding: bundled name (LSP7DigitalAsset, ERC20, …), JSON file path or inline JSON." },
  { name: "operation", type: "string", description: "ERC725X operation.", enum: ["call", "staticcall", "create", "create2"], default: "call" },
];

export const PATH_PARAMS: ParamDef[] = [
  { name: "via", type: "string", description: "Execution path: auto (default: relay if a relayer covers the chain with quota > 0, else km; never userop), km (controller → Key Manager), lsp0 (controller → profile, LSP20-verified), relay (LSP25 via an LSP15 relayer, gasless), userop (opt-in ERC-4337 module, explicit only).", enum: ["auto", "km", "lsp0", "relay", "userop"], default: "auto" },
  { name: "relayer", type: "string", description: "Relayer name or base URL (relay path). Default: first relayer configured for the chain." },
  { name: "channel", type: "string", description: "Advanced, this call only: LSP25 nonce channel (uint128, as a decimal or 0x string). Default: the profile's saved relay channel (one random channel per profile in this state folder, created on the first relayed send, the same on every chain and relayer). Never use it to get around a pending or conflicting call; the saved channel does not change." },
  { name: "validity", type: "integer", description: "Relay validity window in seconds from now (default 600; 0 = unlimited)." },
  { name: "valid-from", type: "integer", description: "Relay validity start (unix seconds); overrides --validity." },
  { name: "valid-until", type: "integer", description: "Relay validity end (unix seconds, 0 = no expiry); overrides --validity." },
  { name: "fund-from-controller", type: "boolean", description: "Direct paths only: the controller EOA sends the call value with the transaction instead of the profile paying from its balance. That spends the agent's gas money, so a call with value always needs the human's --approval; never a fallback when the profile lacks funds." },
];

/** The verb's chain and the profile's address on that chain (a linked chain-specific address when one exists). */
export async function chainAndProfile(ctx: VerbContext, a: Record<string, any>): Promise<{ chainId: number; profile: Address }> {
  await ctx.config();
  const chainId = ctx.chainId(a.chain);
  return { chainId, profile: await ctx.profile(a.profile, chainId) };
}

const U128 = (1n << 128n) - 1n;

/**
 * A uint128 option (nonce channel, validity timestamps): a decimal or 0x string, or a JSON number that is a
 * safe integer. Anything else (fractions, signs, exponents, other bases, out of range) is refused here,
 * before any chain read, signature or relayer request.
 */
export function parseU(v: unknown, name: string, max = U128): bigint | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  let b: bigint | undefined;
  if (typeof v === "number") b = Number.isSafeInteger(v) ? BigInt(v) : undefined;
  else if (typeof v === "bigint") b = v;
  else if (typeof v === "string" && /^(0[xX][0-9a-fA-F]+|[0-9]+)$/.test(v)) b = BigInt(v);
  if (b === undefined || b < 0n) throw new UpError("BAD_ARGS", `--${name} must be a non-negative integer, given as a decimal or 0x string`);
  if (b > max) throw new UpError("BAD_ARGS", `--${name} is out of range (at most ${max === U128 ? "2^128 - 1" : max})`);
  return b;
}

export function execOptions(a: Record<string, any>, via?: ExecPath | "auto"): Omit<ExecOptionsExt, "via"> & { via: ExecPath | "auto" } {
  return {
    via: via ?? (a.via as ExecPath | "auto") ?? "auto",
    relayer: a.relayer,
    channel: parseU(a.channel, "channel"),
    validitySeconds: a.validity,
    validFrom: parseU(a["valid-from"], "valid-from"),
    validUntil: parseU(a["valid-until"], "valid-until"),
    fundFromController: a["fund-from-controller"] === true,
  };
}

function callInputFrom(a: Record<string, any>): CallInput {
  return { to: a.to, value: a.value, data: a.data, fn: a.fn, args: a.args, abi: a.abi, operation: a.operation };
}

/** Bare-number value warnings first, then the outcome's own; undefined when there are none. */
function allWarnings(unit: (string | undefined)[], out?: string[]): string[] | undefined {
  const w = [...unit.filter((x): x is string => !!x), ...(out ?? [])];
  return w.length ? w : undefined;
}

async function runSend(ctx: VerbContext, a: Record<string, any>, verb: string, via?: ExecPath | "auto") {
  const { chainId, profile } = await chainAndProfile(ctx, a);
  const b = buildCall(callInputFrom(a));
  const req: ExecRequestExt = { chainId, profile, calls: [b.call], verb, abi: b.abi };
  const out = await executeAuto(ctx, req, execOptions(a, via));
  const auto = out.autoDecision ? `\npath chosen: ${out.autoDecision.path} — ${out.autoDecision.reason}` : "";
  return { data: out, text: outcomeText(out) + auto, warnings: allWarnings([bareValueWarning(a.value, b.call.value)], out.warnings) };
}

const batchValueWarnings = (inputs: CallInput[], calls: ExecCall[]) => inputs.map((c, i) => bareValueWarning(c?.value, calls[i].value, `calls[${i}].value`));

defineVerb({
  name: "exec send",
  group: "execute",
  summary: "Execute one call AS THE PROFILE (--via auto|km|lsp0|relay|userop; auto = relay when a relayer with quota covers the chain, else direct Key Manager).",
  description:
    "Builds the ERC725X call, simulates it with the exact transport, shows the confirmation block (actor = profile, chain, Key Manager, path, gas payer, target, value, decoded function, raw calldata), asks for consent, then signs and sends. Swaps, approvals and payments to any contract go this way: the target sees the profile as msg.sender, the value comes from the profile balance (unless --fund-from-controller) and outputs belong to the profile; the agent's key only signs and pays gas. A revert is fixed here and simulated again, never retried from the key or a wallet app.",
  risk: "write",
  params: [...CALL_PARAMS, ...PATH_PARAMS],
  examples: ["up exec send --to 0xRecipient --value 0.1ether", 'up exec send --to 0xToken --fn "transfer(address,address,uint256,bool,bytes)" --args \'["0xUP","0xTo","1000",false,"0x"]\' --via relay'],
  run: (ctx, a) => runSend(ctx, a, "exec send"),
});

defineVerb({
  name: "exec relay",
  group: "execute",
  summary: "Execute one call AS THE PROFILE through an LSP15 relayer (LSP25 executeRelayCall, gasless for the agent).",
  risk: "write",
  params: [...CALL_PARAMS, ...PATH_PARAMS.filter((p) => p.name !== "via" && p.name !== "fund-from-controller")],
  run: (ctx, a) => runSend(ctx, a, "exec relay", "relay"),
});

defineVerb({
  name: "exec batch",
  group: "execute",
  summary: "Execute several calls atomically AS THE PROFILE (KM.executeBatch on km, UP.executeBatch on lsp0/relay).",
  risk: "write",
  params: [{ name: "calls", type: "json", description: 'JSON array of calls: [{"to":"0x…","value":"0.1ether"},{"to":"0x…","fn":"approve(address,uint256)","args":["0x…","1"]}]', required: true }, ...PATH_PARAMS],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    if (!Array.isArray(a.calls)) throw new UpError("BAD_ARGS", "--calls must be a JSON array");
    const { calls, abi } = buildCalls(a.calls as CallInput[]);
    const out = await executeAuto(ctx, { chainId, profile, calls, verb: "exec batch", abi } as ExecRequestExt, execOptions(a));
    return { data: out, text: outcomeText(out), warnings: allWarnings(batchValueWarnings(a.calls as CallInput[], calls), out.warnings) };
  },
});

defineVerb({
  name: "exec simulate",
  group: "execute",
  summary: "Build and simulate a call or batch with the exact transport, return the confirmation block — never signs or sends.",
  risk: "read",
  params: [...CALL_PARAMS, { name: "calls", type: "json", description: "Optional JSON array of calls (batch) instead of --to/--data." }, ...PATH_PARAMS],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const sim: VerbContext = { ...ctx, flags: { ...ctx.flags, dryRun: true }, consent: async () => {} };
    let req: ExecRequestExt;
    let unit: (string | undefined)[];
    if (a.calls !== undefined) {
      const { calls, abi } = buildCalls(a.calls as CallInput[]);
      req = { chainId, profile, calls, abi, verb: "exec simulate" };
      unit = batchValueWarnings(a.calls as CallInput[], calls);
    } else {
      const b = buildCall(callInputFrom(a));
      req = { chainId, profile, calls: [b.call], abi: b.abi, verb: "exec simulate" };
      unit = [bareValueWarning(a.value, b.call.value)];
    }
    const out = await executeAuto(sim, req, execOptions(a));
    return { data: { ...out, simulated: true }, text: `simulation OK (nothing signed or sent)\n${outcomeText(out)}`, warnings: allWarnings(unit, out.warnings) };
  },
});

defineVerb({
  name: "exec call",
  group: "execute",
  summary: "Read-only call AS THE PROFILE (eth_call): STATICCALL through UP.execute (msg.sender = profile), or a direct eth_call.",
  risk: "read",
  params: [
    { name: "to", type: "string", description: "Contract to read.", required: true },
    { name: "fn", type: "string", description: 'Function signature with returns, e.g. "balanceOf(address) view returns (uint256)", or a name with --abi.' },
    { name: "args", type: "json", description: "Arguments as a JSON array." },
    { name: "abi", type: "string", description: "Bundled ABI name, JSON file or inline JSON." },
    { name: "data", type: "string", description: "Raw calldata instead of --fn." },
    { name: "mode", type: "string", description: "profile: eth_call of UP.execute(STATICCALL, to, 0, data) from the profile's owner (no permission needed, nothing is sent); direct: eth_call to the target with from = profile.", enum: ["profile", "direct"], default: "profile" },
    { name: "block", type: "string", description: "Block tag or number (default latest)." },
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    const b = buildCall({ to: a.to, data: a.data, fn: a.fn, args: a.args, abi: a.abi });
    const block = a.block ? (/^\d+$/.test(a.block) ? "0x" + BigInt(a.block).toString(16) : a.block) : "latest";
    let raw: Hex;
    let from: Address;
    if (a.mode === "direct") {
      from = profile;
      raw = await ethCall(ctx, chainId, { from, to: b.call.to, data: b.call.data, block });
    } else {
      const km = await resolveKeyManager(ctx, chainId, profile);
      from = km.owner;
      const outer = await ethCall(ctx, chainId, { from, to: profile, data: encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [3n, b.call.to, 0n, b.call.data] }), block });
      raw = decodeFunctionResult({ abi: UP_ABI, functionName: "execute", data: outer }) as Hex;
    }
    let decoded: unknown;
    if (b.fn && b.fn.outputs?.length) {
      try {
        decoded = decodeFunctionResult({ abi: [b.fn], functionName: b.fn.name, data: raw } as any);
      } catch (e) {
        decoded = { error: `could not decode with ${b.fn.name}: ${(e as Error).message}` };
      }
    }
    return { data: { chainId, profile, to: b.call.to, mode: a.mode, from, raw, decoded }, text: decoded !== undefined ? JSON.stringify(decoded, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : raw };
  },
});

defineVerb({
  name: "exec receipt",
  group: "execute",
  summary: "Fetch a transaction receipt, decode LSP events (Executed, DataChanged, PermissionsVerified, ownership…) and the revert reason of failed transactions.",
  risk: "read",
  params: [{ name: "hash", type: "string", description: "Transaction hash.", positional: 0, required: true }],
  async run(ctx, a) {
    await ctx.config();
    const chainId = ctx.chainId(a.chain);
    if (!/^0x[0-9a-fA-F]{64}$/.test(a.hash)) throw new UpError("BAD_ARGS", "hash must be a 32-byte transaction hash");
    const r = await ctx.rpc.request<any>(chainId, "eth_getTransactionReceipt", [a.hash]);
    const tx = await ctx.rpc.request<any>(chainId, "eth_getTransactionByHash", [a.hash]);
    if (!r) return { data: { chainId, hash: a.hash, status: tx ? "pending" : "unknown" }, text: tx ? "pending (no receipt yet)" : `transaction not found on chain ${chainId}` };
    const latest = BigInt(await ctx.rpc.request<Hex>(chainId, "eth_blockNumber", []));
    const blockNumber = BigInt(r.blockNumber);
    const events = decodeReceiptEvents({ logs: r.logs });
    const status = r.status === "0x1" ? "success" : "reverted";
    let revert: unknown;
    if (status === "reverted" && tx) {
      try {
        await ctx.rpc.request(chainId, "eth_call", [{ from: tx.from, to: tx.to, data: tx.input, value: tx.value, gas: tx.gas }, "0x" + (blockNumber - 1n).toString(16)]);
        revert = { message: "replay at the previous block did not revert (state-dependent failure, e.g. out of gas)" };
      } catch (e) {
        revert = decodeRevert(revertData(e));
      }
    }
    const data = {
      chainId,
      hash: a.hash,
      status,
      from: tx?.from ? getAddress(tx.from) : undefined,
      to: r.to ? getAddress(r.to) : undefined,
      blockNumber: blockNumber.toString(),
      confirmations: (latest - blockNumber + 1n).toString(),
      gasUsed: BigInt(r.gasUsed).toString(),
      effectiveGasPrice: r.effectiveGasPrice ? BigInt(r.effectiveGasPrice).toString() : undefined,
      contractAddress: r.contractAddress ?? undefined,
      events,
      revert,
      explorerUrl: explorerTxUrl(ctx, chainId, a.hash),
    };
    return { data, text: `${status} in block ${data.blockNumber} (${data.confirmations} confirmations), ${events.length} decoded event(s)` };
  },
});

/**
 * The agent's controller address used on `chainId` (its chain-specific key, else the default
 * key; without `chainId` the verb's chain) without unlocking the key when the config knows it.
 */
export async function controllerAddress(ctx: VerbContext, chainId?: number): Promise<Address> {
  const cfg = await ctx.config();
  let chain = chainId;
  if (chain === undefined) {
    try {
      chain = ctx.chainId();
    } catch {}
  }
  const c = controllerFor(cfg, chain);
  if (c) return c.address;
  return (await ctx.signer(chain)).address;
}

/** The chain-independent default controller (address derivation of new profiles uses this key). */
export async function defaultControllerAddress(ctx: VerbContext): Promise<Address> {
  const cfg = await ctx.config();
  if (cfg.controller?.address) return getAddress(cfg.controller.address);
  return (await ctx.signer()).address;
}

const NOT_CREATED = "not created yet: the first relayed send creates one random channel for this profile and saves it (or create it now: up nonce channel --create)";
const channelView = (c: RelayChannel) => ({ channel: c.channel.toString(), hex: "0x" + c.channel.toString(16), createdAt: c.createdAt, source: c.source });

defineVerb({
  name: "nonce",
  group: "execute",
  summary: "Show the live LSP25 relay nonces of a controller (the profile's saved relay channel, channel 0, earlier default channels, --channel) and its EOA transaction nonce. Read-only: never creates a channel.",
  description:
    "Three separate counters: the relay (LSP25) nonce per chain, Key Manager, controller key and channel (value = channel × 2^128 + sequence, read live with getNonce), the key's own transaction nonce (pending count, direct paths only) and, only for --via userop, the EntryPoint nonce. The saved relay channel is one random channel per profile in this state folder; channel 0 and the earlier per-relayer default channels are listed so that calls signed on them before can be checked. A used nonce shows that some call with it executed, not which one.",
  risk: "read",
  params: [
    { name: "controller", type: "string", description: "Controller address (default: this agent's key for the chain)." },
    { name: "channel", type: "string", description: "Extra nonce channel to read (uint128, as a decimal or 0x string)." },
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    if (a.controller && !isAddress(a.controller, { strict: false })) throw new UpError("BAD_ARGS", "--controller must be an address");
    const extra = parseU(a.channel, "channel");
    const controller = a.controller ? getAddress(a.controller) : await controllerAddress(ctx, chainId);
    const km = await resolveKeyManager(ctx, chainId, profile);
    if (!km.keyManager) throw new UpError("NOT_SUPPORTED", `profile owner ${km.owner} is not a Key Manager`);
    const identity = await profileIdentityFor(ctx, chainId, profile);
    const { saved } = await relayChannelState(ctx.home, identity);
    const channels: { channel: bigint; label: string }[] = [];
    if (saved) channels.push({ channel: saved.channel, label: "saved relay channel of this profile (every relayed call uses it)" });
    channels.push({ channel: 0n, label: "channel 0 (strictly ordered; shared with tools that pick it by hand)" });
    for (const r of await listRelayers(ctx, chainId)) {
      const c = r.profile === "lukso-live" ? 0n : defaultChannel(r.name, chainId);
      if (!channels.some((x) => x.channel === c)) channels.push({ channel: c, label: `earlier default channel of relayer ${r.name} (before saved channels)` });
    }
    if (extra !== undefined && !channels.some((x) => x.channel === extra)) channels.push({ channel: extra, label: "requested channel" });
    const relay = [];
    for (const c of channels) {
      const n = await getRelayNonce(ctx, chainId, km.keyManager, controller, c.channel);
      relay.push({ label: c.label, channel: c.channel.toString(), nonce: n.toString(), sequence: splitNonce(n).sequence.toString() });
    }
    const eoaNonce = Number(BigInt(await ctx.rpc.request<Hex>(chainId, "eth_getTransactionCount", [controller, "pending"])));
    return {
      data: { chainId, profile, identity, keyManager: km.keyManager, controller, eoaNonce, relayChannel: saved ? channelView(saved) : null, ...(saved ? {} : { relayChannelNote: NOT_CREATED }), relay },
      text: [`controller ${controller} on chain ${chainId}: EOA nonce ${eoaNonce}`, ...(saved ? [] : [`  relay channel: ${NOT_CREATED}`]), ...relay.map((r) => `  ${r.label}: nonce ${r.nonce} (sequence ${r.sequence})`)].join("\n"),
    };
  },
});

defineVerb({
  name: "nonce channel",
  group: "execute",
  summary: "Show this agent's saved LSP25 relay channel for the profile (one random uint128 per profile in this state folder, used by every relayed call on every chain and relayer); --create creates it now.",
  description:
    "The channel is public (not a secret) and is never replaced: no new channel per chat, restart, upgrade, relayer or chain, and never one to get around a pending call. It is saved in this state folder's profile record, not in key backups. Without --create nothing is written. After a restore from a key backup it is not known here: first make sure no relayed action from before is still pending, then --create (new random channel) or --create --channel <earlier channel> to continue the one this agent used before. A missing channel is not a missing key: the key is never regenerated.",
  risk: "local",
  params: [
    { name: "create", type: "boolean", description: "Create and save the channel now if this profile has none in this state folder (random, from the operating system's CSPRNG); an existing one is kept." },
    { name: "channel", type: "string", description: "With --create, only when none is saved yet: save this earlier channel of the same agent and profile instead of a new random one (decimal or 0x string, 4 to 2^128 - 1)." },
  ],
  examples: ["up nonce channel", "up nonce channel --create"],
  async run(ctx, a) {
    await ctx.config();
    const adopt = parseU(a.channel, "channel");
    if (adopt !== undefined && a.create !== true) throw new UpError("BAD_ARGS", "--channel needs --create: it only sets the channel of a profile that has none saved yet");
    let identity = await ctx.identity(a.profile);
    let chainId: number | undefined;
    try {
      chainId = ctx.chainId(a.chain);
    } catch {}
    if (chainId !== undefined) identity = await profileIdentityFor(ctx, chainId, identity); // a chain-specific address names its profile
    const r = a.create === true ? await ensureRelayChannel(ctx.home, identity, { explicit: true, adopt }) : (await relayChannelState(ctx.home, identity)).saved;
    const created = !!(r && "created" in r && r.created);
    const scope = "this state folder (this agent) and this profile, on every chain and relayer; the counter is on chain per chain, Key Manager, key and channel (read with: up nonce)";
    return {
      data: { profile: identity, relayChannel: r ? channelView(r) : null, created, scope, ...(r ? {} : { note: NOT_CREATED }) },
      text: r ? `relay channel of ${identity}: ${r.channel}${created ? " (created now)" : ""}` : `relay channel of ${identity}: ${NOT_CREATED}`,
    };
  },
});
