// Guarded fetch for URLs that come from untrusted data (token metadata URIs,
// tokenURI/uri, user-chosen IPFS gateways):
//  - https only; every hop's host is resolved (node:dns lookup, all addresses) and
//    refused if ANY address is loopback / private / link-local / unique-local /
//    CGNAT / multicast / unspecified / reserved (also for IP-literal hosts);
//  - redirects are followed manually (max 3), each target checked the same way;
//  - the body is streamed and the request aborted as soon as it exceeds the cap.
// Residual risk: DNS can change between our lookup and fetch's own resolution
// (rebinding); Node's built-in fetch offers no supported way to pin the address.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readCapped, type FetchLike } from "../abi/http.ts";

export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>;

export interface SafeFetchOptions {
  fetch?: FetchLike;
  lookup?: LookupFn;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  accept?: string;
}

export class BlockedUrlError extends Error {}

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || // "this" network / unspecified
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) || // IETF protocol assignments / TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && p[2] === 100) || // TEST-NET-2
    (a === 203 && b === 0 && p[2] === 113) || // TEST-NET-3
    a >= 224 // multicast (224/4) and reserved (240/4), broadcast
  );
}

function ipv6Blocked(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (s === "::" || s === "::1") return true;
  // IPv4-mapped / -compatible (::ffff:a.b.c.d, ::a.b.c.d) and the hex form ::ffff:7f00:1
  const v4 = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) return ipv4Blocked(v4[1]);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return ipv4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(s.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
    (first & 0xff00) === 0xff00 || // multicast
    s.startsWith("64:ff9b:") || // NAT64 (could reach internal IPv4)
    s.startsWith("2001:db8:") // documentation
  );
}

/** True when the address must not be contacted. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]);
  if (v === 4) return ipv4Blocked(ip);
  if (v === 6) return ipv6Blocked(ip);
  return true;
}

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true });

/** Throws BlockedUrlError unless the URL is https and its host resolves only to public addresses. */
export async function assertPublicHttpsUrl(raw: string, lookup: LookupFn = defaultLookup): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError(`invalid URL: ${raw.slice(0, 120)}`);
  }
  if (u.protocol !== "https:") throw new BlockedUrlError(`only https:// URLs are fetched (got ${u.protocol})`);
  if (u.username || u.password) throw new BlockedUrlError("URLs with embedded credentials are refused");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new BlockedUrlError(`refusing local host name ${host}`);
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new BlockedUrlError(`refusing non-public address ${host}`);
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host);
  } catch (e) {
    throw new BlockedUrlError(`cannot resolve ${host}: ${(e as Error).message}`);
  }
  if (!addrs.length) throw new BlockedUrlError(`${host} does not resolve`);
  const bad = addrs.find((a) => isBlockedAddress(a.address));
  if (bad) throw new BlockedUrlError(`refusing ${host}: it resolves to the non-public address ${bad.address}`);
  return u;
}

/** Fetches untrusted https content with the guards described in the header; returns the raw bytes. */
export async function safeFetchBytes(url: string, opts: SafeFetchOptions = {}): Promise<{ bytes: Uint8Array; finalUrl: string; contentType?: string }> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const lookup = opts.lookup ?? defaultLookup;
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = url;
  for (let hop = 0; ; hop++) {
    const u = await assertPublicHttpsUrl(current, lookup);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await f(u.toString(), { redirect: "manual", signal: ctrl.signal, headers: { accept: opts.accept ?? "application/json" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) throw new Error(`HTTP ${res.status} redirect without a Location header`);
        if (hop >= maxRedirects) throw new BlockedUrlError(`more than ${maxRedirects} redirects`);
        current = new URL(loc, u).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${res.status}`);
      }
      const declared = Number(res.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`content larger than ${maxBytes} bytes`);
      }
      const bytes = await readCapped(res, maxBytes, ctrl);
      return { bytes, finalUrl: u.toString(), contentType: res.headers.get("content-type") ?? undefined };
    } finally {
      clearTimeout(timer);
    }
  }
}
