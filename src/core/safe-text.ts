// One sanitizer for text that comes from outside the skill and is shown to the agent or stored:
// names, hints and dates in a backup file, tool names and URIs an MCP client sends. Such text
// can be crafted to carry a private key (a file author who knows a key can copy it into a name,
// hint or date), and the output guard only knows the keys this process has loaded. So the
// shape of a key is suppressed, whether or not the key is registered.
//
// A key-shaped run is 64 hex digits (with or without 0x, any case), also when it is spread
// over separators or hidden by zero-width characters.

/** Control characters, line/paragraph separators and zero-width characters. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
/** Separators that can sit between the digits of a spread-out key. */
const SPREAD = /(?<=[0-9a-f])[\s_.,:;'"`|/\\-]+(?=[0-9a-f])/gi;

export const KEY_WITHHELD = "[withheld: looks like key material]";

/** True when `text` holds a key-shaped run: 64 hex digits in a row, or spread over separators. */
export function looksLikeKey(text: string): boolean {
  const t = text.replace(INVISIBLE, "");
  return /[0-9a-f]{64}/i.test(t) || /[0-9a-f]{64}/i.test(t.replace(SPREAD, ""));
}

/**
 * Untrusted free text made safe to show and to store: invisible characters out, a key-shaped
 * text replaced by KEY_WITHHELD (checked on the whole text, before it is shortened), length capped.
 */
export function safeFileText(value: unknown, max = 80): string {
  const raw = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  if (looksLikeKey(raw)) return KEY_WITHHELD;
  const t = raw.replace(INVISIBLE, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** An untrusted identifier repeated in an error: long hex runs elided, length capped. */
export function safeEcho(value: unknown, max = 64): string {
  const raw = typeof value === "string" ? value : value === undefined || value === null ? "" : typeof value === "object" ? "[object]" : String(value);
  const t = raw.replace(INVISIBLE, " ").replace(/[0-9a-f]{32,}/gi, "<hidden>").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** `YYYY-MM-DDTHH:mm:ss[.sss]` followed by Z or an offset: the only date shape a backup file may carry. */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** The date as written when it is an ISO date-time, else undefined. */
export function canonicalDateTime(value: unknown): string | undefined {
  return typeof value === "string" && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
}
