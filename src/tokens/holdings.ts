// Asset discovery for an address ("what does this profile hold?").
// On-chain truth first, indexers as freshness-labelled hints:
//   lsp5       LSP5ReceivedAssets[] + LSP5ReceivedAssetsMap on the profile (maintained by
//              the Universal Receiver Delegate when one is set)
//   envio      Envio GraphQL indexer (LUKSO 42 / 4201)
//   blockscout /api/v2/addresses/{addr}/tokens on every blockscout-family explorer of the chain
//   logs       eth_getLogs scan for incoming Transfer events (ERC-20/721, LSP7, LSP8) over a
//              bounded block range — the fallback for chains without an indexer
// Every entry records which sources reported it and when; balances are re-read on-chain.
// Token names/symbols are attacker-controlled; unsolicited assets (airdrops) are common
// scam vectors: the skill never claims, approves or sells anything automatically.
import { getAddress, pad, type Abi, type AbiEvent, type Address, type Hex } from "viem";
import { encodeArrayKey } from "@erc725/erc725.js";
import type { ChainInfo, VerbContext } from "../core/types.ts";
import { assetJson } from "../core/assets.ts";
import { httpJson, type FetchLike } from "../abi/http.ts";
import { readMany, tryRead } from "../abi/read.ts";
import { ERC725Y_GETDATA_ABI, INTERFACE_IDS } from "../abi/detect.ts";
import { topicOf } from "../abi/signature.ts";
import { ERC20_ABI, ERC721_ABI, LSP7_ABI, LSP8_ABI, formatAmount, type AssetStandard } from "./assets.ts";

export const LSP5_ARRAY_KEY = "0x6460ee3c0aac563ccbf76d6e1d07bada78e3a9514e6382b736ed3f478ab7b90b" as Hex;
export const LSP5_MAP_PREFIX = "0x812c4334633eb816c80d0000";

export type HoldingSourceName = "lsp5" | "envio" | "blockscout" | "logs";

export interface HoldingSource {
  source: HoldingSourceName;
  fetchedAt: string;
  /** indexer head / scanned range end */
  blockNumber?: number;
  /** how far the indexer is behind the chain head */
  lagBlocks?: number;
  detail?: string;
}

export interface HoldingEntry {
  asset: Address;
  standard?: AssetStandard;
  /** token-controlled strings: UNTRUSTED */
  name?: string;
  symbol?: string;
  decimals?: number;
  balance?: string;
  balanceFormatted?: string;
  tokenIds?: string[];
  /** LSP5 map: interface id the URD recorded + array index */
  lsp5?: { interfaceId: Hex; index: number };
  sources: HoldingSourceName[];
  verifiedOnchain: boolean;
  flags: string[];
}

export interface SourceReport {
  source: HoldingSourceName;
  status: "ok" | "skipped" | "error";
  count: number;
  detail?: string;
  fetchedAt: string;
  blockNumber?: number;
  lagBlocks?: number;
}

const STD_BY_INTERFACE = new Map<string, AssetStandard>();
for (const id of INTERFACE_IDS.LSP7DigitalAsset) STD_BY_INTERFACE.set(id, "LSP7");
for (const id of INTERFACE_IDS.LSP8IdentifiableDigitalAsset) STD_BY_INTERFACE.set(id, "LSP8");
for (const id of INTERFACE_IDS.ERC721) STD_BY_INTERFACE.set(id, "ERC721");
for (const id of INTERFACE_IDS.ERC1155) STD_BY_INTERFACE.set(id, "ERC1155");

export function lsp5MapKey(asset: Address): Hex {
  return `${LSP5_MAP_PREFIX}${asset.slice(2).toLowerCase()}` as Hex;
}

type Ctx = Pick<VerbContext, "rpc">;
type Partial_ = Omit<HoldingEntry, "sources" | "verifiedOnchain" | "flags">;

