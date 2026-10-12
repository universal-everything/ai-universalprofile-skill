// Where backups live on this machine: <UP_HOME>/backups (0700), files 0600, never overwritten,
// plus the append-only index backups/index.jsonl (public data only: paths, hashes, addresses).
// The skill never deletes a backup file or an index line.
import { createHash } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { UpError } from "../core/errors.ts";
import { assertNoKeyMaterial } from "../core/public-record.ts";
import { appendLine, ensureDir, paths } from "../core/home.ts";
import { assertNotKeyMaterialPath } from "../core/secret-guard.ts";
import { looksLikeKey } from "../core/safe-text.ts";
import { writeNewFileExclusive } from "../signer/verbs.ts";
import { backupText, MAX_BACKUP_BYTES, type BackupMode } from "./lsp30-format.ts";

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

export function backupsDir(home: string): string {
  return paths.backups(home);
}

export function indexFile(home: string): string {
  return join(backupsDir(home), "index.jsonl");
}

export interface IndexEntry {
  at: string;
  file: string;
  sha256: string;
  mode: BackupMode;
  encrypted: boolean;
  profiles: string[];
  keys: string[];
  chains: number[];
  fingerprint: string;
  /** Fingerprint of profiles and deployment data only (what a public backup covers). */
  profilesFingerprint: string;
  hintPresent: boolean;
  appCompatible: boolean;
}

/**
 * `reserved`: a path about to receive a backup (guarded from other readers from then on);
 * `committed`: the file was written; `cancelled`: it was not (the path is free again). The newest event of a path wins.
 */
export interface IndexEvent {
  at: string;
  event: "asked" | "import" | "reserved" | "committed" | "cancelled";
  fingerprint?: string;
  kind?: string;
  file?: string;
  sha256?: string;
  profiles?: string[];
  keys?: string[];
}

export async function appendIndex(home: string, entry: IndexEntry | IndexEvent): Promise<void> {
  assertNoKeyMaterial("a backups index line", entry);
  await ensureDir(backupsDir(home));
  await appendLine(indexFile(home), JSON.stringify(entry));
}

/** Every well-formed index line; damaged lines are skipped, never removed. */
export async function readIndex(home: string): Promise<{ backups: IndexEntry[]; events: IndexEvent[] }> {
  let text = "";
  try {
    text = await readFile(indexFile(home), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { backups: [], events: [] };
    throw e;
  }
  const backups: IndexEntry[] = [];
  const events: IndexEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v.event === "string") events.push(v);
      else if (v && typeof v.file === "string" && typeof v.sha256 === "string") backups.push(v);
    } catch {
      /* a partly written line */
    }
  }
  return { backups, events };
}

const MAX_LABEL = 40;
/** Names Windows reserves for devices, whatever follows them. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * The generating agent's display name as a safe file name prefix, or undefined when nothing usable is left.
 * Letters, marks, digits, space, `.`, `_` and `-` stay (Unicode letters included); path separators, Windows-reserved
 * characters, control and zero-width characters and everything else become spaces; length is capped. Never a path
 * (no separator survives), never a key (key-shaped text is refused by the caller's key-material check).
 */
export function sanitizeAgentLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string" || looksLikeKey(raw)) return undefined;
  let t = raw.normalize("NFKC").replace(/[\p{C}\u2028\u2029]/gu, "").replace(/[^\p{L}\p{M}\p{N} ._-]/gu, " ");
  t = t.replace(/\s+/g, " ").replace(/\.{2,}/g, ".").replace(/(^| )[._-]+(?= |$)/g, "$1").replace(/ {2,}/g, " ").trim();
  t = [...t].slice(0, MAX_LABEL).join("").replace(/^[ .\-_]+|[ .\-_]+$/g, "");
  if (!t) return undefined;
  return WINDOWS_RESERVED.test(t) ? `${t}-agent` : t;
}

/**
 * The agent label for a default backup name: the explicit `--bot-name`, else UP_AGENT_NAME (the host's own
 * public display name for the agent, never a secret). Nothing is guessed from the model or the host: without
 * either, the name has no prefix.
 */
export function agentLabel(given?: unknown, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (typeof given === "string" && given.trim()) {
    const label = sanitizeAgentLabel(given);
    if (!label) throw new UpError("BAD_ARGS", "--bot-name has no usable letters or digits left after removing characters that are not allowed in a file name", { hint: "pass the agent's display name, e.g. --bot-name \"Alice\"" });
    return label;
  }
  return sanitizeAgentLabel(env.UP_AGENT_NAME);
}

/** `<agent> - universal-profiles-backup-YYYY-MM-DD.json` (UTC date; no prefix without an agent label), `-2`, `-3` … when taken. */
export async function defaultBackupPath(home: string, now = new Date(), label?: string): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  const dir = backupsDir(home);
  const prefix = label ? `${label} - ` : "";
  for (let n = 1; n < 1000; n++) {
    const file = join(dir, `${prefix}universal-profiles-backup-${day}${n === 1 ? "" : `-${n}`}.json`);
    if (!(await lstat(file).then(() => true, () => false))) return file;
  }
  throw new UpError("INTERNAL", "too many backups for today in the backups folder");
}

/** The destination for a new backup: the given path (its folder must exist; used as is) or the default name in backups/. Never an existing file. */
export async function resolveDestination(home: string, given?: string, label?: string): Promise<string> {
  if (!given?.trim()) {
    await ensureDir(backupsDir(home));
    return defaultBackupPath(home, new Date(), label);
  }
  const file = isAbsolute(given.trim()) ? given.trim() : resolve(given.trim());
  const parent = await stat(dirname(file)).catch(() => null);
  if (!parent?.isDirectory()) throw new UpError("BAD_ARGS", `the folder ${dirname(file)} does not exist`);
  assertNotKeyMaterialPath(dirname(file), "backup destination", { allowBackups: true });
  if (await lstat(file).then(() => true, () => false)) throw new UpError("BAD_ARGS", `${file} already exists; a backup is never overwritten`, { hint: "pass another --path, or omit it" });
  return file;
}

/** Writes a new backup file (0600, exclusive). Returns its sha256. */
export async function writeBackup(file: string, content: string): Promise<{ sha256: string; size: number; warning?: string }> {
  const { warning } = await writeNewFileExclusive(file, content);
  return { sha256: sha256Hex(content), size: Buffer.byteLength(content), ...(warning ? { warning } : {}) };
}

/**
 * Reads a backup file for inspect, verify and import. These verbs are the only readers of backup
 * files (every other file-reading verb refuses them); the key store and key files stay off limits.
 */
export async function readBackupFile(given: string): Promise<{ file: string; text: string; sha256: string; size: number }> {
  if (!given?.trim()) throw new UpError("BAD_ARGS", "give the path of a backup file");
  const file = resolve(given.trim());
  assertNotKeyMaterialPath(file, "backup file", { allowBackups: true });
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) throw new UpError("BAD_ARGS", `no backup file at ${file}`, { hint: "pass the path the file was saved to (a chat attachment is saved by the host; use that path)" });
  if (st.size > MAX_BACKUP_BYTES) throw new UpError("BAD_ARGS", `the backup file is larger than ${MAX_BACKUP_BYTES / 1024 / 1024} MiB`);
  const bytes = await readFile(file);
  return { file, text: backupText(bytes), sha256: sha256Hex(bytes), size: bytes.length };
}
