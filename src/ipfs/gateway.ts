// Reading IPFS content back through a gateway, and hash verification.
//  - verifyUpload(): after every upload the bytes are fetched again through the gateway
//    (default https://api.universalprofile.cloud/ipfs/<cid>) and re-hashed with keccak256;
//    a mismatch or an unreachable CID fails closed, so nothing unverifiable is written on-chain.
//  - fetchVerifiable(): reads a VerifiableURI target (ipfs:// through the gateway, https://
//    through the guarded fetch for untrusted URLs) and reports whether its hash matches.
// The gateway is trusted configuration (https, or http on a loopback host for a local node);
// content URLs found on-chain are untrusted data (public https hosts only, see safe-fetch.ts).
import { keccak256, type Hex } from "viem";
import { UpError } from "../core/errors.ts";
import { scrubUrls } from "../core/json.ts";
import type { UpConfig } from "../core/types.ts";
import type { FetchLike } from "../abi/http.ts";
import { readCapped } from "../abi/http.ts";
import { DEFAULT_IPFS_GATEWAY } from "../tokens/metadata.ts";
import { assertPublicHttpsUrl, safeFetchBytes, type LookupFn } from "../tokens/safe-fetch.ts";
import { isCid } from "./providers.ts";

export { DEFAULT_IPFS_GATEWAY };

/** Configured gateway: config ipfs.gateway, else UP_IPFS_GATEWAY, else the Universal Profile gateway. */
export function gatewayFrom(cfg: Pick<UpConfig, "ipfs">, env: NodeJS.ProcessEnv = process.env): string {
  return normaliseGateway(cfg.ipfs?.gateway ?? env.UP_IPFS_GATEWAY ?? DEFAULT_IPFS_GATEWAY);
}

/** https://host/ipfs/ form with a trailing slash; http only for loopback hosts (a local node). */
export function normaliseGateway(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // the raw value is never echoed: it may contain a password or a token
    throw new UpError("BAD_ARGS", "the IPFS gateway is not a valid URL", { hint: `e.g. ${DEFAULT_IPFS_GATEWAY}` });
  }
  const loopback = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i.test(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) throw new UpError("BAD_ARGS", "the IPFS gateway must be an https URL (http only for a local node on 127.0.0.1)", { hint: `e.g. ${DEFAULT_IPFS_GATEWAY}` });
  if (u.username || u.password || u.search || u.hash) throw new UpError("BAD_ARGS", "the IPFS gateway URL must not contain credentials, a query or a fragment");
  return u.toString().replace(/\/?$/, "/");
}

/** ipfs://<cid>[/path] → { cid, path } (only a valid CID and a plain path are accepted). */
export function parseIpfsUrl(url: string): { cid: string; path: string } | undefined {
  const m = /^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]+)(\/[A-Za-z0-9._~\-/]*)?$/.exec(url.trim());
  if (!m || !isCid(m[1])) return undefined;
  // no "." / ".." segments: the path must stay below the CID on the gateway
  if (m[2] && m[2].split("/").some((seg) => seg === "." || seg === "..")) return undefined;
  return { cid: m[1], path: m[2] ?? "" };
}

export function gatewayUrlFor(gateway: string, cid: string, path = ""): string {
  if (!isCid(cid)) throw new UpError("BAD_ARGS", `not a valid IPFS CID: ${String(cid).slice(0, 80)}`);
  return `${normaliseGateway(gateway)}${cid}${path}`;
}

export function keccakBytes(bytes: Uint8Array): Hex {
  return keccak256(bytes);
}

