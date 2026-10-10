// Self-healing RPC discovery and remote registry refresh.
//  - findRpcs(chainId): fetch chainlist.org/rpcs.json (+ chainid.network as
//    fallback), probe candidates (eth_chainId must match, fresh head), store the
//    working ones in $UP_HOME/cache/rpc/<chainId>.json (trust: remote-discovered).
//  - refreshRegistry(): fetch lsp-smart-contracts deployments/ from main, diff
//    against the bundled mirror, store an overlay; never overwrite the seed.
import type { ChainInfo, RpcEndpoint, RpcHealth } from "../core/types.ts";
import { assetJson } from "../core/assets.ts";
import { paths, readJson, writeJson } from "../core/home.ts";
import { UpError } from "../core/errors.ts";
import { rawRpc } from "./rpc.ts";

interface ChainlistEntry {
  chainId: number;
  name: string;
  chain?: string;
  nativeCurrency?: { symbol: string; decimals: number };
  rpc: (string | { url: string; tracking?: string })[];
  explorers?: { name?: string; url: string; standard?: string }[];
  testnet?: boolean;
  shortName?: string;
}

const TEMPLATE = /\$\{|\{[A-Z_]+\}|API_KEY|INFURA|ALCHEMY/i;

async function fetchJson(url: string, timeoutMs = 20000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "universal-profile-skill" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchChainLists(): Promise<{ entries: ChainlistEntry[]; sources: string[] }> {
  const sources = assetJson<{ rpcLists: { name: string; url: string }[] }>("registry", "sources.json").rpcLists;
  const entries: ChainlistEntry[] = [];
  const used: string[] = [];
  for (const s of sources) {
    try {
      const data = await fetchJson(s.url);
      if (Array.isArray(data)) {
        entries.push(...data);
        used.push(s.url);
      }
    } catch {
      /* try next list */
    }
  }
  if (entries.length === 0) throw new UpError("NETWORK_ERROR", "could not fetch any public RPC list (chainlist.org, chainid.network)", { hint: "check internet access, or add an RPC yourself: up chains rpc set <chainId> <url>" });
  return { entries, sources: used };
}

export async function probe(url: string, chainId: number): Promise<RpcHealth> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const id = Number(BigInt(await rawRpc(url, "eth_chainId", [], 8000)));
    if (id !== chainId) return { url, ok: false, chainIdMatches: false, error: `eth_chainId returned ${id}`, checkedAt };
    const block = await rawRpc(url, "eth_getBlockByNumber", ["latest", false], 8000);
    const age = Math.round(Date.now() / 1000 - Number(BigInt(block?.timestamp ?? "0x0")));
    return { url, ok: age < 3600, chainIdMatches: true, blockNumber: BigInt(block?.number ?? "0x0").toString(), blockAgeSec: age, latencyMs: Date.now() - started, checkedAt, error: age < 3600 ? undefined : `stale head (${age}s)` };
  } catch (e: any) {
    return { url, ok: false, error: String(e?.message ?? e), latencyMs: Date.now() - started, checkedAt };
  }
}

