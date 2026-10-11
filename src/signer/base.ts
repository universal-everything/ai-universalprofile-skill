// Common lifecycle for every key-holding backend:
//   create  = generate in-process → store over a pipe/file → read back and
//             verify it derives to the same address (a key that cannot be read
//             back is reported, never handed out as usable, and never deleted)
//   load    = read secret → build an in-memory Signer (address verified)
// Subclasses implement only the raw secret store operations.
import { getAddress } from "viem";
import { UpError } from "../core/errors.ts";
import type { Address, BackendProbe, Hex, ProtectionInfo, Signer, SignerBackend } from "../core/types.ts";
import { addressOf, assertValidPrivateKey, createLocalSigner, generateKey, normalizePrivateKey, storageId } from "./local-signer.ts";
import { registerSecret } from "../core/secret-guard.ts";

export abstract class KeyBackend implements SignerBackend {
  abstract readonly id: string;
  abstract readonly label: string;

  abstract probe(): Promise<BackendProbe>;
  /** Static description of how keys in this backend are protected. */
  abstract protectionInfo(): ProtectionInfo;

  /** Persist `privateKey` for `id` (lowercase address). Must fail if an item already exists. */
  protected abstract storeSecret(id: string, privateKey: Hex): Promise<void>;
  /** Return the raw stored secret (hex, possibly without 0x / with whitespace). Throws SIGNER_LOCKED / NO_SIGNER. */
  protected abstract readSecret(id: string): Promise<string>;
  protected abstract deleteSecret(id: string): Promise<void>;
  protected abstract hasSecret(id: string): Promise<boolean>;

  async create(beforeStore?: (address: Address) => Promise<void>): Promise<Address> {
    return this.storeVerified(generateKey(), beforeStore);
  }

  async importKey(privateKey: Hex, beforeStore?: (address: Address) => Promise<void>): Promise<Address> {
    const k = normalizePrivateKey(privateKey);
    assertValidPrivateKey(k, "imported key");
    return this.storeVerified(k, beforeStore);
  }

  async load(address: Address): Promise<Signer> {
    const key = await this.exportPrivateKey(address);
    return createLocalSigner(key, this.protectionInfo(), getAddress(address));
  }

  async remove(address: Address): Promise<void> {
    await this.deleteSecret(storageId(address));
  }

  async has(address: Address): Promise<boolean> {
    return this.hasSecret(storageId(address));
  }

  /**
   * Internal: returns the private key for `address` after verifying it derives
   * to that address. Only for in-process signing and the encrypted keystore
   * backup; never returned from a verb.
   */
  async exportPrivateKey(address: Address): Promise<Hex> {
    const id = storageId(address);
    const raw = await this.readSecret(id);
    const key = normalizePrivateKey(raw);
    registerSecret(key); // never let it reach any output (core/secret-guard.ts)
    assertValidPrivateKey(key);
    if (addressOf(key).toLowerCase() !== id) {
      throw new UpError("SIGNER_LOCKED", `the key stored for ${getAddress(address)} in ${this.id} belongs to a different address`, {
        hint: "the key store entry was replaced or corrupted; do not sign with it — run: up key backend",
      });
    }
    return key;
  }

  private async storeVerified(key: Hex, beforeStore?: (address: Address) => Promise<void>): Promise<Address> {
    const address = addressOf(key);
    const id = storageId(address);
    // e.g. the recovery inventory record: written before the key exists in the store, so a stored
    // key is always listed somewhere; if it fails, nothing is stored.
    if (beforeStore) await beforeStore(address);
    await this.storeSecret(id, key);
    // Keys are never deleted: once stored, the item stays even if the check below fails. The
    // error carries the (public) address with kept: true so the caller records it in the
    // recovery inventory (keys/inventory.jsonl) and it stays listed.
    let readBack: Hex;
    try {
      readBack = normalizePrivateKey(await this.readSecret(id));
    } catch (e) {
      const inner = e instanceof UpError ? e : undefined;
      throw new UpError(inner?.code ?? "SIGNER_LOCKED", `${this.label}: the new key ${address} was stored but could not be read back (${inner?.message ?? "unknown error"}); it was kept in the store, nothing was deleted`, {
        hint: inner?.hint ?? `run: up key backend; the key stays listed (up key address)`,
        details: { address, backend: this.id, kept: true, problem: "read-back-failed" },
        cause: e instanceof UpError ? e : undefined,
      });
    }
    if (readBack !== key) {
      throw new UpError("SIGNER_LOCKED", `${this.label}: WARNING: the stored key for ${address} did not read back identically; it was kept in the store (nothing deleted) and must not be used until checked`, {
        hint: "run: up key backend; the key stays listed (up key address)",
        details: { address, backend: this.id, kept: true, problem: "read-back-mismatch" },
      });
    }
    return address;
  }
}

/** Shape the registry relies on (KeyBackend and the remote stub both satisfy it). */
export interface InternalBackend extends SignerBackend {
  protectionInfo(): ProtectionInfo;
  exportPrivateKey?(address: Address): Promise<Hex>;
}

export function probeResult(b: { id: string }, level: ProtectionInfo["level"], available: boolean, reason: string, unattended = available): BackendProbe {
  return { id: b.id, available, unattended: available && unattended, level, reason };
}

/**
 * Plain guidance when the agent's configured key is missing from (or unreadable in) its key store.
 * Keys are permanent: this never suggests replacing or deleting a key; the missing key stays listed.
 */
export function missingKeyHint(store: string): string {
  return (
    `the agent's key is missing from ${store}; it is permanent and is never replaced. Restore it from its backup ` +
    `(the encrypted file made with up key backup, or a backup of ${store}). If it is truly gone, a co-owner or admin wallet ` +
    `adds a new additional key for the agent on each network (the agent creates it with up key new-candidate; after it is ` +
    `added: up key activate <address>); the missing key stays listed`
  );
}
