import { describe, expect, it } from "vitest";
import {
  concat,
  encodePacked,
  hashMessage,
  hashTypedData,
  keccak256,
  parseTransaction,
  recoverAddress,
  recoverMessageAddress,
  recoverTypedDataAddress,
  serializeSignature,
  serializeTransaction,
  size,
  hexToBigInt,
  type Hex,
} from "viem";
import { sign } from "viem/accounts";
import { inspect } from "node:util";
import {
  SECP256K1_N,
  addressOf,
  createLocalSigner,
  generateKey,
  intendedValidatorDigest,
  isValidPrivateKey,
} from "../../../src/signer/local-signer.ts";
import type { ProtectionInfo } from "../../../src/core/types.ts";
import { UpError } from "../../../src/core/errors.ts";

// Hardhat/anvil account #0 (public test key).
const HH0_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const HH0_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const PROT: ProtectionInfo = { backend: "memory", level: "ephemeral", unattended: true, encryptedAtRest: false, notes: [] };

describe("key generation and validation", () => {
  it("derives the well-known address of hardhat account #0", () => {
    expect(addressOf(HH0_KEY)).toBe(HH0_ADDR);
  });

  it("rejects zero, n, > n and malformed keys", () => {
    expect(isValidPrivateKey("0x" + "00".repeat(32))).toBe(false);
    expect(isValidPrivateKey("0x" + SECP256K1_N.toString(16))).toBe(false);
    expect(isValidPrivateKey("0x" + "ff".repeat(32))).toBe(false);
    expect(isValidPrivateKey("0x1234")).toBe(false);
    expect(isValidPrivateKey("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")).toBe(false);
    expect(isValidPrivateKey("0x" + (SECP256K1_N - 1n).toString(16))).toBe(true);
    expect(isValidPrivateKey(HH0_KEY)).toBe(true);
  });

  it("generates distinct valid lowercase keys", () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateKey()));
    expect(keys.size).toBe(20);
    for (const k of keys) {
      expect(k).toMatch(/^0x[0-9a-f]{64}$/);
      expect(isValidPrivateKey(k)).toBe(true);
    }
  });
});

describe("createLocalSigner", () => {
  const signer = createLocalSigner(HH0_KEY, PROT);

  it("exposes address and protection but never the key", () => {
    expect(signer.address).toBe(HH0_ADDR);
    const bare = HH0_KEY.slice(2);
    expect(JSON.stringify(signer)).not.toContain(bare);
    expect(inspect(signer, { depth: 10, showHidden: true })).not.toContain(bare);
    const account = signer.toAccount();
    expect(JSON.stringify(account)).not.toContain(bare);
    expect(inspect(account, { depth: 10, showHidden: true })).not.toContain(bare);
    expect(account.address).toBe(HH0_ADDR);
    expect(account.type).toBe("local");
    expect((account as any).signAuthorization).toBeUndefined();
  });

  it("refuses a key that does not match the expected address (fail closed, key-free error)", () => {
    let err: unknown;
    try {
      createLocalSigner(HH0_KEY, PROT, "0x0000000000000000000000000000000000000001");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UpError);
    expect((err as UpError).code).toBe("SIGNER_LOCKED");
    expect(JSON.stringify((err as UpError).toJSON())).not.toContain(HH0_KEY.slice(2));
  });

  it("signMessage (string and raw) recovers to the address", async () => {
    const s1 = await signer.signMessage("hello universal profile");
    expect(await recoverMessageAddress({ message: "hello universal profile", signature: s1 })).toBe(HH0_ADDR);
    const s2 = await signer.signMessage({ raw: "0xdeadbeef" });
    expect(await recoverMessageAddress({ message: { raw: "0xdeadbeef" }, signature: s2 })).toBe(HH0_ADDR);
    expect(await recoverAddress({ hash: hashMessage({ raw: "0xdeadbeef" }), signature: s2 })).toBe(HH0_ADDR);
  });

  it("signTypedData recovers to the address", async () => {
    const td = {
      domain: { name: "UP", version: "1", chainId: 42, verifyingContract: "0x0000000000000000000000000000000000000042" as const },
      types: { Mail: [{ name: "contents", type: "string" }, { name: "amount", type: "uint256" }] },
      primaryType: "Mail" as const,
      message: { contents: "hi", amount: 7n },
    };
    const sig = await signer.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature: sig })).toBe(HH0_ADDR);
    expect(await recoverAddress({ hash: hashTypedData(td), signature: sig })).toBe(HH0_ADDR);
  });

  it("signTransaction produces a transaction from the address", async () => {
    const tx = { chainId: 42, type: "eip1559" as const, nonce: 3, to: "0x0000000000000000000000000000000000000042" as const, value: 1n, gas: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n };
    const raw = await signer.signTransaction(tx);
    const parsed = parseTransaction(raw);
    const { r, s, yParity, v, ...unsigned } = parsed as any;
    const hash = keccak256(serializeTransaction(unsigned));
    const recovered = await recoverAddress({ hash, signature: { r, s, yParity } });
    expect(recovered).toBe(HH0_ADDR);
  });

  it("signIntendedValidator = EIP-191 v0 over validator ‖ data, 65 bytes, v ∈ {27, 28}", async () => {
    const validator = "0xCAfEcAfeCAfECaFeCaFecaFecaFECafECafeCaFe" as const;
    const data = "0x0102030405" as Hex;
    const sig = await signer.signIntendedValidator(validator, data);
    expect(size(sig)).toBe(65);
    const v = Number(hexToBigInt(`0x${sig.slice(130)}`));
    expect([27, 28]).toContain(v);
    // Independent digest: 0x19 ‖ 0x00 ‖ validator ‖ data
    const digest = keccak256(concat(["0x19", "0x00", validator, data]));
    expect(intendedValidatorDigest(validator, data)).toBe(digest);
    expect(await recoverAddress({ hash: digest, signature: sig })).toBe(HH0_ADDR);
    // Deterministic (RFC 6979): equals an independent raw signature over the digest.
    expect(sig).toBe(serializeSignature(await sign({ hash: digest, privateKey: HH0_KEY })));
  });

  it("matches the LSP25 executeRelayCall digest construction", async () => {
    const keyManager = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
    const LSP25_VERSION = 25n;
    const chainId = 4201n;
    const nonce = (5n << 128n) | 17n; // channel 5, nonce 17
    const validityTimestamps = ("0x" + "00".repeat(32)) as Hex;
    const value = 0n;
    const payload = "0x44c028fe0000000000000000000000000000000000000000000000000000000000000000" as Hex;
    const encodedMessage = encodePacked(["uint256", "uint256", "uint256", "bytes32", "uint256", "bytes"], [LSP25_VERSION, chainId, nonce, validityTimestamps, value, payload]);
    const digest = keccak256(encodePacked(["bytes1", "bytes1", "address", "bytes"], ["0x19", "0x00", keyManager, encodedMessage]));
    const sig = await signer.signIntendedValidator(keyManager, encodedMessage);
    expect(await recoverAddress({ hash: digest, signature: sig })).toBe(HH0_ADDR);
  });

  it("rejects malformed validator/data", async () => {
    await expect(Promise.resolve().then(() => signer.signIntendedValidator("0x1234" as any, "0x"))).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(Promise.resolve().then(() => signer.signIntendedValidator(HH0_ADDR, "zz" as any))).rejects.toMatchObject({ code: "BAD_ARGS" });
  });
});