export async function findRpcs(home: string, chainId: number, opts: { max?: number } = {}): Promise<{ working: RpcEndpoint[]; checked: RpcHealth[]; entry?: ChainlistEntry; sources: string[] }> {
  const { entries, sources } = await fetchChainLists();
  const matches = entries.filter((e) => e.chainId === chainId);
  const candidates: { url: string; tracking: string; source: RpcEndpoint["source"] }[] = [];
  const seen = new Set<string>();
  for (const e of matches) {
    for (const r of e.rpc) {
      const url = (typeof r === "string" ? r : r.url).replace(/\/+$/, "");
      const tracking = typeof r === "string" ? "unspecified" : (r.tracking ?? "unspecified");
      if (!/^https:\/\//.test(url) || TEMPLATE.test(url) || seen.has(url)) continue;
      seen.add(url);
      candidates.push({ url, tracking, source: "discovered" });
    }
  }
  const rank: Record<string, number> = { none: 0, limited: 1, unspecified: 2, yes: 3 };
  candidates.sort((a, b) => (rank[a.tracking] ?? 2) - (rank[b.tracking] ?? 2));
  const checked: RpcHealth[] = [];
  const limit = Math.min(candidates.length, 16);
  for (let i = 0; i < limit; i += 4) {
    checked.push(...(await Promise.all(candidates.slice(i, i + 4).map((c) => probe(c.url, chainId)))));
  }
  const working = checked
    .filter((h) => h.ok)
    .sort((a, b) => (a.latencyMs ?? 9e9) - (b.latencyMs ?? 9e9))
    .slice(0, opts.max ?? 5)
    .map((h) => ({ url: h.url, source: "discovered" as const, tracking: (candidates.find((c) => c.url === h.url)?.tracking ?? "unspecified") as RpcEndpoint["tracking"], trust: "remote-discovered" as const }));
  await writeJson(paths.cache(home, "rpc", `${chainId}.json`), { chainId, discoveredAt: new Date().toISOString(), sources, endpoints: working });
  return { working, checked, entry: matches[0], sources };
}

/** Adds a chain that is not in the bundled registry (metadata from chainlist) to the local overlay. */
export async function addChain(home: string, chainId: number): Promise<ChainInfo> {
  const { working, entry, sources } = await findRpcs(home, chainId);
  if (!entry) throw new UpError("CHAIN_UNKNOWN", `chain ${chainId} is not listed on chainlist.org / chainid.network`, { hint: "add an RPC manually: up chains rpc set <chainId> <url>" });
  const info: ChainInfo = {
    chainId,
    name: entry.name,
    slug: (entry.shortName ?? entry.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    nativeSymbol: entry.nativeCurrency?.symbol ?? "ETH",
    testnet: Boolean(entry.testnet) || /test|sepolia|goerli|holesky|hoodi|amoy/i.test(entry.name),
    rpcs: working,
    explorers: (entry.explorers ?? []).map((x) => ({ url: x.url.replace(/\/+$/, ""), family: x.standard === "EIP3091" && /blockscout/i.test(x.url) ? "blockscout" : "other" })),
    lsp: { deployed: false, versions: {}, notes: [`added from ${sources.join(", ")}; LSP base contracts not in the LUKSO registry — check code with: up chains verify ${chainId}`] },
    relayers: [],
  };
  const overlayFile = paths.cache(home, "registry", "overlay.json");
  const overlay = await readJson<{ chains: ChainInfo[] }>(overlayFile, { chains: [] });
  overlay.chains = [...(overlay.chains ?? []).filter((c) => c.chainId !== chainId), info];
  await writeJson(overlayFile, { ...overlay, updatedAt: new Date().toISOString() });
  return info;
}

/** Fetches the live lsp-smart-contracts deployment lists and diffs them against the bundled mirror. */
export async function refreshRegistry(home: string): Promise<{ newChains: { chainId: number; name: string }[]; removed: number[]; changedRpc: { chainId: number; from: string; to: string }[]; changedExplorers: number[]; source: string }> {
  const src = assetJson<any>("registry", "sources.json").lspDeployments.raw;
  const [mainnet, testnet] = await Promise.all([fetchJson(src.chainsMainnet), fetchJson(src.chainsTestnet)]);
  const live: any[] = [...mainnet.map((c: any) => ({ ...c, testnet: false })), ...testnet.map((c: any) => ({ ...c, testnet: true }))];
  const bundled = assetJson<{ chains: ChainInfo[] }>("registry", "chains.json").chains;
  const byId = new Map(bundled.map((c) => [c.chainId, c]));
  const newChains = live.filter((c) => !byId.has(c.chainId)).map((c) => ({ chainId: c.chainId, name: c.name }));
  const liveIds = new Set(live.map((c) => c.chainId));
  const removed = bundled.filter((c) => !liveIds.has(c.chainId)).map((c) => c.chainId);
  const changedRpc: { chainId: number; from: string; to: string }[] = [];
  const changedExplorers: number[] = [];
  const overlayChains: ChainInfo[] = [];
  for (const c of live) {
    const b = byId.get(c.chainId);
    const lspRpc = b?.rpcs.find((r) => r.source === "lsp-repo")?.url;
    if (b && lspRpc && c.rpcUrl && lspRpc !== c.rpcUrl.replace(/\/+$/, "")) changedRpc.push({ chainId: c.chainId, from: lspRpc, to: c.rpcUrl });
    if (b && JSON.stringify(b.explorers.map((e) => e.url)) !== JSON.stringify((c.explorers ?? []).map((e: any) => e.url.replace(/\/+$/, "")))) changedExplorers.push(c.chainId);
    if (!b || (lspRpc && c.rpcUrl && lspRpc !== c.rpcUrl.replace(/\/+$/, ""))) {
      overlayChains.push({
        chainId: c.chainId,
        name: c.name,
        slug: c.slug,
        nativeSymbol: c.currencySymbol,
        testnet: c.testnet,
        rpcs: [{ url: c.rpcUrl.replace(/\/+$/, ""), source: "lsp-repo", tracking: "unspecified", trust: "remote-unpinned" }],
        explorers: (c.explorers ?? []).map((e: any) => ({ url: e.url.replace(/\/+$/, ""), family: ["blockscout", "etherscan", "routescan"].includes(e.category) ? e.category : "other", apiBase: e.category === "blockscout" ? `${e.url.replace(/\/+$/, "")}/api` : undefined })),
        bridges: c.bridges ?? [],
        lsp: { deployed: true, versions: {}, notes: ["from remote lsp-smart-contracts main (remote-unpinned); verify code with up chains verify"] },
        relayers: [],
      });
    }
  }
  const overlayFile = paths.cache(home, "registry", "overlay.json");
  const overlay = await readJson<{ chains: ChainInfo[] }>(overlayFile, { chains: [] });
  const merged = [...(overlay.chains ?? []).filter((c) => !overlayChains.some((o) => o.chainId === c.chainId)), ...overlayChains];
  await writeJson(overlayFile, { chains: merged, updatedAt: new Date().toISOString(), source: src.chainsMainnet });
  return { newChains, removed, changedRpc, changedExplorers, source: src.chainsMainnet };
}
