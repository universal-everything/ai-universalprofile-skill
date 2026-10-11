// LSP-30 encrypted secrets, byte-compatible with the Universal Profile mobile app.
//
// The app (src/shared/keychain/controllers/AesEncryptor.ts, a port of MetaMask browser-passworder)
// writes and reads exactly this, and its reader hard-codes the parameters:
//   key        = PBKDF2-HMAC-SHA256(password as UTF-8, salt, 10,000 iterations, 32 bytes)
//   cipher     = AES-256-GCM, 16-byte random IV, 128-bit tag appended to the ciphertext, no AAD
//   salt / iv / secret = standard Base64 with padding (salt 32 bytes)
//   plaintext  = UTF-8 of JSON.stringify(JSON.stringify({"privateKeys":[{"address","privateKey"}],"seedPhrases":[]}))
//                (the object is encoded twice; the key index is the position in privateKeys)
// Writing always uses these values. Reading is more tolerant (quirks Q1 to Q5 in the design):
// the payload as a single-encoded object or as the spec's entry array, 12 to 16 byte IVs, 600,000
// iterations (the spec recommendation), and NFC/NFKC forms of a non-ASCII password.
//
// Errors never contain the password, a key, ciphertext or any decrypted byte.
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from "node:crypto";
import { getAddress } from "viem";
import { UpError } from "../core/errors.ts";
import { registerSecret } from "../core/secret-guard.ts";
import { addressOf, isValidPrivateKey, normalizePrivateKey } from "../signer/local-signer.ts";
import type { Address, Hex } from "../core/types.ts";

export const ENCRYPTION_TYPE = "Key from PBKDF2. Encrypted with AES-GCM.";
export const KDF_DESCRIPTION = "PBKDF2-HMAC-SHA256 (10,000 iterations), AES-256-GCM";
export const APP_ITERATIONS = 10_000;
const SPEC_ITERATIONS = 600_000; // LSP-30 recommendation; the app does not use it, future writers might
const KEY_BYTES = 32;
const SALT_BYTES = 32;
const IV_BYTES = 16;
const TAG_BYTES = 16;

export interface SecretKey {
  address: Address;
  privateKey: Hex;
}

export interface EncryptedData {
  secret: string;
  iv: string;
  salt: string;
}

export interface OpenedKey {
  /** Position in the file's key list (privateKeyIndex / index). */
  index: number;
  /** Always derived from the key itself; a stored address is never trusted. */
  address: Address;
  privateKey: Hex;
  /** The address the file claimed, when it differs from the derived one. */
  claimedAddress?: string;
}

export interface OpenedSecrets {
  keys: OpenedKey[];
  /** Seed phrase entries found and skipped (the skill has no HD keys). */
  seedPhraseEntries: number;
  shape: "app" | "object" | "array";
  iterations: number;
  passwordForm: "as-typed" | "nfc" | "nfkc";
}

const WRONG_PASSWORD = "wrong password or damaged file";

function derive(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => pbkdf2(Buffer.from(password, "utf8"), salt, iterations, KEY_BYTES, "sha256", (e, k) => (e ? reject(e) : resolve(k))));
}

/** The exact plaintext the app encrypts: the key list as a JSON string inside JSON. */
export function payloadText(keys: SecretKey[]): string {
  const inner = JSON.stringify({ privateKeys: keys.map((k) => ({ address: getAddress(k.address), privateKey: k.privateKey.toLowerCase() })), seedPhrases: [] });
  return JSON.stringify(inner);
}

