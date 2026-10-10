// State directory handling. $UP_HOME (default ~/.universal-profile) is created
// 0700; every file is written atomically (temp + rename) with mode 0600.
// Never store key material here except through a signer backend that encrypts
// it or the owner-approved protected-file backend.
import { mkdir, readFile, rename, writeFile, chmod, stat } from "node:fs/promises";
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