export async function readLsp5(ctx: Ctx, chainId: number, holder: Address, max = 200): Promise<{ supported: boolean; total: number; entries: Partial_[] }> {
  const len = await tryRead<Hex>(ctx, chainId, { address: holder, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [LSP5_ARRAY_KEY] });
  if (!len.ok) return { supported: false, total: 0, entries: [] };
  const total = len.value === "0x" ? 0 : Number(BigInt(len.value));
  const n = Math.min(total, max);
  if (n === 0) return { supported: true, total, entries: [] };
  const items = await readMany(
    ctx,
    chainId,
    Array.from({ length: n }, (_, i) => ({ address: holder, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [encodeArrayKey(LSP5_ARRAY_KEY, i) as Hex] })),
  );
  const assets = items.map((r) => (r.ok && typeof r.value === "string" && /^0x[0-9a-fA-F]{40}$/.test(r.value) ? getAddress(r.value) : undefined)).filter((x): x is Address => !!x);
  const maps = await readMany(
    ctx,
    chainId,
    assets.map((a) => ({ address: holder, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [lsp5MapKey(a)] })),
  );
  const entries = assets.map((asset, i) => {
    const m = maps[i];
    let lsp5: HoldingEntry["lsp5"];
    let standard: AssetStandard | undefined;
    if (m.ok && typeof m.value === "string" && m.value.length === 42) {
      const interfaceId = m.value.slice(0, 10).toLowerCase() as Hex;
      lsp5 = { interfaceId, index: Number(BigInt(`0x${m.value.slice(10)}`)) };
      standard = STD_BY_INTERFACE.get(interfaceId);
    }
    return { asset, standard, lsp5 };
  });
  return { supported: true, total, entries };
}

export function envioEndpoint(chainId: number): string | undefined {
  const e = (assetJson<any>("registry", "protocols.json").indexers?.envioLukso ?? {}) as { url?: string; testnet?: string; chains?: number[] };
  if (!e.chains?.includes(chainId)) return undefined;
  return chainId === 4201 ? e.testnet : e.url;
}

const ENVIO_QUERY = `query Holdings($holder: String!, $limit: Int!, $offset: Int!) {
  Hold(where: {profile_id: {_eq: $holder}, balance: {_gt: "0"}}, limit: $limit, offset: $offset, order_by: {id: asc}) {
    asset_id baseAsset_id token_id balance updatedBlockNumber
    asset { id lsp4TokenName lsp4TokenSymbol decimals standard }
    baseAsset { id lsp4TokenName lsp4TokenSymbol decimals standard }
  }
  chain_metadata { chain_id latest_processed_block }
}`;

function envioStandard(s: unknown): AssetStandard | undefined {
  const v = String(s ?? "");
  if (/LSP7/i.test(v)) return "LSP7";
  if (/LSP8/i.test(v)) return "LSP8";
  return undefined;
}

export async function envioHoldings(endpoint: string, holder: Address, opts: { fetch?: FetchLike; pages?: number } = {}): Promise<{ entries: Partial_[]; head?: number }> {
  const byAsset = new Map<string, Partial_>();
  let head: number | undefined;
  const limit = 200;
  for (let page = 0; page < (opts.pages ?? 5); page++) {
    const r = await httpJson<any>(endpoint, { fetch: opts.fetch, method: "POST", body: JSON.stringify({ query: ENVIO_QUERY, variables: { holder: holder.toLowerCase(), limit, offset: page * limit } }), label: "Envio indexer" });
    if (r.status !== 200 || !r.body || r.body.errors) throw new Error(`Envio: ${r.status !== 200 ? `HTTP ${r.status}` : JSON.stringify(r.body?.errors ?? "no body").slice(0, 200)}`);
    const holds = (r.body.data?.Hold ?? []) as any[];
    head ??= r.body.data?.chain_metadata?.[0]?.latest_processed_block;
    for (const h of holds) {
      const assetId: string | undefined = h.baseAsset_id ?? h.asset_id ?? (typeof h.token_id === "string" ? h.token_id.split("-")[0] : undefined);
      if (!assetId || !/^0x[0-9a-fA-F]{40}$/.test(assetId)) continue;
      const meta = h.baseAsset ?? h.asset ?? {};
      const key = assetId.toLowerCase();
      const e: Partial_ = byAsset.get(key) ?? { asset: getAddress(assetId), standard: envioStandard(meta.standard), name: meta.lsp4TokenName ?? undefined, symbol: meta.lsp4TokenSymbol ?? undefined, decimals: typeof meta.decimals === "number" ? meta.decimals : undefined };
      const tokenId = typeof h.token_id === "string" && h.token_id.includes("-") ? h.token_id.split("-")[1] : undefined;
      if (tokenId) (e.tokenIds ??= []).push(tokenId);
      else e.balance = String(h.balance);
      byAsset.set(key, e);
    }
    if (holds.length < limit) break;
  }
  return { entries: [...byAsset.values()], head };
}

