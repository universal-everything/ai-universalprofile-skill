// Path (c) — LSP25 relay through an LSP15 relayer (primary gasless path).
// Order of operations (never sign before consent, never sign in dry-run):
//   resolve KM → pick relayer + capabilities → permission pre-check (EXECUTE_RELAY_CALL)
//   → pre-simulate KM.execute(payload) as the controller (no signature needed)
//   → nonce (channel per relayer×chain) + validity window from chain time → quota
//   → consent → [dry-run stops here] → RPC chainId binding check → sign LSP25 digest
//   → simulate the exact KM.executeRelayCall (from any address) → POST /execute (with chainId)
//   → track task/hash → receipt on the SAME chain → verify the relayed tx really executed
//     this signed call (PermissionsVerified(signer) from our KM + nonce consumed).
import { getAddress, keccak256, toBytes, zeroAddress, type Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { explorerTxUrl, simulate, waitForReceipt } from "../chain/tx.ts";
import { encodeFunctionData } from "viem";
import { KM_ABI } from "../lsp/abis.ts";
import { requireKeyManager, readControllerPermissions, resolveKeyManager } from "../lsp/profile.ts";
import { hasPermission } from "../lsp/permissions.ts";
import { assertRpcChainId, latestBlock } from "../lsp/read.ts";
import { checkValidity, decodeValidityTimestamps, defaultChannel, encodeExecuteRelayCall, encodeValidityTimestamps, getRelayNonce, recoverLsp25Signer, signLsp25, splitNonce, validityWindow } from "../lsp/lsp25.ts";
import { clientFor, getCapabilities, selectRelayer } from "../relayer/registry.ts";
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

    const channel = opts.channel ?? (relayer.profile === "lukso-live" ? 0n : defaultChannel(relayer.name, chainId));
    const nonce = await getRelayNonce(ctx, chainId, keyManager, signer.address, channel);
    const now = (await latestBlock(ctx, chainId)).timestamp || BigInt(Math.floor(Date.now() / 1000));
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
        lsp25: { nonce: nonce.toString(), channel: channel.toString(), sequence: splitNonce(nonce).sequence.toString(), validityTimestamps: "0x" + validityTimestamps.toString(16), validFrom: v.start.toString(), validUntil: v.unlimited ? "unlimited" : v.end.toString(), signedValue: "0" },
        quota: ctx.flags.dryRun ? "not checked in dry-run (no signatures in dry-run)" : opts.skipQuota ? "skipped" : `checked AFTER approval and before the LSP25 signature, with the LSP15 /quota login message only: personal_sign(keccak256(abi.encodePacked(address, uint256 timestamp[, uint256 chainId]))) — authorises nothing`,
        relayEntry: "KeyManager.executeRelayCall(signature, nonce, validityTimestamps, payload) — the signature is created only after approval; the relayer receives {address, chainId, transaction:{abi: payload, signature, nonce, validityTimestamps}}",
      },
    });

    await consentForRequest(ctx, req, confirmation);
    if (ctx.flags.dryRun) return { path: "relay", chainId, profile: req.profile, keyManager, gasPayer: `relayer ${relayer.name}`, status: "dry-run", confirmation, warnings };

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
    const pending: PendingRelay = { ctx, chainId, keyManager, signer: signer.address, nonce, channel, validityTimestamps, relayer: relayer.name, fromBlock: (await latestBlock(ctx, chainId)).number };
    const base = { path: "relay" as const, chainId, profile: req.profile, keyManager, gasPayer: `relayer ${relayer.name}`, entryCalldata, warnings };

    let res: Awaited<ReturnType<RelayerClient["execute"]>>;
    try {
      res = await client.execute({ address: req.profile, chainId, transaction: { abi: payload, signature, nonce, validityTimestamps } });
    } catch (e) {
      if (!isAmbiguousSubmitError(e)) throw e; // explicit rejection before submission: nothing can land
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
    const ours = events.some((e) => e.event === "PermissionsVerified" && getAddress(e.address) === getAddress(keyManager) && String(e.args.signer).toLowerCase() === signer.address.toLowerCase());
    const nonceAfter = await getRelayNonce(ctx, chainId, keyManager, signer.address, channel);
    if (receipt.status !== "success" || !ours || nonceAfter <= nonce) {
      const why = receipt.status !== "success" ? `relayed transaction ${hash} reverted on chain ${chainId}` : `relayer ${relayer.name} returned transaction ${hash}, but it did not execute this signed call (no PermissionsVerified for the controller from the Key Manager or nonce not consumed)`;
      return settleAmbiguous(pending, base, confirmation, why, undefined, res.taskId);
    }
    return {
      ...base,
      status: "success",
      txHash: hash,
      relayTaskId: res.taskId,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: explorerTxUrl(ctx, chainId, hash),
      confirmation: { ...confirmation, events },
    };
  },
};

