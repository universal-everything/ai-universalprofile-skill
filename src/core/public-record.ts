// One scan for everything the backup code path persists or shows: audit summaries, backups index
// lines, profile records and deployment manifests, config changes, key inventory notes. A "public
// record" is any object whose strings are written down or sent to the agent. It must hold no
// private key: neither one this process has loaded (registered with the output guard, also when
// spread over separators) nor key-shaped text (64 hex digits in a row, or spread out).
//
// Hex DATA is the one exception to the key-shape rule: calldata, salts, data keys and values,
// hashes and fingerprints are legitimately 64 hex digits long. A string that is only hex, in a
// field that is not named like free text, is therefore checked against the registered keys only.
// Everything else (names, hints, paths, labels, object keys) gets the full check.
import { UpError } from "./errors.ts";
import { looksLikeKey } from "./safe-text.ts";
import { containsSecret } from "./secret-guard.ts";

/** Field names that hold free text: a bare key there is a key, never data. */
const TEXT_FIELDS = new Set(["name", "type", "hint", "passwordHint", "encryptionType", "backupDate", "file", "path", "destination", "alias", "label", "note", "effect", "say", "message", "chain", "network"]);
const PURE_HEX = /^(0x)?[0-9a-f]*$/i;
const MAX_DEPTH = 24;

/** True when `text` holds a loaded private key (also spread over separators) or is key-shaped. */
export function textHoldsKey(text: string): boolean {
  return containsSecret(text) || containsSecret(text.replace(/[^0-9a-z]/gi, "")) || looksLikeKey(text);
}

/** True when `value` (any JSON-like structure, object keys included) holds key material anywhere. */
export function holdsKeyMaterial(value: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (v: unknown, field: string, depth: number): boolean => {
    if (typeof v === "string") {
      if (PURE_HEX.test(v) && !TEXT_FIELDS.has(field)) return containsSecret(v);
      return textHoldsKey(v);
    }
    if (v === null || typeof v !== "object") return false;
    if (seen.has(v) || depth > MAX_DEPTH) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some((x) => walk(x, field, depth + 1));
    return Object.entries(v as Record<string, unknown>).some(([k, x]) => textHoldsKey(k) || walk(x, k, depth + 1));
  };
  return walk(value, "", 0);
}

/**
 * Refuses to go on when `value` holds key material. The error names what was refused, never the text:
 * nothing about the offending value reaches an error, a log or the agent.
 */
export function assertNoKeyMaterial(what: string, value: unknown): void {
  if (holdsKeyMaterial(value)) throw new UpError("BAD_ARGS", `${what} holds private key material (or text shaped like it); nothing was changed`, { hint: "rename or replace it" });
}
