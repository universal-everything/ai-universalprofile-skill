// Path (c) — LSP25 relay through an LSP15 relayer (primary gasless path).
// Order of operations (never sign before consent, never sign in dry-run):
//   resolve KM → pick relayer + capabilities → permission pre-check (EXECUTE_RELAY_CALL)
//   → pre-simulate KM.execute(payload) as the controller (no signature needed)
//   → nonce: the profile's saved relay channel (src/lsp/relay-channel.ts; created at the first relayed
//     send, never in a dry run; --channel overrides one call) and its live counter (getNonce)
//     + validity window from chain time → quota
//   → consent → [dry-run stops here] → RPC chainId binding check → sign LSP25 digest
//   → simulate the exact KM.executeRelayCall (from any address) → POST /execute (with chainId)
//   → track task/hash → receipt on the SAME chain → attribution: the transaction must be a direct call
//     to this Key Manager that carries exactly this signed call (decoded with the KM ABI) and succeeded.
//     A used nonce alone never proves that THIS call executed: another call signed with the same key on
//     the same channel uses it too.
import { decodeFunctionData, getAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { explorerTxUrl, simulate, waitForReceipt } from "../chain/tx.ts";
import { encodeFunctionData } from "viem";
import { KM_ABI } from "../lsp/abis.ts";
import { requireKeyManager, readControllerPermissions, resolveKeyManager } from "../lsp/profile.ts";
import { hasPermission } from "../lsp/permissions.ts";
import { assertRpcChainId, latestBlock } from "../lsp/read.ts";
import { checkValidity, decodeValidityTimestamps, defaultChannel, encodeExecuteRelayCall, encodeValidityTimestamps, getRelayNonce, recoverLsp25Signer, signLsp25, splitNonce, validityWindow } from "../lsp/lsp25.ts";
import { ensureRelayChannel, profileIdentityFor, relayChannelState, restoredWithoutChannel } from "../lsp/relay-channel.ts";
import { clientFor, getCapabilities, listRelayers, selectRelayer } from "../relayer/registry.ts";
import { quotaPositive, type QuotaResult, RelayerClient } from "../relayer/client.ts";
import type { ExecOutcome, ExecRequest, ExecTransport } from "./transport.ts";
import { confirmationBlock, consentForRequest, decodeReceiptEvents, upPayload, validateRequest, type ExecOptionsExt, type ExecRequestExt } from "./common.ts";

const POLL_MS = () => Number(process.env.UP_POLL_MS ?? 2000);
const TIMEOUT_MS = () => Number(process.env.UP_RECEIPT_TIMEOUT_MS ?? 180_000);

async function waitForTask(client: RelayerClient, taskId: string): Promise<Hex> {
  const deadline = Date.now() + TIMEOUT_MS();
  let last = "";
  while (Date.now() < deadline) {
    const t = await client.task(taskId);
    last = t.status;
    if (t.status === "FAILED") throw new UpError("RELAYER_ERROR", `relay task ${taskId} failed`, { hint: "simulate again (up exec simulate --via relay) to see the decoded reason", details: { task: t.raw } });
    if (t.status === "COMPLETE") {
      if (t.transactionHash) return t.transactionHash;
      throw new UpError("RELAYER_ERROR", `relay task ${taskId} is COMPLETE but reports no transaction hash`, { details: { task: t.raw } });
    }
    await new Promise((r) => setTimeout(r, POLL_MS()));
  }
  throw new UpError("RELAYER_ERROR", `relay task ${taskId} not complete after ${TIMEOUT_MS()} ms (last status ${last})`, { hint: "check later with up exec receipt <hash> or the relayer's task endpoint" });
}

export const relayTransport: ExecTransport = {
  path: "relay",
  async execute(ctx: VerbContext, signer: Signer, reqIn: ExecRequest, optsIn): Promise<ExecOutcome> {
    const req = reqIn as ExecRequestExt;
    const opts = optsIn as ExecOptionsExt;
    const chainId = req.chainId;
    const kmInfo = await resolveKeyManager(ctx, chainId, req.profile);
    const keyManager = kmInfo.keyManager ?? (await requireKeyManager(ctx, chainId, req.profile)); // throws with the precise reason
    const warnings = validateRequest(req, keyManager);
    const kmVersion = kmInfo.keyManagerVersion;
    const m = kmVersion ? /^(\d+)\.(\d+)/.exec(kmVersion) : null;
    if (m && Number(m[1]) === 0 && Number(m[2]) < 12) {
      throw new UpError("NOT_SUPPORTED", `the Key Manager on chain ${chainId} is v${kmVersion}, older than the LSP25 relay format (v0.12+)`, { hint: "execute directly (--via km) or upgrade the Key Manager (up ownership transfer <new KM>)" });
    }
    if (opts.fundFromController) throw new UpError("BAD_ARGS", "--fund-from-controller is not possible on the relay path: the relayer sends the transaction (msg.value 0); the profile pays call values from its own balance");

    const relayer = await selectRelayer(ctx, chainId, opts.relayer);
    if (!relayer) {
      throw new UpError("RELAYER_ERROR", `no relayer is configured for chain ${chainId}`, {
        hint: `add an LSP15 relayer that serves this chain: up relayer add <https://…> --chains ${chainId}   (or execute directly with a funded controller: --via km)`,
      });
    }
    const caps = await getCapabilities(ctx, relayer);
    const client = clientFor(relayer);
    client.assertServes(chainId, caps);

    const payload = upPayload(req);
    // Permission pre-check: the signer needs EXECUTE_RELAY_CALL in addition to the payload permissions.
    const perms = await readControllerPermissions(ctx, chainId, req.profile, signer.address);
    if (perms.permissions.value === 0n) throw new UpError("NOT_AUTHORISED", `${signer.address} is not a controller of ${req.profile} on chain ${chainId}`, { hint: "authorise the agent's controller first (up permissions recommend)" });
    if (!hasPermission(perms.permissions.value, "EXECUTE_RELAY_CALL")) {
      throw new UpError("NOT_AUTHORISED", `controller ${signer.address} lacks EXECUTE_RELAY_CALL on chain ${chainId}`, { hint: "ask the human to add EXECUTE_RELAY_CALL (up controller edit <controller> --add EXECUTE_RELAY_CALL) or use --via km" });
    }
    // Pre-simulation without a signature: same payload checks as the relay (except EXECUTE_RELAY_CALL, checked above).
    await simulate(ctx, { chainId, from: signer.address, to: keyManager, data: encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [payload] }) });

    // The nonce channel: the profile's saved channel, created at its first relayed send (never in a dry run);
    // --channel replaces it for this one call and never changes it. No other default, never an implicit 0.
    const identity = await profileIdentityFor(ctx, chainId, req.profile);
    let channel = opts.channel;
    let channelSource: string;
    let created = false;
    if (opts.channel !== undefined) {
      const saved = (await relayChannelState(ctx.home, identity).catch(() => undefined))?.saved;
      channelSource = `--channel for this call only; the saved channel (${saved ? saved.channel : "none yet"}) is unchanged`;
      warnings.push(`--channel ${opts.channel} is used for this call only, instead of ${saved ? `the saved relay channel ${saved.channel}` : "the profile's relay channel"} (advanced): calls on different channels are not ordered with each other`);
    } else if (ctx.flags.dryRun) {
      const st = await relayChannelState(ctx.home, identity);
      if (!st.saved && st.restored) throw restoredWithoutChannel(identity);
      channel = st.saved?.channel;
      channelSource = st.saved ? "saved" : "none yet: the first relayed send creates one random channel for this profile and saves it (a dry run saves nothing)";
    } else {
      const c = await ensureRelayChannel(ctx.home, identity);
      channel = c.channel;
      created = c.created;
      channelSource = c.created ? "created now (random, saved)" : "saved";
    }
    // the nonce read below is unused at this block, so whatever uses it later is in a later block (small margin for RPC failover)
    const start = await latestBlock(ctx, chainId);
    const nonce = channel === undefined ? undefined : await getRelayNonce(ctx, chainId, keyManager, signer.address, channel);
    // Migration: until a call of this key has executed on the saved channel here (sequence 0, also after a first send that
    // failed or a dry run), say which other channels it used here, so a call signed on one of them that may still be
    // pending is checked first: the earlier defaults, and the address's own saved channel when another profile links it.
    if (opts.channel === undefined && (nonce === undefined || splitNonce(nonce).sequence === 0n)) {
      const own = identity !== getAddress(req.profile) ? (await relayChannelState(ctx.home, req.profile)).saved : undefined;
      const earlier = (await earlierChannelsInUse(ctx, chainId, keyManager, signer.address, own ? [own.channel] : [])).filter((e) => e.channel !== channel);
      if (earlier.length) {
        const head =
          channel === undefined
            ? "the first relayed send creates this profile's relay channel (random, saved in this state folder, used from then on on every chain and relayer)."
            : created
              ? `this profile's relay channel ${channel} was created now (random, saved in this state folder, used from now on on every chain and relayer).`
              : `no call of this key has executed on this profile's relay channel ${channel} on chain ${chainId} yet.`;
        const ownNote = own && earlier.some((e) => e.channel === own.channel) ? ` (channel ${own.channel} is the saved channel of ${getAddress(req.profile)} itself; ${identity} links that address here, so its channel is used)` : "";
        warnings.push(`${head} This key relayed before on ${earlier.map((e) => `channel ${e.channel} (sequence ${e.sequence})`).join(", ")}${ownNote}: those counters stay on chain (up nonce shows them); if a call signed there may still be pending, check it before repeating its action`);
      }
    }
    const now = start.timestamp || BigInt(Math.floor(Date.now() / 1000));
    const validityTimestamps =
      opts.validFrom !== undefined || opts.validUntil !== undefined ? encodeValidityTimestamps(opts.validFrom ?? 0n, opts.validUntil ?? 0n) : validityWindow(now, opts.validitySeconds ?? 600);
    const vstate = checkValidity(validityTimestamps, now);
    if (vstate !== "ok") warnings.push(`validity window is ${vstate} at the current block time ${now}`);
    if (validityTimestamps === 0n) warnings.push("unlimited validity: the signed call stays executable until its nonce is used");

    const v = decodeValidityTimestamps(validityTimestamps);
    const confirmation = confirmationBlock(ctx, req, {
      path: "relay",
      keyManager,
      gasPayer: `relayer ${relayer.name} (${relayer.baseUrl})`,
      entry: { to: keyManager, data: "0x" as Hex, value: 0n, function: "executeRelayCall(bytes,uint256,uint256,bytes)" },
      payload,
      signer: signer.address,
      warnings,
      extra: {
        relayer: { name: relayer.name, baseUrl: relayer.baseUrl, profile: relayer.profile, legacy: caps.legacy, lsp15Version: caps.lsp15Version },
        lsp25: { nonce: nonce?.toString() ?? null, channel: channel?.toString() ?? null, channelSource, sequence: nonce !== undefined ? splitNonce(nonce).sequence.toString() : "0", validityTimestamps: "0x" + validityTimestamps.toString(16), validFrom: v.start.toString(), validUntil: v.unlimited ? "unlimited" : v.end.toString(), signedValue: "0" },
        quota: ctx.flags.dryRun ? "not checked in dry-run (no signatures in dry-run)" : opts.skipQuota ? "skipped" : `checked AFTER approval and before the LSP25 signature, with the LSP15 /quota login message only: personal_sign(keccak256(abi.encodePacked(address, uint256 timestamp[, uint256 chainId]))) — authorises nothing`,
        relayEntry: "KeyManager.executeRelayCall(signature, nonce, validityTimestamps, payload) — the signature is created only after approval; the relayer receives {address, chainId, transaction:{abi: payload, signature, nonce, validityTimestamps}} (no chainId for lukso-live; nonce = the full getNonce value and validityTimestamps, both as exact 0x hex)",
      },
    });

    await consentForRequest(ctx, req, confirmation);
    if (ctx.flags.dryRun) return { path: "relay", chainId, profile: req.profile, keyManager, gasPayer: `relayer ${relayer.name}`, status: "dry-run", confirmation, warnings };
    if (nonce === undefined || channel === undefined) throw new UpError("INTERNAL", "relay nonce missing outside a dry run");

    // Quota (LSP15 login message) only after approval; nothing is signed for the call yet.
    if (!opts.skipQuota) {
      const quota: QuotaResult = await client.quota(signer, { chainId, profile: req.profile, caps });
      if (quota.available && !quotaPositive(quota)) {
        throw new UpError("RELAYER_ERROR", `relayer ${relayer.name} reports no quota left on chain ${chainId} (${quota.quota} ${quota.unit ?? ""})`, { hint: "nothing was signed or sent: wait for the reset or execute directly with a funded controller (--via km)", details: { code: "quota_exhausted", fallback: "km", quota } });
      }
      if (!quota.available) warnings.push(quota.reason ?? "relayer quota unknown");
      (confirmation as any).quotaResult = { available: quota.available, quota: quota.quota, unit: quota.unit, scope: quota.scope, reason: quota.reason };
    }

    // Binding: the digest commits to chainId + keyManager; make sure both are those of the selected chain.
    await assertRpcChainId(ctx, chainId);
    const msg = { keyManager, chainId, nonce, validityTimestamps, value: 0n, payload };
    const signature = await signLsp25(signer, msg);
    const recovered = await recoverLsp25Signer(msg, signature);
    if (getAddress(recovered) !== getAddress(signer.address)) throw new UpError("INTERNAL", "LSP25 signature does not recover to the controller", { hint: "signer backend problem; run up doctor" });
    const entryCalldata = encodeExecuteRelayCall(signature, nonce, validityTimestamps, payload);
    await simulate(ctx, { chainId, from: zeroAddress, to: keyManager, data: entryCalldata });
    const kmNow = await requireKeyManager(ctx, chainId, req.profile);
    if (getAddress(kmNow) !== getAddress(keyManager) || msg.chainId !== req.chainId) {
      throw new UpError("RELAYER_ERROR", "chain binding check failed: the signed chainId/Key Manager no longer match the selected chain", { details: { signedKeyManager: keyManager, currentKeyManager: kmNow, signedChainId: msg.chainId } });
    }

    // From here on the signed call exists and may land on chain at any time within its validity window.
    const pending: PendingRelay = { ctx, chainId, keyManager, signer: signer.address, nonce, channel, validityTimestamps, payload, relayer: relayer.name, fromBlock: start.number > 5n ? start.number - 5n : 0n };
    const base = { path: "relay" as const, chainId, profile: req.profile, keyManager, gasPayer: `relayer ${relayer.name}`, entryCalldata, warnings };

    let res: Awaited<ReturnType<RelayerClient["execute"]>>;
    try {
      res = await client.execute({ address: req.profile, chainId, transaction: { abi: payload, signature, nonce, validityTimestamps } });
    } catch (e) {
      if (!isAmbiguousSubmitError(e)) throw e; // an explicit refusal: passed on as the relayer's error
      return settleAmbiguous(pending, base, confirmation, `relayer ${relayer.name} answered /execute ambiguously (${(e as Error).message})`, e);
    }
    let hash: Hex | undefined;
    try {
      hash = res.taskId && relayer.profile === "lukso-live" ? await waitForTask(client, res.taskId) : res.transactionHash ?? (res.taskId ? await waitForTask(client, res.taskId) : undefined);
    } catch (e) {
      return settleAmbiguous(pending, base, confirmation, `relay task ${res.taskId} did not complete (${(e as Error).message})`, e, res.taskId);
    }
    if (!hash) return settleAmbiguous(pending, base, confirmation, "relayer did not provide a transaction hash", undefined, res.taskId);
    let receipt;
    try {
      receipt = await waitForReceipt(ctx, chainId, hash);
    } catch (e) {
      return settleAmbiguous(pending, base, confirmation, `relayer ${relayer.name} returned transaction ${hash}, but no receipt appeared on chain ${chainId}`, e, res.taskId);
    }
    const events = decodeReceiptEvents(receipt);
    const match = await matchRelayCall(await ctx.rpc.request<any>(chainId, "eth_getTransactionByHash", [hash]).catch(() => null), pending);
    const verified = events.some((e) => e.event === "PermissionsVerified" && getAddress(e.address) === getAddress(keyManager) && String(e.args.signer).toLowerCase() === signer.address.toLowerCase());
    if (receipt.status !== "success" || match.kind !== "ours" || !verified || (await getRelayNonce(ctx, chainId, keyManager, signer.address, channel)) <= nonce) {
      const why = receipt.status !== "success" ? `relayed transaction ${hash} reverted on chain ${chainId}` : `relayer ${relayer.name} returned transaction ${hash}, but it did not execute this signed call (${match.kind === "undecodable" ? match.reason : match.kind === "other" ? `it carries another call with this nonce (${match.entry})` : match.kind === "unrelated" ? "it does not carry this call" : "no PermissionsVerified for the controller or nonce not used"})`;
      return settleAmbiguous(pending, base, confirmation, why, undefined, res.taskId, hash);
    }
    return {
      ...base,
      status: "success",
      txHash: hash,
      relayTaskId: res.taskId,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: explorerTxUrl(ctx, chainId, hash),
      confirmation: { ...confirmation, events, attribution: { transaction: hash, entry: match.entry } },
    };
  },
};

