// Last line of defence against leaking key material to the AI provider. Everything this process
// writes to stdout/stderr (CLI results, MCP responses, logs) is read by the agent and therefore
// sent to its model API. Every private key and backup passphrase this process touches is
// registered here, and every outgoing text is checked against them right before it is written.
// A match never goes out: the output is replaced by a key-free error.
//
// The registry lives only in this process's memory, like the signer itself; it is never
// serialised, logged or written anywhere.
import { realpathSync } from "node:fs";
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

export const WITHHELD_MESSAGE = "output withheld: it contained the agent's private key or a passphrase, which must never be sent to the AI provider. This is a bug in the skill; nothing was revealed.";

/** `text` unchanged, or a key-free replacement when it contains a registered secret. */
export function guardOutput(text: string, json: boolean): string {
  if (!containsSecret(text)) return text;
  return json ? JSON.stringify({ ok: false, error: { code: "INTERNAL", message: WITHHELD_MESSAGE } }) : `✗ INTERNAL: ${WITHHELD_MESSAGE}`;
}

/**
 * Refuses user-supplied file paths inside the skill's key store (`<UP_HOME>/keys`) or that look
 * like key files, so no verb can read a key file and echo, parse or upload its contents.
 */
export function assertNotKeyMaterialPath(file: string, what = "file"): void {
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
}

/** Command words safe to repeat in an error: long hex strings (possible keys) are elided. */
export function safeWords(words: string[]): string {
  return words.map((w) => (/[0-9a-f]{32,}/i.test(w) ? "<hidden>" : w.length > 64 ? `${w.slice(0, 32)}…` : w)).join(" ");
}

/** Test helper: forget all registered secrets. */
export function clearSecretsForTests(): void {
  secrets.length = 0;
}
