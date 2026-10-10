// `--via auto` (task decision): relay if a relayer covers the chain and its quota
// is > 0, otherwise the direct Key Manager path. ERC-4337 is never auto-selected.
// For a relayer whose quota cannot be read (lukso-live: JWT-gated), relay is
// chosen only when the controller EOA has no gas on that chain (km would fail anyway).
import type { Address } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { getBalance } from "../lsp/read.ts";
import { readControllerPermissions } from "../lsp/profile.ts";
import { hasPermission } from "../lsp/permissions.ts";
import { clientFor, getCapabilities, selectRelayer } from "../relayer/registry.ts";
import { quotaPositive } from "../relayer/client.ts";
import { executeAsProfile, type ExecOutcome, type ExecPath, type ExecRequest } from "./transport.ts";
import type { ExecOptionsExt, ExecRequestExt } from "./common.ts";

export interface AutoDecision {
  path: Exclude<ExecPath, "userop">;
  reason: string;
  relayer?: string;
  /** true when the LSP15 /quota login message was signed to take the decision (before approval) */
  quotaSigned?: boolean;
}

export const QUOTA_LOGIN_FORMAT = "LSP15 /quota login message only: personal_sign(keccak256(abi.encodePacked(address, uint256 timestamp[, uint256 chainId]))) computed by the skill — authorises nothing, valid ±300 s";

export async function resolveAutoPath(ctx: VerbContext, chainId: number, profile: Address, signer: Signer, relayerName?: string): Promise<AutoDecision> {
  let relayer;
  try {
    relayer = await selectRelayer(ctx, chainId, relayerName);
  } catch {
    relayer = undefined;
  }
  if (!relayer) return { path: "km", reason: `no relayer configured for chain ${chainId}` };
  try {
    const perms = await readControllerPermissions(ctx, chainId, profile, signer.address);
    if (!hasPermission(perms.permissions.value, "EXECUTE_RELAY_CALL")) return { path: "km", reason: `controller ${signer.address} lacks EXECUTE_RELAY_CALL on chain ${chainId}` };
    const caps = await getCapabilities(ctx, relayer);
    const client = clientFor(relayer);
    client.assertServes(chainId, caps);
    if (ctx.flags.dryRun) return { path: "relay", relayer: relayer.name, reason: `relayer ${relayer.name} covers chain ${chainId} (quota not checked in dry-run: no signatures in dry-run)` };
    const q = await client.quota(signer, { chainId, profile, caps });
    if (q.available) {
      return quotaPositive(q) ? { path: "relay", relayer: relayer.name, reason: `relayer ${relayer.name} quota ${q.quota} ${q.unit ?? ""} > 0`, quotaSigned: true } : { path: "km", reason: `relayer ${relayer.name} quota is ${q.quota ?? 0}`, quotaSigned: true };
    }
    const bal = await getBalance(ctx, chainId, signer.address);
    if (bal === 0n) return { path: "relay", relayer: relayer.name, reason: `relayer quota unknown (${q.reason}); controller EOA has no gas, so relay is the only option` };
    return { path: "km", reason: `relayer quota unknown (${q.reason}); controller EOA is funded` };
  } catch (e) {
    return { path: "km", reason: `relayer ${relayer.name} unusable: ${(e as Error).message}` };
  }
}

/** executeAsProfile with support for via: "auto". */
export async function executeAuto(ctx: VerbContext, req: ExecRequest, opts: Omit<ExecOptionsExt, "via"> & { via: ExecPath | "auto" }): Promise<ExecOutcome & { autoDecision?: AutoDecision }> {
  if (opts.via !== "auto") return executeAsProfile(ctx, req, opts as ExecOptionsExt);
  const signer = await ctx.signer(req.chainId);
  // Chain preflight before choosing a path: a profile that is not deployed on this chain, or a
  // key that is not a controller here, gets the per-chain fix instead of a relay/km fallback.
  const { preflightProfileOnChain } = await import("../lsp/multichain.ts");
  await preflightProfileOnChain(ctx, req.chainId, req.profile, signer.address);
  const d: AutoDecision = opts.fundFromController ? { path: "km", reason: "--fund-from-controller needs a direct path (the controller sends the value)" } : await resolveAutoPath(ctx, req.chainId, req.profile, signer, opts.relayer);
  const r = req as ExecRequestExt;
  const autoInfo = { ...d, quotaLogin: d.quotaSigned ? `signed BEFORE approval to choose the path — ${QUOTA_LOGIN_FORMAT}` : "not signed" };
  const out = await executeAsProfile(ctx, { ...r, summaryExtra: { ...r.summaryExtra, autoDecision: autoInfo } } as ExecRequestExt, { ...opts, via: d.path, relayer: d.relayer ?? opts.relayer, skipQuota: opts.skipQuota ?? d.quotaSigned, chainChecked: true } as ExecOptionsExt);
  return { ...out, autoDecision: d };
}
