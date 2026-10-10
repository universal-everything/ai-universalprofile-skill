// W1 — Windows DPAPI (CurrentUser scope) through the built-in Windows
// PowerShell 5.1; L3 — the same bridge from WSL2 via powershell.exe interop
// (runs as the active Windows user).
//
//   powershell.exe -NoLogo -NoProfile -NonInteractive -Command <fixed script>
//
// The fixed script contains NO secret: the key (protect) or the DPAPI blob
// (unprotect) is delivered on stdin and read with [Console]::In.ReadToEnd();
// the result comes back on the stdout pipe. Keeping secrets out of the script
// text matters because PowerShell script-block logging (event 4104, also
// auto-triggered for "suspicious" scripts), transcription and AMSI all record
// or inspect script text — never data read from stdin. The scripts contain no
// double quotes so Node/WSL command-line quoting cannot alter them.
//
// Blob: <UP_HOME>/keys/<address>.dpapi (base64, 0600; on Windows the user
// profile ACLs apply). DPAPI binds it to the Windows user's credentials and
// machine; it is usable after the user logs on (OpenClaw's scheduled task uses
// an interactive token) but not in S4U / key-based SSH network logons.
// LocalMachine scope is never used (any local user could decrypt).
import { readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { UpError } from "../core/errors.ts";
import { ensureDir, paths, upHome, writeFileAtomic } from "../core/home.ts";
import type { BackendProbe, Hex, ProtectionInfo } from "../core/types.ts";
import { KeyBackend, probeResult } from "./base.ts";
import { environment, type SignerEnvironment } from "./env.ts";
import { runProcess, stderrSummary, type RunFn, type RunResult } from "./proc.ts";

export type DpapiMode = "windows" | "wsl";

const PS_PRELUDE = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';";
const PS_ERR = "catch{[Console]::Error.Write('UPERR:'+$_.Exception.GetType().FullName+':'+('{0:X8}' -f $_.Exception.HResult));exit 3}";
const SCOPE = "[Security.Cryptography.DataProtectionScope]::CurrentUser";

/** Reads ASCII text from stdin, DPAPI-protects it, prints UPOK:<base64>. */
export const PS_PROTECT =
  PS_PRELUDE +
  "try{Add-Type -AssemblyName System.Security;" +
  "$s=[Console]::In.ReadToEnd().Trim();$b=[Text.Encoding]::ASCII.GetBytes($s);" +
  `$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,${SCOPE});` +
  "[Array]::Clear($b,0,$b.Length);[Console]::Out.Write('UPOK:'+[Convert]::ToBase64String($p))}" +
  PS_ERR;

/** Reads a base64 DPAPI blob from stdin, unprotects it, prints UPOK:<ascii>. */
export const PS_UNPROTECT =
  PS_PRELUDE +
  "try{Add-Type -AssemblyName System.Security;" +
  "$c=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
  `$b=[Security.Cryptography.ProtectedData]::Unprotect($c,$null,${SCOPE});` +
  "[Console]::Out.Write('UPOK:'+[Text.Encoding]::ASCII.GetString($b));[Array]::Clear($b,0,$b.Length)}" +
  PS_ERR;

/** Probe: protect + unprotect a random canary from stdin in one process; prints UPOK:<canary>. */
export const PS_CANARY =
  PS_PRELUDE +
  "try{Add-Type -AssemblyName System.Security;" +
  "$s=[Console]::In.ReadToEnd().Trim();$b=[Text.Encoding]::ASCII.GetBytes($s);" +
  `$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,${SCOPE});` +
  `$u=[Security.Cryptography.ProtectedData]::Unprotect($p,$null,${SCOPE});` +
  "[Console]::Out.Write('UPOK:'+[Text.Encoding]::ASCII.GetString($u))}" +
  PS_ERR;

export function powershellArgs(script: string): string[] {
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script];
}

/** Extracts the payload after the UPOK: marker (ignores BOMs, CLIXML noise, CRLF). */
export function parsePsOutput(stdout: string): string | null {
  const i = stdout.indexOf("UPOK:");
  if (i < 0) return null;
  return stdout.slice(i + 5).trim();
}

export interface DpapiOptions {
  run?: RunFn;
  platform?: NodeJS.Platform;
  env?: () => Promise<SignerEnvironment>;
  exists?: (p: string) => boolean;
  dir?: () => string;
  timeoutMs?: number;
  /** Override of the powershell executable (tests). */
  powershell?: string;
  readFile?: (p: string) => string | null;
}

