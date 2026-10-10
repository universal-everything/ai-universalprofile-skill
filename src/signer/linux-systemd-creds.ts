// L1 — `systemd-creds --user` (systemd >= 256).
//   encrypt: hex key on stdin → `systemd-creds encrypt --user --with-key=auto --name=up-signer-<addr> - -`
//            → ciphertext on stdout → written atomically to <UP_HOME>/keys/<addr>.cred (0600)
//   decrypt: ciphertext on stdin → `systemd-creds decrypt --user --name=up-signer-<addr> - -` → hex on stdout
// The credential is AES-256-GCM under the root-only host key and/or TPM2 and
// bound to this UID + machine; the unprivileged process goes through the
// systemd-creds.socket Varlink service. Works unattended after reboot,
// including lingering user services with no login session.
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { UpError } from "../core/errors.ts";
import { ensureDir, paths, upHome, writeFileAtomic } from "../core/home.ts";
import type { BackendProbe, Hex, ProtectionInfo } from "../core/types.ts";
import { KeyBackend, missingKeyHint, probeResult } from "./base.ts";
import { parseSystemdVersion } from "./env.ts";
import { resolveSystemBinary, runProcess, stderrSummary, type RunFn, type RunResult, type WhichFn } from "./proc.ts";

export const SYSTEMD_CREDS_BIN = "systemd-creds";
export const MIN_SYSTEMD_VERSION = 256;

export interface SystemdCredsOptions {
  run?: RunFn;
  platform?: NodeJS.Platform;
  dir?: () => string;
  timeoutMs?: number;
  /** Binary resolver (default: system directories only, never $PATH). */
  which?: WhichFn;
}

export function credentialName(id: string): string {
  return `up-signer-${id}`;
}

export class LinuxSystemdCredsBackend extends KeyBackend {
  readonly id = "linux-systemd-creds";
  readonly label = "systemd-creds (user-scoped, host key/TPM2)";
  private readonly run: RunFn;
  private readonly platform: NodeJS.Platform;
  private readonly dirFn: () => string;
  private readonly timeoutMs: number;
  private readonly which: WhichFn;

