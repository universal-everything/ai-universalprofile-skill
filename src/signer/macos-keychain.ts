// M1 — macOS login keychain through Apple-signed /usr/bin/security.
//
// Store: spawn `/usr/bin/security -i` and write ONE command line to its stdin:
//   add-generic-password -s <service> -a <address> -l "Universal Profile controller key" -w <hex>
// No -A (allow all apps), no -T (would replace the default trusted app list),
// no keychain path (default = login keychain), no -U (never overwrite).
// Read:  /usr/bin/security find-generic-password -s <service> -a <address> -w
//        (secret arrives on the stdout pipe)
// Because both create and read go through the same Apple-signed binary, the
// item's ACL/partition list ("apple-tool:") always matches — Node/OpenClaw
// upgrades never invalidate access and no dialog appears while the keychain
// is unlocked. When it is locked in a non-GUI context, `security` fails with
// -25308 (errSecInteractionNotAllowed) and we fail closed.
//
// `security` exits with the low byte of the OSStatus: -25300 → 44 (not found),
// -25299 → 45 (duplicate), -25308 → 36 (interaction not allowed),
// -25293 → 51 (auth failed), -128 → 128 (user cancelled).
import { existsSync } from "node:fs";
import { UpError } from "../core/errors.ts";
import type { BackendProbe, Hex, ProtectionInfo } from "../core/types.ts";
import { KeyBackend, probeResult } from "./base.ts";
import { keystoreService, runProcess, stderrSummary, type RunFn, type RunResult } from "./proc.ts";

export const SECURITY_BIN = "/usr/bin/security";
export const KEYCHAIN_LABEL = "Universal Profile controller key";

const EXIT_NOT_FOUND = 44;
const EXIT_DUPLICATE = 45;
const EXIT_INTERACTION_NOT_ALLOWED = 36;
const EXIT_AUTH_FAILED = 51;
const EXIT_USER_CANCELLED = 128;
const EXIT_NO_DEFAULT_KEYCHAIN = [37, 50, 53];

export interface MacosKeychainOptions {
  run?: RunFn;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  timeoutMs?: number;
}

const LOCKED_HINT =
  "the macOS login keychain is locked or not reachable from this session: log in at the Mac once (GUI) so the keychain unlocks — the skill never asks for or stores your password";

export class MacosKeychainBackend extends KeyBackend {
  readonly id = "macos-keychain";
  readonly label = "macOS login keychain";
  private readonly run: RunFn;
  private readonly platform: NodeJS.Platform;
  private readonly exists: (p: string) => boolean;
  private readonly timeoutMs: number;