/** The earlier default channels (channel 0, each relayer's hashed channel) on which this key already relayed on this chain. */
async function earlierChannelsInUse(ctx: VerbContext, chainId: number, keyManager: Address, signer: Address, also: bigint[] = []): Promise<{ channel: bigint; sequence: bigint }[]> {
  const channels = [0n];
  for (const r of await listRelayers(ctx, chainId)) {
    const c = r.profile === "lukso-live" ? 0n : defaultChannel(r.name, chainId);
    if (!channels.includes(c)) channels.push(c);
  }
  for (const c of also) if (!channels.includes(c)) channels.push(c);
  const out: { channel: bigint; sequence: bigint }[] = [];
  for (const channel of channels) {
    const sequence = splitNonce(await getRelayNonce(ctx, chainId, keyManager, signer, channel)).sequence;
    if (sequence > 0n) out.push({ channel, sequence });
  }
  return out;
}

/** One signed relay call, as far as attribution needs it (value is always 0: the skill never signs msg.value). */
export interface SignedRelay {
  keyManager: Address;
  chainId: number;
  signer: Address;
  nonce: bigint;
  validityTimestamps: bigint;
  payload: Hex;
}

interface PendingRelay extends SignedRelay {
  ctx: VerbContext;
  channel: bigint;
  relayer: string;
  fromBlock: bigint;
}

