// Relay outcome attribution from calldata (matchRelayCall): only a direct Key Manager call that carries exactly
// this signed call counts as this call; a different call of the same key with this nonce is "other"; another
// key's equal nonce value or another nonce is unrelated; anything that is not a decodable direct Key Manager
// call proves nothing, also when this call's signature bytes appear somewhere in it.
import { describe, expect, it } from "vitest";
import { concat, encodeFunctionData, getAddress, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { testSigner } from "../../support/context.ts";
import { matchRelayCall, type SignedRelay } from "../../../src/exec/relay.ts";
import { composeNonce, encodeExecuteRelayCall, encodeExecuteRelayCallBatch, signLsp25 } from "../../../src/lsp/lsp25.ts";
import { encodeUpExecute } from "../../../src/exec/common.ts";
import { KM_ABI } from "../../../src/lsp/abis.ts";
import type { Signer } from "../../../src/core/types.ts";

const KM = getAddress("0x" + "4b".repeat(20));
const WRAPPER = getAddress("0x" + "77".repeat(20));
const TARGET = getAddress("0x" + "5a".repeat(20));
const me = testSigner(generatePrivateKey());
const someoneElse = testSigner(generatePrivateKey());
const nonce = composeNonce(0x1234_5678_9abc_def0_1234_5678_9abc_def0n, 7n);
const payload = encodeUpExecute({ operation: 0, to: TARGET, value: 0n, data: "0xdeadbeef" });
const intent: SignedRelay = { keyManager: KM, chainId: 42, signer: me.address, nonce, validityTimestamps: 0n, payload };
const sign = (s: Signer, m: Partial<{ nonce: bigint; validityTimestamps: bigint; payload: Hex; value: bigint }> = {}) =>
  signLsp25(s, { keyManager: KM, chainId: 42, nonce, validityTimestamps: 0n, value: 0n, payload, ...m });
const tx = (input: Hex, to: string | null = KM, value = "0x0") => ({ to, input, value });
const item = async (s: Signer, m: Partial<{ nonce: bigint; validityTimestamps: bigint; payload: Hex }> = {}) => ({ signature: await sign(s, m), nonce: m.nonce ?? nonce, validityTimestamps: m.validityTimestamps ?? 0n, value: 0n, payload: m.payload ?? payload });

describe("matchRelayCall", () => {
  it("the exact executeRelayCall to this Key Manager is this call", async () => {
    const sig = await sign(me);
    expect(await matchRelayCall(tx(encodeExecuteRelayCall(sig, nonce, 0n, payload)), intent)).toEqual({ kind: "ours", entry: "executeRelayCall" });
    expect(await matchRelayCall(tx(encodeExecuteRelayCall(sig, nonce, 0n, payload), KM.toLowerCase()), intent)).toEqual({ kind: "ours", entry: "executeRelayCall" });
  });

  it("another call of the same key with this nonce is 'other' (other payload, other window)", async () => {
    const otherPayload = encodeUpExecute({ operation: 0, to: TARGET, value: 0n, data: "0xc0ffee" });
    expect(await matchRelayCall(tx(encodeExecuteRelayCall(await sign(me, { payload: otherPayload }), nonce, 0n, otherPayload)), intent)).toEqual({ kind: "other", entry: "executeRelayCall" });
    expect(await matchRelayCall(tx(encodeExecuteRelayCall(await sign(me, { validityTimestamps: 5n }), nonce, 5n, payload)), intent)).toEqual({ kind: "other", entry: "executeRelayCall" });
  });

  it("another key's call with the same nonce value, the same key's call with another nonce, or a non-zero msg.value are unrelated", async () => {
    expect(await matchRelayCall(tx(encodeExecuteRelayCall(await sign(someoneElse), nonce, 0n, payload)), intent)).toEqual({ kind: "unrelated" });
    expect(await matchRelayCall(tx(encodeExecuteRelayCall(await sign(me, { nonce: nonce + 1n }), nonce + 1n, 0n, payload)), intent)).toEqual({ kind: "unrelated" });
    // this signature with msg.value 1 recovers to a different signer: it is not this controller's call
    expect(await matchRelayCall(tx(encodeExecuteRelayCall(await sign(me), nonce, 0n, payload), KM, "0x1"), intent)).toEqual({ kind: "unrelated" });
    expect(await matchRelayCall(tx(encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [payload] })), intent)).toEqual({ kind: "unrelated" });
  });

  it("an item of executeRelayCallBatch: this call at its index, or another call of the same key with this nonce", async () => {
    const otherPayload = encodeUpExecute({ operation: 0, to: TARGET, value: 0n, data: "0x01" });
    const batch = encodeExecuteRelayCallBatch([await item(someoneElse), await item(me)]);
    expect(await matchRelayCall(tx(batch), intent)).toEqual({ kind: "ours", entry: "executeRelayCallBatch[1]" });
    const competing = encodeExecuteRelayCallBatch([await item(me, { nonce: nonce - 1n }), await item(me, { payload: otherPayload })]);
    expect(await matchRelayCall(tx(competing), intent)).toEqual({ kind: "other", entry: "executeRelayCallBatch[1]" });
  });

  it("anything that is not a decodable direct Key Manager call proves nothing, even when it carries this call's bytes", async () => {
    const sig = await sign(me);
    const exact = encodeExecuteRelayCall(sig, nonce, 0n, payload);
    expect(await matchRelayCall(tx(exact, WRAPPER), intent)).toMatchObject({ kind: "undecodable" }); // a wrapper that may or may not have run it
    expect(await matchRelayCall(tx(concat(["0x12345678", sig])), intent)).toMatchObject({ kind: "undecodable" }); // signature bytes in unrelated calldata
    expect(await matchRelayCall(tx(exact, null), intent)).toMatchObject({ kind: "undecodable" });
    expect(await matchRelayCall(null, intent)).toMatchObject({ kind: "undecodable", reason: /could not be read/ });
    expect(await matchRelayCall({ to: KM }, intent)).toMatchObject({ kind: "undecodable" });
    // another key's relay call whose payload embeds this call's signature is still not this call
    const carrier = encodeUpExecute({ operation: 0, to: TARGET, value: 0n, data: sig });
    expect(await matchRelayCall(tx(encodeExecuteRelayCall(await sign(someoneElse, { payload: carrier }), nonce, 0n, carrier)), intent)).toEqual({ kind: "unrelated" });
  });
});