function blockscoutStandard(t: unknown): AssetStandard | undefined {
  switch (String(t ?? "").toUpperCase()) {
    case "ERC-20":
      return "ERC20";
    case "ERC-721":
      return "ERC721";
    case "ERC-1155":
      return "ERC1155";
    case "LSP7":
      return "LSP7";
    case "LSP8":
      return "LSP8";
    default:
      return undefined;
  }
}

export function blockscoutBases(chain: ChainInfo | undefined): string[] {
  if (!chain) return [];
  return [...new Set(chain.explorers.filter((e) => e.family === "blockscout").map((e) => (e.apiBase ? e.apiBase.replace(/\/api\/?$/, "") : e.url).replace(/\/+$/, "")))];
}

export async function blockscoutHoldings(base: string, holder: Address, opts: { fetch?: FetchLike; pages?: number } = {}): Promise<Partial_[]> {
  const byAsset = new Map<string, Partial_>();
  let query = "";
  for (let page = 0; page < (opts.pages ?? 4); page++) {
    const r = await httpJson<any>(`${base}/api/v2/addresses/${holder}/tokens${query}`, { fetch: opts.fetch, label: `blockscout:${new URL(base).host}` });
    if (r.status === 404) break;
    if (r.status !== 200 || !Array.isArray(r.body?.items)) throw new Error(`Blockscout: HTTP ${r.status}`);
    for (const it of r.body.items as any[]) {
      const addr = it?.token?.address_hash ?? it?.token?.address;
      if (typeof addr !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
      const key = addr.toLowerCase();
      const dec = it.token.decimals !== null && it.token.decimals !== undefined && /^\d+$/.test(String(it.token.decimals)) ? Number(it.token.decimals) : undefined;
      const e: Partial_ = byAsset.get(key) ?? { asset: getAddress(addr), standard: blockscoutStandard(it.token.type), name: it.token.name ?? undefined, symbol: it.token.symbol ?? undefined, decimals: dec };
      if (it.token_id !== null && it.token_id !== undefined) (e.tokenIds ??= []).push(String(it.token_id));
      else if (it.value !== undefined && it.value !== null) e.balance = String(it.value);
      byAsset.set(key, e);
    }
    const next = r.body.next_page_params;
    if (!next || typeof next !== "object") break;
    query = "?" + new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)])).toString();
  }
  return [...byAsset.values()];
}

/** Transfer-style events with the recipient's topic position, from the bundled ABIs. */
function transferEvents(): { std: AssetStandard; topic0: Hex; toTopic: number; topicCount: number }[] {
  const pick = (abi: Abi, std: AssetStandard) =>
    abi
      .filter((x): x is AbiEvent => x.type === "event" && x.name === "Transfer")
      .map((ev) => {
        const indexed = ev.inputs.filter((i) => i.indexed);
        const toIdx = indexed.findIndex((i) => i.name === "to" || i.name === "recipient");
        return { std, topic0: topicOf(ev), toTopic: toIdx + 1, topicCount: indexed.length + 1 };
      })
      .filter((x) => x.toTopic > 0);
  const erc = [
    { std: "ERC20" as const, topic0: topicOf(ERC20_TRANSFER), toTopic: 2, topicCount: 3 },
    { std: "ERC721" as const, topic0: topicOf(ERC20_TRANSFER), toTopic: 2, topicCount: 4 },
  ];
  return [...erc, ...pick(LSP7_ABI(), "LSP7"), ...pick(LSP8_ABI(), "LSP8")];
}

const ERC20_TRANSFER: AbiEvent = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
};