export type RelayMatch = { kind: "ours" | "other"; entry: string } | { kind: "unrelated" } | { kind: "undecodable"; reason: string };

/**
 * What one transaction (raw eth_getTransactionByHash object) proves about one signed relay call, from its
 * calldata decoded with the Key Manager ABI — never from bytes found somewhere in it:
 * - ours: a direct call to this Key Manager (executeRelayCall, or an item of executeRelayCallBatch) with this
 *   nonce, signed by this controller over the identical message (validity window, value 0, payload);
 * - other: a direct call to this Key Manager in which this controller signed a DIFFERENT call with this nonce;
 * - unrelated: a direct Key Manager call without this controller's nonce;
 * - undecodable: anything else (another contract such as a wrapper or aggregator, unreadable calldata, no
 *   transaction): it proves nothing either way.
 * Whether it executed is the receipt's part (a reverted transaction uses no nonce).
 */
export async function matchRelayCall(tx: any, c: SignedRelay): Promise<RelayMatch> {
  if (!tx || typeof tx.input !== "string") return { kind: "undecodable", reason: "the transaction could not be read" };
  if (typeof tx.to !== "string" || tx.to.toLowerCase() !== c.keyManager.toLowerCase()) return { kind: "undecodable", reason: `it calls ${tx.to ?? "no contract"}, not the Key Manager directly` };
  let d;
  try {
    d = decodeFunctionData({ abi: KM_ABI, data: tx.input as Hex });
  } catch {
    return { kind: "undecodable", reason: "its calldata is not a Key Manager call" };
  }
  const a = d.args as unknown as any[];
  const items =
    d.functionName === "executeRelayCall"
      ? [{ entry: "executeRelayCall", signature: a[0], nonce: a[1], validityTimestamps: a[2], value: BigInt(tx.value ?? 0), payload: a[3] }]
      : d.functionName === "executeRelayCallBatch"
        ? (a[0] as Hex[]).map((signature, i) => ({ entry: `executeRelayCallBatch[${i}]`, signature, nonce: a[1][i], validityTimestamps: a[2][i], value: a[3][i], payload: a[4][i] }))
        : [];
  for (const it of items) {
    if (it.nonce !== c.nonce || typeof it.payload !== "string") continue;
    let who: Address;
    try {
      who = await recoverLsp25Signer({ keyManager: c.keyManager, chainId: c.chainId, nonce: it.nonce, validityTimestamps: it.validityTimestamps, value: it.value, payload: it.payload as Hex }, it.signature);
    } catch {
      continue;
    }
    if (getAddress(who) !== getAddress(c.signer)) continue; // another key's nonce space
    const same = it.validityTimestamps === c.validityTimestamps && it.value === 0n && it.payload.toLowerCase() === c.payload.toLowerCase();
    return { kind: same ? "ours" : "other", entry: it.entry };
  }
  return { kind: "unrelated" };
}