  constructor(opts: SystemdCredsOptions = {}) {
    super();
    this.which = opts.which ?? ((n) => resolveSystemBinary(n));
    this.run = opts.run ?? runProcess;
    this.platform = opts.platform ?? process.platform;
    this.dirFn = opts.dir ?? (() => paths.keys(upHome()));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  protectionInfo(): ProtectionInfo {
    return {
      backend: this.id,
      level: "os-keychain",
      unattended: true,
      encryptedAtRest: true,
      notes: [
        "encrypted by systemd-creds (AES-256-GCM with the host key and/or TPM2), bound to this user and machine",
        "works unattended after reboot, including lingering services; a copy of the file is useless on another machine",
        "programs running as your user can still ask systemd to decrypt it — keep the controller's on-chain permissions minimal",
      ],
    };
  }

  async probe(): Promise<BackendProbe> {
    const level = "os-keychain" as const;
    if (this.platform !== "linux") return probeResult(this, level, false, "only available on Linux");
    const bin = this.which(SYSTEMD_CREDS_BIN);
    if (!bin) return probeResult(this, level, false, "systemd-creds not installed (needs systemd >= 256, e.g. Debian 13 / Ubuntu 26.04)");
    const v = await this.run(bin, ["--version"], { timeoutMs: 10_000 });
    if (v.error || v.code !== 0) return probeResult(this, level, false, "systemd-creds not installed (needs systemd >= 256, e.g. Debian 13 / Ubuntu 26.04)");
    const version = parseSystemdVersion(v.stdout.toString("utf8"));
    if (version === null) return probeResult(this, level, false, "could not determine the systemd version");
    if (version < MIN_SYSTEMD_VERSION) return probeResult(this, level, false, `systemd ${version} is too old for user-scoped credentials (needs >= ${MIN_SYSTEMD_VERSION})`);
    // Canary round trip: proves the Varlink service (systemd-creds.socket) and key material are usable.
    const canary = randomBytes(16).toString("hex");
    const name = "up-signer-probe";
    const enc = await this.run(bin, ["encrypt", "--user", "--with-key=auto", `--name=${name}`, "-", "-"], { input: canary, timeoutMs: this.timeoutMs });
    if (enc.error || enc.code !== 0 || enc.stdout.length === 0) {
      return probeResult(this, level, false, `systemd ${version}: user-scoped encryption failed (${stderrSummary(enc, [canary]) || enc.error?.message || `exit ${enc.code}`}); is systemd-creds.socket available?`);
    }
    const dec = await this.run(bin, ["decrypt", "--user", `--name=${name}`, "-", "-"], { input: enc.stdout, timeoutMs: this.timeoutMs });
    if (dec.error || dec.code !== 0 || dec.stdout.toString("utf8").trim() !== canary) {
      return probeResult(this, level, false, `systemd ${version}: canary decryption failed (${stderrSummary(dec, [canary]) || dec.error?.message || `exit ${dec.code}`})`);
    }
    return probeResult(this, level, true, `systemd ${version}: user-scoped credential encryption works (canary round trip ok)`);
  }

  private file(id: string): string {
    return join(this.dirFn(), `${id}.cred`);
  }

  protected async storeSecret(id: string, privateKey: Hex): Promise<void> {
    this.assertPlatform();
    const f = this.file(id);
    if (existsSync(f)) throw new UpError("INTERNAL", `a credential file for ${id} already exists; refusing to overwrite it`);
    const r = await this.run(this.bin(), ["encrypt", "--user", "--with-key=auto", `--name=${credentialName(id)}`, "-", "-"], { input: privateKey, timeoutMs: this.timeoutMs });
    if (r.error || r.code !== 0 || r.stdout.length === 0) throw this.mapError(r, "encrypt", [privateKey]);
    await ensureDir(this.dirFn(), 0o700);
    await writeFileAtomic(f, r.stdout, 0o600);
  }

  protected async readSecret(id: string): Promise<string> {
    this.assertPlatform();
    const f = this.file(id);
    let blob: Buffer;
    try {
      blob = await readFile(f);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new UpError("NO_SIGNER", `no systemd credential for ${id} in ${this.dirFn()}`, { hint: missingKeyHint("its systemd credential file") });
      }
      throw new UpError("SIGNER_LOCKED", `cannot read the credential file for ${id} (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
    const r = await this.run(this.bin(), ["decrypt", "--user", `--name=${credentialName(id)}`, "-", "-"], { input: blob, timeoutMs: this.timeoutMs });
    if (r.error || r.code !== 0) throw this.mapError(r, "decrypt");
    return r.stdout.toString("utf8").trim();
  }

  protected async deleteSecret(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }

  protected async hasSecret(id: string): Promise<boolean> {
    return existsSync(this.file(id));
  }

  private assertPlatform(): void {
    if (this.platform !== "linux") throw new UpError("SIGNER_BACKEND_UNAVAILABLE", "the linux-systemd-creds backend only works on Linux", { hint: "run: up key backend" });
  }

  private bin(): string {
    const b = this.which(SYSTEMD_CREDS_BIN);
    if (!b) throw new UpError("SIGNER_BACKEND_UNAVAILABLE", "systemd-creds not found in the system directories", { hint: "run: up key backend" });
    return b;
  }

  private mapError(r: RunResult, action: "encrypt" | "decrypt", secrets: string[] = []): UpError {
    const detail = stderrSummary(r, secrets) || r.error?.message || `exit ${r.code}`;
    if (r.error?.code === "ENOENT") return new UpError("SIGNER_BACKEND_UNAVAILABLE", "systemd-creds not found", { hint: "run: up key backend" });
    if (r.error?.code === "TIMEOUT") return new UpError("SIGNER_LOCKED", `systemd-creds did not answer (${action})`, { hint: "check that systemd-creds.socket is running: systemctl status systemd-creds.socket" });
    if (action === "encrypt") return new UpError("SIGNER_BACKEND_UNAVAILABLE", `systemd-creds could not encrypt the key (${detail})`, { hint: "run: up key backend" });
    return new UpError("SIGNER_LOCKED", `systemd-creds could not decrypt the controller key (${detail})`, {
      hint: "the credential is bound to this user, machine and host key/TPM; if those changed it cannot be read here: restore the key from its backup (up key backup file), or a co-owner or admin wallet adds a new additional key for the agent on each network (the old key stays listed, never deleted)",
    });
  }
}
