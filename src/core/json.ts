// JSON helpers that are safe for bigint and never leak secrets.

/** JSON.stringify replacer: bigint -> decimal string, Uint8Array -> 0x hex. */
export function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return "0x" + Buffer.from(value).toString("hex");
  return value;
}

export function toJson(value: unknown, pretty = true): string {
  return JSON.stringify(value, replacer, pretty ? 2 : undefined);
}

/** Keys whose values must never be printed, logged or returned. */
const SECRET_KEY = /(private.?key|secret|mnemonic|passphrase|password|apikey|api.?key|access.?token|auth.?token|bearer)$/i;
/** Containers whose every string child is a credential (e.g. config.explorerKeys, config.ipfsKeys). */
export const SECRET_CONTAINER = /^(explorerKeys|ipfsKeys|apiKeys|secrets|credentials)$/i;
/** URLs carrying credentials in the query or as a long opaque path segment (provider API keys). */
function maskUrl(s: string): string {
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const u = new URL(s);
    let changed = false;
    for (const k of [...u.searchParams.keys()]) {
      if (/key|token|secret|auth|apikey/i.test(k)) {
        u.searchParams.set(k, "[redacted]");
        changed = true;
      }
    }
    const keyInPathHost = /(alchemy|infura|quiknode|quicknode|ankr|chainstack|blastapi|getblock|drpc|nodereal|pimlico|stackup|biconomy|etherspot|candide|blockpi|tenderly|onfinality|nownodes)/i.test(u.hostname);
    const parts = u.pathname.split("/").map((seg) => {
      if (keyInPathHost && /^[A-Za-z0-9_-]{24,}$/.test(seg) && !/^0x[0-9a-fA-F]+$/.test(seg)) {
        changed = true;
        return "[redacted]";
      }
      return seg;
    });
    u.pathname = parts.join("/");
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      changed = true;
    }
    return changed ? u.toString() : s;
  } catch {
    return s;
  }
}

const released = new WeakMap<object, Set<string>>();

/**
 * Marks keys of a result object as meant to be output (the generated backup password, which the
 * agent must hand to the human). redact() leaves exactly these keys of exactly this object alone;
 * nothing else changes, and private keys stay covered by the output guard (secret-guard.ts).
 */
export function releaseKeys<T extends object>(obj: T, ...keys: string[]): T {
  released.set(obj, new Set([...(released.get(obj) ?? []), ...keys]));
  return obj;
}

/** Deep-redact secret-shaped fields before output (defence in depth; verbs never put secrets in results). */
export function redact<T>(value: T, inSecretContainer = false): T {
  if (Array.isArray(value)) return value.map((v) => redact(v, inSecretContainer)) as T;
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && (inSecretContainer || SECRET_KEY.test(k)) && !released.get(value as object)?.has(k)) out[k] = "[redacted]";
      else out[k] = redact(v, SECRET_CONTAINER.test(k));
    }
    return out as T;
  }
  if (typeof value === "string") return maskUrl(value) as T;
  return value;
}

/**
 * A URL as it may appear in messages: scheme, host and path only — never userinfo, query or
 * fragment (they can carry passwords and tokens). Unparseable input is not echoed at all.
 */
export function safeUrlText(raw: string): string {
  try {
    const u = new URL(raw.trim());
    return `${u.protocol}//${u.host}${u.pathname}${u.search || u.hash ? "?…" : ""}`;
  } catch {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw.trim())?.[1];
    return scheme ? `${scheme.toLowerCase()}://<invalid URL>` : "<invalid URL>";
  }
}

/**
 * Rewrites every URL inside a free-text message (e.g. a nested error) with safeUrlText, and
 * then removes anything that still looks like credentials even when a URL was broken up by
 * whitespace or odd characters: "user:password@" parts, query strings and fragments.
 */
export function scrubUrls(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, (m) => safeUrlText(m))
    .replace(/[^\s/@"'<>]*@/g, "[redacted]@") // userinfo, also the tail of a password that contained a space
    .replace(/[?#][^\s"'<>]*/g, (m) => (m === "?…" ? m : "?…")); // query / fragment (tokens)
}
