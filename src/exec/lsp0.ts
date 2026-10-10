// Path (b) — direct LSP0/LSP20: the controller EOA calls the Universal Profile
// itself (execute / executeBatch / setData / setDataBatch / ownership functions).
// Because msg.sender != owner, LSP0 calls KM.lsp20VerifyCall(...) before (and,
// for non-setData calls, lsp20VerifyCallResult after) the execution; the KM
// applies exactly the same permission checks as path (a).
import type { Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { sendTx, simulate } from "../chain/tx.ts";
import { requireKeyManager } from "../lsp/profile.ts";
import type { ExecOutcome, ExecRequest, ExecTransport } from "./transport.ts";
import { confirmationBlock, consentForRequest, decodeReceiptEvents, totalValue, upPayload, validateRequest, type ExecOptionsExt, type ExecRequestExt } from "./common.ts";

export function buildLsp0Entry(req: ExecRequest, fundFromController: boolean): { data: Hex; value: bigint; function: string } {
  const data = upPayload(req);
  const fn = (req.calls?.length ?? 0) > 1 ? "executeBatch(uint256[],address[],uint256[],bytes[])" : req.calls?.length ? "execute(uint256,address,uint256,bytes)" : `payload ${data.slice(0, 10)}`;
  return { data, value: fundFromController ? totalValue(req) : 0n, function: fn };
}

export const lsp0Transport: ExecTransport = {
  path: "lsp0",
  async execute(ctx: VerbContext, signer: Signer, reqIn: ExecRequest, optsIn): Promise<ExecOutcome> {
    const req = reqIn as ExecRequestExt;
    const opts = optsIn as ExecOptionsExt;
    // The KM must be the owner for LSP20 verification to apply the controller's permissions.
    const keyManager = await requireKeyManager(ctx, req.chainId, req.profile);
    const warnings = validateRequest(req, keyManager);
    const entry = buildLsp0Entry(req, opts.fundFromController === true);
    const confirmation = confirmationBlock(ctx, req, {
      path: "lsp0",
      keyManager,
      gasPayer: `controller EOA ${signer.address}`,
      entry: { to: req.profile, ...entry },
      payload: entry.data,
      signer: signer.address,
      warnings,
    });
    await simulate(ctx, { chainId: req.chainId, from: signer.address, to: req.profile, data: entry.data, value: entry.value });
    await consentForRequest(ctx, req, confirmation);
    const tx = await sendTx(ctx, signer, { chainId: req.chainId, to: req.profile, data: entry.data, value: entry.value });
    if (tx.status === "dry-run") return { path: "lsp0", chainId: req.chainId, profile: req.profile, keyManager, gasPayer: `controller EOA ${signer.address}`, status: "dry-run", entryCalldata: entry.data, confirmation, warnings };
    const events = tx.receipt ? decodeReceiptEvents(tx.receipt) : [];
    return {
      path: "lsp0",
      chainId: req.chainId,
      profile: req.profile,
      keyManager,
      gasPayer: `controller EOA ${signer.address}`,
      status: "success",
      txHash: tx.hash,
      blockNumber: tx.blockNumber,
      gasUsed: tx.gasUsed,
      explorerUrl: tx.explorerUrl,
      entryCalldata: entry.data,
      confirmation: { ...confirmation, events },
      warnings,
    };
  },
};
