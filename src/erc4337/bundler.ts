// ERC-4337 bundler JSON-RPC client (ERC-7769 method set, EntryPoint v0.6 field
// set). Bundler URLs are user configuration (config.bundlers[chainId]) and may
// embed API keys, so they are never printed in full (see redactUrl).
import type { Address, Hex } from "viem";
import { UpError } from "../core/errors.ts";
import { JsonRpcError, rawRpc } from "../chain/rpc.ts";
import { BUNDLER_RPC_ERRORS, explainAA } from "./aa-errors.ts";
import { toRpcUserOp, type UserOperationV06 } from "./userop.ts";

export interface BundlerGasEstimate {
  preVerificationGas: bigint;
  verificationGasLimit: bigint;
  callGasLimit: bigint;
}

export interface BundlerReceipt {
  userOpHash: Hex;
  success: boolean;
  reason?: string;
  actualGasCost?: string;
  actualGasUsed?: string;
  logs?: any[];
  receipt?: { transactionHash: Hex; blockNumber?: Hex };
  transactionHash?: Hex;
  [k: string]: unknown;
}

/** Hides credentials in a bundler URL: user:pass@, query values and long path segments that look like keys. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "";
    }
    for (const k of [...u.searchParams.keys()]) u.searchParams.set(k, "***");
    u.pathname = u.pathname
      .split("/")
      .map((seg) => (seg.length >= 20 && /[a-z0-9_-]{20,}/i.test(seg) ? "***" : seg))
      .join("/");
    return decodeURIComponent(u.toString());
  } catch {
    return "<invalid url>";
  }
}

export function validateBundlerUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UpError("BAD_ARGS", `invalid bundler URL`, { hint: "pass a full https://… JSON-RPC URL" });
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new UpError("BAD_ARGS", "bundler URL must use https:// (http:// only for localhost)");
  return u.toString();
}

export class BundlerClient {
  readonly url: string;
  readonly label: string;
  readonly timeoutMs: number;
  constructor(url: string, opts: { timeoutMs?: number } = {}) {
    this.url = url;
    this.label = redactUrl(url);
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.UP_BUNDLER_TIMEOUT_MS ?? 30_000);
  }

  async request<T = any>(method: string, params: unknown[] = []): Promise<T> {
    try {
      return (await rawRpc(this.url, method, params, this.timeoutMs)) as T;
    } catch (e) {
      throw bundlerError(e, method, this.label);
    }
  }

  async chainId(): Promise<number> {
    return Number(BigInt(await this.request<Hex>("eth_chainId")));
  }

  async supportedEntryPoints(): Promise<Address[]> {
    return this.request<Address[]>("eth_supportedEntryPoints");
  }

  /** Checks chain id and that the EntryPoint is served; returns the supported list. */
  async verify(chainId: number, entryPoint: Address): Promise<{ chainId: number; entryPoints: Address[]; supportsEntryPoint: boolean }> {
    const [cid, eps] = await Promise.all([this.chainId(), this.supportedEntryPoints()]);
    const supports = eps.some((e) => e.toLowerCase() === entryPoint.toLowerCase());
    if (cid !== chainId) throw new UpError("BUNDLER_ERROR", `bundler ${this.label} serves chain ${cid}, not ${chainId}`);
    if (!supports) throw new UpError("BUNDLER_ERROR", `bundler ${this.label} does not support EntryPoint v0.6 ${entryPoint} (supports: ${eps.join(", ") || "none"})`, { hint: "Extension4337 only works with EntryPoint v0.6; use a v0.6-capable bundler or self-bundling (remove the bundler: up bundler set <chain> none)" });
    return { chainId: cid, entryPoints: eps, supportsEntryPoint: supports };
  }

  async estimateUserOperationGas(op: UserOperationV06, entryPoint: Address): Promise<BundlerGasEstimate> {
    const r = await this.request<Record<string, Hex>>("eth_estimateUserOperationGas", [toRpcUserOp(op), entryPoint]);
    const big = (k: string) => {
      if (r?.[k] === undefined) throw new UpError("BUNDLER_ERROR", `bundler ${this.label} returned no ${k} in eth_estimateUserOperationGas`);
      return BigInt(r[k]);
    };
    return { preVerificationGas: big("preVerificationGas"), verificationGasLimit: big("verificationGasLimit"), callGasLimit: big("callGasLimit") };
  }

  async sendUserOperation(op: UserOperationV06, entryPoint: Address): Promise<Hex> {
    return this.request<Hex>("eth_sendUserOperation", [toRpcUserOp(op), entryPoint]);
  }

  async getUserOperationByHash(hash: Hex): Promise<any | null> {
    return this.request("eth_getUserOperationByHash", [hash]);
  }

  async getUserOperationReceipt(hash: Hex): Promise<BundlerReceipt | null> {
    return this.request<BundlerReceipt | null>("eth_getUserOperationReceipt", [hash]);
  }

  async waitForUserOperationReceipt(hash: Hex, timeoutMs = Number(process.env.UP_USEROP_TIMEOUT_MS ?? 180_000)): Promise<BundlerReceipt> {
    const started = Date.now();
    const poll = Number(process.env.UP_POLL_MS ?? 2000);
    for (;;) {
      const r = await this.getUserOperationReceipt(hash);
      if (r) return r;
      if (Date.now() - started > timeoutMs) {
        throw new UpError("BUNDLER_ERROR", `no receipt for UserOperation ${hash} after ${Math.round(timeoutMs / 1000)} s`, {
          hint: "the op may still be pending in the bundler mempool; track it later by userOpHash (it may be re-bundled under a different transaction hash)",
          details: { userOpHash: hash },
        });
      }
      await new Promise((res) => setTimeout(res, poll));
    }
  }
}

function bundlerError(e: unknown, method: string, label: string): UpError {
  if (e instanceof JsonRpcError) {
    const kind = BUNDLER_RPC_ERRORS[e.code];
    const aa = explainAA(e.message);
    return new UpError("BUNDLER_ERROR", `bundler ${label} rejected ${method}: ${e.message}${kind ? ` (${kind})` : ""}${aa.up ? ` — ${aa.up}` : ""}`, {
      hint: aa.hint,
      details: { rpcCode: e.code, rpcData: e.data, aa: aa.code ? aa : undefined },
    });
  }
  return new UpError("NETWORK_ERROR", `bundler ${label} unreachable for ${method}: ${(e as Error)?.message ?? String(e)}`, { cause: e });
}
