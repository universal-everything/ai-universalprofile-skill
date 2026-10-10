// Selector / event-topic lookup (trust-ladder rung 5 when it reaches the remote
// databases). Order: bundled (assets/abis/selectors.json, then every bundled
// ABI incl. errors/events) → Sourcify 4byte (openchain-compatible) →
// 4byte.directory. Every candidate is re-hashed locally (the databases are
// one-way and collision-prone: 0xa9059cbb has several entries), ALL
// candidates are returned, and remote answers are labelled `guessed` —
// never enough to sign a value-moving call.
import { parseAbiItem, type AbiFunction, type Hex } from "viem";
import type { TrustLabel } from "../core/types.ts";
import { assetJson } from "../core/assets.ts";
import { UpError } from "../core/errors.ts";
import { bundledIndexes } from "./bundled.ts";
import { httpJson, type FetchLike } from "./http.ts";
import { canonicalSignature, humanSignature, selectorOfSignature, topicOfSignature } from "./signature.ts";

export type SelectorSource = "bundled" | "sourcify-4byte" | "4byte.directory";

export interface SelectorCandidate {
  signature: string;
  /** Human-readable fragment when known (bundled), else the canonical signature. */
  fragment: string;
  kind: "function" | "error" | "event";
  source: SelectorSource;
  /** Bundled contracts declaring it. */
  contracts?: string[];
  /** Sourcify flags */
  filtered?: boolean;
  hasVerifiedContract?: boolean;
  /** keccak256(signature) really starts with the queried selector. */
  hashMatches: boolean;
}

export interface SelectorLookup {
  query: Hex;
  kind: "selector" | "topic";
  trust: TrustLabel | "unknown";
  candidates: SelectorCandidate[];
  sources: { source: SelectorSource; outcome: string }[];
  warnings: string[];
}

export interface LookupOptions {
  offline?: boolean;
  /** Query every source even after a hit (shows all collisions). */
  allSources?: boolean;
  fetch?: FetchLike;
}

function templates() {
  const t = assetJson<any>("registry", "sources.json").abiDiscovery as Record<string, string>;
  return {
    sourcify: t.fourbyteSourcify ?? "https://api.4byte.sourcify.dev/signature-database/v1/lookup?function={selector}&filter=false",
    fourbyte: t.fourbyteDirectory ?? "https://www.4byte.directory/api/v1/signatures/?hex_signature={selector}",
  };
}

function hashMatches(signature: string, query: Hex): boolean {
  try {
    const h = query.length === 66 ? topicOfSignature(signature) : selectorOfSignature(signature);
    return h.toLowerCase() === query.toLowerCase();
  } catch {
    return false;
  }
}

export function normalizeQuery(q: string): { query: Hex; kind: "selector" | "topic" } {
  const s = q.trim().toLowerCase();
  if (/^0x[0-9a-f]{8}$/.test(s)) return { query: s as Hex, kind: "selector" };
  if (/^0x[0-9a-f]{64}$/.test(s)) return { query: s as Hex, kind: "topic" };
  throw new UpError("BAD_ARGS", `"${q}" is neither a 4-byte selector (0x + 8 hex) nor a 32-byte event topic (0x + 64 hex)`);
}

