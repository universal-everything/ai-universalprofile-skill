// LSP-30 encryption: byte-compatibility with the Universal Profile mobile app (known-answer vector made
// with the app's algorithm, public Anvil key + throwaway password) and the quirks the importer accepts.
import { afterEach, describe, expect, it } from "vitest";
import { createCipheriv, pbkdf2Sync, randomBytes, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { ENCRYPTION_TYPE, decryptSecrets, encryptSecrets, payloadText } from "../../../src/backup/lsp30-crypto.ts";
import { UpError } from "../../../src/core/errors.ts";
import { clearSecretsForTests, containsSecret } from "../../../src/core/secret-guard.ts";

const kat = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "fixtures", "lsp30", "app-kat.json"), "utf8"));
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ANVIL_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const data = kat.backupFile.secrets.data;

afterEach(() => clearSecretsForTests());

/** Seals any plaintext with any parameters, the way a foreign writer might. */
function seal(plain: string, password: string, o: { iterations?: number; ivBytes?: number } = {}) {
  const salt = randomBytes(32);
  const iv = randomBytes(o.ivBytes ?? 16);
  const key = pbkdf2Sync(Buffer.from(password, "utf8"), salt, o.iterations ?? 10_000, 32, "sha256");
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final(), c.getAuthTag()]);
  return { secret: ct.toString("base64"), iv: iv.toString("base64"), salt: salt.toString("base64") };
}
const entry = (k: Hex = ANVIL_KEY) => ({ address: privateKeyToAddress(k), privateKey: k });
const thrown = async (p: Promise<unknown>): Promise<UpError> => {
  try {
    await p;
  } catch (e) {
    return e as UpError;
  }
  throw new Error("expected an error");
};

describe("known-answer vector from the app's algorithm", () => {
  it("decrypts the app's file with the skill code", async () => {
    const r = await decryptSecrets(data, kat.password);
    expect(r.shape).toBe("app");
    expect(r.iterations).toBe(10_000);
    expect(r.keys).toEqual([{ index: 0, address: ANVIL_ADDRESS, privateKey: ANVIL_KEY }]);
    expect(r.seedPhraseEntries).toBe(0);
  });

  it("encrypts to exactly the app's bytes when salt and IV are pinned", async () => {
    const out = await encryptSecrets([{ address: ANVIL_ADDRESS, privateKey: ANVIL_KEY }], kat.password, { salt: Buffer.from(kat.saltHex, "hex"), iv: Buffer.from(kat.ivHex, "hex") });
    expect(out).toEqual(data);
    expect(out.secret).toBe(kat.ciphertextPlusTagB64);
  });

  it("the plaintext is the app's double-encoded object with its key order", () => {
    const text = payloadText([{ address: ANVIL_ADDRESS, privateKey: ANVIL_KEY }]);
    expect(text).toBe(kat.plaintextBytesUtf8);
    const once = JSON.parse(text);
    expect(typeof once).toBe("string");
    expect(Object.keys(JSON.parse(once))).toEqual(["privateKeys", "seedPhrases"]);
    expect(Object.keys(JSON.parse(once).privateKeys[0])).toEqual(["address", "privateKey"]);
    expect(once).not.toContain(" "); // compact inner JSON
  });

  it("an independent implementation (WebCrypto, the app's own primitives) decrypts the skill's output", async () => {
    const k = generatePrivateKey();
    const out = await encryptSecrets([entry(k)], "web-crypto-check-123");
    const subtle = webcrypto.subtle;
    const base = await subtle.importKey("raw", new TextEncoder().encode("web-crypto-check-123"), "PBKDF2", false, ["deriveKey"]);
    const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(out.salt, "base64"), iterations: 10_000 }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(out.iv, "base64") }, key, Buffer.from(out.secret, "base64"));
    expect(Buffer.from(plain).toString("utf8")).toBe(payloadText([entry(k)]));
    expect(Buffer.from(out.salt, "base64")).toHaveLength(32);
    expect(Buffer.from(out.iv, "base64")).toHaveLength(16);
  });

  it("a fresh encrypt uses random salt and IV and round-trips several keys in order", async () => {
    const ks = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
    const a = await encryptSecrets(ks.map(entry), "round-trip-password-1");
    const b = await encryptSecrets(ks.map(entry), "round-trip-password-1");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect((await decryptSecrets(a, "round-trip-password-1")).keys.map((k) => [k.index, k.privateKey])).toEqual(ks.map((k, i) => [i, k]));
  });

  it("registers every decrypted key with the output guard", async () => {
    await decryptSecrets(data, kat.password);
    expect(containsSecret(`x ${ANVIL_KEY}`)).toBe(true);
  });
});

