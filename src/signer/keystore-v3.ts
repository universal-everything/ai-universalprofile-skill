// Ethereum keystore v3 ("Web3 Secret Storage") — used only by
// `up key backup --encrypted`. Encryption: scrypt KDF + AES-128-CTR,
// MAC = keccak256(derivedKey[16..32] ‖ ciphertext). Decryption additionally
// accepts pbkdf2 (hmac-sha256) keystores for interoperability/verification.
// node:crypto only (scrypt, pbkdf2, aes-128-ctr); keccak256 from viem.
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { bytesToHex, hexToBytes, keccak256 } from "viem";
import { UpError } from "../core/errors.ts";
import type { Hex } from "../core/types.ts";
import { addressOf, assertValidPrivateKey, normalizePrivateKey } from "./local-signer.ts";

const scryptAsync = promisify(scrypt) as (pw: Buffer, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const pbkdf2Async = promisify(pbkdf2);

export interface ScryptParams {
  dklen: number;
  n: number;
  r: number;
  p: number;
  salt: string;
}
export interface Pbkdf2Params {
  dklen: number;
  c: number;
  prf: "hmac-sha256";
  salt: string;
}

export interface KeystoreV3 {
  version: 3;
  id: string;
  address?: string;
  crypto: {
    cipher: "aes-128-ctr";
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: "scrypt" | "pbkdf2";
    kdfparams: ScryptParams | Pbkdf2Params;
    mac: string;
  };
}

/** geth "standard" scrypt parameters (N = 2^18, r = 8, p = 1, ≈256 MiB, ~1 s). */
export const STANDARD_SCRYPT = { n: 262144, r: 8, p: 1 } as const;

export interface EncryptOptions {
  n?: number;
  r?: number;
  p?: number;
  /** Fixed salt/iv/uuid — tests only. */
  salt?: Uint8Array;
  iv?: Uint8Array;
  uuid?: string;
}

function passwordBytes(passphrase: string): Buffer {
  if (typeof passphrase !== "string" || passphrase.length === 0) throw new UpError("BAD_ARGS", "an empty passphrase is not allowed");
  return Buffer.from(passphrase, "utf8");
}

async function deriveScrypt(pw: Buffer, p: ScryptParams): Promise<Buffer> {
  const { n, r, p: par, dklen } = p;
  if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) throw new UpError("BAD_ARGS", "keystore scrypt n must be a power of two");
  if (!Number.isInteger(r) || r < 1 || !Number.isInteger(par) || par < 1 || dklen !== 32) throw new UpError("BAD_ARGS", "unsupported keystore scrypt parameters");
  // Bounds against CPU/memory exhaustion from a hostile keystore (geth "standard" is n=2^18, r=8, p=1).
  if (n * r > 2 ** 24 || par > 16 || n * r * par > 2 ** 25) throw new UpError("BAD_ARGS", "keystore scrypt parameters are unreasonably large");
  // OpenSSL (behind node:crypto) enforces scrypt's N < 2^(16·r); e.g. r=1 with N=2^18 cannot be computed here.
  if (16 * r < 53 && n >= 2 ** (16 * r)) throw new UpError("NOT_SUPPORTED", `keystore scrypt parameters n=${n}, r=${r} are not supported by this runtime (needs n < 2^(16·r))`);
  try {
    return await scryptAsync(pw, Buffer.from(p.salt, "hex"), dklen, { N: n, r, p: par, maxmem: 256 * n * r + 64 * 1024 * 1024 });
  } catch (e) {
    throw new UpError("NOT_SUPPORTED", `scrypt failed for keystore parameters n=${n}, r=${r}, p=${par}: ${e instanceof Error ? e.message : "error"}`);
  }
}

function mac(derived: Buffer, ciphertext: Buffer): Hex {
  return keccak256(new Uint8Array(Buffer.concat([derived.subarray(16, 32), ciphertext])));
}

/** Encrypts a private key into a keystore v3 object (scrypt + aes-128-ctr). */
export async function encryptKeystoreV3(privateKey: Hex, passphrase: string, opts: EncryptOptions = {}): Promise<KeystoreV3> {
  const key = normalizePrivateKey(privateKey);
  assertValidPrivateKey(key, "key");
  const salt = Buffer.from(opts.salt ?? randomBytes(32));
  const iv = Buffer.from(opts.iv ?? randomBytes(16));
  if (iv.length !== 16) throw new UpError("BAD_ARGS", "iv must be 16 bytes");
  const kdfparams: ScryptParams = { dklen: 32, n: opts.n ?? STANDARD_SCRYPT.n, r: opts.r ?? STANDARD_SCRYPT.r, p: opts.p ?? STANDARD_SCRYPT.p, salt: salt.toString("hex") };
  const derived = await deriveScrypt(passwordBytes(passphrase), kdfparams);
  const plain = Buffer.from(hexToBytes(key));
  const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  plain.fill(0);
  const out: KeystoreV3 = {
    version: 3,
    id: opts.uuid ?? randomUUID(),
    address: addressOf(key).slice(2).toLowerCase(),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams,
      mac: mac(derived, ciphertext).slice(2),
    },
  };
  derived.fill(0);
  return out;
}

/** Decrypts a keystore v3 (scrypt or pbkdf2/hmac-sha256). Throws BAD_ARGS on a wrong passphrase. */
export async function decryptKeystoreV3(input: KeystoreV3 | string, passphrase: string): Promise<Hex> {
  let ks: any;
  try {
    ks = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new UpError("BAD_ARGS", "not a JSON keystore");
  }
  const c = ks?.crypto ?? ks?.Crypto;
  if (ks?.version !== 3 || !c) throw new UpError("BAD_ARGS", "not a version 3 keystore");
  if (c.cipher !== "aes-128-ctr") throw new UpError("BAD_ARGS", `unsupported keystore cipher ${String(c.cipher).slice(0, 32)}`);
  const pw = passwordBytes(passphrase);
  let derived: Buffer;
  if (c.kdf === "scrypt") derived = await deriveScrypt(pw, c.kdfparams);
  else if (c.kdf === "pbkdf2") {
    const kp = c.kdfparams as Pbkdf2Params;
    if (kp.prf !== "hmac-sha256" || kp.dklen !== 32 || !Number.isInteger(kp.c) || kp.c < 1 || kp.c > 10_000_000) throw new UpError("BAD_ARGS", "unsupported keystore pbkdf2 parameters");
    derived = await pbkdf2Async(pw, Buffer.from(kp.salt, "hex"), kp.c, 32, "sha256");
  } else throw new UpError("BAD_ARGS", `unsupported keystore kdf ${String(c.kdf).slice(0, 32)}`);
  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const expected = Buffer.from(String(c.mac).replace(/^0x/, ""), "hex");
  const actual = Buffer.from(hexToBytes(mac(derived, ciphertext)));
  if (expected.length !== 32 || !timingSafeEqual(expected, actual)) {
    derived.fill(0);
    throw new UpError("BAD_ARGS", "wrong passphrase or corrupted keystore (MAC mismatch)");
  }
  const decipher = createDecipheriv("aes-128-ctr", derived.subarray(0, 16), Buffer.from(c.cipherparams.iv, "hex"));
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  derived.fill(0);
  const key = bytesToHex(new Uint8Array(plain)) as Hex;
  plain.fill(0);
  assertValidPrivateKey(key, "decrypted key");
  if (ks.address && addressOf(key).slice(2).toLowerCase() !== String(ks.address).replace(/^0x/, "").toLowerCase()) {
    throw new UpError("BAD_ARGS", "keystore address does not match the decrypted key");
  }
  return key;
}
