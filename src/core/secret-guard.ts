// Last line of defence against leaking key material to the AI provider. Everything this process
// writes to stdout/stderr (CLI results, MCP responses, logs) is read by the agent and therefore
// sent to its model API. Every private key and backup passphrase this process touches is
// registered here, and every outgoing text is checked against them right before it is written.
// A match never goes out: the output is replaced by a key-free error.
//
// The registry lives only in this process's memory, like the signer itself; it is never
// serialised, logged or written anywhere.
import { closeSync, fstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { UpError } from "./errors.ts";
import { paths, upHome } from "./home.ts";

const secrets: string[] = [];

/** Normalised forms that must never appear in output (lowercase, without 0x). */
function forms(secret: string): string[] {
  const s = secret.trim().toLowerCase();
  const plain = s.startsWith("0x") ? s.slice(2) : s;
  return [...new Set([plain, JSON.stringify(plain).slice(1, -1)])]; // also as it appears inside JSON strings
}

/** Registers a private key (hex) or passphrase that must never be written to any output. */
export function registerSecret(secret: string | undefined | null): void {
  if (!secret || secret.trim().length < 8) return;
  for (const f of forms(secret)) if (!secrets.includes(f)) secrets.push(f);
}

/** True when `text` contains a registered secret (case-insensitive). */
export function containsSecret(text: string): boolean {
  if (!secrets.length || !text) return false;
  const t = text.toLowerCase();
  return secrets.some((s) => t.includes(s));
}

/**
 * Called by every state-file writer (writeJson, appendLine, the audit log) right before the bytes go
 * to disk: a text that holds a loaded private key (also spread over separators) is never written.
 * The error does not repeat any of it.
 */
export function assertNothingSecretToWrite(text: string, what = "a state file"): void {
  if (containsSecret(text) || containsSecret(text.replace(/[^0-9a-z]/gi, ""))) throw new UpError("INTERNAL", `refusing to write ${what}: it would contain the agent's private key; nothing was written. This is a bug in the skill`);
}

export const WITHHELD_MESSAGE = "output withheld: it contained the agent's private key or a passphrase, which must never be sent to the AI provider. This is a bug in the skill; nothing was revealed.";

/** `text` unchanged, or a key-free replacement when it contains a registered secret. */
export function guardOutput(text: string, json: boolean): string {
  if (!containsSecret(text)) return text;
  return json ? JSON.stringify({ ok: false, error: { code: "INTERNAL", message: WITHHELD_MESSAGE } }) : `✗ INTERNAL: ${WITHHELD_MESSAGE}`;
}

function realOf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Files recorded in the backup index (<UP_HOME>/backups/index.jsonl), as real paths; unreadable index = none.
 * Lines are folded in order: a backup entry, a reservation, a commit or an imported file guards its path; a
 * later `cancelled` event frees it (a write that failed before any file existed must not block an unrelated file there).
 */
function indexedBackups(): string[] {
  try {
    const text = readFileSync(resolve(paths.backups(upHome()), "index.jsonl"), "utf8");
    const guarded = new Map<string, boolean>();
    for (const l of text.split("\n")) {
      try {
        const v = JSON.parse(l);
        if (typeof v?.file !== "string") continue;
        guarded.set(resolve(v.file), v.event !== "cancelled");
      } catch {
        /* a partly written line */
      }
    }
    return [...guarded].filter(([, on]) => on).map(([f]) => f);
  } catch {
    return [];
  }
}

/** Whether the file starts the way every LSP-30 backup does (`{ "version": 2, "backupDate": …`), wherever it lives and whatever it is called. */
function startsLikeBackup(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    if (!fstatSync(fd).isFile()) return false;
    const buf = Buffer.alloc(160);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return /^\uFEFF?\s*\{\s*"version"\s*:\s*2\s*,\s*"backupDate"\s*:/.test(buf.subarray(0, n).toString("utf8"));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Refuses user-supplied file paths inside the skill's key store (`<UP_HOME>/keys`) or that look
 * like key files, so no verb can read a key file and echo, parse or upload its contents. Backup
 * files (<UP_HOME>/backups, universal-profiles-backup-*.json, files named in the backup index)
 * are refused too, except for the backup verbs, which read them through their own reader
 * (`allowBackups`).
 */
export function assertNotKeyMaterialPath(file: string, what = "file", opts: { allowBackups?: boolean } = {}): void {
  let real = resolve(file);
  try {
    real = realpathSync(real);
  } catch {
    /* missing files are reported by the caller */
  }
  const keysDir = resolve(paths.keys(upHome()));
  let keysReal = keysDir;
  try {
    keysReal = realpathSync(keysDir);
  } catch {
    /* no key store yet */
  }
  const inside = (dir: string) => real === dir || real.startsWith(dir + sep);
  if (inside(keysDir) || inside(keysReal) || /\.(key|cred|dpapi)$/i.test(real) || /(^|[\\/])keystore[^\\/]*\.json$/i.test(real)) {
    throw new UpError("BAD_ARGS", `refusing to read ${what} from the key store or a key file`, { hint: "key files are only ever used inside the skill for signing; pass a different file" });
  }
  if (!opts.allowBackups) {
    const backupsDir = resolve(paths.backups(upHome()));
    let backupsReal = backupsDir;
    try {
      backupsReal = realpathSync(backupsDir);
    } catch {
      /* no backups yet */
    }
    if (inside(backupsDir) || inside(backupsReal) || /(^|[\\/])universal-profiles-backup-[^\\/]*\.json$/i.test(real) || indexedBackups().some((f) => f === real || realOf(f) === real) || startsLikeBackup(real)) {
      throw new UpError("BAD_ARGS", `refusing to read ${what} from the backups or a backup file`, { hint: "backup files hold encrypted (or, if asked for, plain) keys; only the backup verbs open them. Never read or send a backup file's contents" });
    }
  }
}

/** Command words safe to repeat in an error: long hex strings (possible keys) are elided. */
export function safeWords(words: string[]): string {
  return words.map((w) => (/[0-9a-f]{32,}/i.test(w) ? "<hidden>" : w.length > 64 ? `${w.slice(0, 32)}…` : w)).join(" ");
}

/** Test helper: forget all registered secrets. */
export function clearSecretsForTests(): void {
  secrets.length = 0;
}
