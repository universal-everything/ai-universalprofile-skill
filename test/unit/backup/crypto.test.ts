// LSP-30 encryption: byte-compatibility with the Universal Profile mobile app (known-answer vector made
// with the app's algorithm, public Anvil key + throwaway password), the stated iteration count (used as
// given, never guessed) and the quirks the importer accepts.
import { afterEach, describe, expect, it } from "vitest";
import { createCipheriv, pbkdf2Sync, randomBytes, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { DEFAULT_ITERATIONS, ENCRYPTION_TYPE, LEGACY_ITERATIONS, MAX_ITERATIONS, decryptSecrets, encryptSecrets, isValidIterations, kdfDescription, payloadText } from "../../../src/backup/lsp30-crypto.ts";
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
  it("decrypts the app's file (it states no count: 10,000) with the skill code", async () => {
    expect(kat.backupFile.secrets).not.toHaveProperty("iterations");
    const r = await decryptSecrets(data, kat.password, LEGACY_ITERATIONS);
    expect(r.shape).toBe("app");
    expect(r.iterations).toBe(10_000);
    expect(r.keys).toEqual([{ index: 0, address: ANVIL_ADDRESS, privateKey: ANVIL_KEY }]);
    expect(r.seedPhraseEntries).toBe(0);
  });

  it("encrypts to exactly the app's bytes at 10,000 iterations when salt and IV are pinned", async () => {
    const out = await encryptSecrets([{ address: ANVIL_ADDRESS, privateKey: ANVIL_KEY }], kat.password, LEGACY_ITERATIONS, { salt: Buffer.from(kat.saltHex, "hex"), iv: Buffer.from(kat.ivHex, "hex") });
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

  it("an independent implementation (WebCrypto, the app's own primitives) decrypts the skill's 600,000-iteration output, and only at 600,000", async () => {
    const k = generatePrivateKey();
    const out = await encryptSecrets([entry(k)], "web-crypto-check-123", DEFAULT_ITERATIONS);
    const subtle = webcrypto.subtle;
    const base = await subtle.importKey("raw", new TextEncoder().encode("web-crypto-check-123"), "PBKDF2", false, ["deriveKey"]);
    const open = async (iterations: number) => {
      const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(out.salt, "base64"), iterations }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      return subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(out.iv, "base64") }, key, Buffer.from(out.secret, "base64"));
    };
    expect(Buffer.from(await open(600_000)).toString("utf8")).toBe(payloadText([entry(k)]));
    await expect(open(10_000)).rejects.toThrow(); // what an app that only knows 10,000 does with it
    expect(Buffer.from(out.salt, "base64")).toHaveLength(32);
    expect(Buffer.from(out.iv, "base64")).toHaveLength(16);
  });

  it("a fresh encrypt uses random salt and IV and round-trips several keys in order", async () => {
    const ks = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
    const a = await encryptSecrets(ks.map(entry), "round-trip-password-1", DEFAULT_ITERATIONS);
    const b = await encryptSecrets(ks.map(entry), "round-trip-password-1", DEFAULT_ITERATIONS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    const r = await decryptSecrets(a, "round-trip-password-1", DEFAULT_ITERATIONS);
    expect(r.keys.map((k) => [k.index, k.privateKey])).toEqual(ks.map((k, i) => [i, k]));
    expect(r.iterations).toBe(600_000);
  });

  it("registers every decrypted key with the output guard", async () => {
    await decryptSecrets(data, kat.password, LEGACY_ITERATIONS);
    expect(containsSecret(`x ${ANVIL_KEY}`)).toBe(true);
  });
});

