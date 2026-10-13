// LSP-30 encrypted secrets in the Universal Profile mobile app's encryption.
//
// The app (src/shared/keychain/controllers/AesEncryptor.ts, a port of MetaMask browser-passworder)
// writes and reads exactly this, and its reader hard-codes the iteration count to 10,000:
//   key        = PBKDF2-HMAC-SHA256(password as UTF-8, salt, iterations, 32 bytes)
//   cipher     = AES-256-GCM, 16-byte random IV, 128-bit tag appended to the ciphertext, no AAD
//   salt / iv / secret = standard Base64 with padding (salt 32 bytes)
//   plaintext  = UTF-8 of JSON.stringify(JSON.stringify({"privateKeys":[{"address","privateKey"}],"seedPhrases":[]}))
//                (the object is encoded twice; the key index is the position in privateKeys)
// The iteration count is stated in the file as `secrets.iterations` (lsp30-format.ts): this skill writes
// 600,000 (LSP-30's recommendation), or 10,000 with `--legacy` for app versions that do not read the
// field. A file without it (the app's, earlier versions of this skill's) was made with exactly 10,000.
// The count is authoritative: exactly that count is derived, no other one is ever tried, and a count
// outside 1 to 5,000,000 is refused before any derivation (a file must not make the reader spin).
// Reading is otherwise tolerant (quirks Q1, Q2, Q4, Q5 in the design): the payload as a single-encoded
// object or as the spec's entry array, 12 to 16 byte IVs, and NFC/NFKC forms of a non-ASCII password.
//
// Errors never contain the password, a key, ciphertext or any decrypted byte.
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from "node:crypto";
import { getAddress } from "viem";
import { UpError } from "../core/errors.ts";
import { registerSecret } from "../core/secret-guard.ts";
import { addressOf, isValidPrivateKey, normalizePrivateKey } from "../signer/local-signer.ts";
import type { Address, Hex } from "../core/types.ts";

export const ENCRYPTION_TYPE = "Key from PBKDF2. Encrypted with AES-GCM.";
/** What a new encrypted backup is made with (LSP-30's recommendation), stated as `secrets.iterations`. */
export const DEFAULT_ITERATIONS = 600_000;
/** What a file without `secrets.iterations` was made with (the app, earlier versions of this skill), and what `--legacy` writes. */
export const LEGACY_ITERATIONS = 10_000;
/** The highest count a file may state (the app's automatic backup accepts the same maximum), so that a crafted file cannot make the reader spin. */
export const MAX_ITERATIONS = 5_000_000;
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

/** A stated iteration count is usable when it is a whole number from 1 to MAX_ITERATIONS (anything else is refused before any derivation). */
export function isValidIterations(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= MAX_ITERATIONS;
}

/** The rule a stated count breaks, for messages that name the field and never its value. */
export const ITERATIONS_RULE = `a whole number from 1 to ${MAX_ITERATIONS.toLocaleString("en-US")}`;

/** How the keys are locked, in words: "PBKDF2-HMAC-SHA256 (600,000 iterations), AES-256-GCM". */
export function kdfDescription(iterations: number): string {
  return `PBKDF2-HMAC-SHA256 (${iterations.toLocaleString("en-US")} iterations), AES-256-GCM`;
}

function derive(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => pbkdf2(Buffer.from(password, "utf8"), salt, iterations, KEY_BYTES, "sha256", (e, k) => (e ? reject(e) : resolve(k))));
}

/** The exact plaintext the app encrypts: the key list as a JSON string inside JSON. */
export function payloadText(keys: SecretKey[]): string {
  const inner = JSON.stringify({ privateKeys: keys.map((k) => ({ address: getAddress(k.address), privateKey: k.privateKey.toLowerCase() })), seedPhrases: [] });
  return JSON.stringify(inner);
}

/**
 * Encrypts the key list the way the app does, with `iterations` (the caller states the same count in the file as
 * `secrets.iterations`). `fixed` pins salt and IV (known-answer tests only).
 */
export async function encryptSecrets(keys: SecretKey[], password: string, iterations: number, fixed: { salt?: Buffer; iv?: Buffer } = {}): Promise<EncryptedData> {
  if (!isValidIterations(iterations)) throw new UpError("INTERNAL", `the iteration count for a backup must be ${ITERATIONS_RULE}`);
  const salt = fixed.salt ?? randomBytes(SALT_BYTES);
  const iv = fixed.iv ?? randomBytes(IV_BYTES);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new UpError("INTERNAL", "salt or IV has the wrong length");
  const key = await derive(password, salt, iterations);
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
      if (e.type !== "privateKey") throw new UpError("BAD_ARGS", `entry ${position} of the decrypted backup is not a private key or a seed phrase`);
      const index = Number.isInteger(e.index) && (e.index as number) >= 0 ? (e.index as number) : position;
      if (keys.some((k) => k.index === index)) throw new UpError("BAD_ARGS", `key number ${index} appears twice in the decrypted backup`);
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
 * Opens the encrypted secrets with the password, deriving the key with exactly `iterations`: the count the file
 * states, or 10,000 when it states none (lsp30-format.ts decides that). No other count is tried: a wrong count,
 * a wrong password and a damaged file are indistinguishable by design (Q6). An invalid count is refused before
 * any derivation.
 */
export async function decryptSecrets(data: EncryptedData, password: string, iterations: number): Promise<OpenedSecrets> {
  if (!isValidIterations(iterations)) throw new UpError("BAD_ARGS", `the backup's iterations is not ${ITERATIONS_RULE}`, { hint: "check the file with: up backup inspect <file>" });
  const salt = decodeField(data.salt, "salt", 8, 128);
  const iv = decodeField(data.iv, "iv", 12, 16);
  const sealed = decodeField(data.secret, "secret", TAG_BYTES + 1, 5 * 1024 * 1024);
  const ct = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
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
  throw new UpError("BAD_ARGS", WRONG_PASSWORD, { hint: "check the password; if it is right, the file is damaged or was not made by the Universal Profile app or this skill", details: { reason: "wrong-password-or-damaged-file", iterations } });
}