export function bundledCandidates(query: Hex): SelectorCandidate[] {
  const out: SelectorCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: SelectorCandidate) => {
    const k = `${c.kind}:${c.signature}`;
    if (seen.has(k)) {
      const prev = out.find((x) => `${x.kind}:${x.signature}` === k)!;
      for (const ct of c.contracts ?? []) if (!prev.contracts?.includes(ct)) (prev.contracts ??= []).push(ct);
      return;
    }
    seen.add(k);
    out.push(c);
  };
  const idx = bundledIndexes();
  if (query.length === 10) {
    const sel = assetJson<Record<string, string[]>>("abis", "selectors.json")[query] ?? [];
    for (const frag of sel) {
      try {
        const item = parseAbiItem(`function ${frag}`) as AbiFunction;
        push({ signature: canonicalSignature(item), fragment: humanSignature(item), kind: "function", source: "bundled", contracts: ["selectors.json"], hashMatches: hashMatches(canonicalSignature(item), query) });
      } catch {}
    }
    for (const x of idx.functions.get(query) ?? []) push({ signature: x.signature, fragment: humanSignature(x.item), kind: "function", source: "bundled", contracts: [...x.contracts], hashMatches: true });
    for (const x of idx.errors.get(query) ?? []) push({ signature: x.signature, fragment: humanSignature(x.item), kind: "error", source: "bundled", contracts: [...x.contracts], hashMatches: true });
  } else {
    for (const x of idx.events.get(query) ?? []) {
      // ERC-20 and ERC-721 Transfer share a topic but differ in indexing → keep both fragments
      const k = `event:${humanSignature(x.item)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ signature: x.signature, fragment: humanSignature(x.item), kind: "event", source: "bundled", contracts: [...x.contracts], hashMatches: true });
    }
  }
  return out;
}

/** Batch lookup in the Sourcify 4byte service (comma-separated queries). */
export async function sourcifyLookup(queries: Hex[], kind: "selector" | "topic", opts: LookupOptions = {}): Promise<Map<string, SelectorCandidate[]>> {
  const out = new Map<string, SelectorCandidate[]>();
  if (queries.length === 0) return out;
  const param = kind === "topic" ? "event" : "function";
  const url = templates().sourcify.replace("function={selector}", `${param}=${queries.join(",")}`);
  const r = await httpJson<any>(url, { fetch: opts.fetch, label: "Sourcify 4byte" });
  if (r.status !== 200 || !r.body?.ok) throw new UpError("NETWORK_ERROR", `Sourcify 4byte: HTTP ${r.status}`);
  const bucket = r.body.result?.[param] ?? {};
  for (const q of queries) {
    const list = (bucket[q] ?? bucket[q.toLowerCase()] ?? []) as { name: string; filtered?: boolean; hasVerifiedContract?: boolean }[];
    out.set(
      q,
      list
        .filter((x) => typeof x?.name === "string")
        .map((x) => ({
          signature: x.name,
          fragment: x.name,
          kind: kind === "topic" ? ("event" as const) : ("function" as const),
          source: "sourcify-4byte" as const,
          filtered: !!x.filtered,
          hasVerifiedContract: !!x.hasVerifiedContract,
          hashMatches: hashMatches(x.name, q),
        })),
    );
  }
  return out;
}

export async function fourByteDirectoryLookup(query: Hex, kind: "selector" | "topic", opts: LookupOptions = {}): Promise<SelectorCandidate[]> {
  let url = templates().fourbyte.replace("{selector}", query);
  if (kind === "topic") url = url.replace("/signatures/", "/event-signatures/");
  const r = await httpJson<any>(url, { fetch: opts.fetch, label: "4byte.directory" });
  if (r.status !== 200 || !Array.isArray(r.body?.results)) throw new UpError("NETWORK_ERROR", `4byte.directory: HTTP ${r.status}`);
  return (r.body.results as { text_signature?: string }[])
    .filter((x) => typeof x?.text_signature === "string")
    .map((x) => ({ signature: x.text_signature!, fragment: x.text_signature!, kind: kind === "topic" ? ("event" as const) : ("function" as const), source: "4byte.directory" as const, hashMatches: hashMatches(x.text_signature!, query) }));
}

/** Ranks remote candidates: hash-verified, not spam-filtered, seen in a verified contract first. */
export function rankCandidates(list: SelectorCandidate[]): SelectorCandidate[] {
  const score = (c: SelectorCandidate) => (c.source === "bundled" ? 0 : 10) + (c.hashMatches ? 0 : 100) + (c.filtered ? 5 : 0) + (c.hasVerifiedContract ? 0 : 1);
  return list.map((c, i) => ({ c, i })).sort((a, b) => score(a.c) - score(b.c) || a.i - b.i).map((x) => x.c);
}

export async function lookupSelector(q: string, opts: LookupOptions = {}): Promise<SelectorLookup> {
  const { query, kind } = normalizeQuery(q);
  const res: SelectorLookup = { query, kind, trust: "unknown", candidates: [], sources: [], warnings: [] };
  const bundled = bundledCandidates(query);
  res.sources.push({ source: "bundled", outcome: bundled.length ? `${bundled.length} match(es)` : "no match" });
  res.candidates.push(...bundled);
  if (bundled.length && !opts.allSources) {
    res.trust = "bundled";
    return finish(res);
  }
  if (opts.offline) {
    res.warnings.push("offline: remote selector databases were not queried");
    return finish(res);
  }
  let remoteHit = false;
  try {
    const m = await sourcifyLookup([query], kind, opts);
    const list = m.get(query) ?? [];
    res.sources.push({ source: "sourcify-4byte", outcome: list.length ? `${list.length} candidate(s)` : "no match" });
    res.candidates.push(...list);
    remoteHit = list.length > 0;
  } catch (e) {
    res.sources.push({ source: "sourcify-4byte", outcome: `error: ${(e as Error).message}` });
  }
  if (!remoteHit || opts.allSources) {
    try {
      const list = await fourByteDirectoryLookup(query, kind, opts);
      res.sources.push({ source: "4byte.directory", outcome: list.length ? `${list.length} candidate(s)` : "no match" });
      // merge duplicates across databases
      for (const c of list) if (!res.candidates.some((x) => x.signature === c.signature)) res.candidates.push(c);
    } catch (e) {
      res.sources.push({ source: "4byte.directory", outcome: `error: ${(e as Error).message}` });
    }
  }
  return finish(res);
}

function finish(res: SelectorLookup): SelectorLookup {
  res.candidates = rankCandidates(res.candidates);
  if (res.trust === "unknown" && res.candidates.some((c) => c.source === "bundled")) res.trust = "bundled";
  else if (res.trust === "unknown" && res.candidates.length) res.trust = "guessed";
  const remote = res.candidates.filter((c) => c.source !== "bundled");
  if (remote.length) res.warnings.push("remote selector-database matches are guesses (one-way hash, collision-prone, user-submitted): never sign a value-moving call on that basis");
  const verified = res.candidates.filter((c) => c.hashMatches);
  if (new Set(verified.map((c) => c.signature)).size > 1) res.warnings.push(`selector collision: ${new Set(verified.map((c) => c.signature)).size} different signatures hash to ${res.query}`);
  if (res.candidates.some((c) => !c.hashMatches)) res.warnings.push("some database entries do not hash to the queried value and were ranked last");
  return res;
}