/** Encrypts the key list the way the app does. `fixed` pins salt and IV (known-answer tests only). */
export async function encryptSecrets(keys: SecretKey[], password: string, fixed: { salt?: Buffer; iv?: Buffer } = {}): Promise<EncryptedData> {
  const salt = fixed.salt ?? randomBytes(SALT_BYTES);
  const iv = fixed.iv ?? randomBytes(IV_BYTES);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new UpError("INTERNAL", "salt or IV has the wrong length");
  const key = await derive(password, salt, APP_ITERATIONS);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const ct = Buffer.concat([cipher.update(payloadText(keys), "utf8"), cipher.final()]);
  return { secret: Buffer.concat([ct, cipher.getAuthTag()]).toString("base64"), iv: iv.toString("base64"), salt: salt.toString("base64") };
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decodes a Base64 field and checks the decoded length; the error names the field, never its value. */
export function decodeField(value: unknown, name: string, min: number, max: number): Buffer {
  if (typeof value !== "string" || !B64.test(value) || value.length % 4 !== 0) throw new UpError("BAD_ARGS", `the backup's ${name} is not valid Base64`);
  const b = Buffer.from(value, "base64");
  if (b.length < min || b.length > max) throw new UpError("BAD_ARGS", `the backup's ${name} has an unexpected length`);
  return b;
}

/** Checks one key from a file (never echoed on failure), registers it with the output guard and derives its address. */
export function openKey(rawKey: unknown, index: number, claimed?: unknown): OpenedKey {
  const privateKey = typeof rawKey === "string" ? normalizePrivateKey(rawKey) : undefined;
  if (!privateKey || !isValidPrivateKey(privateKey)) throw new UpError("BAD_ARGS", `key number ${index} in the backup is not a valid private key`);
  registerSecret(privateKey); // never let it reach any output (core/secret-guard.ts)
  const address = addressOf(privateKey);
  const claimedAddress = typeof claimed === "string" && claimed.toLowerCase() !== address.toLowerCase() ? "different" : undefined;
  return { index, address, privateKey, ...(claimedAddress ? { claimedAddress } : {}) };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the decrypted payload in any of the three shapes (Q1); anything else is "unsupported", without quoting it. */
function readPayload(plain: string): Omit<OpenedSecrets, "iterations" | "passwordForm"> {
  const unsupported = () => new UpError("BAD_ARGS", "the decrypted backup has an unsupported payload (expected the app's key list)");
  let v: unknown;
  let shape: OpenedSecrets["shape"] = "object";
  try {
    v = JSON.parse(plain);
    if (typeof v === "string") {
      v = JSON.parse(v);
      shape = "app";
    }
  } catch {
    throw unsupported();
  }
  const keys: OpenedKey[] = [];
  let seedPhraseEntries = 0;
  if (Array.isArray(v)) {
    shape = "array";
    v.forEach((e, position) => {
      if (!isObj(e)) throw unsupported();
      if (e.type === "seedPhrase") {
        seedPhraseEntries++;
        return;
      }
      const index = Number.isInteger(e.index) && (e.index as number) >= 0 ? (e.index as number) : position;
      keys.push(openKey(e.secret ?? e.privateKey, index, e.address));
    });
  } else if (isObj(v) && Array.isArray(v.privateKeys)) {
    v.privateKeys.forEach((e, position) => {
      if (!isObj(e)) throw unsupported();
      keys.push(openKey(e.privateKey, position, e.address));
    });
    if (Array.isArray(v.seedPhrases)) seedPhraseEntries = v.seedPhrases.length;
  } else throw unsupported();
  return { keys, seedPhraseEntries, shape };
}

/** Password spellings to try: as typed, then NFC and NFKC when they differ (phone keyboards, Q5). */
function passwordForms(password: string): { form: OpenedSecrets["passwordForm"]; text: string }[] {
  const forms: { form: OpenedSecrets["passwordForm"]; text: string }[] = [{ form: "as-typed", text: password }];
  if (/[^\x00-\x7f]/.test(password)) {
    for (const [form, norm] of [["nfc", "NFC"], ["nfkc", "NFKC"]] as const) {
      const text = password.normalize(norm);
      if (!forms.some((f) => f.text === text)) forms.push({ form, text });
    }
  }
  return forms;
}

/**
 * Opens the encrypted secrets with the password. Tries the app's 10,000 iterations first, then the
 * spec's 600,000 (Q3). A wrong password and a damaged file are indistinguishable by design (Q6).
 */
export async function decryptSecrets(data: EncryptedData, password: string): Promise<OpenedSecrets> {
  const salt = decodeField(data.salt, "salt", 8, 128);
  const iv = decodeField(data.iv, "iv", 12, 16);
  const sealed = decodeField(data.secret, "secret", TAG_BYTES + 1, 5 * 1024 * 1024);
  const ct = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  for (const iterations of [APP_ITERATIONS, SPEC_ITERATIONS]) {
    for (const { form, text } of passwordForms(password)) {
      const key = await derive(text, salt, iterations);
      let plain: Buffer;
      try {
        const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
        d.setAuthTag(tag);
        plain = Buffer.concat([d.update(ct), d.final()]);
      } catch {
        continue;
      }
      return { ...readPayload(plain.toString("utf8")), iterations, passwordForm: form };
    }
  }
  throw new UpError("BAD_ARGS", WRONG_PASSWORD, { hint: "check the password; if it is right, the file is damaged or was not made by the Universal Profile app or this skill", details: { reason: "wrong-password-or-damaged-file" } });
}
