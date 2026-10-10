// Token-move guard (allowlist). When the delegated policy does not allow token moves
// for a contract, ANY state-changing call to a token contract (LSP7, LSP8, ERC-20/777,
// ERC-721, ERC-1155) needs the human's approval unless the function is on the small
// list of known-harmless token functions below. This closes wrapper bypasses such as a
// token's own batchCalls(bytes[]), transferAndCall, ERC-777 send or legacy approve
// variants, which a selector blocklist cannot see into.
import { encodeFunctionData, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";
import type { ConsentRequest, VerbContext } from "./types.ts";
import type { DelegationPolicy } from "./policy.ts";
import { UpError } from "./errors.ts";

/** Token functions that never move the holder's assets or grant spending rights. */
export const TOKEN_SAFE_SELECTORS: ReadonlySet<string> = new Set(
  [
    "function revokeOperator(address,address,bool,bytes)", // LSP7
    "function revokeOperator(address,bytes32,bool,bytes)", // LSP8
    "function decreaseAllowance(address,address,uint256,bytes)", // LSP7
    "function decreaseAllowance(address,uint256)", // ERC-20 (OZ)
    "function mint(address,uint256,bool,bytes)", // LSP7 issuer
    "function mint(address,bytes32,bool,bytes)", // LSP8 issuer
    "function setData(bytes32,bytes)", // LSP4 metadata (issuer)
    "function setDataBatch(bytes32[],bytes[])",
    "function setDataForTokenId(bytes32,bytes32,bytes)",
    "function setDataBatchForTokenIds(bytes32[],bytes32[],bytes[])",
    // read-only functions (harmless even when executed as a transaction)
    "function balanceOf(address)",
    "function totalSupply()",
    "function decimals()",
    "function name()",
    "function symbol()",
    "function owner()",
    "function allowance(address,address)",
    "function authorizedAmountFor(address,address)",
    "function getOperatorsOf(address)",
    "function getOperatorsOf(bytes32)",
    "function isOperatorFor(address,bytes32)",
    "function tokenOwnerOf(bytes32)",
    "function tokenIdsOf(address)",
    "function getData(bytes32)",
    "function getDataBatch(bytes32[])",
    "function getDataForTokenId(bytes32,bytes32)",
    "function supportsInterface(bytes4)",
    "function ownerOf(uint256)",
    "function isApprovedForAll(address,address)",
    "function getApproved(uint256)",
  ].map((s) => toFunctionSelector(s).toLowerCase()),
);

const LSP7_IDS = ["0xc52d6008", "0xb3c4928f", "0xdaa746b7"];
const LSP8_IDS = ["0x3a271706", "0xecad9f75", "0x30dc5278"];
const NFT_IDS = ["0x80ac58cd", "0xd9b67a26"]; // ERC-721, ERC-1155
const probeAbi = parseAbi(["function supportsInterface(bytes4) view returns (bool)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);

const cache = new Map<string, boolean>();

async function call(ctx: VerbContext, chainId: number, to: Address, data: Hex): Promise<Hex | undefined> {
  try {
    const r = await ctx.rpc.request<Hex>(chainId, "eth_call", [{ to, data }, "latest"]);
    return typeof r === "string" ? r : undefined;
  } catch {
    return undefined;
  }
}

/** True if the target looks like a token contract (ERC-165 ids or the ERC-20/777/LSP7 shape). */
export async function isTokenContract(ctx: VerbContext, chainId: number, target: Address): Promise<boolean> {
  const key = `${chainId}:${target.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key)!;
  const code = await ctx.rpc.request<Hex>(chainId, "eth_getCode", [target, "latest"]).catch(() => "0x" as Hex);
  let token = false;
  if (code && code !== "0x") {
    for (const id of [...LSP7_IDS, ...LSP8_IDS, ...NFT_IDS]) {
      const r = await call(ctx, chainId, target, encodeFunctionData({ abi: probeAbi, functionName: "supportsInterface", args: [id as Hex] }));
      if (r && r.length >= 66 && BigInt(r.slice(0, 66)) === 1n) {
        token = true;
        break;
      }
    }
    if (!token) {
      const ts = await call(ctx, chainId, target, encodeFunctionData({ abi: probeAbi, functionName: "totalSupply" }));
      const bal = await call(ctx, chainId, target, encodeFunctionData({ abi: probeAbi, functionName: "balanceOf", args: [target] }));
      token = Boolean(ts && ts.length === 66 && bal && bal.length === 66);
    }
  }
  cache.set(key, token);
  return token;
}

function delegated(policy: DelegationPolicy, target: Address): boolean {
  return policy.allowTokenMoves && (policy.tokenTargets.includes("*") || policy.tokenTargets.map((t) => t.toLowerCase()).includes(target.toLowerCase()));
}

/** Throws POLICY_DENIED if an autonomous (--yes) write would touch a token outside the delegation. */
export async function guardTokenMoves(ctx: VerbContext, policy: DelegationPolicy, req: ConsentRequest): Promise<void> {
  if (req.chainId === undefined) return;
  const calls = req.calls?.length ? req.calls : req.target ? [{ target: req.target, selector: req.selector, value: req.value }] : [];
  for (const c of calls) {
    const sel = (c.selector ?? "0x").toLowerCase();
    if (sel === "0x" || TOKEN_SAFE_SELECTORS.has(sel)) continue;
    if (delegated(policy, c.target)) continue;
    if (await isTokenContract(ctx, req.chainId, c.target)) {
      throw new UpError("POLICY_DENIED", `outside the delegated policy: ${c.target} is a token contract and function ${sel} may move assets or grant spending rights (policy.allowTokenMoves${policy.allowTokenMoves ? "/tokenTargets" : ""} does not cover it)`, {
        hint: "ask the human to approve this exact action and pass their words with --approval, or to delegate this token via up policy set",
        details: { confirmation: { action: req.verb, chainId: req.chainId, ...req.summary }, target: c.target, selector: sel },
      });
    }
  }
}