/** Errors after which the signed call may or may not have been submitted (timeouts, 5xx, nonce conflicts, missing hash). */
export function isAmbiguousSubmitError(e: unknown): boolean {
  if (!(e instanceof UpError)) return true;
  if (e.code === "NETWORK_ERROR") return true;
  if (e.code !== "RELAYER_ERROR") return false;
  const d = (e.details ?? {}) as any;
  if (d.status === undefined) return true; // malformed answer (no hash / task)
  return d.status >= 500 || d.status === 409 || d.code === "nonce_conflict" || d.code === "chain_submission_failed";
}

const untilText = (validityTimestamps: bigint) => {
  const v = decodeValidityTimestamps(validityTimestamps);
  return v.unlimited || v.end === 0n ? "has NO expiry, so it stays executable until its nonce is used" : `stays executable until unix ${v.end}`;
};

export function ambiguousRelayHint(validityTimestamps: bigint): string {
  return `do not resend and do not re-sign: this signed call ${untilText(validityTimestamps)}. A used nonce (up nonce) alone does not show that it was this call: find the transaction that used it (up exec receipt <hash>) or wait until the window ends before repeating the action`;
}

const MAX_CANDIDATES = 25;

/** The transaction that used this call's nonce, decoded: this exact call, another call of the same key, or not provable. */
async function findNonceUse(p: PendingRelay, knownHash?: Hex): Promise<{ kind: "ours" | "other"; hash: Hex; entry: string; receipt: any } | { kind: "unresolved"; reason: string; hashes: Hex[] }> {
  const topic = keccak256(toBytes("PermissionsVerified(address,uint256,bytes4)"));
  const signerTopic = ("0x" + p.signer.slice(2).toLowerCase().padStart(64, "0")) as Hex;
  const logs = await p.ctx.rpc.request<any[]>(p.chainId, "eth_getLogs", [{ address: p.keyManager, fromBlock: "0x" + p.fromBlock.toString(16), toBlock: "latest", topics: [topic, signerTopic] }]).catch(() => undefined);
  // newest first; the relayer's own hash (if any) is checked first
  const hashes = [...new Set([...(knownHash ? [knownHash.toLowerCase()] : []), ...[...(logs ?? [])].reverse().map((l) => String(l.transactionHash).toLowerCase())])] as Hex[];
  const undecodable: Hex[] = [];
  for (const hash of hashes.slice(0, MAX_CANDIDATES)) {
    const receipt = await p.ctx.rpc.request<any>(p.chainId, "eth_getTransactionReceipt", [hash]).catch(() => null);
    if (!receipt || receipt.status !== "0x1") continue; // failed or unknown: it used no nonce
    const m = await matchRelayCall(await p.ctx.rpc.request<any>(p.chainId, "eth_getTransactionByHash", [hash]).catch(() => null), p);
    if (m.kind === "ours" || m.kind === "other") return { kind: m.kind, hash, entry: m.entry, receipt };
    if (m.kind === "undecodable") undecodable.push(hash);
  }
  if (undecodable.length) return { kind: "unresolved", reason: `the Key Manager was reached through another contract or unreadable calldata in ${undecodable.join(", ")}, which the skill cannot decode`, hashes: undecodable };
  return { kind: "unresolved", reason: logs ? "no transaction that used it was found" : "the Key Manager's logs could not be read", hashes: [] };
}

