// In-process signer built from a private key that is held only inside
// closures (never as an enumerable property), so JSON.stringify / util.inspect
// of a Signer or of its viem account never reveals it.
//
// signIntendedValidator implements EIP-191 version 0x00 ("data with intended
// validator"), used by LSP25 executeRelayCall:
//   digest = keccak256(0x19 ‖ 0x00 ‖ validator(20 bytes) ‖ data)
//   signature = secp256k1 sign(digest) as 65 bytes r ‖ s ‖ v (v = 27/28)
import { concat, getAddress, isAddress, isHex, keccak256 } from "viem";
import type { LocalAccount, TransactionSerializable, TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { UpError } from "../core/errors.ts";
import type { Address, Hex, ProtectionInfo, Signer } from "../core/types.ts";

/** secp256k1 group order n. A private key must satisfy 0 < k < n. */
export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export function isValidPrivateKey(key: unknown): key is Hex {
  if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) return false;
  const k = BigInt(key);
  return k > 0n && k < SECP256K1_N;
}

/** Throws a key-free error when `key` is not a valid secp256k1 scalar. */
export function assertValidPrivateKey(key: unknown, what = "stored key"): asserts key is Hex {
  if (!isValidPrivateKey(key)) throw new UpError("SIGNER_LOCKED", `${what} is not a valid secp256k1 private key`, { hint: "the key store returned malformed data; run: up key backend" });
}

/** Normalises user/storage input ("0x…" or bare hex, any case, surrounding whitespace) to 0x-lowercase hex. */
export function normalizePrivateKey(raw: string): Hex {
  const t = raw.trim().toLowerCase();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

/** Generates a fresh key with viem's CSPRNG-backed generator and validates the scalar. */
export function generateKey(): Hex {
  for (let i = 0; i < 8; i++) {
    const k = generatePrivateKey();
    if (isValidPrivateKey(k)) return k.toLowerCase() as Hex;
  }
  throw new UpError("INTERNAL", "could not generate a valid secp256k1 key"); // practically unreachable (p ≈ 2^-128)
}

/** Public address of a private key (checksummed). */
export function addressOf(privateKey: Hex): Address {
  assertValidPrivateKey(privateKey, "key");
  return privateKeyToAccount(privateKey).address;
}

/** Canonical storage form of an address (lowercase) used for key-store item names. */
export function storageId(address: string): string {
  if (!isAddress(address, { strict: false })) throw new UpError("BAD_ARGS", `not an address: ${String(address).slice(0, 64)}`);
  return address.toLowerCase();
}

/** EIP-191 version 0x00 digest: keccak256(0x19 ‖ 0x00 ‖ validator ‖ data). */
export function intendedValidatorDigest(validator: Address, data: Hex): Hex {
  if (!isAddress(validator, { strict: false })) throw new UpError("BAD_ARGS", "validator must be a 20-byte address");
  if (!isHex(data)) throw new UpError("BAD_ARGS", "data must be 0x-prefixed hex");
  return keccak256(concat(["0x19", "0x00", validator.toLowerCase() as Hex, data]));
}

/**
 * Builds a Signer around `privateKey`. When `expectedAddress` is given the key
 * must derive to it, otherwise the store returned the wrong item (fail closed).
 */
export function createLocalSigner(privateKey: Hex, protection: ProtectionInfo, expectedAddress?: Address): Signer {
  assertValidPrivateKey(privateKey);
  const account = privateKeyToAccount(privateKey);
  if (expectedAddress && account.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new UpError("SIGNER_LOCKED", `the key stored for ${getAddress(expectedAddress)} in ${protection.backend} belongs to a different address`, {
      hint: "the key store entry was replaced or corrupted; do not sign with it — run: up key backend",
    });
  }
  const address = account.address;
  const protectionCopy: ProtectionInfo = Object.freeze({ ...protection, notes: [...protection.notes] }) as ProtectionInfo;

  // Never expose signAuthorization (EIP-7702 delegation of the controller EOA) — no verb needs it.
  const view: LocalAccount = {
    address,
    publicKey: account.publicKey,
    source: "up-signer",
    type: "local",
    sign: ({ hash }) => account.sign({ hash }),
    signMessage: ({ message }) => account.signMessage({ message }),
    signTransaction: (tx, opts) => account.signTransaction(tx as any, opts as any),
    signTypedData: (td) => account.signTypedData(td as any),
  };

  const signer: Signer = {
    address,
    protection: protectionCopy,
    signMessage(message: { raw: Hex } | string) {
      return account.signMessage({ message });
    },
    signIntendedValidator(validator: Address, data: Hex) {
      return account.sign({ hash: intendedValidatorDigest(validator, data) });
    },
    signTypedData(td: TypedDataDefinition) {
      return account.signTypedData(td as any);
    },
    signTransaction(tx: TransactionSerializable) {
      return account.signTransaction(tx);
    },
    toAccount() {
      return view;
    },
  };
  return Object.freeze(signer);
}
