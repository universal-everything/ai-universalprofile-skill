// F1 / L4 — protected key file: <UP_HOME>/keys/<address>.key, hex, mode 0600
// inside a 0700 directory, written atomically (temp + rename), never logged.
//
// Two ids share this storage but carry different protection labels:
//  - vm-protected-file: inside a cloud agent VM (OpenAI dots, Meta Muse).
//    Owner-approved there (2026-10-09); the VM is the isolation boundary.
//    Chosen automatically only when the host is declared with
//    UP_AGENT_HOST=dots|muse|vm, otherwise only via --backend vm-protected-file.
//    A detected container or cloud server alone does NOT qualify.
//  - protected-file: the same file anywhere else. Not encrypted at rest;
//    chosen automatically only on a headless host or container where no OS
//    key store works unattended (init then warns), otherwise only with an
//    explicit `--backend protected-file`.
// On load the file and directory permissions are checked like ssh does
// (refuse group/other access) and the file owner must be the current user.
import { lstat, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UpError } from "../core/errors.ts";
import { ensureDir, paths, upHome, writeFileAtomic } from "../core/home.ts";
import type { BackendProbe, Hex, ProtectionInfo } from "../core/types.ts";
import { KeyBackend, missingKeyHint, probeResult } from "./base.ts";
import { environment, type SignerEnvironment } from "./env.ts";

export type FileVariant = "protected-file" | "vm-protected-file";

/** Shown by init, key backend and doctor whenever the active key is a plain protected file. */
export const PROTECTED_FILE_WARNING =
  "the key is stored in a file readable only by this user and is NOT encrypted at rest; if this machine/container is deleted the key is lost — add a human controller as recovery";

export interface ProtectedFileOptions {
  /** Directory override (default <UP_HOME>/keys, resolved at call time). */
  dir?: () => string;
  env?: () => Promise<SignerEnvironment>;
  platform?: NodeJS.Platform;
}

export class ProtectedFileBackend extends KeyBackend {
  readonly id: FileVariant;
  readonly label: string;
  private readonly dirFn: () => string;
  private readonly envFn: () => Promise<SignerEnvironment>;
  private readonly platform: NodeJS.Platform;

  constructor(variant: FileVariant, opts: ProtectedFileOptions = {}) {
    super();
    this.id = variant;
    this.label = variant === "vm-protected-file" ? "protected key file inside the agent VM" : "protected key file (0600)";
    this.dirFn = opts.dir ?? (() => paths.keys(upHome()));
    this.envFn = opts.env ?? environment;
    this.platform = opts.platform ?? process.platform;
  }

  protectionInfo(): ProtectionInfo {
    if (this.id === "vm-protected-file") {
      return {
        backend: this.id,
        level: "vm-protected-file",
        unattended: true,
        encryptedAtRest: false,
        notes: [
          "private file inside this agent VM (mode 0600 in a 0700 directory); the VM is the isolation boundary",
          "readable by any program running as the same user inside the VM",
        ],
      };
    }
    return {
      backend: this.id,
      level: "protected-file",
      unattended: true,
      encryptedAtRest: false,
      notes: [
        PROTECTED_FILE_WARNING,
        this.platform === "win32" ? "file in your user profile, protected by your Windows account's file permissions" : "mode 0600 in a 0700 directory",
        "anyone who can read this user's files or backups can copy the key",
      ],
    };
  }

  async probe(): Promise<BackendProbe> {
    const level = this.id === "vm-protected-file" ? "vm-protected-file" : "protected-file";
    if (this.id === "vm-protected-file") {
      const env = await this.envFn();
      if (env.agentHost) return probeResult(this, level, true, `0600 key file inside the declared agent VM (${env.agentHost}); the VM is the isolation boundary`);
      return probeResult(this, level, true, "only for cloud agent VMs (OpenAI dots, Meta Muse): declare UP_AGENT_HOST=dots|muse|vm or pass --backend vm-protected-file there; never chosen automatically otherwise");
    }
    return probeResult(this, level, true, `0600 key file — ${PROTECTED_FILE_WARNING}`);
  }

  private file(id: string): string {
    return join(this.dirFn(), `${id}.key`);
  }

  protected async storeSecret(id: string, privateKey: Hex): Promise<void> {
    const dir = this.dirFn();
    await ensureDir(dir, 0o700);
    const f = this.file(id);
    if (existsSync(f)) throw new UpError("INTERNAL", `a key file for ${id} already exists; refusing to overwrite it`);
    await writeFileAtomic(f, `${privateKey}\n`, 0o600);
  }

  protected async readSecret(id: string): Promise<string> {
    const f = this.file(id);
    let st;
    try {
      st = await lstat(f);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new UpError("NO_SIGNER", `no key file for ${id} in ${this.dirFn()}`, { hint: missingKeyHint("its key file") });
      }
      throw new UpError("SIGNER_LOCKED", `cannot access the key file for ${id} (${(e as NodeJS.ErrnoException).code ?? "error"})`, { hint: "check the permissions of the keys directory" });
    }
    if (!st.isFile()) throw new UpError("SIGNER_LOCKED", `the key path for ${id} is not a regular file (symlinks are refused)`, { hint: `remove ${f} and restore the real key file` });
    if (this.platform !== "win32") {
      if ((st.mode & 0o077) !== 0) {
        throw new UpError("SIGNER_LOCKED", `key file permissions are too open (${(st.mode & 0o777).toString(8)}); refusing to use it`, { hint: `run: chmod 600 ${f}` });
      }
      const ds = await stat(this.dirFn());
      if ((ds.mode & 0o077) !== 0) {
        throw new UpError("SIGNER_LOCKED", `keys directory permissions are too open (${(ds.mode & 0o777).toString(8)}); refusing to use it`, { hint: `run: chmod 700 ${this.dirFn()}` });
      }
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
        throw new UpError("SIGNER_LOCKED", "the key file is owned by another user; refusing to use it", { hint: `check the owner of ${f}` });
      }
    }
    const raw = (await readFile(f, "utf8")).trim();
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) throw new UpError("SIGNER_LOCKED", `the key file for ${id} is malformed`, { hint: "the file was modified; do not sign with it — run: up key backend" });
    return raw;
  }

  protected async deleteSecret(id: string): Promise<void> {
    const f = this.file(id);
    try {
      const st = await lstat(f);
      // Best effort overwrite before unlinking (copy-on-write filesystems may still keep old blocks).
      if (st.isFile()) await writeFile(f, "0".repeat(Math.max(68, st.size)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    }
    await rm(f, { force: true });
  }

  protected async hasSecret(id: string): Promise<boolean> {
    return existsSync(this.file(id));
  }
}
