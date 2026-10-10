// Builds the ERC725X calls for token actions performed AS THE PROFILE.
// Nothing here signs or sends: verbs hand the plan to executeAsProfile().
//
// LSP7/LSP8 `force`:
//   force = false → the recipient must be a contract implementing LSP1
//                   UniversalReceiver (e.g. a Universal Profile); EOAs and
//                   contracts without LSP1 make the transfer revert. This is the
//                   safe default: tokens cannot land somewhere that cannot handle them.
//   force = true  → any recipient (EOA, any contract) is accepted.
// Default when --force is not given: true for an EOA (an EOA can never satisfy
// force=false), false for an LSP1 contract (the recipient gets notified),
// and REFUSE for a contract without LSP1 (tokens could be stuck) unless the
// caller passes --force true explicitly.
import { encodeFunctionData, getAddress, maxUint256, zeroAddress, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import type { ExecCall } from "../exec/transport.ts";
import { detectStandards, supportsLsp1, type Detection } from "../abi/detect.ts";
import { lsp17Extensions } from "../abi/proxy.ts";
import { read, tryRead } from "../abi/read.ts";
import { describeCall } from "../abi/codec.ts";
import { ERC1155_ABI, ERC20_ABI, ERC721_ABI, LSP7_ABI, LSP8_ABI, assetLabel, formatAmount, formatLsp8TokenId, parseAmount, parseLsp8TokenId, parseUintTokenId, type AssetInfo } from "./assets.ts";

type Ctx = Pick<VerbContext, "rpc">;

export interface TokenPlan {
  calls: ExecCall[];
  /** One-line human description for the confirmation block. */
  description: string;
  /** Decoded call (function + args) for display. */
  decoded: string;
  warnings: string[];
  details: Record<string, unknown>;
}

function call(to: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[], value = 0n): { exec: ExecCall; decoded: string } {
  const data = encodeFunctionData({ abi: abi as any, functionName, args } as any);
  const fn = (abi as any[]).find((x) => x.type === "function" && x.name === functionName && x.inputs.length === args.length);
  return { exec: { operation: 0, to, value, data }, decoded: fn ? describeCall(fn, args) : `${functionName}(…)` };
}

export interface RecipientInfo {
  address: Address;
  kind: Detection["kind"];
  lsp1: boolean;
  isProfile: boolean;
  detection: Detection;
}

export async function inspectRecipient(ctx: Ctx, chainId: number, to: Address): Promise<RecipientInfo> {
  const d = await detectStandards(ctx, chainId, to);
  return { address: to, kind: d.kind, lsp1: supportsLsp1(d), isProfile: !!d.interfaces.LSP0ERC725Account, detection: d };
}

/** Decides the LSP7/LSP8 `force` flag (see header). */
export function decideForce(r: RecipientInfo, explicit: boolean | undefined): { force: boolean; reason: string } {
  if (explicit !== undefined) {
    if (!explicit && !r.lsp1) {
      throw new UpError("BAD_ARGS", `--force false will revert: ${r.address} is ${r.kind === "contract" ? "a contract without LSP1 UniversalReceiver" : "an EOA"}`, {
        hint: "force=false only works for recipients implementing LSP1 (e.g. Universal Profiles); use --force true to send anyway",
      });
    }
    return { force: explicit, reason: explicit ? "force=true requested: any recipient accepted, no LSP1 check" : "force=false requested: recipient implements LSP1 and is notified" };
  }
  if (r.kind !== "contract") return { force: true, reason: `recipient is ${r.kind === "eoa" ? "an EOA" : "a delegated EOA"}: force=true is required (EOAs cannot implement LSP1)` };
  if (r.lsp1) return { force: false, reason: `recipient implements LSP1${r.isProfile ? " (Universal Profile)" : ""}: force=false (safe; recipient is notified)` };
  throw new UpError("BAD_ARGS", `recipient ${r.address} is a contract that does not implement LSP1 UniversalReceiver; the tokens could be stuck there`, {
    hint: "double-check the recipient; if it can really handle the tokens, re-run with --force true",
  });
}

async function hasExtension(ctx: Ctx, chainId: number, account: Address, selector: Hex): Promise<boolean> {
  try {
    return (await lsp17Extensions(ctx, chainId, account, [selector])).length > 0;
  } catch {
    return false;
  }
}

export interface TransferOptions {
  to: Address;
  amount?: unknown;
  raw?: boolean;
  tokenId?: unknown;
  force?: boolean;
  data?: Hex;
  /** ERC-721: use safeTransferFrom (default) */
  safe?: boolean;
}

export async function planTransfer(ctx: Ctx, chainId: number, profile: Address, asset: AssetInfo, o: TransferOptions): Promise<TokenPlan> {
  const to = getAddress(o.to);
  if (to.toLowerCase() === profile.toLowerCase()) throw new UpError("BAD_ARGS", "recipient is the profile itself");
  if (to === zeroAddress) throw new UpError("BAD_ARGS", "refusing to transfer to the zero address (that is a burn)");
  const data = (o.data ?? "0x") as Hex;
  const label = assetLabel(asset);
  const rcpt = await inspectRecipient(ctx, chainId, to);
  const warnings = [...asset.warnings];
  const details: Record<string, unknown> = { asset: asset.address, standard: asset.standard, recipient: to, recipientKind: rcpt.kind, recipientIsProfile: rcpt.isProfile, recipientLsp1: rcpt.lsp1 };

  switch (asset.standard) {
    case "LSP7": {
      const amount = parseAmount(o.amount, asset.decimals, o.raw);
      if (amount === 0n) throw new UpError("BAD_ARGS", "--amount must be greater than zero");
      const bal = await read<bigint>(ctx, chainId, { address: asset.address, abi: LSP7_ABI(), functionName: "balanceOf", args: [profile] });
      if (bal < amount) throw new UpError("BAD_ARGS", `insufficient balance: profile holds ${formatAmount(bal, asset.decimals)}, transfer needs ${formatAmount(amount, asset.decimals)}`, { details: { balance: bal, amount } });
      const f = decideForce(rcpt, o.force);
      warnings.push(f.reason);
      const c = call(asset.address, LSP7_ABI(), "transfer", [profile, to, amount, f.force, data]);
      Object.assign(details, { amount: amount.toString(), amountFormatted: formatAmount(amount, asset.decimals), decimals: asset.decimals, force: f.force });
      return { calls: [c.exec], decoded: c.decoded, description: `transfer ${formatAmount(amount, asset.decimals)} ${label} from ${profile} to ${to} (force=${f.force})`, warnings, details };
    }
    case "LSP8": {
      const tokenId = parseLsp8TokenId(o.tokenId, asset.tokenIdFormat);
      const owner = await tryRead<Address>(ctx, chainId, { address: asset.address, abi: LSP8_ABI(), functionName: "tokenOwnerOf", args: [tokenId] });
      if (!owner.ok) throw new UpError("BAD_ARGS", `token id ${tokenId} does not exist on ${asset.address}`, { details: { error: owner.error } });
      if (owner.value.toLowerCase() !== profile.toLowerCase()) throw new UpError("BAD_ARGS", `token id ${formatLsp8TokenId(tokenId, asset.tokenIdFormat)} is owned by ${owner.value}, not by the profile`);
      const f = decideForce(rcpt, o.force);
      warnings.push(f.reason);
      const c = call(asset.address, LSP8_ABI(), "transfer", [profile, to, tokenId, f.force, data]);
      Object.assign(details, { tokenId, tokenIdReadable: formatLsp8TokenId(tokenId, asset.tokenIdFormat), force: f.force });
      return { calls: [c.exec], decoded: c.decoded, description: `transfer ${label} token ${formatLsp8TokenId(tokenId, asset.tokenIdFormat)} from ${profile} to ${to} (force=${f.force})`, warnings, details };
    }
    case "ERC20": {
      if (o.force !== undefined) warnings.push("--force has no meaning for ERC-20 and was ignored");
      const amount = parseAmount(o.amount, asset.decimals, o.raw);
      if (amount === 0n) throw new UpError("BAD_ARGS", "--amount must be greater than zero");
      const bal = await read<bigint>(ctx, chainId, { address: asset.address, abi: ERC20_ABI, functionName: "balanceOf", args: [profile] });
      if (bal < amount) throw new UpError("BAD_ARGS", `insufficient balance: profile holds ${formatAmount(bal, asset.decimals)}, transfer needs ${formatAmount(amount, asset.decimals)}`, { details: { balance: bal, amount } });
      if (rcpt.kind === "contract" && !rcpt.isProfile) warnings.push("recipient is a contract: ERC-20 has no receiver hook, tokens sent to a contract that cannot move them are lost");
      const c = call(asset.address, ERC20_ABI, "transfer", [to, amount]);
      Object.assign(details, { amount: amount.toString(), amountFormatted: formatAmount(amount, asset.decimals), decimals: asset.decimals });
      return { calls: [c.exec], decoded: c.decoded, description: `transfer ${formatAmount(amount, asset.decimals)} ${label} from ${profile} to ${to}`, warnings, details };
    }
    case "ERC721": {
      const id = parseUintTokenId(o.tokenId);
      const owner = await tryRead<Address>(ctx, chainId, { address: asset.address, abi: ERC721_ABI, functionName: "ownerOf", args: [id] });
      if (!owner.ok) throw new UpError("BAD_ARGS", `token id ${id} does not exist on ${asset.address}`);
      if (owner.value.toLowerCase() !== profile.toLowerCase()) throw new UpError("BAD_ARGS", `token id ${id} is owned by ${owner.value}, not by the profile`);
      const safe = o.safe ?? true;
      if (safe && rcpt.kind === "contract") {
        if (rcpt.isProfile) {
          if (!(await hasExtension(ctx, chainId, to, "0x150b7a02"))) {
            throw new UpError("BAD_ARGS", `safeTransferFrom to Universal Profile ${to} will revert: it has no onERC721Received LSP17 extension (ERCTokenCallbacks) registered`, {
              hint: "ask the recipient to register the ERCTokenCallbacks extension, or use --safe false (transferFrom, no receiver check)",
            });
          }
          warnings.push("recipient Universal Profile has the onERC721Received extension: safeTransferFrom will succeed");
        } else warnings.push("recipient is a contract: safeTransferFrom reverts unless it implements onERC721Received");
      }
      if (!safe) warnings.push("transferFrom skips the ERC-721 receiver check: a contract recipient that cannot handle NFTs would lock the token");
      if (o.force !== undefined) warnings.push("--force has no meaning for ERC-721 and was ignored");
      const c = safe ? call(asset.address, ERC721_ABI, "safeTransferFrom", [profile, to, id, data]) : call(asset.address, ERC721_ABI, "transferFrom", [profile, to, id]);
      Object.assign(details, { tokenId: id.toString(), method: safe ? "safeTransferFrom" : "transferFrom" });
      return { calls: [c.exec], decoded: c.decoded, description: `transfer ${label} token #${id} from ${profile} to ${to} via ${safe ? "safeTransferFrom" : "transferFrom"}`, warnings, details };
    }
    case "ERC1155": {
      const id = parseUintTokenId(o.tokenId);
      const amount = parseAmount(o.amount ?? "1", 0, true);
      if (amount === 0n) throw new UpError("BAD_ARGS", "--amount must be greater than zero");
      const bal = await read<bigint>(ctx, chainId, { address: asset.address, abi: ERC1155_ABI, functionName: "balanceOf", args: [profile, id] });
      if (bal < amount) throw new UpError("BAD_ARGS", `insufficient balance of id ${id}: profile holds ${bal}, transfer needs ${amount}`);
      if (rcpt.kind === "contract") {
        if (rcpt.isProfile && !(await hasExtension(ctx, chainId, to, "0xf23a6e61"))) {
          throw new UpError("BAD_ARGS", `ERC-1155 transfer to Universal Profile ${to} will revert: it has no onERC1155Received LSP17 extension (ERCTokenCallbacks) registered`, {
            hint: "ask the recipient to register the ERCTokenCallbacks extension first",
          });
        }
        if (!rcpt.isProfile) warnings.push("recipient is a contract: ERC-1155 transfers revert unless it implements onERC1155Received");
      }
      const c = call(asset.address, ERC1155_ABI, "safeTransferFrom", [profile, to, id, amount, data]);
      Object.assign(details, { tokenId: id.toString(), amount: amount.toString() });
      return { calls: [c.exec], decoded: c.decoded, description: `transfer ${amount} × ${label} id ${id} from ${profile} to ${to}`, warnings, details };
    }
  }
}

export async function planNativeTransfer(ctx: Ctx, chainId: number, profile: Address, nativeSymbol: string, o: { to: Address; amount: unknown; raw?: boolean }): Promise<TokenPlan> {
  const to = getAddress(o.to);
  if (to.toLowerCase() === profile.toLowerCase()) throw new UpError("BAD_ARGS", "recipient is the profile itself");
  const value = parseAmount(o.amount, 18, o.raw);
  if (value === 0n) throw new UpError("BAD_ARGS", "--amount must be greater than zero");
  const bal = BigInt(await ctx.rpc.request<Hex>(chainId, "eth_getBalance", [profile, "latest"]));
  if (bal < value) throw new UpError("BAD_ARGS", `insufficient ${nativeSymbol}: profile holds ${formatAmount(bal, 18)}, transfer needs ${formatAmount(value, 18)}`, { details: { balance: bal, value } });
  const rcpt = await inspectRecipient(ctx, chainId, to);
  const warnings: string[] = [];
  if (rcpt.kind === "contract" && !rcpt.isProfile) warnings.push("recipient is a contract: the transfer reverts if it does not accept native value");
  return {
    calls: [{ operation: 0, to, value, data: "0x" }],
    decoded: `native transfer of ${value} wei`,
    description: `send ${formatAmount(value, 18)} ${nativeSymbol} from ${profile} to ${to}`,
    warnings,
    details: { native: true, symbol: nativeSymbol, recipient: to, value: value.toString(), valueFormatted: formatAmount(value, 18), recipientKind: rcpt.kind },
  };
}

// ---------------------------------------------------------------------------
// Approvals / operators
// ---------------------------------------------------------------------------

export type ApproveMode = "authorize" | "revoke" | "increase" | "decrease" | "all" | "revoke-all";
export const APPROVE_MODES: readonly ApproveMode[] = ["authorize", "revoke", "increase", "decrease", "all", "revoke-all"];

export interface ApproveOptions {
  operator: Address;
  mode: ApproveMode;
  amount?: unknown;
  raw?: boolean;
  unlimited?: boolean;
  tokenId?: unknown;
  notify?: boolean;
  data?: Hex;
}

function unsupported(asset: AssetInfo, mode: ApproveMode): UpError {
  return new UpError("BAD_ARGS", `mode "${mode}" is not available for ${asset.standard}`, {
    hint:
      asset.standard === "LSP7"
        ? "LSP7 modes: authorize, revoke, increase, decrease"
        : asset.standard === "LSP8"
          ? "LSP8 modes: authorize, revoke (per --token-id)"
          : asset.standard === "ERC20"
            ? "ERC-20 modes: authorize (approve), revoke (approve 0)"
            : asset.standard === "ERC721"
              ? "ERC-721 modes: authorize/revoke with --token-id, all/revoke-all for every token"
              : "ERC-1155 modes: all (setApprovalForAll true), revoke-all",
  });
}

export async function planApprove(ctx: Ctx, chainId: number, profile: Address, asset: AssetInfo, o: ApproveOptions): Promise<TokenPlan> {
  const op = getAddress(o.operator);
  if (op === zeroAddress) throw new UpError("BAD_ARGS", "operator must not be the zero address");
  if (op.toLowerCase() === profile.toLowerCase()) throw new UpError("BAD_ARGS", "the profile cannot be its own operator");
  const data = (o.data ?? "0x") as Hex;
  const label = assetLabel(asset);
  const warnings = [...asset.warnings];
  const details: Record<string, unknown> = { asset: asset.address, standard: asset.standard, operator: op, mode: o.mode };
  const amountOf = (): bigint => {
    if (o.unlimited) {
      warnings.push(`UNLIMITED approval: ${op} will be able to move ALL of the profile's ${label} now and in the future, until revoked`);
      return maxUint256;
    }
    const v = parseAmount(o.amount, asset.decimals, o.raw);
    details.amount = v.toString();
    details.amountFormatted = formatAmount(v, asset.decimals);
    return v;
  };
  const opDet = await detectStandards(ctx, chainId, op);
  details.operatorKind = opDet.kind;
  const plan = (c: { exec: ExecCall; decoded: string }, description: string): TokenPlan => ({ calls: [c.exec], decoded: c.decoded, description, warnings, details });

  switch (asset.standard) {
    case "LSP7": {
      if (o.mode === "authorize") {
        const amt = amountOf();
        if (amt === 0n) throw new UpError("BAD_ARGS", "use --mode revoke to remove an operator");
        warnings.push(`${op} may transfer up to ${amt === maxUint256 ? "UNLIMITED" : formatAmount(amt, asset.decimals)} ${label} out of the profile`);
        return plan(call(asset.address, LSP7_ABI(), "authorizeOperator", [op, amt, data]), `authorize ${op} as operator for ${amt === maxUint256 ? "UNLIMITED" : formatAmount(amt, asset.decimals)} ${label}`);
      }
      if (o.mode === "revoke") return plan(call(asset.address, LSP7_ABI(), "revokeOperator", [op, profile, !!o.notify, data]), `revoke operator ${op} on ${label}${o.notify ? " (notify)" : ""}`);
      if (o.mode === "increase") {
        const amt = amountOf();
        return plan(call(asset.address, LSP7_ABI(), "increaseAllowance", [op, amt, data]), `increase ${op}'s allowance on ${label} by ${formatAmount(amt, asset.decimals)}`);
      }
      if (o.mode === "decrease") {
        const amt = amountOf();
        return plan(call(asset.address, LSP7_ABI(), "decreaseAllowance", [op, profile, amt, data]), `decrease ${op}'s allowance on ${label} by ${formatAmount(amt, asset.decimals)}`);
      }
      throw unsupported(asset, o.mode);
    }
    case "LSP8": {
      const tokenId = parseLsp8TokenId(o.tokenId, asset.tokenIdFormat);
      details.tokenId = tokenId;
      if (o.mode === "authorize") {
        warnings.push(`${op} may transfer token ${formatLsp8TokenId(tokenId, asset.tokenIdFormat)} out of the profile`);
        return plan(call(asset.address, LSP8_ABI(), "authorizeOperator", [op, tokenId, data]), `authorize ${op} as operator of ${label} token ${formatLsp8TokenId(tokenId, asset.tokenIdFormat)}`);
      }
      if (o.mode === "revoke") return plan(call(asset.address, LSP8_ABI(), "revokeOperator", [op, tokenId, !!o.notify, data]), `revoke operator ${op} on ${label} token ${formatLsp8TokenId(tokenId, asset.tokenIdFormat)}`);
      throw unsupported(asset, o.mode);
    }
    case "ERC20": {
      if (o.mode === "authorize") {
        const amt = amountOf();
        const cur = await tryRead<bigint>(ctx, chainId, { address: asset.address, abi: ERC20_ABI, functionName: "allowance", args: [profile, op] });
        if (cur.ok && cur.value > 0n && amt > 0n) warnings.push(`existing allowance ${formatAmount(cur.value, asset.decimals)} is replaced; some tokens (e.g. USDT) require setting it to 0 first (--mode revoke)`);
        return plan(call(asset.address, ERC20_ABI, "approve", [op, amt]), `approve ${op} to spend ${amt === maxUint256 ? "UNLIMITED" : formatAmount(amt, asset.decimals)} ${label}`);
      }
      if (o.mode === "revoke") return plan(call(asset.address, ERC20_ABI, "approve", [op, 0n]), `revoke ${op}'s allowance on ${label} (approve 0)`);
      throw unsupported(asset, o.mode);
    }
    case "ERC721": {
      if (o.mode === "authorize" || o.mode === "revoke") {
        const id = parseUintTokenId(o.tokenId);
        details.tokenId = id.toString();
        const target = o.mode === "authorize" ? op : zeroAddress;
        return plan(call(asset.address, ERC721_ABI, "approve", [target, id]), o.mode === "authorize" ? `approve ${op} for ${label} token #${id}` : `clear the approval of ${label} token #${id}`);
      }
      if (o.mode === "all") {
        warnings.push(`setApprovalForAll lets ${op} move EVERY token of ${label} the profile holds, now and in the future`);
        return plan(call(asset.address, ERC721_ABI, "setApprovalForAll", [op, true]), `approve ${op} for ALL ${label} tokens`);
      }
      if (o.mode === "revoke-all") return plan(call(asset.address, ERC721_ABI, "setApprovalForAll", [op, false]), `revoke ${op}'s approval for all ${label} tokens`);
      throw unsupported(asset, o.mode);
    }
    case "ERC1155": {
      if (o.mode === "all" || o.mode === "authorize") {
        warnings.push(`setApprovalForAll lets ${op} move EVERY token id of ${label} the profile holds (ERC-1155 has no per-id approval)`);
        return plan(call(asset.address, ERC1155_ABI, "setApprovalForAll", [op, true]), `approve ${op} for ALL ${label} token ids`);
      }
      if (o.mode === "revoke" || o.mode === "revoke-all") return plan(call(asset.address, ERC1155_ABI, "setApprovalForAll", [op, false]), `revoke ${op}'s approval for all ${label} token ids`);
      throw unsupported(asset, o.mode);
    }
  }
}
