// Path (a) — direct Key Manager: the controller EOA sends
//   KM.execute(payload)                         for one call or a raw payload
//   KM.executeBatch(values[], payloads[])       for several calls (atomic)
// msg.value semantics (LSP6KeyManagerCore._executePayload): whatever the controller
// sends with the KM call is forwarded to the UP together with the payload. By
// default the profile pays call values from its OWN balance (ERC725X value field)
// and msg.value is 0; with fundFromController the controller EOA funds the call
// values (KM.execute{value: Σ} / executeBatch values[i] = call value, Σ == msg.value),
// which spends the agent's gas money and therefore needs the human's own approval.
import { encodeFunctionData, type Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { sendTx, simulate } from "../chain/tx.ts";
import { KM_ABI } from "../lsp/abis.ts";
import { requireKeyManager } from "../lsp/profile.ts";
import type { ExecOutcome, ExecTransport, ExecRequest } from "./transport.ts";
import { assertControllerValueApproved, confirmationBlock, consentForRequest, decodeReceiptEvents, encodeUpExecute, totalValue, upPayload, validateRequest, type ExecOptionsExt, type ExecRequestExt } from "./common.ts";

export function buildKmEntry(req: ExecRequest, fundFromController: boolean): { data: Hex; value: bigint; function: string } {
  const calls = req.calls ?? [];
  if (calls.length > 1) {
    const values = calls.map((c) => (fundFromController ? c.value : 0n));
    return {
      data: encodeFunctionData({ abi: KM_ABI, functionName: "executeBatch", args: [values, calls.map((c) => encodeUpExecute(c))] }),
      value: values.reduce((a, b) => a + b, 0n),
      function: "executeBatch(uint256[],bytes[])",
    };
  }
  const payload = upPayload(req);
  const value = fundFromController ? totalValue(req) : 0n;
  return { data: encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [payload] }), value, function: "execute(bytes)" };
}

export const kmTransport: ExecTransport = {
  path: "km",
  async execute(ctx: VerbContext, signer: Signer, reqIn: ExecRequest, optsIn): Promise<ExecOutcome> {
    const req = reqIn as ExecRequestExt;
    const opts = optsIn as ExecOptionsExt;
    const keyManager = await requireKeyManager(ctx, req.chainId, req.profile);
    const warnings = validateRequest(req, keyManager);
    const payload = upPayload(req);
    const entry = buildKmEntry(req, opts.fundFromController === true);
    const confirmation = confirmationBlock(ctx, req, {
      path: "km",
      keyManager,
      gasPayer: `controller EOA ${signer.address}`,
      entry: { to: keyManager, ...entry },
      payload,
      signer: signer.address,
      warnings,
    });
    // 1) simulate the exact entry call as the controller (decodes LSP6 errors)
    await simulate(ctx, { chainId: req.chainId, from: signer.address, to: keyManager, data: entry.data, value: entry.value });
    // 2) consent before any signature (call value paid by the controller needs the human's own words)
    assertControllerValueApproved(ctx, entry.value, confirmation);
    await consentForRequest(ctx, req, confirmation);
    // 3) sign + send (sendTx re-simulates, estimates, checks the EOA balance) — or stop in dry-run
    const tx = await sendTx(ctx, signer, { chainId: req.chainId, to: keyManager, data: entry.data, value: entry.value });
    if (tx.status === "dry-run") return { path: "km", chainId: req.chainId, profile: req.profile, keyManager, gasPayer: `controller EOA ${signer.address}`, status: "dry-run", entryCalldata: entry.data, confirmation, warnings };
    const events = tx.receipt ? decodeReceiptEvents(tx.receipt) : [];
    return {
      path: "km",
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