describe("wrong password and damaged files give one content-free error (Q6)", () => {
  it("wrong password", async () => {
    const e = await thrown(decryptSecrets(data, "not-the-password"));
    expect(e.message).toBe("wrong password or damaged file");
    expect(JSON.stringify(e.toJSON())).not.toContain("not-the-password");
  });

  it("flipped ciphertext bit and flipped tag bit", async () => {
    const raw = Buffer.from(data.secret, "base64");
    for (const pos of [3, raw.length - 1]) {
      const bad = Buffer.from(raw);
      bad[pos] ^= 1;
      const e = await thrown(decryptSecrets({ ...data, secret: bad.toString("base64") }, kat.password));
      expect(e.message).toBe("wrong password or damaged file");
    }
  });

  it("malformed Base64 or lengths name the field, never the value", async () => {
    const e1 = await thrown(decryptSecrets({ ...data, salt: "not base64!!" }, kat.password));
    expect(e1.message).toBe("the backup's salt is not valid Base64");
    const e2 = await thrown(decryptSecrets({ ...data, iv: Buffer.alloc(5).toString("base64") }, kat.password));
    expect(e2.message).toBe("the backup's iv has an unexpected length");
  });
});

describe("what the importer tolerates (quirks Q1 to Q5)", () => {
  const pw = "tolerant-reader-pw-1";
  const inner = (ks: Hex[]) => ({ privateKeys: ks.map(entry), seedPhrases: [] as unknown[] });

  it("Q1: a single-encoded object", async () => {
    const r = await decryptSecrets(seal(JSON.stringify(inner([ANVIL_KEY])), pw), pw);
    expect(r.shape).toBe("object");
    expect(r.keys[0].privateKey).toBe(ANVIL_KEY);
  });

  it("Q1/Q2: the spec's entry array, with indices from the entries and seed phrases skipped", async () => {
    const k1 = generatePrivateKey();
    const arr = [
      { type: "privateKey", index: 5, address: privateKeyToAddress(ANVIL_KEY), secret: ANVIL_KEY },
      { type: "seedPhrase", index: 0, secret: "never printed" },
      { type: "privateKey", index: 7, secret: k1 },
    ];
    for (const plain of [JSON.stringify(arr), JSON.stringify(JSON.stringify(arr))]) {
      const r = await decryptSecrets(seal(plain, pw), pw);
      expect(r.shape).toBe("array");
      expect(r.keys.map((k) => [k.index, k.address])).toEqual([[5, ANVIL_ADDRESS], [7, privateKeyToAddress(k1)]]);
      expect(r.seedPhraseEntries).toBe(1);
    }
  });

  it("the entry array: two keys with the same resolved index are refused (a selective import could not tell them apart), whether the index is written or the position", async () => {
    const k1 = generatePrivateKey();
    const written = [{ type: "privateKey", index: 2, secret: ANVIL_KEY }, { type: "privateKey", index: 2, secret: k1 }];
    const positional = [{ type: "privateKey", index: 1, secret: ANVIL_KEY }, { type: "privateKey", secret: k1 }]; // the second one resolves to its position, 1
    for (const arr of [written, positional]) {
      const e = await thrown(decryptSecrets(seal(JSON.stringify(arr), pw), pw));
      expect(e.message).toBe("key number " + (arr === written ? 2 : 1) + " appears twice in the decrypted backup");
      expect(e.message + JSON.stringify(e.details ?? {})).not.toContain(ANVIL_KEY.slice(2));
    }
  });

  it("the entry array: only privateKey is a key and seedPhrase is skipped; any other or missing type is rejected without quoting it", async () => {
    for (const type of ["mnemonic", "PRIVATEKEY", undefined, 7]) {
      const e = await thrown(decryptSecrets(seal(JSON.stringify([{ type, index: 0, secret: ANVIL_KEY }]), pw), pw));
      expect(e.message).toBe("entry 0 of the decrypted backup is not a private key or a seed phrase");
    }
    const ok = await decryptSecrets(seal(JSON.stringify([{ type: "seedPhrase", index: 0, secret: "twelve words" }, { type: "privateKey", index: 1, secret: ANVIL_KEY }]), pw), pw);
    expect(ok.keys.map((k) => k.index)).toEqual([1]);
    expect(ok.seedPhraseEntries).toBe(1);
  });

  it("Q1: anything else is an unsupported payload, quoted nowhere", async () => {
    for (const plain of [JSON.stringify("hello secret text"), JSON.stringify({ other: 1 }), "not json at all", JSON.stringify([1, 2])]) {
      const e = await thrown(decryptSecrets(seal(plain, pw), pw));
      expect(e.message).toBe("the decrypted backup has an unsupported payload (expected the app's key list)");
    }
  });

  it("an invalid key is reported by position only", async () => {
    const e = await thrown(decryptSecrets(seal(JSON.stringify(JSON.stringify({ privateKeys: [{ address: ANVIL_ADDRESS, privateKey: "0x1234" }], seedPhrases: [] })), pw), pw));
    expect(e.message).toBe("key number 0 in the backup is not a valid private key");
  });

  it("a stored address that is not the key's address is flagged and never trusted (Q9)", async () => {
    const forged = { privateKeys: [{ address: "0x1111111111111111111111111111111111111111", privateKey: ANVIL_KEY }], seedPhrases: [] };
    const r = await decryptSecrets(seal(JSON.stringify(JSON.stringify(forged)), pw), pw);
    expect(r.keys[0].address).toBe(ANVIL_ADDRESS);
    expect(r.keys[0].claimedAddress).toBe("different");
  });

  it("Q3: 600,000 iterations (the spec's recommendation) after the app's 10,000", async () => {
    const r = await decryptSecrets(seal(JSON.stringify(JSON.stringify(inner([ANVIL_KEY]))), pw, { iterations: 600_000 }), pw);
    expect(r.iterations).toBe(600_000);
    expect(r.keys).toHaveLength(1);
  });

  it("Q4: a 12-byte IV", async () => {
    const r = await decryptSecrets(seal(JSON.stringify(JSON.stringify(inner([ANVIL_KEY]))), pw, { ivBytes: 12 }), pw);
    expect(r.keys).toHaveLength(1);
  });

  it("Q5: a password typed in another Unicode form (phone keyboards): NFC and NFKC are tried", async () => {
    const composed = "Pässwörd-ünïcode-12"; // NFC
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    const sealed = seal(JSON.stringify(JSON.stringify(inner([ANVIL_KEY]))), composed);
    const r = await decryptSecrets(sealed, decomposed);
    expect(r.passwordForm).toBe("nfc");
    const wide = "ＰａｓｓＷｏｒｄ１２３４５６"; // full-width, NFKC folds to ASCII
    const r2 = await decryptSecrets(seal(JSON.stringify(JSON.stringify(inner([ANVIL_KEY]))), wide.normalize("NFKC")), wide);
    expect(r2.passwordForm).toBe("nfkc");
  });

  it("the encryption type text is the one the app writes", () => {
    expect(ENCRYPTION_TYPE).toBe(kat.backupFile.secrets.encryptionType);
  });
});
