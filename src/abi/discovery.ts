// ABI discovery with the trust ladder — generic over every chain in the registry:
//   rung 1  bundled + pinned: canonical registry address (contracts.json / protocols.json)
//           with code present, or an ERC-1167 clone of such an implementation (UP/KM clones)
//   rung 2  source-verified exact: Sourcify v2 exact_match (chains with registry `sourcify`),
//           Blockscout v2 is_fully_verified (every blockscout-family explorer of the chain, keyless)
//   rung 3  partial: Sourcify "match", Blockscout is_verified, Etherscan V2 multichain getabi
//           (needs config.explorerKeys.etherscan), Routescan (etherscan-compatible, keyless)
//   (onchain) ERC-165 detection of a standard (LSP0/6/7/8/9/26, ERC-721/1155) or ERC-20
//           heuristics → the bundled standard-interface ABI, labelled `onchain`
//   rung 4  proxy-resolved: EIP-1967/beacon/ERC-1167/ERC-1822 or explorer `implementations`
//           → the implementation's ABI (via the same ladder) merged with the proxy's; LSP17
//           extension functions of ERC725 accounts are merged too
//   rung 5  guessed: dispatcher selectors from bytecode looked up in the bundled index, then
//           the Sourcify 4byte database — never enough to sign a value-moving call
// The explorer family and API base come from chains.json per chain; on `unsupported_chain`
// / 404 the next source is tried; 429s back off (http.ts). Results are cached under
// $UP_HOME/cache/abi/<chainId>/<address>.json with the trust label, source, fetchedAt and the
// runtime code hash (a code change invalidates the entry). Proxies are re-resolved every time.
// Everything fetched is data: ABIs are parsed and validated, never interpreted as instructions.
import { getAddress, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import type { ChainInfo, TrustLabel, UpConfig, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { assetJson } from "../core/assets.ts";
import { paths, readJson, writeJson } from "../core/home.ts";
import { bundledAbi, bundledIndexes, canonicalContracts, findBundled, type CanonicalContract } from "./bundled.ts";
import { codeHash, getCode } from "./read.ts";
import { codeHashMatches } from "./codehashes.ts";
import { detectStandards, type Detection, type Standard } from "./detect.ts";
import { dispatcherSelectors, lsp17Extensions, resolveProxy, WELL_KNOWN_EXTENSION_SELECTORS, type Lsp17Extension, type ProxyInfo } from "./proxy.ts";
import { httpJson, type FetchLike } from "./http.ts";
import { canonicalSignature, selectorOf } from "./signature.ts";
import { parseFragments } from "./codec.ts";
import { sourcifyLookup, type SelectorCandidate } from "./selectors.ts";

/** Trust labels sufficient for value-moving calls without a human approval (rung ≤ 4 with a verified implementation). */
export const SIGNABLE_TRUST: ReadonlySet<TrustLabel> = new Set<TrustLabel>(["bundled", "onchain", "exact", "partial", "proxy"]);

export const TRUST_RUNG: Record<TrustLabel, number> = {
  bundled: 1,
  onchain: 1,
  exact: 2,
  partial: 3,
  proxy: 4,
  user: 5,
  "remote-unpinned": 5,
  "remote-discovered": 5,
  guessed: 5,
};

export function isSignableTrust(t: TrustLabel | undefined): boolean {
  return !!t && SIGNABLE_TRUST.has(t);
}

export type ExplorerKind = "sourcify" | "blockscout" | "etherscan" | "routescan";

export interface ExplorerSource {
  kind: ExplorerKind;
  /** Printable label, e.g. "blockscout:explorer.execution.mainnet.lukso.network". */
  label: string;
  /** URL template without any key: {address} placeholder. */
  url: string;
}

export interface ExplorerPlan {
  chainId: number;
  sources: ExplorerSource[];
  skipped: { kind: ExplorerKind; reason: string }[];
}

function templates(): Record<string, string> {
  return assetJson<any>("registry", "sources.json").abiDiscovery;
}

/**
 * Per-chain explorer plan, from the registry entry only (never hard-coded per chain):
 * Sourcify (if the chain is Sourcify-supported) → every Blockscout instance → Etherscan V2
 * (if a key is configured) → Routescan.
 */
export function explorerPlan(chain: ChainInfo | undefined, cfg: Pick<UpConfig, "explorerKeys">, chainIdArg?: number): ExplorerPlan {
  const chainId = chain?.chainId ?? chainIdArg ?? 0;
  const t = templates();
  const plan: ExplorerPlan = { chainId, sources: [], skipped: [] };
  if (!chain) {
    plan.skipped.push({ kind: "sourcify", reason: "chain not in the registry" });
    return plan;
  }
  if (chain.sourcify) plan.sources.push({ kind: "sourcify", label: "sourcify", url: t.sourcify.replace("{chainId}", String(chainId)) });
  else plan.skipped.push({ kind: "sourcify", reason: "chain not supported by Sourcify (registry)" });
  const seen = new Set<string>();
  for (const e of chain.explorers.filter((x) => x.family === "blockscout")) {
    const base = (e.apiBase ? e.apiBase.replace(/\/api\/?$/, "") : e.url).replace(/\/+$/, "");
    if (seen.has(base)) continue;
    seen.add(base);
    plan.sources.push({ kind: "blockscout", label: `blockscout:${new URL(base).host}`, url: t.blockscout.replace("{explorer}", base) });
  }
  const es = chain.explorers.find((x) => x.family === "etherscan");
  if (es) {
    if (cfg.explorerKeys?.etherscan) {
      const base = es.apiBase ?? "https://api.etherscan.io/v2/api";
      plan.sources.push({ kind: "etherscan", label: "etherscan-v2", url: `${base}?chainid=${chainId}&module=contract&action=getabi&address={address}` });
    } else plan.skipped.push({ kind: "etherscan", reason: "no Etherscan API key configured (optional: up config set etherscan-key <key>)" });
  }
  if (chain.explorers.some((x) => x.family === "routescan")) {
    const net = chain.testnet ? "testnet" : "mainnet";
    plan.sources.push({ kind: "routescan", label: "routescan", url: `https://api.routescan.io/v2/network/${net}/evm/${chainId}/etherscan/api?module=contract&action=getabi&address={address}` });
  }
  if (plan.sources.length === 0) plan.skipped.push({ kind: "blockscout", reason: "no Sourcify support and no Blockscout/Etherscan/Routescan explorer listed for this chain" });
  return plan;
}

type FetchOutcome =
  | { status: "found"; abi: Abi; trust: "exact" | "partial"; name?: string; implementations: Address[] }
  | { status: "not_found"; implementations: Address[]; detail?: string }
  | { status: "unsupported"; detail: string }
  | { status: "error"; detail: string };

function addrs(list: unknown, field: string): Address[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => (typeof x === "string" ? x : x?.[field]))
    .filter((x): x is string => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x))
    .map((x) => getAddress(x));
}