export interface GatewayFetchOptions {
  gateway: string;
  fetch?: FetchLike;
  maxBytes?: number;
  timeoutMs?: number;
  /** Attempts (a fresh upload can take a moment to be served). Default 4. */
  attempts?: number;
  /** Base backoff in ms, doubled per attempt. Default 1000 (env UP_IPFS_BACKOFF_MS overrides). */
  backoffMs?: number;
  /** DNS lookup for checking redirect targets (tests). */
  lookup?: LookupFn;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET <gateway>/<cid><path> with retries on network errors, 404, 429 and 5xx; size-capped. */
/**
 * The URLs actually requested for a gateway URL. A local Kubo gateway addressed as "localhost"
 * redirects path requests to its subdomain gateway (<cid>.ipfs.localhost), which the redirect
 * guard refuses; addressed by IP it serves the path gateway directly. So "localhost" is tried
 * as 127.0.0.1 and then [::1] (a node may listen on either); the configured URL is kept as given.
 */
export function gatewayTargets(url: string): string[] {
  const u = new URL(url);
  if (u.protocol !== "http:" || u.hostname.toLowerCase() !== "localhost") return [url];
  return ["127.0.0.1", "[::1]"].map((ip) => {
    const t = new URL(url);
    t.hostname = ip;
    return t.toString();
  });
}

/** GET <gateway>/<cid><path> with retries on network errors, 404, 429 and 5xx; size-capped. */
export async function fetchFromGateway(cid: string, opts: GatewayFetchOptions, path = ""): Promise<Uint8Array> {
  const url = gatewayUrlFor(opts.gateway, cid, path);
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const attempts = Math.max(1, opts.attempts ?? 4);
  const base = Number(process.env.UP_IPFS_BACKOFF_MS ?? opts.backoffMs ?? 1000);
  const maxBytes = opts.maxBytes ?? 12 * 1024 * 1024;
  const host = new URL(url).host;
  let last = "";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(base * 2 ** (i - 1));
    for (const target of gatewayTargets(url)) {
      const origin = new URL(target).origin;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
      try {
        // redirects are followed by hand: the same origin, or a public https host (no hop into private networks)
        let res: Response | undefined;
        let current = target;
        for (let hop = 0; ; hop++) {
          res = await f(current, { signal: ctrl.signal, redirect: "manual", headers: { "user-agent": "universal-profile-skill" } });
          if (res.status < 300 || res.status >= 400) break;
          const loc = res.headers.get("location");
          await res.body?.cancel().catch(() => {});
          if (!loc || hop >= 3) throw new UpError("IPFS_ERROR", `the IPFS gateway ${host} redirected ${loc ? "too often" : "without a location"} for ${cid}`, { details: { reason: "gateway-error", cid } });
          const next = new URL(loc, current);
          if (next.origin !== origin) {
            try {
              await assertPublicHttpsUrl(next.toString(), opts.lookup);
            } catch (e) {
              throw new UpError("IPFS_ERROR", `the IPFS gateway ${host} redirected to a refused location (${scrubUrls((e as Error).message)})`, { details: { reason: "gateway-error", cid } });
            }
          }
          current = next.toString();
        }
        if (res.status === 404 || res.status === 429 || res.status >= 500) {
          await res.body?.cancel().catch(() => {});
          last = `HTTP ${res.status}`;
          break; // the gateway answered: retry later, not on the other loopback address
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          throw new UpError("IPFS_ERROR", `the IPFS gateway ${host} answered HTTP ${res.status} for ${cid}`, { details: { reason: "gateway-error", status: res.status, cid } });
        }
        return await readCapped(res, maxBytes, ctrl);
      } catch (e) {
        if (e instanceof UpError) throw e;
        last = (e as Error)?.name === "AbortError" ? "timeout" : scrubUrls(String((e as Error)?.message ?? e));
        // connection failed: try the next loopback address of a "localhost" gateway
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new UpError("IPFS_ERROR", `the IPFS gateway ${host} did not serve ${cid} (${last})`, { hint: "the content may not have propagated yet or the gateway is unreachable; retry later", details: { reason: "gateway-unavailable", cid } });
}

/**
 * Fetches a freshly uploaded CID back through the gateway and compares keccak256 with the
 * bytes that were uploaded. Fails closed (IPFS_ERROR, reason "verification-failed").
 */
export async function verifyUpload(cid: string, expected: Hex, opts: GatewayFetchOptions & { what: string }): Promise<{ cid: string; verifiedVia: string; hash: Hex }> {
  const bytes = await fetchFromGateway(cid, opts);
  const hash = keccakBytes(bytes);
  if (hash.toLowerCase() !== expected.toLowerCase()) {
    throw new UpError("IPFS_ERROR", `verification failed for the uploaded ${opts.what}: the gateway returned different bytes for ${cid} (keccak256 ${hash}, expected ${expected})`, {
      hint: "nothing was written on-chain; retry the upload, or use another provider or gateway",
      details: { reason: "verification-failed", cid, expected, got: hash },
    });
  }
  return { cid, verifiedVia: gatewayUrlFor(opts.gateway, cid), hash };
}

export interface FetchedVerifiable {
  url: string;
  resolvedUrl?: string;
  bytes?: Uint8Array;
  hash?: Hex;
  /** match / mismatch against the VerifiableURI hash; not-verifiable when no keccak256 method is given. */
  hashCheck: "match" | "mismatch" | "not-verifiable" | "not-fetched";
  error?: string;
}

/** Reads the target of a (Verifiable)URI. Never throws: errors are reported in the result. */
export async function fetchVerifiable(url: string, verification: { method?: string; data?: string } | undefined, opts: GatewayFetchOptions & { lookup?: LookupFn }): Promise<FetchedVerifiable> {
  const out: FetchedVerifiable = { url, hashCheck: "not-fetched" };
  try {
    const ipfs = parseIpfsUrl(url);
    if (ipfs) {
      out.resolvedUrl = gatewayUrlFor(opts.gateway, ipfs.cid, ipfs.path);
      out.bytes = await fetchFromGateway(ipfs.cid, { ...opts, attempts: opts.attempts ?? 2 }, ipfs.path);
    } else if (/^https:\/\//i.test(url)) {
      // untrusted URL from on-chain data: public https hosts only, size-capped, ≤ 3 redirects
      const r = await safeFetchBytes(url, { fetch: opts.fetch, lookup: opts.lookup, maxBytes: opts.maxBytes ?? 1024 * 1024, maxRedirects: 3, accept: "*/*" });
      out.resolvedUrl = r.finalUrl;
      out.bytes = r.bytes;
    } else if (/^ipfs:\/\//i.test(url)) {
      out.error = "not a valid ipfs:// URL (unknown CID format or path)";
      return out;
    } else {
      out.error = "only ipfs:// and https:// URLs are fetched";
      return out;
    }
  } catch (e) {
    out.error = scrubUrls((e as Error).message);
    return out;
  }
  out.hash = keccakBytes(out.bytes);
  if (verification?.method && /^keccak256\((utf8|bytes)\)$/.test(verification.method) && verification.data && /^0x[0-9a-fA-F]{64}$/.test(verification.data)) {
    out.hashCheck = out.hash.toLowerCase() === verification.data.toLowerCase() ? "match" : "mismatch";
  } else out.hashCheck = "not-verifiable";
  return out;
}