/** WSL automount root from /etc/wsl.conf ([automount] root = /x/), default /mnt/. */
export function wslAutomountRoot(wslConf: string | null): string {
  if (!wslConf) return "/mnt/";
  let section = "";
  for (const raw of wslConf.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, "").trim();
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].trim().toLowerCase();
      continue;
    }
    const kv = /^root\s*=\s*(.+)$/i.exec(line);
    if (section === "automount" && kv) {
      const v = kv[1].trim().replace(/^["']|["']$/g, "");
      if (v.startsWith("/")) return v.endsWith("/") ? v : `${v}/`;
    }
  }
  return "/mnt/";
}

export class WindowsDpapiBackend extends KeyBackend {
  readonly id: "windows-dpapi" | "wsl-dpapi";
  readonly label: string;
  private readonly mode: DpapiMode;
  private readonly run: RunFn;
  private readonly platform: NodeJS.Platform;
  private readonly envFn: () => Promise<SignerEnvironment>;
  private readonly exists: (p: string) => boolean;
  private readonly dirFn: () => string;
  private readonly timeoutMs: number;
  private readonly psOverride?: string;
  private readonly readFile: (p: string) => string | null;

  constructor(mode: DpapiMode, opts: DpapiOptions = {}) {
    super();
    this.mode = mode;
    this.id = mode === "windows" ? "windows-dpapi" : "wsl-dpapi";
    this.label = mode === "windows" ? "Windows DPAPI (current user)" : "Windows DPAPI via WSL interop (current Windows user)";
    this.run = opts.run ?? runProcess;
    this.platform = opts.platform ?? process.platform;
    this.envFn = opts.env ?? environment;
    this.exists = opts.exists ?? existsSync;
    this.dirFn = opts.dir ?? (() => paths.keys(upHome()));
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.psOverride = opts.powershell;
    this.readFile =
      opts.readFile ??
      ((p) => {
        try {
          return readFileSync(p, "utf8");
        } catch {
          return null;
        }
      });
  }

  protectionInfo(): ProtectionInfo {
    return {
      backend: this.id,
      level: "os-keychain",
      unattended: true,
      encryptedAtRest: true,
      notes: [
        "encrypted with Windows DPAPI for your Windows user account (bound to your Windows credentials and this machine)",
        "usable after you log on to Windows; not available in key-based SSH / S4U sessions",
        "programs running as your Windows user can decrypt it — keep the controller's on-chain permissions minimal",
        ...(this.mode === "wsl" ? ["reached from WSL through powershell.exe interop (works while your Windows session exists)"] : []),
      ],
    };
  }

  /** Absolute path to Windows PowerShell 5.1 — never resolved through $PATH. Null when not found (WSL). */
  powershellPath(): string | null {
    if (this.psOverride) return this.psOverride;
    if (this.mode === "windows") {
      const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
      return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    }
    const root = wslAutomountRoot(this.readFile("/etc/wsl.conf"));
    const candidates = [`${root}c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`, "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"];
    return candidates.find((p) => this.exists(p)) ?? null;
  }

  private ps(): string {
    const p = this.powershellPath();
    if (!p) throw new UpError("SIGNER_BACKEND_UNAVAILABLE", "Windows PowerShell was not found under the WSL drive mount (C: not mounted or interop disabled?)", { hint: "run: up key backend" });
    return p;
  }

  async probe(): Promise<BackendProbe> {
    const level = "os-keychain" as const;
    if (this.mode === "windows" && this.platform !== "win32") return probeResult(this, level, false, "only available on Windows");
    if (this.mode === "wsl") {
      if (this.platform !== "linux") return probeResult(this, level, false, "only available inside WSL");
      const env = await this.envFn();
      if (!env.wsl) return probeResult(this, level, false, "not running inside WSL");
    }
    const ps = this.powershellPath();
    if (!ps) return probeResult(this, level, false, "Windows PowerShell not found under the WSL drive mount (C: not mounted?)");
    const canary = randomBytes(16).toString("hex");
    const r = await this.run(ps, powershellArgs(PS_CANARY), { input: canary, timeoutMs: this.timeoutMs });
    if (r.error?.code === "ENOENT") return probeResult(this, level, false, this.mode === "wsl" ? "powershell.exe not reachable (WSL Windows interop disabled?)" : "Windows PowerShell not found");
    if (r.error) return probeResult(this, level, false, `PowerShell did not complete: ${r.error.message}`);
    const out = parsePsOutput(r.stdout.toString("utf8"));
    if (r.code !== 0 || out !== canary) {
      return probeResult(this, level, false, `DPAPI canary failed (${psError(r, [canary])}); DPAPI user keys are unavailable in key-based SSH / S4U logons`);
    }
    return probeResult(this, level, true, "DPAPI CurrentUser protect/unprotect works for this Windows logon");
  }

