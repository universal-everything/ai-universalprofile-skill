// R1 — remote policy signer (optional advanced mode, not implemented in v1).
// The key would live in a signer service the user controls (e.g. the "home
// signer bridge" on their own machine) that enforces chain/target/value policy;
// the agent authenticates with a bearer token injected by the host at egress.
// The interface is kept so the registry, `up key backend` and config validation
// know the id; every key operation fails with NOT_SUPPORTED.
import { UpError } from "../core/errors.ts";
import type { Address, BackendProbe, Hex, ProtectionInfo, Signer, SignerBackend } from "../core/types.ts";

const MESSAGE = "the remote-signer backend (key kept in a signer service you control) is not available in this version";
const HINT = "use the default local backend (run: up init); a remote signer bridge is planned as an optional advanced mode";

export class RemoteSignerBackend implements SignerBackend {
  readonly id = "remote-signer";
  readonly label = "remote policy signer (not available yet)";

  protectionInfo(): ProtectionInfo {
    return {
      backend: this.id,
      level: "remote-signer",
      unattended: true,
      encryptedAtRest: true,
      notes: ["the key would stay in a signer service you control, which enforces its own policy"],
    };
  }

  async probe(): Promise<BackendProbe> {
    return { id: this.id, available: false, unattended: false, level: "remote-signer", reason: "not implemented in this version (optional advanced mode)" };
  }

  private fail(): never {
    throw new UpError("NOT_SUPPORTED", MESSAGE, { hint: HINT });
  }

  async create(): Promise<Address> {
    this.fail();
  }
  async importKey(_privateKey: Hex): Promise<Address> {
    this.fail();
  }
  async load(_address: Address): Promise<Signer> {
    this.fail();
  }
  async remove(_address: Address): Promise<void> {
    this.fail();
  }
  async has(_address: Address): Promise<boolean> {
    this.fail();
  }
}