function parseAbiValue(v: unknown): Abi | undefined {
  try {
    const a = typeof v === "string" ? JSON.parse(v) : v;
    if (Array.isArray(a) && a.every((x) => x && typeof x === "object" && typeof x.type === "string")) return a as Abi;
  } catch {}
  return undefined;
}

export async function fetchFromExplorer(src: ExplorerSource, address: Address, cfg: Pick<UpConfig, "explorerKeys">, fetchImpl?: FetchLike): Promise<FetchOutcome> {
  let url = src.url.replace("{address}", address);
  if (src.kind === "etherscan") url += `&apikey=${encodeURIComponent(cfg.explorerKeys?.etherscan ?? "")}`;
  let r;
  try {
    r = await httpJson<any>(url, { fetch: fetchImpl, label: src.label });
  } catch (e) {
    return { status: "error", detail: (e as Error).message };
  }
  const b = r.body;
  switch (src.kind) {
    case "sourcify": {
      if (r.status === 400 && b?.customCode === "unsupported_chain") return { status: "unsupported", detail: "Sourcify: unsupported_chain" };
      if (r.status === 404) return { status: "not_found", implementations: [] };
      if (r.status !== 200 || !b) return { status: "error", detail: `HTTP ${r.status}` };
      const impls = b.proxyResolution?.isProxy ? addrs(b.proxyResolution?.implementations, "address") : [];
      const abi = parseAbiValue(b.abi);
      if (!abi || !b.match) return { status: "not_found", implementations: impls };
      return { status: "found", abi, trust: b.match === "exact_match" ? "exact" : "partial", implementations: impls };
    }
    case "blockscout": {
      if (r.status === 404) return { status: "not_found", implementations: [] };
      if (r.status !== 200 || !b) return { status: "error", detail: `HTTP ${r.status}` };
      const impls = addrs(b.implementations, "address_hash").concat(addrs(b.implementations, "address"));
      const abi = parseAbiValue(b.abi);
      if (!abi || !(b.is_verified || b.is_fully_verified)) return { status: "not_found", implementations: impls, detail: "not verified" };
      return { status: "found", abi, trust: b.is_fully_verified ? "exact" : "partial", name: typeof b.name === "string" ? b.name : undefined, implementations: impls };
    }
    case "etherscan":
    case "routescan": {
      if (r.status !== 200 || !b) return { status: "error", detail: `HTTP ${r.status}` };
      if (String(b.status) === "1") {
        const abi = parseAbiValue(b.result);
        return abi ? { status: "found", abi, trust: "partial", implementations: [] } : { status: "error", detail: "unparseable ABI" };
      }
      const msg = `${b.message ?? ""} ${typeof b.result === "string" ? b.result : ""}`.trim();
      if (/not verified/i.test(msg)) return { status: "not_found", implementations: [] };
      if (/chain.*not supported|unsupported chain|invalid chainid/i.test(msg)) return { status: "unsupported", detail: msg };
      if (/rate limit/i.test(msg)) return { status: "error", detail: "rate limited" };
      if (/api.?key/i.test(msg)) return { status: "error", detail: "API key missing or invalid" };
      return { status: "error", detail: msg.slice(0, 120) || "unknown error" };
    }
  }
}

