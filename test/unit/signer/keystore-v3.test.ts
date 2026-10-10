import { describe, expect, it } from "vitest";
import { createDecipheriv } from "node:crypto";
import { scrypt as nobleScrypt } from "@noble/hashes/scrypt";
import { keccak256, type Hex } from "viem";
import { decryptKeystoreV3, encryptKeystoreV3, type KeystoreV3 } from "../../../src/signer/keystore-v3.ts";
import { addressOf } from "../../../src/signer/local-signer.ts";

// Test vectors from the Web3 Secret Storage Definition
// (https://ethereum.org/en/developers/docs/data-structures-and-encoding/web3-secret-storage/), password "testpassword".
const VECTOR_KEY = "0x7a28b5ba57c53603b0b07b56bba752f7784bf506fa95edc395f5cf6c7514fe9d";
const PBKDF2_VECTOR = {
  crypto: {
    cipher: "aes-128-ctr",
    cipherparams: { iv: "6087dab2f9fdbbfaddc31a909735c1e6" },
    ciphertext: "5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46",
    kdf: "pbkdf2",
    kdfparams: { c: 262144, dklen: 32, prf: "hmac-sha256", salt: "ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd" },
    mac: "517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2",
  },
  id: "3198bc9c-6672-5ab3-d995-4942343ae5b6",
  version: 3,
};
const SCRYPT_VECTOR = {
  crypto: {
    cipher: "aes-128-ctr",
    cipherparams: { iv: "83dbcc02d8ccb40e466191a123791e0e" },
    ciphertext: "d172bf743a674da9cdad04534d56926ef8358534d458fffccd4e6ad2fbde479c",
    kdf: "scrypt",
    kdfparams: { dklen: 32, n: 262144, p: 8, r: 1, salt: "ab0c7876052600dd703518d6fc3fe8984592145b591fc8fb5c6d43190334ba19" },
    mac: "2103ac29920d71da29f15d75b4a16dbe95cfd7ff8faea1056c33131d846e3097",
  },
  id: "3198bc9c-6672-5ab3-d995-4942343ae5b6",
  version: 3,
};

/**
 * Independent decryption path: pure-JS scrypt from @noble/hashes (a different
 * implementation than OpenSSL behind node:crypto) — shares only keccak with the module.
 */
function independentDecrypt(ks: KeystoreV3 | typeof SCRYPT_VECTOR, password: string): string {
  const kp = ks.crypto.kdfparams as any;
  const dk = Buffer.from(nobleScrypt(Buffer.from(password, "utf8"), Buffer.from(kp.salt, "hex"), { N: kp.n, r: kp.r, p: kp.p, dkLen: kp.dklen, maxmem: 2 ** 31 }));
  const ct = Buffer.from(ks.crypto.ciphertext, "hex");
  const mac = keccak256(Buffer.concat([dk.subarray(16, 32), ct])).slice(2);
  if (mac !== ks.crypto.mac) throw new Error("mac mismatch");
  const d = createDecipheriv("aes-128-ctr", dk.subarray(0, 16), Buffer.from(ks.crypto.cipherparams.iv, "hex"));
  return "0x" + Buffer.concat([d.update(ct), d.final()]).toString("hex");
}

