// JSON-RPC access with ranked endpoints, health checks and automatic failover.
// Ranking: user overrides (config.rpcOverrides) → cached healthy endpoints →
// LUKSO-repo endpoint → Chainlist "tracking: none" → others. Every endpoint is
// checked with eth_chainId (must equal the registry chainId) before first use;
// failures demote the endpoint for the rest of the process and in the cache.
import { createPublicClient, custom, defineChain, type PublicClient } from "viem";
import type { ChainInfo, Registry, RpcEndpoint, RpcHealth, RpcManager, UpConfig } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { paths, readJson, writeJson } from "../core/home.ts";

const TIMEOUT_MS = Number(process.env.UP_RPC_TIMEOUT_MS ?? 15000);

interface HealthCache {
  [chainId: string]: { [url: string]: RpcHealth };
}

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

let requestId = 1;

export async function rawRpc(url: string, method: string, params: unknown[] = [], timeoutMs = TIMEOUT_MS): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params }),
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new TransportError(`HTTP 429 rate limited`, true);
    if (!res.ok) throw new TransportError(`HTTP ${res.status}`, res.status >= 500);
    const body: any = await res.json();
    if (body.error) throw new JsonRpcError(body.error.code, body.error.message, body.error.data);
    return body.result;
  } catch (e: any) {
    if (e instanceof JsonRpcError || e instanceof TransportError) throw e;
    throw new TransportError(e?.name === "AbortError" ? `timeout after ${timeoutMs} ms` : String(e?.message ?? e), true);
  } finally {
    clearTimeout(t);
  }
}

export class TransportError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** JSON-RPC errors that mean "the node answered, the call itself failed" — never fail over on these. */
function isApplicationError(e: unknown): boolean {
  if (!(e instanceof JsonRpcError)) return false;
  // -32000.. range is used by nodes for both execution reverts and node problems;
  // treat execution reverts / nonce / funds errors as application errors.
  const m = e.message.toLowerCase();
  if (e.code === 3) return true; // execution reverted (geth)
  if (/revert|insufficient funds|nonce|underpriced|already known|intrinsic gas|exceeds block gas limit|gas required exceeds/.test(m)) return true;
  if (e.code === -32602) return true; // invalid params
  return false;
}

