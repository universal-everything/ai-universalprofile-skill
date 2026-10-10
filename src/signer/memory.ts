// Ephemeral in-memory backend — TESTS ONLY. Enabled only when the
// UP_TEST_EPHEMERAL_KEY environment variable is set; never chosen by "auto".
//  - UP_TEST_EPHEMERAL_KEY=1 (or any non-key value): create() generates fresh
//    keys that live in this process only.
//  - UP_TEST_EPHEMERAL_KEY=0x<64 hex>: a fixed test key (e.g. a funded local
//    devnet account). The first create() returns its address and load() of
//    that address works in every process, so separate CLI invocations in chain
//    tests share the same controller.
import { UpError } from "../core/errors.ts";
import type { BackendProbe, Hex, ProtectionInfo } from "../core/types.ts";
import { KeyBackend, probeResult } from "./base.ts";
import { addressOf, generateKey, isValidPrivateKey, normalizePrivateKey, storageId } from "./local-signer.ts";

const store = new Map<string, Hex>();
let fixedKeyUsed = false;

function fixedKey(): Hex | undefined {
  const v = process.env.UP_TEST_EPHEMERAL_KEY?.trim();
  if (!v) return undefined;
  const k = normalizePrivateKey(v);
  return isValidPrivateKey(k) ? k : undefined;
}

export function memoryEnabled(): boolean {
  return Boolean(process.env.UP_TEST_EPHEMERAL_KEY?.trim());
}

/** Tests only: forget all in-memory keys. */
export function resetMemoryBackend(): void {
  store.clear();
  fixedKeyUsed = false;
}

export class MemoryBackend extends KeyBackend {
  readonly id = "memory";
  readonly label = "in-memory test key (ephemeral)";

  protectionInfo(): ProtectionInfo {
    return {
      backend: this.id,
      level: "ephemeral",
      unattended: true,
      encryptedAtRest: false,
      notes: ["test mode: the key exists only in this process's memory (or is the fixed UP_TEST_EPHEMERAL_KEY test key)"],
    };
  }

  async probe(): Promise<BackendProbe> {
    return memoryEnabled()
      ? probeResult(this, "ephemeral", true, "test mode (UP_TEST_EPHEMERAL_KEY is set)")
      : probeResult(this, "ephemeral", false, "tests only: set UP_TEST_EPHEMERAL_KEY to enable");
  }

  override async create() {
    this.assertEnabled();
    const k = fixedKey();
    if (k && !fixedKeyUsed && !store.has(storageId(addressOf(k)))) {
      fixedKeyUsed = true;
      return this.importKey(k);
    }
    return this.importKey(generateKey());
  }

  protected async storeSecret(id: string, privateKey: Hex): Promise<void> {
    this.assertEnabled();
    if (store.has(id)) throw new UpError("INTERNAL", `an in-memory key for ${id} already exists`);
    store.set(id, privateKey);
  }

  protected async readSecret(id: string): Promise<string> {
    this.assertEnabled();
    const v = store.get(id);
    if (v) return v;
    const k = fixedKey();
    if (k && storageId(addressOf(k)) === id) return k;
    throw new UpError("NO_SIGNER", `no in-memory key for ${id} (ephemeral keys do not survive the process)`, { hint: "run: up init --backend memory" });
  }

  protected async deleteSecret(id: string): Promise<void> {
    store.delete(id);
  }

  protected async hasSecret(id: string): Promise<boolean> {
    if (!memoryEnabled()) return false;
    if (store.has(id)) return true;
    const k = fixedKey();
    return Boolean(k && storageId(addressOf(k)) === id);
  }

  private assertEnabled(): void {
    if (!memoryEnabled()) throw new UpError("SIGNER_BACKEND_UNAVAILABLE", "the memory backend is for tests only (UP_TEST_EPHEMERAL_KEY is not set)", { hint: "run: up key backend" });
  }
}