describe("keystore v3", () => {
  it("decrypts the official pbkdf2 test vector", async () => {
    expect(await decryptKeystoreV3(PBKDF2_VECTOR as any, "testpassword")).toBe(VECTOR_KEY);
  });

  it("official scrypt test vector (n=262144, r=1, p=8): verified independently; node:crypto cannot compute it", async () => {
    // The independent implementation confirms the vector (and our MAC/AES-CTR construction).
    expect(independentDecrypt(SCRYPT_VECTOR, "testpassword")).toBe(VECTOR_KEY);
    // OpenSSL enforces N < 2^(16·r), so r=1/N=2^18 is reported clearly instead of crashing.
    await expect(decryptKeystoreV3(JSON.stringify(SCRYPT_VECTOR), "testpassword")).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("rejects a wrong passphrase with a MAC error that does not leak the key", async () => {
    await expect(decryptKeystoreV3(PBKDF2_VECTOR as any, "wrong")).rejects.toMatchObject({ code: "BAD_ARGS", message: expect.stringContaining("MAC") });
  });

  it("round-trips with small scrypt params and cross-checks with an independent decryptor", async () => {
    const key = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318" as Hex;
    const ks = await encryptKeystoreV3(key, "correct horse battery staple", { n: 1024, r: 8, p: 1 });
    expect(ks.version).toBe(3);
    expect(ks.crypto.kdf).toBe("scrypt");
    expect(ks.crypto.cipher).toBe("aes-128-ctr");
    expect(ks.address).toBe(addressOf(key).slice(2).toLowerCase());
    expect(JSON.stringify(ks)).not.toContain(key.slice(2));
    expect(await decryptKeystoreV3(ks, "correct horse battery staple")).toBe(key);
    expect(independentDecrypt(ks, "correct horse battery staple")).toBe(key);
    await expect(decryptKeystoreV3(ks, "correct horse battery stapler")).rejects.toMatchObject({ code: "BAD_ARGS" });
  });

  it("is deterministic for fixed salt/iv/uuid; a generated vector decrypts with the independent implementation", async () => {
    const opts = {
      n: 16384,
      r: 8,
      p: 1,
      salt: Buffer.from(SCRYPT_VECTOR.crypto.kdfparams.salt, "hex"),
      iv: Buffer.from(SCRYPT_VECTOR.crypto.cipherparams.iv, "hex"),
      uuid: SCRYPT_VECTOR.id,
    };
    const a = await encryptKeystoreV3(VECTOR_KEY as Hex, "testpassword", opts);
    const b = await encryptKeystoreV3(VECTOR_KEY as Hex, "testpassword", opts);
    expect(a).toEqual(b);
    // Same salt/iv but different KDF parameters ⇒ different derived key ⇒ different ciphertext.
    expect(a.crypto.ciphertext).not.toBe(SCRYPT_VECTOR.crypto.ciphertext);
    expect(independentDecrypt(a, "testpassword")).toBe(VECTOR_KEY);
    expect(() => independentDecrypt(a, "testpasswore")).toThrow("mac mismatch");
  });

  it("uses geth standard scrypt parameters by default", async () => {
    const ks = await encryptKeystoreV3("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318", "a-long-enough-passphrase");
    expect(ks.crypto.kdfparams).toMatchObject({ n: 262144, r: 8, p: 1, dklen: 32 });
    expect(ks.crypto.kdfparams.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(ks.crypto.cipherparams.iv).toMatch(/^[0-9a-f]{32}$/);
  });

  it("rejects absurd scrypt parameters and unsupported formats", async () => {
    const bad = structuredClone(SCRYPT_VECTOR);
    bad.crypto.kdfparams.n = 1000; // not a power of two
    await expect(decryptKeystoreV3(bad as any, "x")).rejects.toMatchObject({ code: "BAD_ARGS" });
    const huge = structuredClone(SCRYPT_VECTOR);
    huge.crypto.kdfparams.n = 2 ** 30;
    await expect(decryptKeystoreV3(huge as any, "x")).rejects.toMatchObject({ code: "BAD_ARGS" });
    const manyP = structuredClone(SCRYPT_VECTOR);
    manyP.crypto.kdfparams.p = 1000;
    await expect(decryptKeystoreV3(manyP as any, "x")).rejects.toMatchObject({ code: "BAD_ARGS" });
    const manyC = structuredClone(PBKDF2_VECTOR);
    manyC.crypto.kdfparams.c = 2 ** 31;
    await expect(decryptKeystoreV3(manyC as any, "x")).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(decryptKeystoreV3("{}", "x")).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(encryptKeystoreV3(VECTOR_KEY as Hex, "")).rejects.toMatchObject({ code: "BAD_ARGS" });
  });
});