  private file(id: string): string {
    return join(this.dirFn(), `${id}.dpapi`);
  }

  protected async storeSecret(id: string, privateKey: Hex): Promise<void> {
    await this.assertPlatform();
    const f = this.file(id);
    if (existsSync(f)) throw new UpError("INTERNAL", `a DPAPI blob for ${id} already exists; refusing to overwrite it`);
    const r = await this.run(this.ps(), powershellArgs(PS_PROTECT), { input: privateKey, timeoutMs: this.timeoutMs });
    const blob = r.code === 0 && !r.error ? parsePsOutput(r.stdout.toString("utf8")) : null;
    if (!blob || !/^[A-Za-z0-9+/]+=*$/.test(blob)) throw this.mapError(r, "protect", [privateKey]);
    await ensureDir(this.dirFn(), 0o700);
    await writeFileAtomic(f, blob + "\n", 0o600);
  }

  protected async readSecret(id: string): Promise<string> {
    await this.assertPlatform();
    let blob: string;
    try {
      blob = (await readFile(this.file(id), "utf8")).trim();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new UpError("NO_SIGNER", `no DPAPI blob for ${id} in ${this.dirFn()}`, { hint: "the controller key blob is missing; create a new key with: up init --force (then rotate on-chain)" });
      }
      throw new UpError("SIGNER_LOCKED", `cannot read the DPAPI blob for ${id} (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
    const r = await this.run(this.ps(), powershellArgs(PS_UNPROTECT), { input: blob, timeoutMs: this.timeoutMs });
    const out = r.code === 0 && !r.error ? parsePsOutput(r.stdout.toString("utf8")) : null;
    if (!out) throw this.mapError(r, "unprotect");
    return out;
  }

  protected async deleteSecret(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }

  protected async hasSecret(id: string): Promise<boolean> {
    return existsSync(this.file(id));
  }

  private async assertPlatform(): Promise<void> {
    const ok = this.mode === "windows" ? this.platform === "win32" : this.platform === "linux" && (await this.envFn()).wsl;
    if (!ok) throw new UpError("SIGNER_BACKEND_UNAVAILABLE", `the ${this.id} backend is not available on this system`, { hint: "run: up key backend" });
  }

  private mapError(r: RunResult, action: "protect" | "unprotect", secrets: string[] = []): UpError {
    if (r.error?.code === "ENOENT") {
      return new UpError("SIGNER_BACKEND_UNAVAILABLE", this.mode === "wsl" ? "powershell.exe is not reachable from WSL (interop disabled?)" : "Windows PowerShell not found", { hint: "run: up key backend" });
    }
    if (r.error?.code === "TIMEOUT") return new UpError("SIGNER_LOCKED", `PowerShell did not finish the DPAPI ${action} step`, { hint: "run: up key backend" });
    const detail = psError(r, secrets);
    if (action === "protect") return new UpError("SIGNER_BACKEND_UNAVAILABLE", `DPAPI could not protect the key (${detail})`, { hint: "DPAPI needs an interactive Windows logon (not key-based SSH / S4U); run: up key backend" });
    return new UpError("SIGNER_LOCKED", `DPAPI could not unlock the controller key (${detail})`, {
      hint: "DPAPI user keys are only available in an interactive Windows logon of the same user (not key-based SSH / S4U); if the Windows password was reset by an administrator the key is unrecoverable — rotate via your second controller",
    });
  }
}

function psError(r: RunResult, secrets: string[]): string {
  const m = /UPERR:([A-Za-z0-9_.]+:[0-9A-F]{8})/.exec(r.stderr);
  if (m) return m[1].replace(/:([0-9A-F]{8})$/, " (HRESULT 0x$1)");
  return stderrSummary(r, secrets) || r.error?.message || `exit ${r.code}`;
}
