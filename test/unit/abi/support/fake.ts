// Unit-test doubles (no network, no EVM):
//  - fakeRpc(): a RpcManager whose eth_call dispatches to per-contract handlers
//    (calldata decoded with the contract's ABI, results ABI-encoded), with ERC-165,
//    ERC725Y getData, code, storage, balances and logs;
//  - mockFetch(): a fetch stand-in that routes by URL and records every request.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, type Abi, type Address, type Hex } from "viem";
import type { RpcManager, UpConfig, VerbContext } from "../../../../src/core/types.ts";
import { JsonRpcError } from "../../../../src/chain/rpc.ts";
import { createRegistry } from "../../../../src/chain/registry.ts";
import { UpError } from "../../../../src/core/errors.ts";

export interface FakeContract {
  code?: Hex;
  abi?: Abi;
  handlers?: Record<string, (args: readonly unknown[], from?: Address) => unknown>;
  /** ERC-165 ids (0x01ffc9a7 implied). Undefined = no ERC-165 (calls revert). */
  interfaces?: string[];
  /** ERC725Y getData(key) values */
  data?: Record<string, Hex>;
  storage?: Record<string, Hex>;
}

export interface FakeLog {
  address: Address;
  topics: Hex[];
  data?: Hex;
  blockNumber?: number;
}

export interface FakeRpc extends RpcManager {
  calls: { method: string; params: unknown[] }[];
}

const GETDATA = "0x54f6127f";
const SUPPORTS = "0x01ffc9a7";

export function fakeRpc(contracts: Record<string, FakeContract>, opts: { balances?: Record<string, bigint>; blockNumber?: number; logs?: FakeLog[] } = {}): FakeRpc {
  const byAddr = new Map(Object.entries(contracts).map(([k, v]) => [k.toLowerCase(), v]));
  const calls: { method: string; params: unknown[] }[] = [];
  const revert = () => {
    throw new JsonRpcError(3, "execution reverted");
  };
  const request = async <T>(_chainId: number, method: string, params: unknown[] = []): Promise<T> => {
    calls.push({ method, params });
    switch (method) {
      case "eth_getCode": {
        const c = byAddr.get(String(params[0]).toLowerCase());
        return (c ? c.code ?? "0x6001600155" : "0x") as T;
      }
      case "eth_getStorageAt": {
        const c = byAddr.get(String(params[0]).toLowerCase());
        return (c?.storage?.[String(params[1]).toLowerCase()] ?? `0x${"0".repeat(64)}`) as T;
      }
      case "eth_getBalance":
        return `0x${(opts.balances?.[String(params[0]).toLowerCase()] ?? 0n).toString(16)}` as T;
      case "eth_blockNumber":
        return `0x${(opts.blockNumber ?? 1000).toString(16)}` as T;
      case "eth_getLogs": {
        const f = params[0] as { topics: (Hex | null)[]; fromBlock: Hex; toBlock: Hex };
        const from = Number(BigInt(f.fromBlock));
        const to = Number(BigInt(f.toBlock));
        return (opts.logs ?? []).filter((l) => (l.blockNumber ?? 0) >= from && (l.blockNumber ?? 0) <= to && f.topics.every((t, i) => t === null || l.topics[i]?.toLowerCase() === t.toLowerCase())) as T;
      }
      case "eth_call": {
        const tx = params[0] as { to: string; data: Hex; from?: Address };
        const c = byAddr.get(tx.to.toLowerCase());
        if (!c) return "0x" as T;
        const sel = tx.data.slice(0, 10).toLowerCase();
        if (sel === SUPPORTS && !c.handlers?.supportsInterface) {
          if (!c.interfaces) return revert();
          const id = `0x${tx.data.slice(10, 18)}`.toLowerCase();
          const yes = id === SUPPORTS || (id !== "0xffffffff" && c.interfaces.map((x) => x.toLowerCase()).includes(id));
          return encodeAbiParameters([{ type: "bool" }], [yes]) as T;
        }
        if (sel === GETDATA && c.data && !c.handlers?.getData) {
          const key = `0x${tx.data.slice(10, 74)}`.toLowerCase();
          return encodeAbiParameters([{ type: "bytes" }], [c.data[key] ?? "0x"]) as T;
        }
        if (!c.abi) return revert();
        let d;
        try {
          d = decodeFunctionData({ abi: c.abi, data: tx.data });
        } catch {
          return revert();
        }
        const h = c.handlers?.[d.functionName];
        if (!h) return revert();
        const result = h((d.args ?? []) as readonly unknown[], tx.from);
        return encodeFunctionResult({ abi: c.abi, functionName: d.functionName, result } as any) as T;
      }
      default:
        throw new Error(`fakeRpc: unsupported method ${method}`);
    }
  };
  return {
    calls,
    request,
    publicClient: () => {
      throw new Error("fakeRpc: no public client");
    },
    ranked: () => [],
    verify: async () => [],
  };
}

export function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "up-unit-"));
}

/** Minimal VerbContext for library-level unit tests (no signer, no consent). */
export function fakeCtx(rpc: RpcManager, cfg: Partial<UpConfig> = {}, home = tmpHome()): VerbContext {
  const registry = createRegistry(home);
  const config: UpConfig = { version: 1, ...cfg };
  return {
    home,
    flags: { json: true, dryRun: false, yes: true },
    registry,
    rpc,
    config: async () => config,
    saveConfig: async () => {},
    signer: async () => {
      throw new Error("no signer in unit tests");
    },
    consent: async () => {},
    // same contract as src/core/context.ts: explicit arg → registry; else default; else BAD_ARGS
    chainId: (arg) => {
      if (arg !== undefined && arg !== "") return registry.chain(arg).chainId;
      if (config.defaultChain) return config.defaultChain;
      throw new UpError("BAD_ARGS", "no chain given");
    },
    profile: async (arg) => getAddress(String(arg ?? config.defaultProfile)),
    log: () => {},
  };
}

export type Route = [pattern: RegExp, respond: (url: string, init?: RequestInit) => { status: number; body?: unknown; headers?: Record<string, string> }];

export function mockFetch(routes: Route[]) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    for (const [re, respond] of routes) {
      if (re.test(url)) {
        const r = respond(url, init);
        return new Response(r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: r.headers });
      }
    }
    return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
  };
  return { fetch, requests };
}
