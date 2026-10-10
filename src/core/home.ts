// State directory handling. $UP_HOME (default ~/.universal-profile) is created
// 0700; every file is written atomically (temp + rename) with mode 0600.
// Never store key material here except through a signer backend that encrypts
// it or the owner-approved protected-file backend.
import { appendFile, copyFile, mkdir, open, readFile, rename, writeFile, chmod, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export function upHome(): string {
  return process.env.UP_HOME && process.env.UP_HOME.trim() !== "" ? process.env.UP_HOME : join(homedir(), ".universal-profile");
}

export async function ensureDir(dir: string, mode = 0o700): Promise<void> {
  await mkdir(dir, { recursive: true, mode });
  if (process.platform !== "win32") {
    try {
      const s = await stat(dir);
      if ((s.mode & 0o777) !== mode) await chmod(dir, mode);
    } catch {}
  }
}

export async function writeFileAtomic(file: string, data: string | Uint8Array, mode = 0o600): Promise<void> {
  await ensureDir(dirname(file));
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, data, { mode });
  if (process.platform !== "win32") await chmod(tmp, mode);
  await rename(tmp, file);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  const { toJson } = await import("./json.ts");
  await writeFileAtomic(file, toJson(value) + "\n");
}

/**
 * Reads a state file that must never be silently replaced (config.json, keys/candidates.json):
 * a missing file gives `fallback`; an unreadable file or invalid JSON throws, so nothing is
 * written over a file that could still hold the agent's key inventory.
 */
export async function readJsonStrict<T>(file: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    const { UpError } = await import("./errors.ts");
    throw new UpError("INTERNAL", `cannot read ${file} (${(e as NodeJS.ErrnoException).code ?? "error"}); nothing was changed`, { hint: `fix its permissions or restore it (a previous copy may be at ${file}.bak)` });
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const { UpError } = await import("./errors.ts");
    throw new UpError("INTERNAL", `${file} is not valid JSON; nothing was changed and it will not be overwritten`, { hint: `repair it or restore it (a previous copy may be at ${file}.bak); never delete it: it lists the agent's keys` });
  }
}

/**
 * writeJson that first keeps the current file as `<file>.bak` (0600) — but only when the current
 * file parses and has the expected shape (`valid`); a damaged current file never replaces a good .bak.
 */
export async function writeJsonWithBackup(file: string, value: unknown, valid: (v: unknown) => boolean = () => true): Promise<void> {
  if (existsSync(file)) {
    let good = false;
    try {
      good = valid(JSON.parse(await readFile(file, "utf8")));
    } catch {}
    if (good) {
      await copyFile(file, `${file}.bak`);
      if (process.platform !== "win32") await chmod(`${file}.bak`, 0o600).catch(() => {});
    }
  }
  await writeJson(file, value);
}

/** A JSON object (not null, not an array): the expected top-level shape of config.json. */
export function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Appends one line to an append-only log file (0600); the file is never rewritten. If an earlier
 * append was interrupted (no trailing newline), a newline is written first so the partial line
 * stays on its own and never swallows this record.
 */
export async function appendLine(file: string, line: string): Promise<void> {
  await ensureDir(dirname(file));
  let prefix = "";
  try {
    const fh = await open(file, "r");
    try {
      const { size } = await fh.stat();
      if (size > 0) {
        const b = Buffer.alloc(1);
        await fh.read(b, 0, 1, size - 1);
        if (b[0] !== 0x0a) prefix = "\n";
      }
    } finally {
      await fh.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await appendFile(file, prefix + (line.endsWith("\n") ? line : line + "\n"), { mode: 0o600 });
}

export const paths = {
  config: (home: string) => join(home, "config.json"),
  policy: (home: string) => join(home, "policy.json"),
  profiles: (home: string) => join(home, "profiles"),
  profile: (home: string, address: string) => join(home, "profiles", `${address.toLowerCase()}.json`),
  cache: (home: string, ...p: string[]) => join(home, "cache", ...p),
  media: (home: string) => join(home, "media"),
  keys: (home: string) => join(home, "keys"),
  audit: (home: string) => join(home, "audit.log"),
};