// ---------------------------------------------------------------------------
// Records + cache
// ---------------------------------------------------------------------------

export interface Attempt {
  rung: number;
  source: string;
  outcome: string;
}

export interface AbiRecord {
  chainId: number;
  address: Address;
  abi: Abi;
  trust: TrustLabel;
  source: string;
  name?: string;
  fetchedAt: string;
  codeHash?: Hex;
  standards?: Standard[];
  proxy?: ProxyInfo & { implementationTrust?: TrustLabel; implementationSource?: string };
  extensions?: (Lsp17Extension & { signature?: string; source: string; unverified?: boolean })[];
  /** rung-5 candidates per selector (all shown, best first) */
  guesses?: Record<string, SelectorCandidate[]>;
  attempts: Attempt[];
  notes: string[];
  cached?: boolean;
  /** the address is canonical but its code differs from the pinned deployments */
  canonicalMismatch?: boolean;
}

export interface DiscoveryOptions {
  offline?: boolean;
  refresh?: boolean;
  fetch?: FetchLike;
  /** extra selectors to probe for LSP17 extensions */
  extensionSelectors?: Hex[];
}

const TTL_MS: Partial<Record<TrustLabel, number>> = {
  bundled: 30 * 86400_000,
  onchain: 30 * 86400_000,
  exact: 7 * 86400_000,
  partial: 7 * 86400_000,
  guessed: 86400_000,
};