/**
 * The relayer's answer is not conclusive. Poll the chain until the nonce is used; then decode the
 * transaction that used it: success only when it carries exactly this signed call; a different call of the
 * same key with this nonce is proof that this call did not (and cannot) execute; anything else stays
 * unresolved. Never suggests another path or a new signature: the signed LSP25 call stays valid for its
 * window, so a second execution through another path could pay twice.
 */
async function settleAmbiguous(p: PendingRelay, base: Omit<ExecOutcome, "status" | "confirmation">, confirmation: Record<string, unknown>, why: string, cause?: unknown, taskId?: string, knownHash?: Hex): Promise<ExecOutcome> {
  const waitMs = Number(process.env.UP_RELAY_AMBIGUOUS_WAIT_MS ?? 60_000);
  const deadline = Date.now() + waitMs;
  let current = await getRelayNonce(p.ctx, p.chainId, p.keyManager, p.signer, p.channel);
  while (current <= p.nonce && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS()));
    current = await getRelayNonce(p.ctx, p.chainId, p.keyManager, p.signer, p.channel);
  }
  const v = decodeValidityTimestamps(p.validityTimestamps);
  const pendingDetails = {
    ambiguous: true,
    keyManager: p.keyManager,
    signer: p.signer,
    nonce: p.nonce.toString(),
    channel: p.channel.toString(),
    validityTimestamps: "0x" + p.validityTimestamps.toString(16),
    validFrom: v.start.toString(),
    validUntil: v.unlimited || v.end === 0n ? "no expiry" : v.end.toString(),
    relayer: p.relayer,
    relayTaskId: taskId,
    reason: why,
  };
  if (current <= p.nonce) {
    throw new UpError("RELAYER_ERROR", `${why}; the nonce was NOT used after ${waitMs} ms — the signed call is still valid and may still land`, {
      hint: ambiguousRelayHint(p.validityTimestamps),
      details: { ...pendingDetails, code: "relay_outcome_unknown", fallback: "none", cause: cause instanceof Error ? cause.message : undefined },
      cause,
    });
  }
  const use = await findNonceUse(p, knownHash);
  if (use.kind === "unresolved") {
    throw new UpError("RELAYER_ERROR", `${why}; the nonce of this call was used on chain, but ${use.reason}, so whether THIS call executed is not proven`, {
      hint: "do not resend and do not re-sign: look at the transaction(s) in details.transactions (up exec receipt <hash> decodes their events) and repeat the action only once it is proven that it did not execute, with the human's consent",
      details: { ...pendingDetails, code: "relay_outcome_unresolved", fallback: "none", transactions: use.hashes },
      cause,
    });
  }
  if (use.kind === "other") {
    throw new UpError("RELAYER_ERROR", `${why}; this signed call did NOT execute and can no longer execute: its nonce ${p.nonce} (channel ${p.channel}) was used by another call signed with the same key, in ${use.hash}`, {
      hint: "the same key signed a different call on this channel (another copy of this state folder, another agent or a script using this key and channel): find out what that call did before anything else, and repeat this action only if it is still wanted, with the human's consent. Never re-sign it automatically and never switch channel or path to get around it",
      details: { ...pendingDetails, code: "nonce_used_by_other_call", fallback: "none", otherTransaction: use.hash, otherEntry: use.entry },
    });
  }
  return {
    ...base,
    status: "success",
    txHash: use.hash,
    relayTaskId: taskId,
    blockNumber: BigInt(use.receipt.blockNumber).toString(),
    gasUsed: BigInt(use.receipt.gasUsed).toString(),
    explorerUrl: explorerTxUrl(p.ctx, p.chainId, use.hash),
    confirmation: { ...confirmation, events: decodeReceiptEvents({ logs: use.receipt.logs ?? [] }), attribution: { transaction: use.hash, entry: use.entry }, relayResolution: pendingDetails },
    warnings: [...(base.warnings ?? []), `${why}; the chain shows that this exact signed call executed in ${use.hash} (${use.entry}, decoded from that transaction)`],
  };
}
