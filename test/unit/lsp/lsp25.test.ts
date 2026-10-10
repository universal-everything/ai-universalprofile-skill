import { describe, expect, it } from "vitest";
import { keccak256, recoverAddress, type Hex } from "viem";
import { testSigner } from "../../support/context.ts";
import {
  checkValidity,
  composeNonce,
  decodeValidityTimestamps,
  defaultChannel,
  encodeExecuteRelayCall,
  encodeExecuteRelayCallBatch,
  encodeLsp25Message,
  encodeValidityTimestamps,
  lsp25Digest,
  recoverLsp25Signer,
  signLsp25,
  signRelayBatch,
  splitNonce,
  validityWindow,
} from "../../../src/lsp/lsp25.ts";

// Hardhat/anvil default account #0 — public test key, never used with real funds.
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const KM = "0x2Fe3AeD98684E7351aD2D408A43cE09a738BF8a4" as const;
const PAYLOAD = "0x7f23690c5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020a0b000000000000000000000000000000000000000000000000000000000000" as Hex;

const u256 = (n: bigint) => n.toString(16).padStart(64, "0");

describe("LSP25 message and digest", () => {
  it("encodePacked(25, chainId, nonce, validity, value, payload) — byte layout per LIP-25", () => {
    const m = encodeLsp25Message({ chainId: 42, nonce: 5n, validityTimestamps: 0x10n, value: 0n, payload: PAYLOAD });
    expect(m).toBe(("0x" + u256(25n) + u256(42n) + u256(5n) + u256(16n) + u256(0n) + PAYLOAD.slice(2)) as Hex);
  });

  it("digest = keccak256(0x19 ‖ 0x00 ‖ KM ‖ message) — independent re-implementation (EIP191Signer.hashDataWithIntendedValidator)", () => {
    const msg = { keyManager: KM, chainId: 4201, nonce: composeNonce(3n, 9n), validityTimestamps: encodeValidityTimestamps(1_700_000_000n, 1_700_000_600n), value: 7n, payload: PAYLOAD };
    const manual = keccak256(("0x1900" + KM.slice(2).toLowerCase() + u256(25n) + u256(4201n) + u256(msg.nonce) + u256(msg.validityTimestamps) + u256(7n) + PAYLOAD.slice(2)) as Hex);
    expect(lsp25Digest(msg)).toBe(manual);
  });

  it("signature recovers to the controller; any change of chainId / KM / nonce / payload changes the signer", async () => {
    const s = testSigner(PK);
    expect(s.address).toBe(ADDR);
    const msg = { keyManager: KM, chainId: 42, nonce: 0n, validityTimestamps: 0n, value: 0n, payload: PAYLOAD };
    const sig = await signLsp25(s, msg);
    expect(await recoverLsp25Signer(msg, sig)).toBe(ADDR);
    expect(await recoverAddress({ hash: lsp25Digest(msg), signature: sig })).toBe(ADDR);
    // deterministic (RFC 6979)
    expect(await signLsp25(s, msg)).toBe(sig);
    for (const changed of [{ ...msg, chainId: 4201 }, { ...msg, keyManager: "0xa75684d7D048704a2DB851D05Ba0c3cbe226264C" as const }, { ...msg, nonce: 1n }, { ...msg, payload: (PAYLOAD.slice(0, -2) + "01") as Hex }, { ...msg, value: 1n }]) {
      expect(await recoverLsp25Signer(changed, sig)).not.toBe(ADDR);
    }
  });
});

describe("multi-channel nonces", () => {
  it("nonce = channel << 128 | sequence (LIP-25 example: channel 1 → 2^128)", () => {
    expect(composeNonce(1n, 0n)).toBe(340282366920938463463374607431768211456n);
    expect(composeNonce(1n, 1n)).toBe(340282366920938463463374607431768211457n);
    expect(splitNonce(composeNonce(5n, 1n))).toEqual({ channelId: 5n, sequence: 1n });
    expect(() => composeNonce(1n << 128n, 0n)).toThrow();
  });
  it("default channel per relayer × chain is a non-zero uint128 and stable", () => {
    const a = defaultChannel("universal-relayer", 42);
    expect(a).toBe(defaultChannel("Universal-Relayer", 42));
    expect(a).not.toBe(defaultChannel("universal-relayer", 8453));
    expect(a).not.toBe(defaultChannel("other", 42));
    expect(a > 0n && a < 1n << 128n).toBe(true);
  });
});

describe("validity timestamps", () => {
  it("encodes start ‖ end as two uint128 and checks like LSP25MultiChannelNonce", () => {
    const v = encodeValidityTimestamps(100n, 200n);
    expect(v).toBe((100n << 128n) | 200n);
    expect(decodeValidityTimestamps(v)).toEqual({ start: 100n, end: 200n, unlimited: false });
    expect(checkValidity(v, 99n)).toBe("not-yet-valid");
    expect(checkValidity(v, 100n)).toBe("ok");
    expect(checkValidity(v, 200n)).toBe("ok");
    expect(checkValidity(v, 201n)).toBe("expired");
    expect(checkValidity(0n, 10n ** 12n)).toBe("ok");
    expect(checkValidity(encodeValidityTimestamps(5n, 0n), 10n ** 12n)).toBe("ok"); // end 0 = no expiry
    expect(() => encodeValidityTimestamps(10n, 5n)).toThrow();
  });
  it("default window = now-60s … now+seconds; 0 = unlimited", () => {
    expect(decodeValidityTimestamps(validityWindow(1000n, 600))).toMatchObject({ start: 940n, end: 1600n });
    expect(validityWindow(1000n, 0)).toBe(0n);
    expect(() => validityWindow(1000n, -1)).toThrow();
  });
});

describe("calldata", () => {
  it("executeRelayCall and executeRelayCallBatch selectors", async () => {
    expect(encodeExecuteRelayCall("0x" + "11".repeat(65) as Hex, 1n, 0n, PAYLOAD).slice(0, 10)).toBe("0x4c8a4e74");
    const s = testSigner(PK);
    const batch = await signRelayBatch(s, { keyManager: KM, chainId: 42, channelId: 2n, startSequence: 4n, validityTimestamps: 0n }, [{ payload: PAYLOAD }, { payload: PAYLOAD, value: 3n }]);
    expect(batch.map((b) => b.nonce)).toEqual([composeNonce(2n, 4n), composeNonce(2n, 5n)]);
    expect(await recoverLsp25Signer({ keyManager: KM, chainId: 42, nonce: batch[1].nonce, validityTimestamps: 0n, value: 3n, payload: PAYLOAD }, batch[1].signature)).toBe(ADDR);
    expect(encodeExecuteRelayCallBatch(batch).slice(0, 10)).toBe("0xa20856a5");
  });
});
