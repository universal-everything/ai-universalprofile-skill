// Thin eth_call helpers over ctx.rpc (ranked endpoints + failover) with LSP
// custom-error decoding.
import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { decodeRevert, hintForRevert, revertData } from "../chain/tx.ts";

export async function ethCall(ctx: VerbContext, chainId: number, req: { to: Address; data: Hex; from?: Address; value?: bigint; block?: string }): Promise<Hex> {
  try {
    return await ctx.rpc.request<Hex>(chainId, "eth_call", [
      { from: req.from, to: req.to, data: req.data, value: req.value ? `0x${req.value.toString(16)}` : undefined },
      req.block ?? "latest",
    ]);
  } catch (e) {
    if (e instanceof UpError) throw e;
    const decoded = decodeRevert(revertData(e));
    throw new UpError("SIMULATION_REVERTED", `call to ${req.to} reverted: ${decoded.message}`, { hint: hintForRevert(decoded), details: decoded, cause: e });
  }
}

export async function read<T = unknown>(ctx: VerbContext, chainId: number, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = [], from?: Address): Promise<T> {
  const data = encodeFunctionData({ abi, functionName, args } as any);
  const ret = await ethCall(ctx, chainId, { to: address, data, from });
  return decodeFunctionResult({ abi, functionName, data: ret } as any) as T;
}

/** Like read() but returns undefined instead of throwing (for probes on unknown contracts). */
export async function tryRead<T = unknown>(ctx: VerbContext, chainId: number, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<T | undefined> {
  try {
    return await read<T>(ctx, chainId, address, abi, functionName, args);
  } catch (e) {
    if (e instanceof UpError && e.code === "RPC_UNAVAILABLE") throw e;
    return undefined;
  }
}

export async function getCode(ctx: VerbContext, chainId: number, address: Address): Promise<Hex> {
  return ctx.rpc.request<Hex>(chainId, "eth_getCode", [address, "latest"]);
}

export async function hasCode(ctx: VerbContext, chainId: number, address: Address): Promise<boolean> {
  const c = await getCode(ctx, chainId, address);
  return typeof c === "string" && c.length > 2;
}

export async function getBalance(ctx: VerbContext, chainId: number, address: Address): Promise<bigint> {
  return BigInt(await ctx.rpc.request<Hex>(chainId, "eth_getBalance", [address, "latest"]));
}

export async function latestBlock(ctx: VerbContext, chainId: number): Promise<{ number: bigint; timestamp: bigint }> {
  const b = await ctx.rpc.request<any>(chainId, "eth_getBlockByNumber", ["latest", false]);
  return { number: BigInt(b?.number ?? "0x0"), timestamp: BigInt(b?.timestamp ?? "0x0") };
}

/** Verifies the RPC really serves `chainId` (binding check before signing chain-bound messages). */
export async function assertRpcChainId(ctx: VerbContext, chainId: number): Promise<void> {
  const id = Number(BigInt(await ctx.rpc.request<Hex>(chainId, "eth_chainId", [])));
  if (id !== chainId) throw new UpError("RPC_UNAVAILABLE", `RPC for chain ${chainId} reports chainId ${id}`, { hint: `fix the RPC configuration: up chains rpc verify ${chainId}` });
}
