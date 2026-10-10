// Child-process helper for signer backends. Secrets only ever travel over the
// child's stdin/stdout pipes — never argv, never the child's environment — and
// every piece of child output that may end up in an error message is scrubbed
// of anything that looks like key material first.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { UpError } from "../core/errors.ts";

export interface RunOptions {
  /** Bytes written to the child's stdin (then stdin is closed). */
  input?: string | Uint8Array;
  /** Hard timeout; the child is killed with SIGKILL when it expires. */
  timeoutMs?: number;
  /** Extra environment variables (never secrets). The parent environment is inherited. */
  env?: Record<string, string>;
}

export interface RunResult {
  /** Exit code; null when the child was killed or could not be started. */
  code: number | null;
  stdout: Buffer;
  stderr: string;
  /** Set when the process could not be spawned (e.g. ENOENT) or timed out. */
  error?: { code: "ENOENT" | "EACCES" | "TIMEOUT" | "SPAWN"; message: string };
}

export type RunFn = (cmd: string, args: readonly string[], opts?: RunOptions) => Promise<RunResult>;

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Variables that may carry secrets in this process and must never reach a child. */
export const SECRET_ENV_VARS = ["UP_TEST_EPHEMERAL_KEY", "UP_BACKUP_PASSPHRASE"] as const;

/** Dynamic-loader hooks that could inject code into a child handling key material. */
const INJECTION_ENV = /^(LD_PRELOAD|LD_AUDIT|LD_LIBRARY_PATH|DYLD_.*)$/;

/** Parent environment minus secret-bearing and loader-injection variables, plus `extra` (never secrets). */
export function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of SECRET_ENV_VARS) delete env[k];
  for (const k of Object.keys(env)) if (INJECTION_ENV.test(k)) delete env[k];
  return env;
}

/** System directories searched for helpers that receive key material (never $PATH). */
export const SYSTEM_BIN_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/run/current-system/sw/bin"] as const;

export type WhichFn = (name: string) => string | null;

/** Absolute path of a system binary from SYSTEM_BIN_DIRS, or null. */
export function resolveSystemBinary(name: string, exists: (p: string) => boolean = existsSync): string | null {
  for (const d of SYSTEM_BIN_DIRS) {
    const p = `${d}/${name}`;
    if (exists(p)) return p;
  }
  return null;
}

/** Spawns `cmd args` without a shell. Never rejects: failures are reported in the result. */
export const runProcess: RunFn = (cmd, args, opts = {}) =>
  new Promise<RunResult>((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, [...args], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        env: childEnv(opts.env),
      });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return resolve({ code: null, stdout: Buffer.alloc(0), stderr: "", error: { code: code === "ENOENT" ? "ENOENT" : code === "EACCES" ? "EACCES" : "SPAWN", message: `cannot start ${cmd}` } });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout!.on("data", (d: Buffer) => out.push(d));
    child.stderr!.on("data", (d: Buffer) => err.push(d));
    child.stdin!.on("error", () => {}); // EPIPE when the child exits before reading stdin
    child.on("error", (e: NodeJS.ErrnoException) => {
      const code = e.code === "ENOENT" ? "ENOENT" : e.code === "EACCES" ? "EACCES" : "SPAWN";
      finish({ code: null, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8"), error: { code, message: `cannot start ${cmd} (${e.code ?? "error"})` } });
    });
    child.on("close", (code) => {
      finish({
        code: timedOut ? null : code,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString("utf8"),
        error: timedOut ? { code: "TIMEOUT", message: `${cmd} did not finish within ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms` } : undefined,
      });
    });
    if (opts.input !== undefined) child.stdin!.end(opts.input);
    else child.stdin!.end();
  });

const HEX_SECRET = /(0x)?[0-9a-fA-F]{64,}/g;
const B64_BLOB = /[A-Za-z0-9+/=]{80,}/g;

/**
 * Removes anything that could be key material from text that is about to be
 * placed in an error, log line or result: any 32+-byte hex run, long base64
 * runs (encrypted blobs), and every explicitly listed secret.
 */
export function scrub(text: string, secrets: readonly string[] = []): string {
  let t = text;
  for (const s of secrets) {
    if (!s) continue;
    const bare = s.startsWith("0x") ? s.slice(2) : s;
    if (bare.length >= 8) t = t.split(bare).join("[redacted]").split(bare.toLowerCase()).join("[redacted]").split(bare.toUpperCase()).join("[redacted]");
  }
  return t.replace(HEX_SECRET, "[redacted]").replace(B64_BLOB, "[redacted]");
}

/** First non-empty line of child stderr, scrubbed and length-limited, for error messages. */
export function stderrSummary(r: RunResult, secrets: readonly string[] = []): string {
  const line = r.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" | ");
  const s = scrub(line, secrets);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}

/** Service / attribute name used by OS key stores. Overridable for test isolation. */
export function keystoreService(): string {
  const s = process.env.UP_KEYCHAIN_SERVICE?.trim();
  if (!s) return "universal-profile";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) throw new UpError("BAD_ARGS", "UP_KEYCHAIN_SERVICE may only contain letters, digits, '.', '_' and '-' (max 64)");
  return s;
}