interface PendingRelay {
  ctx: VerbContext;
  chainId: number;
  keyManager: Hex;
  signer: Hex;
  nonce: bigint;
  channel: bigint;
  validityTimestamps: bigint;
  relayer: string;
  fromBlock: bigint;
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

export function ambiguousRelayHint(validityTimestamps: bigint): string {
  const v = decodeValidityTimestamps(validityTimestamps);
  return `do not resend; check \`up nonce\` (has the nonce been used?) or wait until the validity window ends${v.unlimited || v.end === 0n ? " — this call has NO expiry, so it stays executable until its nonce is used" : ` (unix ${v.end})`}`;
}

/**
 * The relayer's answer is not conclusive. Poll the chain for the nonce being consumed
 * (the only proof). If it is, report the transaction that used it; otherwise fail WITHOUT
 * suggesting another path: the signed LSP25 call stays valid for its window, so a second
 * execution through another path could pay twice.
 */
async function settleAmbiguous(p: PendingRelay, base: Omit<ExecOutcome, "status" | "confirmation">, confirmation: Record<string, unknown>, why: string, cause?: unknown, taskId?: string): Promise<ExecOutcome> {
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
  if (current > p.nonce) {
    const topic = keccak256(toBytes("PermissionsVerified(address,uint256,bytes4)"));
    const signerTopic = ("0x" + p.signer.slice(2).toLowerCase().padStart(64, "0")) as Hex;
    const logs = await p.ctx.rpc.request<any[]>(p.chainId, "eth_getLogs", [{ address: p.keyManager, fromBlock: "0x" + p.fromBlock.toString(16), toBlock: "latest", topics: [topic, signerTopic] }]).catch(() => []);
    const hash = logs.length ? (logs[logs.length - 1].transactionHash as Hex) : undefined;
    const warning = `${why}; the chain shows the nonce was consumed, so the signed call WAS executed${hash ? ` in ${hash}` : " (transaction not identified)"}`;
    if (!hash) return { ...base, status: "submitted", relayTaskId: taskId, confirmation: { ...confirmation, relayResolution: pendingDetails }, warnings: [...(base.warnings ?? []), warning] };
    const receipt = await waitForReceipt(p.ctx, p.chainId, hash);
    return {
      ...base,
      status: receipt.status === "success" ? "success" : "reverted",
      txHash: hash,
      relayTaskId: taskId,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: explorerTxUrl(p.ctx, p.chainId, hash),
      confirmation: { ...confirmation, events: decodeReceiptEvents(receipt), relayResolution: pendingDetails },
      warnings: [...(base.warnings ?? []), warning],
    };
  }
  throw new UpError("RELAYER_ERROR", `${why}; the nonce was NOT consumed after ${waitMs} ms — the signed call is still valid and may still land`, {
    hint: ambiguousRelayHint(p.validityTimestamps),
    details: { ...pendingDetails, code: "relay_outcome_unknown", fallback: "none", cause: cause instanceof Error ? cause.message : undefined },
    cause,
  });
}