export async function logScanHoldings(ctx: Ctx, chainId: number, holder: Address, blocks: number): Promise<{ entries: Partial_[]; fromBlock: number; toBlock: number; errors: string[] }> {
  const latest = Number(BigInt(await ctx.rpc.request<Hex>(chainId, "eth_blockNumber", [])));
  const fromBlock = Math.max(0, latest - Math.max(1, blocks) + 1);
  const holderTopic = pad(holder.toLowerCase() as Hex, { size: 32 });
  const evs = transferEvents();
  const byAsset = new Map<string, Partial_>();
  const errors: string[] = [];
  const CHUNK = 2000;
  // group queries by (topic0, position) so ERC-20 and ERC-721 share one getLogs
  const queries = [...new Map(evs.map((e) => [`${e.topic0}:${e.toTopic}`, e])).values()];
  for (const q of queries) {
    for (let start = fromBlock; start <= latest; start += CHUNK) {
      const end = Math.min(latest, start + CHUNK - 1);
      const topics: (Hex | null)[] = [q.topic0];
      for (let i = 1; i < q.toTopic; i++) topics.push(null);
      topics.push(holderTopic);
      let logs: { address: string; topics: Hex[] }[] = [];
      try {
        logs = await ctx.rpc.request<any[]>(chainId, "eth_getLogs", [{ fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics }]);
      } catch (e) {
        errors.push(`blocks ${start}-${end}: ${(e as Error).message}`);
        continue;
      }
      for (const l of logs ?? []) {
        const match = evs.find((e) => e.topic0 === l.topics[0]?.toLowerCase() && e.toTopic === q.toTopic && e.topicCount === l.topics.length);
        if (!match || !/^0x[0-9a-fA-F]{40}$/.test(l.address)) continue;
        const key = l.address.toLowerCase();
        if (!byAsset.has(key)) byAsset.set(key, { asset: getAddress(l.address), standard: match.std });
      }
    }
  }
  return { entries: [...byAsset.values()], fromBlock, toBlock: latest, errors };
}

/** Re-reads balances on-chain (fungible: balanceOf; NFTs: balanceOf count + LSP8 tokenIdsOf). */
export async function verifyBalances(ctx: Ctx, chainId: number, holder: Address, entries: HoldingEntry[], max = 100): Promise<void> {
  const todo = entries.filter((e) => e.standard && e.standard !== "ERC1155").slice(0, max);
  const reqs = todo.map((e) => ({ address: e.asset, abi: e.standard === "LSP7" ? LSP7_ABI() : e.standard === "LSP8" ? LSP8_ABI() : e.standard === "ERC721" ? (ERC721_ABI as Abi) : (ERC20_ABI as Abi), functionName: "balanceOf", args: [holder] }));
  const res = await readMany(ctx, chainId, reqs);
  const decimalsNeeded = todo.filter((e) => (e.standard === "LSP7" || e.standard === "ERC20") && e.decimals === undefined);
  const decs = await readMany(ctx, chainId, decimalsNeeded.map((e) => ({ address: e.asset, abi: ERC20_ABI as Abi, functionName: "decimals" })));
  decimalsNeeded.forEach((e, i) => {
    if (decs[i].ok) e.decimals = Number(decs[i].value);
  });
  const lsp8 = todo.filter((e) => e.standard === "LSP8");
  const ids = await readMany(ctx, chainId, lsp8.map((e) => ({ address: e.asset, abi: LSP8_ABI(), functionName: "tokenIdsOf", args: [holder] })));
  lsp8.forEach((e, i) => {
    if (ids[i].ok) e.tokenIds = (ids[i].value as Hex[]).slice(0, 100).map(String);
  });
  todo.forEach((e, i) => {
    const r = res[i];
    if (!r.ok) {
      e.flags.push("balance-unreadable");
      return;
    }
    const v = BigInt(r.value as bigint);
    e.balance = v.toString();
    e.verifiedOnchain = true;
    if (e.decimals !== undefined && (e.standard === "LSP7" || e.standard === "ERC20")) e.balanceFormatted = formatAmount(v, e.decimals);
    if (v === 0n) e.flags.push("zero-balance-now");
  });
}

export function mergeEntries(lists: { source: HoldingSourceName; entries: Partial_[] }[]): HoldingEntry[] {
  const map = new Map<string, HoldingEntry>();
  for (const { source, entries } of lists) {
    for (const e of entries) {
      const key = e.asset.toLowerCase();
      const cur = map.get(key);
      if (!cur) {
        map.set(key, { ...e, sources: [source], verifiedOnchain: false, flags: [] });
        continue;
      }
      if (!cur.sources.includes(source)) cur.sources.push(source);
      cur.standard ??= e.standard;
      cur.name ??= e.name;
      cur.symbol ??= e.symbol;
      cur.decimals ??= e.decimals;
      cur.lsp5 ??= e.lsp5;
      cur.balance ??= e.balance;
      if (e.tokenIds?.length) cur.tokenIds = [...new Set([...(cur.tokenIds ?? []), ...e.tokenIds])];
    }
  }
  return [...map.values()];
}
