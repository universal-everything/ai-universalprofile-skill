// Read helpers over ctx.rpc (JSON-RPC with failover): eth_call with ABI
// encode/decode, code/storage reads, and batched reads through Multicall3
// `aggregate3` where its code is present (falls back to parallel eth_calls).
import { decodeFunctionResult, encodeFunctionData, keccak256, type Abi, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { JsonRpcError } from "../chain/rpc.ts";
import { revertData } from "../chain/tx.ts";

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;

type Ctx = Pick<VerbContext, "rpc">;

export async function getCode(ctx: Ctx, chainId: number, address: Address, block: string = "latest"): Promise<Hex> {
  const code = await ctx.rpc.request<Hex>(chainId, "eth_getCode", [address, block]);
  return (code && code !== "0x0" ? code : "0x") as Hex;
}

export function codeHash(code: Hex): Hex | undefined {
  return code === "0x" ? undefined : keccak256(code);
}

export async function getStorageAt(ctx: Ctx, chainId: number, address: Address, slot: Hex): Promise<Hex> {
  return ctx.rpc.request<Hex>(chainId, "eth_getStorageAt", [address, slot, "latest"]);
}

export async function ethCall(ctx: Ctx, chainId: number, to: Address, data: Hex, opts: { from?: Address; value?: bigint; block?: string } = {}): Promise<Hex> {
  return ctx.rpc.request<Hex>(chainId, "eth_call", [
    { to, data, ...(opts.from ? { from: opts.from } : {}), ...(opts.value ? { value: `0x${opts.value.toString(16)}` } : {}) },
    opts.block ?? "latest",
  ]);
}

export interface ReadRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export type ReadResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string; revert?: Hex };

/** One eth_call; reverts and undecodable results are returned as {ok:false}, transport problems throw. */
export async function tryRead<T = unknown>(ctx: Ctx, chainId: number, r: ReadRequest, opts: { from?: Address; block?: string } = {}): Promise<ReadResult<T>> {
  const data = encodeFunctionData({ abi: r.abi, functionName: r.functionName, args: r.args ?? [] } as any);
  let raw: Hex;
  try {
    raw = await ethCall(ctx, chainId, r.address, data, opts);
  } catch (e) {
    if (e instanceof JsonRpcError || revertData(e)) return { ok: false, error: (e as Error).message, revert: revertData(e) };
    throw e;
  }
  return decodeResult<T>(r, raw);
}

function decodeResult<T>(r: ReadRequest, raw: Hex): ReadResult<T> {
  if (!raw || raw === "0x") return { ok: false, error: "empty return data (no such function or not a contract)" };
  try {
    return { ok: true, value: decodeFunctionResult({ abi: r.abi, functionName: r.functionName, data: raw, args: r.args } as any) as T };
  } catch (e) {
    return { ok: false, error: `undecodable return data: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** Like tryRead but throws a readable error. */
export async function read<T = unknown>(ctx: Ctx, chainId: number, r: ReadRequest, opts: { from?: Address; block?: string } = {}): Promise<T> {
  const res = await tryRead<T>(ctx, chainId, r, opts);
  if (!res.ok) throw new UpError("SIMULATION_REVERTED", `${r.functionName}() on ${r.address} failed: ${res.error}`, { details: { revert: res.revert } });
  return res.value;
}

const AGGREGATE3_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

const multicallPresent = new Map<string, boolean>();

async function hasMulticall(ctx: Ctx, chainId: number): Promise<boolean> {
  const key = String(chainId);
  if (!multicallPresent.has(key)) multicallPresent.set(key, (await getCode(ctx, chainId, MULTICALL3).catch(() => "0x")) !== "0x");
  return multicallPresent.get(key)!;
}

/** Batched reads: Multicall3 aggregate3 (chunks of 100) when deployed, else parallel eth_calls (8 at a time). */
export async function readMany(ctx: Ctx, chainId: number, reqs: ReadRequest[]): Promise<ReadResult[]> {
  if (reqs.length === 0) return [];
  if (reqs.length > 1 && (await hasMulticall(ctx, chainId))) {
    const out: ReadResult[] = [];
    for (let i = 0; i < reqs.length; i += 100) {
      const chunk = reqs.slice(i, i + 100);
      const calls = chunk.map((r) => ({ target: r.address, allowFailure: true, callData: encodeFunctionData({ abi: r.abi, functionName: r.functionName, args: r.args ?? [] } as any) }));
      try {
        const raw = await ethCall(ctx, chainId, MULTICALL3, encodeFunctionData({ abi: AGGREGATE3_ABI, functionName: "aggregate3", args: [calls] }));
        const results = decodeFunctionResult({ abi: AGGREGATE3_ABI, functionName: "aggregate3", data: raw }) as readonly { success: boolean; returnData: Hex }[];
        chunk.forEach((r, k) => out.push(results[k]?.success ? decodeResult(r, results[k].returnData) : { ok: false, error: "reverted", revert: results[k]?.returnData }));
      } catch {
        // a misbehaving multicall must not break reads: fall back to individual calls
        out.push(...(await parallel(ctx, chainId, chunk)));
      }
    }
    return out;
  }
  return parallel(ctx, chainId, reqs);
}

async function parallel(ctx: Ctx, chainId: number, reqs: ReadRequest[]): Promise<ReadResult[]> {
  const out: ReadResult[] = new Array(reqs.length);
  let next = 0;
  const worker = async () => {
    while (next < reqs.length) {
      const i = next++;
      try {
        out[i] = await tryRead(ctx, chainId, reqs[i]);
      } catch (e) {
        out[i] = { ok: false, error: (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, reqs.length) }, worker));
  return out;
}

/** For tests: forget cached Multicall3 presence. */
export function resetReadCaches(): void {
  multicallPresent.clear();
}
