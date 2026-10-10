// Small eth_call helpers for the 4337 module (reads, probes and simulations that
// must expose the raw revert data, e.g. EntryPoint simulateValidation which
// always reverts with its result).
import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { decodeRevert, revertData, type DecodedRevert } from "../chain/tx.ts";

export interface CallRequest {
  to: Address;
  data: Hex;
  from?: Address;
  value?: bigint;
  gas?: bigint;
}

const q = (v: bigint | undefined) => (v === undefined ? undefined : `0x${v.toString(16)}`);

export async function ethCall(ctx: VerbContext, chainId: number, c: CallRequest): Promise<Hex> {
  return ctx.rpc.request<Hex>(chainId, "eth_call", [{ from: c.from, to: c.to, data: c.data, value: q(c.value), gas: q(c.gas) }, "latest"]);
}

export type CallResult = { ok: true; data: Hex } | { ok: false; revert: DecodedRevert; raw?: Hex; error: unknown };

/** eth_call that never throws on revert; other transport errors still throw. */
export async function tryCall(ctx: VerbContext, chainId: number, c: CallRequest, errorAbis: Abi[] = []): Promise<CallResult> {
  try {
    return { ok: true, data: await ethCall(ctx, chainId, c) };
  } catch (e) {
    const raw = revertData(e);
    if (raw === undefined && !isRevertError(e)) throw e;
    return { ok: false, revert: decodeRevert(raw, errorAbis), raw, error: e };
  }
}

function isRevertError(e: unknown): boolean {
  let cur: any = e;
  for (let i = 0; i < 6 && cur; i++) {
    const m = String(cur?.message ?? "").toLowerCase();
    if (cur?.code === 3 || /revert|invalid opcode|out of gas/.test(m)) return true;
    cur = cur.cause;
  }
  return false;
}

export async function read<T = unknown>(ctx: VerbContext, chainId: number, to: Address, abi: Abi, functionName: string, args: readonly unknown[] = [], from?: Address): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args } as any);
  const out = await ethCall(ctx, chainId, { to, data, from });
  return decodeFunctionResult({ abi, functionName, data: out } as any) as T;
}

export async function getCode(ctx: VerbContext, chainId: number, address: Address): Promise<Hex> {
  const code = await ctx.rpc.request<Hex>(chainId, "eth_getCode", [address, "latest"]);
  return (code ?? "0x") as Hex;
}

export async function getBalance(ctx: VerbContext, chainId: number, address: Address): Promise<bigint> {
  return BigInt(await ctx.rpc.request<Hex>(chainId, "eth_getBalance", [address, "latest"]));
}

export function hexQuantity(v: bigint): Hex {
  return `0x${v.toString(16)}` as Hex;
}