  constructor(opts: MacosKeychainOptions = {}) {
    super();
    this.run = opts.run ?? runProcess;
    this.platform = opts.platform ?? process.platform;
    this.exists = opts.exists ?? existsSync;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  protectionInfo(): ProtectionInfo {
    return {
      backend: this.id,
      level: "os-keychain",
      unattended: true,
      encryptedAtRest: true,
      notes: [
        "stored in the macOS login keychain via Apple's /usr/bin/security (no allow-all ACL)",
        "usable whenever you are logged in at the Mac (the same moment OpenClaw starts); fails closed while the keychain is locked",
        "any program running as your macOS user can read it while the keychain is unlocked — keep the controller's on-chain permissions minimal",
      ],
    };
  }

  async probe(): Promise<BackendProbe> {
    if (this.platform !== "darwin") return probeResult(this, "os-keychain", false, "only available on macOS");
    if (!this.exists(SECURITY_BIN)) return probeResult(this, "os-keychain", false, `${SECURITY_BIN} not found`);
    // `default-keychain` never prompts; it fails when the session has no user keychain (e.g. LaunchDaemon context).
    const r = await this.run(SECURITY_BIN, ["default-keychain"], { timeoutMs: 10_000 });
    if (r.error) return probeResult(this, "os-keychain", false, `cannot run ${SECURITY_BIN}: ${r.error.message}`);
    if (r.code !== 0 || !/\.keychain/.test(r.stdout.toString("utf8"))) {
      return probeResult(this, "os-keychain", false, `no default (login) keychain in this session (${stderrSummary(r) || `exit ${r.code}`}); run inside your user's login session, not as a system daemon`);
    }
    return probeResult(this, "os-keychain", true, "login keychain reachable via /usr/bin/security (default ACL, secret over stdin)");
  }

  protected async storeSecret(id: string, privateKey: Hex): Promise<void> {
    this.assertPlatform();
    const service = keystoreService();
    const hex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new UpError("INTERNAL", "refusing to store a malformed key");
    // All tokens are [0-9a-zA-Z._-] or the fixed label → no quoting/injection issues in security's line parser.
    const line = `add-generic-password -s ${service} -a ${id} -l "${KEYCHAIN_LABEL}" -w ${hex}\n`;
    const r = await this.run(SECURITY_BIN, ["-i"], { input: line, timeoutMs: this.timeoutMs });
    if (!r.error && r.code === 0) return;
    if (r.code === EXIT_DUPLICATE) throw new UpError("INTERNAL", `a keychain item for ${id} already exists (service ${service}); refusing to overwrite it`);
    throw this.mapError(r, "store the key in", [hex]);
  }

  protected async readSecret(id: string): Promise<string> {
    this.assertPlatform();
    const r = await this.run(SECURITY_BIN, ["find-generic-password", "-s", keystoreService(), "-a", id, "-w"], { timeoutMs: this.timeoutMs });
    if (!r.error && r.code === 0) return r.stdout.toString("utf8").trim();
    if (r.code === EXIT_NOT_FOUND) throw notFound(id, keystoreService());
    throw this.mapError(r, "read the key from");
  }

  protected async deleteSecret(id: string): Promise<void> {
    this.assertPlatform();
    const r = await this.run(SECURITY_BIN, ["delete-generic-password", "-s", keystoreService(), "-a", id], { timeoutMs: this.timeoutMs });
    if (!r.error && (r.code === 0 || r.code === EXIT_NOT_FOUND)) return;
    throw this.mapError(r, "delete the key from");
  }

  protected async hasSecret(id: string): Promise<boolean> {
    this.assertPlatform();
    // Without -w/-g only public attributes are printed.
    const r = await this.run(SECURITY_BIN, ["find-generic-password", "-s", keystoreService(), "-a", id], { timeoutMs: this.timeoutMs });
    if (!r.error && r.code === 0) return true;
    if (r.code === EXIT_NOT_FOUND) return false;
    throw this.mapError(r, "look up the key in");
  }

  private assertPlatform(): void {
    if (this.platform !== "darwin") throw new UpError("SIGNER_BACKEND_UNAVAILABLE", "the macos-keychain backend only works on macOS", { hint: "run: up key backend" });
  }

  private mapError(r: RunResult, action: string, secrets: string[] = []): UpError {
    const detail = stderrSummary(r, secrets);
    if (r.error?.code === "ENOENT") return new UpError("SIGNER_BACKEND_UNAVAILABLE", `${SECURITY_BIN} not found`, { hint: "run: up key backend" });
    if (r.error?.code === "TIMEOUT") {
      return new UpError("SIGNER_LOCKED", `macOS keychain did not answer when trying to ${action} it (a system dialog may be waiting)`, { hint: LOCKED_HINT });
    }
    if (r.code === EXIT_INTERACTION_NOT_ALLOWED || /-25308|interaction is not allowed/i.test(r.stderr)) {
      return new UpError("SIGNER_LOCKED", `macOS keychain is locked (errSecInteractionNotAllowed, -25308); could not ${action} it`, { hint: LOCKED_HINT });
    }
    if (r.code === EXIT_AUTH_FAILED || r.code === EXIT_USER_CANCELLED || /-25293|-128\b|cancel/i.test(r.stderr)) {
      return new UpError("SIGNER_LOCKED", `macOS keychain refused access (${detail || `exit ${r.code}`}); could not ${action} it`, {
        hint: "access to the keychain item was denied; do not change keychain ACLs — run: up key backend",
      });
    }
    if (r.code !== null && EXIT_NO_DEFAULT_KEYCHAIN.includes(r.code)) {
      return new UpError("SIGNER_BACKEND_UNAVAILABLE", `no usable login keychain in this session (${detail || `exit ${r.code}`})`, {
        hint: "run the agent inside your logged-in macOS user session (LaunchAgent), not as a system daemon",
      });
    }
    return new UpError("SIGNER_LOCKED", `could not ${action} the macOS keychain (${detail || r.error?.message || `exit ${r.code}`})`, { hint: "run: up key backend" });
  }
}

function notFound(id: string, service: string): UpError {
  return new UpError("NO_SIGNER", `no keychain item for ${id} (service "${service}")`, {
    hint: "the controller key is missing from the login keychain; if it was deleted, create a new one with: up init --force (then rotate on-chain)",
  });
}
