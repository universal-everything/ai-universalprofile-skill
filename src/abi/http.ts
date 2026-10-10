// Minimal HTTP JSON client for explorers, selector databases and indexers:
// timeout, response-size cap, retry with backoff on 429/5xx (honours
// Retry-After, capped), and URLs that may carry an API key are never put in
// errors or logs (callers pass a `label` instead). Responses are data only.
import { UpError } from "../core/errors.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  /** Injected fetch (tests); defaults to globalThis.fetch at call time. */
  fetch?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  /** Base backoff in ms (doubles per retry). Env UP_HTTP_BACKOFF_MS overrides. */
  backoffMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  /** Safe-to-print name of the endpoint (never the URL when it carries a key). */
  label?: string;
}

export interface HttpResult<T = any> {
  status: number;
  body: T | undefined;
  /** raw text when the body is not JSON */
  text?: string;
  retryAfterMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : undefined;
}

/**
 * Fetches JSON. Returns {status, body} for any HTTP status (callers decide what
 * 404/400 mean); throws NETWORK_ERROR only for transport failures or when
 * retries on 429/5xx are exhausted.
 */
export async function httpJson<T = any>(url: string, opts: HttpOptions = {}): Promise<HttpResult<T>> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const retries = opts.retries ?? 2;
  const base = Number(process.env.UP_HTTP_BACKOFF_MS ?? opts.backoffMs ?? 600);
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const label = opts.label ?? new URL(url).host;
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await f(url, {
        method: opts.method ?? "GET",
        headers: { accept: "application/json", "user-agent": "universal-profile-skill", ...(opts.body ? { "content-type": "application/json" } : {}), ...opts.headers },
        body: opts.body,
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastError = (e as Error)?.name === "AbortError" ? "timeout" : String((e as Error)?.message ?? e);
      if (attempt < retries) {
        await sleep(base * 2 ** attempt);
        continue;
      }
      throw new UpError("NETWORK_ERROR", `${label}: ${lastError}`);
    }
    try {
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(retryAfter(res.headers.get("retry-after")) ?? base * 2 ** attempt, 10_000);
        lastError = `HTTP ${res.status}`;
        if (attempt < retries) {
          await sleep(wait);
          continue;
        }
        throw new UpError("NETWORK_ERROR", `${label}: ${lastError}${res.status === 429 ? " (rate limited)" : ""}`, {
          hint: res.status === 429 ? "the service is rate limiting; wait a moment or configure an API key where supported" : undefined,
          details: { status: res.status },
        });
      }
      const declared = Number(res.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new UpError("NETWORK_ERROR", `${label}: response larger than ${maxBytes} bytes`);
      }
      let buf: Uint8Array;
      try {
        buf = await readCapped(res, maxBytes, ctrl);
      } catch (e) {
        throw new UpError("NETWORK_ERROR", `${label}: ${(e as Error).message}`);
      }
      const text = new TextDecoder().decode(buf);
      try {
        return { status: res.status, body: text ? (JSON.parse(text) as T) : undefined };
      } catch {
        return { status: res.status, body: undefined, text: text.slice(0, 500) };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new UpError("NETWORK_ERROR", `${label}: ${lastError}`);
}

/** Streams a response body, aborting as soon as more than `maxBytes` arrived. */
export async function readCapped(res: Response, maxBytes: number, ctrl?: AbortController): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      ctrl?.abort();
      throw new Error(`content larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
