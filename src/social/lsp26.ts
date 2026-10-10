// LSP26 Follower System: one registry contract at the same address on every
// chain where it is deployed (protocols.json `lsp26FollowerSystem`). Follows are
// recorded for msg.sender, so follow/unfollow run AS THE PROFILE (ERC725X CALL).
import { encodeFunctionData, getAddress, type Abi, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { assetJson } from "../core/assets.ts";
import { UpError } from "../core/errors.ts";
import { bundledAbi } from "../abi/bundled.ts";
import { getCode, read, readMany } from "../abi/read.ts";
import { codeHashMatches } from "../abi/codehashes.ts";
import { codeHash } from "../abi/read.ts";

let abi: Abi | undefined;
export const LSP26_ABI = (): Abi => (abi ??= bundledAbi("LSP26FollowerSystem"));

interface Lsp26Entry {
  address: Address;
  chains?: number[];
  absentOn?: number[];
}

export function lsp26Registry(): Lsp26Entry {
  const p = assetJson<any>("registry", "protocols.json").protocols?.lsp26FollowerSystem;
  if (!p?.address) throw new UpError("INTERNAL", "protocols.json has no lsp26FollowerSystem entry");
  return { address: getAddress(p.address), chains: p.chains, absentOn: p.absentOn };
}

export interface Lsp26Location {
  address: Address;
  chainId: number;
  /** bundled registry statement for this chain */
  registry: "listed" | "unknown";
  /** how presence was confirmed now */
  verifiedBy: "eth_getCode" | "eth_getCode+codehash";
  warnings: string[];
}

function chainName(ctx: Pick<VerbContext, "registry">, id: number): string {
  try {
    return `${ctx.registry.chain(id).name} (${id})`;
  } catch {
    return `chain ${id}`;
  }
}

/**
 * Locates the follower system on a chain or refuses with a precise reason:
 * listed-absent chains are refused without RPC; elsewhere code presence is
 * checked, and the runtime code hash is compared with the canonical deployment
 * (LSP26 does not implement ERC-165): required on chains the registry does not
 * list, a warning on listed chains.
 */
export async function locateLsp26(ctx: Pick<VerbContext, "rpc" | "registry">, chainId: number): Promise<Lsp26Location> {
  const reg = lsp26Registry();
  const where = () => (reg.chains ?? []).map((c) => chainName(ctx, c)).join(", ");
  if (reg.absentOn?.includes(chainId)) {
    throw new UpError("NOT_SUPPORTED", `the LSP26 Follower System is not deployed on ${chainName(ctx, chainId)}: no code at ${reg.address} (registry check)`, {
      hint: `follows are per chain; it is available on: ${where()}`,
    });
  }
  const code = await getCode(ctx, chainId, reg.address);
  if (code === "0x") {
    throw new UpError("NOT_SUPPORTED", `the LSP26 Follower System is not deployed on ${chainName(ctx, chainId)}: eth_getCode(${reg.address}) is empty`, {
      hint: `follows are per chain; known deployments: ${where()}`,
    });
  }
  const listed = !!reg.chains?.includes(chainId);
  const warnings: string[] = [];
  const hashOk = codeHashMatches(reg.address, codeHash(code));
  if (!listed) {
    if (hashOk !== true) {
      throw new UpError("NOT_SUPPORTED", `contract code exists at ${reg.address} on ${chainName(ctx, chainId)} but it is not the canonical LSP26 Follower System (runtime code hash ${codeHash(code)}) — refusing to use it`);
    }
    warnings.push(`chain ${chainId} is not in the bundled LSP26 deployment list; presence verified live (code hash matches the canonical deployment)`);
  } else if (hashOk === false) {
    warnings.push(`the code at ${reg.address} differs from the canonical LSP26 runtime (hash ${codeHash(code)}); the registry lists this chain, double-check before relying on it`);
  }
  return { address: reg.address, chainId, registry: listed ? "listed" : "unknown", verifiedBy: listed ? "eth_getCode" : "eth_getCode+codehash", warnings };
}

export async function isFollowing(ctx: Pick<VerbContext, "rpc">, chainId: number, lsp26: Address, follower: Address, followed: Address): Promise<boolean> {
  return read<boolean>(ctx, chainId, { address: lsp26, abi: LSP26_ABI(), functionName: "isFollowing", args: [follower, followed] });
}

export async function counts(ctx: Pick<VerbContext, "rpc">, chainId: number, lsp26: Address, addr: Address): Promise<{ followers: bigint; following: bigint }> {
  const [a, b] = await readMany(ctx, chainId, [
    { address: lsp26, abi: LSP26_ABI(), functionName: "followerCount", args: [addr] },
    { address: lsp26, abi: LSP26_ABI(), functionName: "followingCount", args: [addr] },
  ]);
  if (!a.ok || !b.ok) throw new UpError("SIMULATION_REVERTED", `LSP26 count read failed: ${!a.ok ? a.error : (b as { error: string }).error}`);
  return { followers: BigInt(a.value as bigint), following: BigInt(b.value as bigint) };
}

/** Pages through followers ("followers") or followed addresses ("following"); [start, start+limit) clamped to the count. */
export async function page(ctx: Pick<VerbContext, "rpc">, chainId: number, lsp26: Address, addr: Address, kind: "followers" | "following", total: bigint, start: number, limit: number): Promise<Address[]> {
  const s = BigInt(start);
  if (s >= total) return [];
  const end = s + BigInt(limit) > total ? total : s + BigInt(limit);
  const list = await read<readonly Address[]>(ctx, chainId, { address: lsp26, abi: LSP26_ABI(), functionName: kind === "followers" ? "getFollowersByIndex" : "getFollowsByIndex", args: [addr, s, end] });
  return list.map((x) => getAddress(x));
}

export function encodeFollow(fn: "follow" | "unfollow" | "followBatch" | "unfollowBatch", arg: Address | Address[]): Hex {
  return encodeFunctionData({ abi: LSP26_ABI(), functionName: fn, args: [arg] } as any);
}