export function abiCacheFile(home: string, chainId: number, address: Address): string {
  return paths.cache(home, "abi", String(chainId), `${address.toLowerCase()}.json`);
}

/** Merges ABIs: items keyed by type + canonical signature (first wins); constructors/fallbacks only from the first. */
export function mergeAbis(...abis: Abi[]): Abi {
  const out: Abi[number][] = [];
  const seen = new Set<string>();
  abis.forEach((abi, n) => {
    for (const item of abi) {
      if (n > 0 && (item.type === "constructor" || item.type === "fallback" || item.type === "receive")) continue;
      const key = item.type === "function" || item.type === "event" || item.type === "error" ? `${item.type}:${canonicalSignature(item)}` : item.type;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  });
  return out as Abi;
}

const STANDARD_ABI: Record<Standard, string> = {
  LSP0: "UniversalProfile",
  LSP6: "LSP6KeyManager",
  LSP7: "LSP7DigitalAsset",
  LSP8: "LSP8IdentifiableDigitalAsset",
  LSP9: "LSP9Vault",
  LSP26: "LSP26FollowerSystem",
  ERC20: "ERC20",
  ERC721: "ERC721",
  ERC1155: "ERC1155",
};

export function standardAbi(std: Standard): Abi {
  return bundledAbi(STANDARD_ABI[std]);
}

/**
 * Whether a canonical address can be trusted on this chain:
 *  - a pinned runtime code hash must match when one exists (codehashes.ts);
 *  - otherwise protocols.json entries must be recorded for the chain;
 *  - otherwise contracts.json (CREATE2) entries must be listed for the chain in
 *    chains.json `lsp.versions` (the registry is a seed: unlisted deployments simply
 *    fall through to the rest of the ladder).
 */
export function canonicalTrusted(ctx: Pick<VerbContext, "registry">, canon: CanonicalContract, chainId: number, hash: Hex | undefined): { ok: true; pinned: boolean } | { ok: false; reason: string } {
  if (!hash) return { ok: false, reason: "no code" };
  const pinned = codeHashMatches(canon.address, hash);
  if (pinned === false) return { ok: false, reason: `code at the canonical ${canon.name} address does not match its known deployments (hash ${hash})` };
  if (pinned === true) return { ok: true, pinned: true };
  if (canon.origin === "protocols.json") {
    return canon.chains?.includes(chainId) ? { ok: true, pinned: false } : { ok: false, reason: `${canon.name} is not recorded on chain ${chainId} in the bundled registry and has no pinned code hash` };
  }
  let versions: string[] | undefined;
  try {
    versions = ctx.registry.chain(chainId).lsp?.versions?.[canon.name];
  } catch {}
  // singletons are listed under varying labels ("singleton" or a release version) → any entry counts
  const listed = canon.version ? !!versions?.includes(canon.version) : !!versions?.length;
  return listed ? { ok: true, pinned: false } : { ok: false, reason: `the chain registry does not list ${canon.name}${canon.version ? ` ${canon.version}` : ""} on chain ${chainId}` };
}

function canonicalAbi(c: CanonicalContract): Abi | undefined {
  return c.abiName ? bundledAbi(c.abiName) : undefined;
}

type Ctx = Pick<VerbContext, "rpc" | "home" | "config" | "registry">;

/** Discovers the ABI of a contract following the trust ladder (see file header). */
export async function discoverAbi(ctx: Ctx, chainId: number, address: Address, opts: DiscoveryOptions = {}): Promise<AbiRecord> {
  return discover(ctx, chainId, getAddress(address), opts, 0);
}

async function discover(ctx: Ctx, chainId: number, address: Address, opts: DiscoveryOptions, depth: number): Promise<AbiRecord> {
  const code = await getCode(ctx, chainId, address);
  if (code === "0x") {
    throw new UpError("ABI_NOT_FOUND", `no contract code at ${address} on chain ${chainId}`, { hint: "an EOA has no ABI; check the address and --chain (the contract may not be deployed on this chain)" });
  }
  const hash = codeHash(code)!;
  const file = abiCacheFile(ctx.home, chainId, address);
  if (!opts.refresh) {
    const cached = await readJson<AbiRecord | undefined>(file, undefined);
    const ttl = cached ? TTL_MS[cached.trust] ?? 86400_000 : 0;
    // Not served from cache: upgradeable proxies (implementation may change) and ERC725
    // accounts (LSP17 extensions may change). ERC-1167 clones are immutable (code hash covers them).
    const mutable = (cached?.proxy?.isProxy && cached.proxy.kind !== "erc1167") || cached?.standards?.some((s) => s === "LSP0" || s === "LSP9") || !!cached?.extensions?.length;
    if (cached && cached.codeHash === hash && !mutable && Date.now() - Date.parse(cached.fetchedAt) < ttl && Array.isArray(cached.abi)) {
      return { ...cached, cached: true };
    }
  }

  const rec: AbiRecord = { chainId, address, abi: [], trust: "guessed", source: "", fetchedAt: new Date().toISOString(), codeHash: hash, attempts: [], notes: [] };
  let found = false;
  const cfg = await ctx.config();

  // rung 1: canonical registry address
  const canon = canonicalContracts().get(address.toLowerCase());
  const canonAbi = canon ? canonicalAbi(canon) : undefined;
  if (canon && canonAbi) {
    const t = canonicalTrusted(ctx, canon, chainId, hash);
    if (t.ok) {
      rec.abi = canonAbi;
      rec.trust = "bundled";
      rec.source = `bundled:${canon.abiName}`;
      rec.name = canon.name + (canon.version ? `@${canon.version}` : "");
      rec.notes.push(`canonical ${canon.origin} address with code present on chain ${chainId}${t.pinned ? " (runtime code hash matches the known deployment)" : ""}`);
      rec.attempts.push({ rung: 1, source: "registry", outcome: `matched ${rec.name}` });
      found = true;
    } else {
      if (codeHashMatches(address, hash) === false) rec.canonicalMismatch = true;
      rec.notes.push(`${t.reason}; not treated as bundled`);
      rec.attempts.push({ rung: 1, source: "registry", outcome: `canonical address not trusted here: ${t.reason}` });
    }
  } else rec.attempts.push({ rung: 1, source: "registry", outcome: canon ? `registry entry ${canon.name} has no bundled ABI` : "not a canonical address" });

  // proxy facts (RPC only)
  const proxy = await resolveProxy(ctx, chainId, address, code);
  if (!found && proxy.kind === "erc1167" && proxy.implementation) {
    const implCanon = canonicalContracts().get(proxy.implementation.toLowerCase());
    const implAbi = implCanon ? canonicalAbi(implCanon) : undefined;
    const implCode = implCanon && implAbi ? await getCode(ctx, chainId, proxy.implementation) : "0x";
    const implTrust = implCanon && implAbi ? canonicalTrusted(ctx, implCanon, chainId, codeHash(implCode)) : undefined;
    if (implCanon && implAbi && implCode === "0x") {
      rec.notes.push(`ERC-1167 clone of ${implCanon.name}, but the implementation has no code on chain ${chainId}: every call will fail`);
    } else if (implTrust && !implTrust.ok) {
      rec.notes.push(`ERC-1167 clone of the ${implCanon!.name} address, but ${implTrust.reason}; not treated as bundled`);
    } else if (implCanon && implAbi) {
      rec.abi = implAbi;
      rec.trust = "bundled";
      rec.source = `bundled:${implCanon.abiName}`;
      rec.name = `${implCanon.name}${implCanon.version ? `@${implCanon.version}` : ""} (ERC-1167 clone)`;
      rec.proxy = { ...proxy, implementationTrust: "bundled", implementationSource: rec.source };
      rec.notes.push(`ERC-1167 minimal proxy of the canonical ${implCanon.name}${implCanon.version ? ` v${implCanon.version}` : ""} implementation`);
      rec.attempts.push({ rung: 1, source: "erc1167", outcome: `clone of ${implCanon.name}` });
      found = true;
    }
  }

  // rungs 2/3: explorers chosen per chain from the registry
  const explorerImpls: Address[] = [];
  if (!found) {
    let chain: ChainInfo | undefined;
    try {
      chain = ctx.registry.chain(chainId);
    } catch {}
    const plan = explorerPlan(chain, cfg, chainId);
    for (const s of plan.skipped) rec.attempts.push({ rung: 2, source: s.kind, outcome: `skipped: ${s.reason}` });
    if (opts.offline) {
      if (plan.sources.length) rec.attempts.push({ rung: 2, source: "explorers", outcome: "skipped: offline" });
    } else {
      let partial: { abi: Abi; src: ExplorerSource; name?: string } | undefined;
      for (const src of plan.sources) {
        const r = await fetchFromExplorer(src, address, cfg, opts.fetch);
        if ("implementations" in r) explorerImpls.push(...r.implementations);
        if (r.status === "found") {
          rec.attempts.push({ rung: r.trust === "exact" ? 2 : 3, source: src.label, outcome: `${r.trust} match` });
          if (r.trust === "exact") {
            rec.abi = r.abi;
            rec.trust = "exact";
            rec.source = src.label;
            rec.name = r.name;
            found = true;
            break;
          }
          partial ??= { abi: r.abi, src, name: r.name };
        } else rec.attempts.push({ rung: 2, source: src.label, outcome: r.status === "not_found" ? `not verified${r.implementations.length ? " (reports a proxy implementation)" : ""}` : `${r.status}: ${r.detail}` });
      }
      if (!found && partial) {
        rec.abi = partial.abi;
        rec.trust = "partial";
        rec.source = partial.src.label;
        rec.name = partial.name;
        rec.notes.push("partial/explorer verification: the ABI matches verified source, but not byte-for-byte metadata");
        found = true;
      }
    }
  }

  // standard detection (ERC-165 / ERC-20 heuristics): used as ABI when nothing better was found
  let det: Detection | undefined;
  try {
    det = await detectStandards(ctx, chainId, address, code);
    rec.standards = det.standards;
  } catch (e) {
    rec.notes.push(`standard detection failed: ${(e as Error).message}`);
  }
  if (!found && det?.primary) {
    rec.abi = mergeAbis(...det.standards.map(standardAbi));
    rec.trust = "onchain";
    rec.source = `erc165:${det.standards.join("+")}`;
    rec.name = `${det.primary} (standard interface)`;
    rec.notes.push(`ABI = bundled standard interface(s) confirmed on-chain via ${det.primary === "ERC20" ? "ERC-20 probes" : "ERC-165"}; contract-specific extra functions are not included`);
    rec.attempts.push({ rung: 1, source: "erc165", outcome: `standard ${det.standards.join(", ")}` });
    found = true;
  }

  // rung 4: proxies (slots or explorer hints) → implementation ABI via the same ladder
  let effective = proxy;
  if (!effective.isProxy && explorerImpls.length) {
    effective = { isProxy: true, kind: "explorer", implementation: explorerImpls[0], evidence: ["explorer reports implementation(s)"] };
  }
  if (effective.isProxy && effective.implementation && !(rec.proxy && rec.proxy.implementationTrust === "bundled")) {
    if (depth >= 2) {
      rec.proxy = { ...effective };
      rec.notes.push(`nested proxy at depth ${depth}: implementation ${effective.implementation} not resolved (only this contract's own ABI is included)`);
    }
    else {
      try {
        const impl = await discover(ctx, chainId, effective.implementation, opts, depth + 1);
        rec.proxy = { ...effective, implementationTrust: impl.trust, implementationSource: impl.source };
        rec.abi = mergeAbis(rec.abi, impl.abi);
        rec.attempts.push({ rung: 4, source: effective.kind ?? "proxy", outcome: `implementation ${effective.implementation}: ${impl.trust} via ${impl.source}` });
        if (impl.guesses) rec.guesses = { ...rec.guesses, ...impl.guesses };
        if (effective.kind === "explorer") {
          // the delegation itself was not verified on-chain (no EIP-1967/1822 slot, not ERC-1167)
          rec.trust = "remote-unpinned";
          rec.source = `explorer-reported implementation → ${impl.source}`;
          rec.notes.push(`proxy relationship reported only by an explorer (not verifiable from storage slots or bytecode); merged ABI labelled remote-unpinned`);
        } else if (isSignableTrust(impl.trust)) {
          rec.trust = "proxy";
          rec.source = `proxy(${effective.kind}) → ${impl.source}`;
          rec.name ??= impl.name;
        } else {
          rec.trust = impl.trust;
          rec.source = `proxy(${effective.kind}) → ${impl.source}`;
        }
        found = true;
      } catch (e) {
        rec.proxy = { ...effective };
        rec.notes.push(`proxy implementation ${effective.implementation} could not be resolved: ${(e as Error).message}`);
      }
    }
  } else if (effective.isProxy && !rec.proxy) rec.proxy = { ...effective };

  // LSP17 extensions of ERC725 accounts (UPs, vaults)
  if (det && (det.interfaces.LSP17Extendable || det.interfaces.LSP0ERC725Account || det.interfaces.LSP9Vault)) {
    const sels = [...WELL_KNOWN_EXTENSION_SELECTORS.map((x) => x.selector), ...(opts.extensionSelectors ?? [])];
    try {
      const exts = await lsp17Extensions(ctx, chainId, address, sels);
      if (exts.length) {
        rec.extensions = [];
        const extra: AbiFunction[] = [];
        for (const x of exts) {
          const fn = await extensionFunction(ctx, chainId, x, opts, depth);
          rec.extensions.push({ ...x, signature: fn?.fn ? canonicalSignature(fn.fn) : undefined, source: fn?.source ?? "unknown", ...(fn?.verified ? {} : { unverified: true }) });
          // only verified extension ABIs join the account ABI; guesses stay listed in `extensions`
          if (fn?.fn && fn.verified) extra.push(fn.fn);
        }
        rec.abi = mergeAbis(rec.abi, extra as Abi);
        rec.notes.push(`${exts.length} LSP17 extension(s) registered; their functions are callable on the account`);
      }
      rec.attempts.push({ rung: 4, source: "lsp17", outcome: `${exts.length} extension(s) among ${sels.length} probed selectors` });
    } catch (e) {
      rec.notes.push(`LSP17 extension lookup failed: ${(e as Error).message}`);
    }
  }

  // rung 5: selector guesses from the dispatcher
  if (!found) {
    const target = effective.implementation ? await getCode(ctx, chainId, effective.implementation).catch(() => code) : code;
    const guessed = await guessAbi(dispatcherSelectors(target), opts);
    rec.abi = guessed.abi;
    rec.guesses = guessed.guesses;
    rec.trust = "guessed";
    rec.source = "selector-db";
    rec.attempts.push({ rung: 5, source: "selector-db", outcome: `${Object.keys(guessed.guesses).length} selectors in bytecode, ${guessed.abi.length} named (${guessed.unknown} unknown)` });
    rec.notes.push("no verified ABI: function names are GUESSES from selector databases (collision-prone); never sign value-moving calls on this basis without human approval");
    if (guessed.abi.length === 0 && Object.keys(guessed.guesses).length === 0) {
      throw Object.assign(new UpError("ABI_NOT_FOUND", `no ABI found for ${address} on chain ${chainId}`, { hint: "pass an ABI explicitly with --abi (JSON file, bundled name or function signature)", details: { attempts: rec.attempts } }), { record: rec });
    }
  }

  await writeJson(file, rec).catch(() => {});
  return rec;
}

async function extensionFunction(ctx: Ctx, chainId: number, x: Lsp17Extension, opts: DiscoveryOptions, depth: number): Promise<{ fn?: AbiFunction; source: string; verified: boolean } | undefined> {
  const fromAbi = (abi: Abi) => abi.find((i): i is AbiFunction => i.type === "function" && selectorOf(i) === x.selector);
  const canon = canonicalContracts().get(x.extension.toLowerCase());
  if (canon?.abiName) {
    const extCode = await getCode(ctx, chainId, x.extension).catch(() => "0x" as Hex);
    const t = canonicalTrusted(ctx, canon, chainId, codeHash(extCode));
    const fn = fromAbi(bundledAbi(canon.abiName));
    if (fn && t.ok) return { fn, source: `bundled:${canon.abiName}`, verified: true };
  }
  if (depth < 1) {
    try {
      const r = await discover(ctx, chainId, x.extension, { ...opts, extensionSelectors: [] }, depth + 1);
      const fn = fromAbi(r.abi);
      if (fn) return { fn, source: `${r.trust}:${r.source}`, verified: isSignableTrust(r.trust) };
    } catch {}
  }
  const b = bundledIndexes().functions.get(x.selector)?.[0];
  if (b) return { fn: b.item, source: "bundled-selector (guessed)", verified: false };
  const known = WELL_KNOWN_EXTENSION_SELECTORS.find((w) => w.selector === x.selector);
  if (known) return { fn: parseFragments(known.signature)[0] as AbiFunction, source: "well-known selector (guessed)", verified: false };
  return { source: "unknown", verified: false };
}

/** Builds a guessed ABI from dispatcher selectors: bundled index first, then one batched Sourcify 4byte request. */
export async function guessAbi(selectors: Hex[], opts: DiscoveryOptions = {}): Promise<{ abi: Abi; guesses: Record<string, SelectorCandidate[]>; unknown: number }> {
  const idx = bundledIndexes();
  const guesses: Record<string, SelectorCandidate[]> = {};
  const fns: AbiFunction[] = [];
  const remote: Hex[] = [];
  for (const s of selectors) {
    const b = idx.functions.get(s);
    if (b?.length) {
      guesses[s] = b.map((x) => ({ signature: x.signature, fragment: x.signature, kind: "function" as const, source: "bundled" as const, contracts: [...x.contracts], hashMatches: true }));
      fns.push(b[0].item);
    } else remote.push(s);
  }
  if (remote.length && !opts.offline) {
    for (let i = 0; i < remote.length; i += 50) {
      const chunk = remote.slice(i, i + 50);
      try {
        const m = await sourcifyLookup(chunk, "selector", { fetch: opts.fetch });
        for (const s of chunk) {
          const list = (m.get(s) ?? []).filter((c) => c.hashMatches).sort((a, b) => Number(!!a.filtered) - Number(!!b.filtered) || Number(!b.hasVerifiedContract) - Number(!a.hasVerifiedContract));
          if (list.length) {
            guesses[s] = list;
            try {
              const parsed = parseFragments(list[0].signature)[0];
              if (parsed?.type === "function") fns.push(parsed);
            } catch {}
          } else guesses[s] = [];
        }
      } catch {
        for (const s of chunk) guesses[s] ??= [];
      }
    }
  } else for (const s of remote) guesses[s] = [];
  return { abi: fns as Abi, guesses, unknown: Object.values(guesses).filter((g) => g.length === 0).length };
}

/** Helper for verbs: bundled ABI for a well-known name, or discovery for an address. */
export function isBundledName(s: string): boolean {
  return !!findBundled(s);
}