describe("the iteration count is the one stated, used as given", () => {
  const pw = "stated-count-password-1";
  const plain = () => JSON.stringify(JSON.stringify({ privateKeys: [entry()], seedPhrases: [] }));

  it("the counts: 600,000 for new files, 10,000 for files that state none (and --legacy), at most 5,000,000", () => {
    expect(DEFAULT_ITERATIONS).toBe(600_000);
    expect(LEGACY_ITERATIONS).toBe(10_000);
    expect(MAX_ITERATIONS).toBe(5_000_000);
    expect(kdfDescription(DEFAULT_ITERATIONS)).toBe("PBKDF2-HMAC-SHA256 (600,000 iterations), AES-256-GCM");
    expect(kdfDescription(LEGACY_ITERATIONS)).toBe("PBKDF2-HMAC-SHA256 (10,000 iterations), AES-256-GCM");
  });

  it("derives with exactly that count: no other count is tried after a failure, in either direction", async () => {
    const at600k = seal(plain(), pw, { iterations: 600_000 });
    expect((await decryptSecrets(at600k, pw, 600_000)).keys).toHaveLength(1);
    expect((await thrown(decryptSecrets(at600k, pw, 10_000))).message).toBe("wrong password or damaged file"); // no fallback to 600,000
    const at10k = seal(plain(), pw, { iterations: 10_000 });
    expect((await thrown(decryptSecrets(at10k, pw, 600_000))).message).toBe("wrong password or damaged file"); // no fallback to 10,000
    expect((await thrown(decryptSecrets(at600k, pw, 600_001))).message).toBe("wrong password or damaged file");
  });

  it("a count other than the two this skill writes works when it is the one stated", async () => {
    const r = await decryptSecrets(seal(plain(), pw, { iterations: 123_457 }), pw, 123_457);
    expect(r.iterations).toBe(123_457);
    expect(r.keys[0].address).toBe(ANVIL_ADDRESS);
  });

  it("the wrong-password error names the count that was used, never the password", async () => {
    const e = await thrown(decryptSecrets(seal(plain(), pw, { iterations: 600_000 }), "not-it-at-all-1", 600_000));
    expect(e.details).toMatchObject({ reason: "wrong-password-or-damaged-file", iterations: 600_000 });
    expect(JSON.stringify(e.toJSON())).not.toContain("not-it-at-all-1");
  });

  it("an invalid count is refused before any key derivation (deriving MAX_SAFE_INTEGER times would never finish)", async () => {
    const sealed = seal(plain(), pw);
    const started = Date.now();
    for (const bad of [0, -0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 5_000_001, Number.MAX_SAFE_INTEGER, 2 ** 53, "600000", null, undefined, true, [600_000], {}]) {
      const e = await thrown(decryptSecrets(sealed, pw, bad as number));
      expect(e, String(bad)).toBeInstanceOf(UpError);
      expect(e.message, String(bad)).toBe("the backup's iterations is not a whole number from 1 to 5,000,000");
    }
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("which counts are valid: whole numbers from 1 to 5,000,000", () => {
    for (const ok of [1, 10_000, 123_457, 600_000, 5_000_000]) expect(isValidIterations(ok), String(ok)).toBe(true);
    for (const bad of [0, -0, -1, 0.5, 1.5, 600_000.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 5_000_001, Number.MAX_SAFE_INTEGER, 2 ** 53, "600000", "", null, undefined, true, false, [600_000], {}, 600_000n]) expect(isValidIterations(bad), String(bad)).toBe(false);
  });

  it("the encryptor refuses an invalid count (nothing this skill writes may be unreadable)", async () => {
    for (const bad of [0, 1.5, 5_000_001, Number.NaN]) {
      const e = await thrown(encryptSecrets([entry()], pw, bad));
      expect(e.code, String(bad)).toBe("INTERNAL");
    }
  });
});

describe("wrong password and damaged files give one content-free error (Q6)", () => {
  it("wrong password", async () => {
    const e = await thrown(decryptSecrets(data, "not-the-password", LEGACY_ITERATIONS));
    expect(e.message).toBe("wrong password or damaged file");
    expect(JSON.stringify(e.toJSON())).not.toContain("not-the-password");
  });

  it("flipped ciphertext bit and flipped tag bit", async () => {
    const raw = Buffer.from(data.secret, "base64");
    for (const pos of [3, raw.length - 1]) {
      const bad = Buffer.from(raw);
      bad[pos] ^= 1;
      const e = await thrown(decryptSecrets({ ...data, secret: bad.toString("base64") }, kat.password, LEGACY_ITERATIONS));
      expect(e.message).toBe("wrong password or damaged file");
    }
  });

  it("malformed Base64 or lengths name the field, never the value", async () => {
    const e1 = await thrown(decryptSecrets({ ...data, salt: "not base64!!" }, kat.password, LEGACY_ITERATIONS));
    expect(e1.message).toBe("the backup's salt is not valid Base64");
    const e2 = await thrown(decryptSecrets({ ...data, iv: Buffer.alloc(5).toString("base64") }, kat.password, LEGACY_ITERATIONS));
    expect(e2.message).toBe("the backup's iv has an unexpected length");
  });
});

describe("what the importer tolerates (quirks Q1, Q2, Q4, Q5)", () => {
  const pw = "tolerant-reader-pw-1";
  const inner = (ks: Hex[]) => ({ privateKeys: ks.map(entry), seedPhrases: [] as unknown[] });
  const open = (sealed: ReturnType<typeof seal>, password = pw) => decryptSecrets(sealed, password, LEGACY_ITERATIONS);

  it("Q1: a single-encoded object", async () => {
    const r = await open(seal(JSON.stringify(inner([ANVIL_KEY])), pw));
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
      const r = await open(seal(plain, pw));
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
      const e = await thrown(open(seal(JSON.stringify(arr), pw)));
      expect(e.message).toBe("key number " + (arr === written ? 2 : 1) + " appears twice in the decrypted backup");
      expect(e.message + JSON.stringify(e.details ?? {})).not.toContain(ANVIL_KEY.slice(2));
    }
  });

  it("the entry array: only privateKey is a key and seedPhrase is skipped; any other or missing type is rejected without quoting it", async () => {
    for (const type of ["mnemonic", "PRIVATEKEY", undefined, 7]) {
      const e = await thrown(open(seal(JSON.stringify([{ type, index: 0, secret: ANVIL_KEY }]), pw)));
      expect(e.message).toBe("entry 0 of the decrypted backup is not a private key or a seed phrase");
    }
    const ok = await open(seal(JSON.stringify([{ type: "seedPhrase", index: 0, secret: "twelve words" }, { type: "privateKey", index: 1, secret: ANVIL_KEY }]), pw));
    expect(ok.keys.map((k) => k.index)).toEqual([1]);
    expect(ok.seedPhraseEntries).toBe(1);
  });

  it("Q1: anything else is an unsupported payload, quoted nowhere", async () => {
    for (const plain of [JSON.stringify("hello secret text"), JSON.stringify({ other: 1 }), "not json at all", JSON.stringify([1, 2])]) {
      const e = await thrown(open(seal(plain, pw)));
      expect(e.message).toBe("the decrypted backup has an unsupported payload (expected the app's key list)");
    }
  });

  it("an invalid key is reported by position only", async () => {
    const e = await thrown(open(seal(JSON.stringify(JSON.stringify({ privateKeys: [{ address: ANVIL_ADDRESS, privateKey: "0x1234" }], seedPhrases: [] })), pw)));
    expect(e.message).toBe("key number 0 in the backup is not a valid private key");
  });

  it("a stored address that is not the key's address is flagged and never trusted (Q9)", async () => {
    const forged = { privateKeys: [{ address: "0x1111111111111111111111111111111111111111", privateKey: ANVIL_KEY }], seedPhrases: [] };
    const r = await open(seal(JSON.stringify(JSON.stringify(forged)), pw));
    expect(r.keys[0].address).toBe(ANVIL_ADDRESS);
    expect(r.keys[0].claimedAddress).toBe("different");
  });

  it("Q4: a 12-byte IV", async () => {
    const r = await open(seal(JSON.stringify(JSON.stringify(inner([ANVIL_KEY]))), pw, { ivBytes: 12 }));
    expect(r.keys).toHaveLength(1);
  });

  it("Q5: a password typed in another Unicode form (phone keyboards): NFC and NFKC are tried, at the one stated count", async () => {
    const composed = "Pässwörd-ünïcode-12"; // NFC
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    const sealed = seal(JSON.stringify(JSON.stringify(inner([ANVIL_KEY]))), composed);
    const r = await open(sealed, decomposed);
    expect(r.passwordForm).toBe("nfc");
    const wide = "ＰａｓｓＷｏｒｄ１２３４５６"; // full-width, NFKC folds to ASCII
    const r2 = await open(seal(JSON.stringify(JSON.stringify(inner([ANVIL_KEY]))), wide.normalize("NFKC")), wide);
    expect(r2.passwordForm).toBe("nfkc");
    const at600k = seal(JSON.stringify(JSON.stringify(inner([ANVIL_KEY]))), composed, { iterations: 600_000 });
    expect((await decryptSecrets(at600k, decomposed, 600_000)).passwordForm).toBe("nfc");
  });

  it("the encryption type text is the one the app writes", () => {
    expect(ENCRYPTION_TYPE).toBe(kat.backupFile.secrets.encryptionType);
  });
});