export function createRpcManager(home: string, registry: Registry, getConfig: () => Promise<UpConfig>): RpcManager {
  const demoted = new Map<string, number>(); // url -> demoted until (ms)
  const verified = new Set<string>(); // `${chainId}:${url}` verified this process
  const clients = new Map<number, PublicClient>();

  const cacheFile = paths.cache(home, "rpc-health.json");

  async function endpoints(chainId: number): Promise<RpcEndpoint[]> {
    const cfg = await getConfig();
    const user = (cfg.rpcOverrides?.[String(chainId)] ?? []).map((url) => ({ url, source: "user" as const, trust: "user" as const }));
    let chain: ChainInfo | undefined;
    try {
      chain = registry.chain(chainId);
    } catch {
      if (user.length === 0) throw new UpError("CHAIN_UNKNOWN", `no RPC known for chain ${chainId}`, { hint: `run: up chains add ${chainId}` });
    }
    const discovered = await readJson<{ endpoints: RpcEndpoint[] }>(paths.cache(home, "rpc", `${chainId}.json`), { endpoints: [] });
    const health = (await readJson<HealthCache>(cacheFile, {}))[String(chainId)] ?? {};
    const seen = new Set<string>();
    const list: RpcEndpoint[] = [];
    for (const e of [...user, ...discovered.endpoints, ...(chain?.rpcs ?? [])]) {
      const u = e.url.replace(/\/+$/, "");
      if (seen.has(u)) continue;
      seen.add(u);
      list.push({ ...e, url: u });
    }
    // Stable sort: user first, then endpoints that were healthy last time, then the rest; demoted last.
    const score = (e: RpcEndpoint) => {
      if (e.source === "user") return 0;
      const h = health[e.url];
      const d = (demoted.get(e.url) ?? 0) > Date.now() ? 100 : 0;
      if (h?.ok) return 1 + d + Math.min(9, (h.latencyMs ?? 1000) / 500);
      if (h && !h.ok) return 50 + d;
      return 20 + d;
    };
    return list.map((e, i) => ({ e, i, s: score(e) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.e);
  }

  async function recordHealth(chainId: number, h: RpcHealth) {
    const all = await readJson<HealthCache>(cacheFile, {});
    (all[String(chainId)] ??= {})[h.url] = h;
    await writeJson(cacheFile, all).catch(() => {});
  }

  async function check(chainId: number, url: string): Promise<RpcHealth> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const id = await rawRpc(url, "eth_chainId", [], 8000);
      const chainIdMatches = Number(BigInt(id)) === chainId;
      if (!chainIdMatches) return { url, ok: false, chainIdMatches, error: `eth_chainId returned ${Number(BigInt(id))}`, checkedAt };
      const block = await rawRpc(url, "eth_getBlockByNumber", ["latest", false], 8000);
      const latencyMs = Date.now() - started;
      const ts = Number(BigInt(block?.timestamp ?? "0x0"));
      const blockAgeSec = Math.max(0, Math.round(Date.now() / 1000 - ts));
      let staleAfter = 600;
      try {
        staleAfter = Math.max(registry.chain(chainId).staleAfterSec ?? 60, 60) * 5;
      } catch {}
      const fresh = blockAgeSec <= staleAfter || process.env.UP_RPC_ALLOW_STALE === "1";
      return { url, ok: fresh, chainIdMatches, blockNumber: BigInt(block?.number ?? "0x0").toString(), blockAgeSec, latencyMs, error: fresh ? undefined : `head block is ${blockAgeSec}s old`, checkedAt };
    } catch (e: any) {
      return { url, ok: false, error: String(e?.message ?? e), latencyMs: Date.now() - started, checkedAt };
    }
  }

  async function request<T>(chainId: number, method: string, params: unknown[] = []): Promise<T> {
    const eps = await endpoints(chainId);
    if (eps.length === 0) throw new UpError("RPC_UNAVAILABLE", `no RPC endpoint configured for chain ${chainId}`, { hint: `run: up chains rpc find ${chainId}` });
    const errors: string[] = [];
    for (const ep of eps) {
      const key = `${chainId}:${ep.url}`;
      if (!verified.has(key)) {
        const h = await check(chainId, ep.url);
        await recordHealth(chainId, h);
        if (!h.ok) {
          demoted.set(ep.url, Date.now() + 10 * 60_000);
          errors.push(`${ep.url}: ${h.error}`);
          continue;
        }
        verified.add(key);
      }
      try {
        return (await rawRpc(ep.url, method, params)) as T;
      } catch (e) {
        if (isApplicationError(e)) throw e;
        if (e instanceof JsonRpcError && !(e.code === -32005 || e.code === -32603 || e.code === -32601)) throw e;
        demoted.set(ep.url, Date.now() + 10 * 60_000);
        verified.delete(key);
        errors.push(`${ep.url}: ${(e as Error).message}`);
      }
    }
    throw new UpError("RPC_UNAVAILABLE", `all RPC endpoints failed for chain ${chainId}`, {
      hint: `run: up chains rpc find ${chainId}   (discovers and stores working public RPCs from chainlist.org)`,
      details: { tried: errors.slice(0, 8) },
    });
  }

  return {
    request,
    ranked: (chainId) => {
      try {
        return registry.chain(chainId).rpcs;
      } catch {
        return [];
      }
    },
    async verify(chainId) {
      const eps = await endpoints(chainId);
      const out: RpcHealth[] = [];
      for (const e of eps) {
        const h = await check(chainId, e.url);
        await recordHealth(chainId, h);
        out.push(h);
      }
      return out;
    },
    publicClient(chainId) {
      let c = clients.get(chainId);
      if (!c) {
        let name = `chain-${chainId}`;
        let symbol = "ETH";
        try {
          const info = registry.chain(chainId);
          name = info.name;
          symbol = info.nativeSymbol;
        } catch {}
        const chain = defineChain({
          id: chainId,
          name,
          nativeCurrency: { name: symbol, symbol, decimals: 18 },
          rpcUrls: { default: { http: [] } },
          contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
        });
        c = createPublicClient({
          chain,
          transport: custom({ request: ({ method, params }: any) => request(chainId, method, params ?? []) }, { retryCount: 0 }),
        }) as PublicClient;
        clients.set(chainId, c);
      }
      return c;
    },
  };
}
