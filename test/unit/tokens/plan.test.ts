// Token planners against a fake chain: proves calldata, force decisions,
// ownership/balance checks and receiver-hook handling for every standard
// (ERC-20/721/1155 have no bytecode fixtures, so they are covered here).
import { describe, expect, it } from "vitest";
import { decodeFunctionData, maxUint256, pad, type Address, type Hex } from "viem";
import { ERC1155_ABI, ERC20_ABI, ERC721_ABI, LSP7_ABI, LSP8_ABI, formatLsp8TokenId, parseAmount, parseLsp8TokenId, resolveAsset } from "../../../src/tokens/assets.ts";
import { decideForce, planApprove, planNativeTransfer, planTransfer, type RecipientInfo } from "../../../src/tokens/plan.ts";
import { lsp17ExtensionKey } from "../../../src/abi/proxy.ts";
import { fakeCtx, fakeRpc, type FakeContract } from "../abi/support/fake.ts";

const PROFILE = "0x9999999999999999999999999999999999999999" as Address;
const EOA = "0x0F4180da178ed1C71398a57ca8Cb177F69591f1f" as Address;
const OTHER_UP = "0x8888888888888888888888888888888888888888" as Address;
const PLAIN_CONTRACT = "0x7777777777777777777777777777777777777777" as Address;
const TOK = { erc20: "0x2000000000000000000000000000000000000020", lsp7: "0x7000000000000000000000000000000000000007", lsp8: "0x8000000000000000000000000000000000000008", erc721: "0x7210000000000000000000000000000000000721", erc1155: "0x1155000000000000000000000000000000001155" } as const;
const CALLBACKS = "0x082d49D8487d2ed2527440c7879C66d850daaBc5";

const UP_IFACES = ["0x24871b3d", "0x629aa694", "0x6bb56a14"];
const ID7 = pad("0x07", { size: 32 });

function chain(extra: Record<string, FakeContract> = {}) {
  return fakeRpc(
    {
      [PROFILE]: { interfaces: UP_IFACES, data: {} },
      [OTHER_UP]: { interfaces: UP_IFACES, data: {} },
      [PLAIN_CONTRACT]: { interfaces: [] },
      [TOK.erc20]: { abi: ERC20_ABI, handlers: { decimals: () => 6, symbol: () => "USDC", name: () => "USD Coin", totalSupply: () => 10n ** 15n, balanceOf: ([a]) => ((a as string).toLowerCase() === PROFILE.toLowerCase() ? 100_000_000n : 0n), allowance: () => 5n } },
      [TOK.lsp7]: { interfaces: ["0xc52d6008", "0x629aa694"], data: {}, abi: LSP7_ABI(), handlers: { decimals: () => 18, balanceOf: ([a]) => ((a as string).toLowerCase() === PROFILE.toLowerCase() ? 10n ** 19n : 0n), totalSupply: () => 10n ** 19n } },
      [TOK.lsp8]: { interfaces: ["0x3a271706", "0x629aa694"], data: {}, abi: LSP8_ABI(), handlers: { tokenOwnerOf: ([id]) => (id === ID7 ? PROFILE : EOA) } },
      [TOK.erc721]: { interfaces: ["0x80ac58cd"], abi: ERC721_ABI, handlers: { ownerOf: ([id]) => ((id as bigint) === 7n ? PROFILE : EOA), name: () => "Punk", symbol: () => "P" } },
      [TOK.erc1155]: { interfaces: ["0xd9b67a26"], abi: ERC1155_ABI, handlers: { balanceOf: ([, id]) => ((id as bigint) === 3n ? 5n : 0n) } },
      ...extra,
    },
    { balances: { [PROFILE.toLowerCase()]: 10n ** 18n } },
  );
}

async function asset(rpc: ReturnType<typeof chain>, addr: string, std = "auto") {
  return resolveAsset(fakeCtx(rpc), 42, addr as Address, std);
}

const decode = (abi: readonly unknown[], data: Hex) => decodeFunctionData({ abi: abi as any, data });

describe("asset resolution", () => {
  it("detects every standard and reads decimals/symbols", async () => {
    const rpc = chain();
    expect(await asset(rpc, TOK.erc20)).toMatchObject({ standard: "ERC20", decimals: 6, symbol: "USDC" });
    expect(await asset(rpc, TOK.lsp7)).toMatchObject({ standard: "LSP7", decimals: 18 });
    expect(await asset(rpc, TOK.lsp8)).toMatchObject({ standard: "LSP8", decimals: 0 });
    expect(await asset(rpc, TOK.erc721)).toMatchObject({ standard: "ERC721", symbol: "P" });
    expect(await asset(rpc, TOK.erc1155)).toMatchObject({ standard: "ERC1155" });
    await expect(asset(rpc, EOA)).rejects.toThrow(/no contract code/);
    await expect(asset(rpc, PLAIN_CONTRACT)).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    const forced = await asset(rpc, TOK.erc20, "LSP7");
    expect(forced.warnings.join(" ")).toMatch(/overrides the detected standard ERC20/);
  });
});

describe("unknown decimals are never assumed", () => {
  it("LSP7 whose decimals() reverts: human units refused, --raw accepted", async () => {
    const BROKEN = "0x7100000000000000000000000000000000000071";
    const rpc = chain({ [BROKEN]: { interfaces: ["0xc52d6008", "0x629aa694"], data: {}, abi: LSP7_ABI(), handlers: { balanceOf: () => 10n ** 30n } } });
    const a = await asset(rpc, BROKEN);
    expect(a.decimals).toBeUndefined();
    expect(a.warnings.join(" ")).toMatch(/decimals\(\) .* could not be read/);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, amount: "1.5" })).rejects.toMatchObject({ code: "BAD_ARGS", hint: expect.stringMatching(/--raw/) });
    const raw = await planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, amount: "15", raw: true });
    expect(decode(LSP7_ABI(), raw.calls[0].data).args[2]).toBe(15n);
    expect(raw.description).toMatch(/15 base units/);
    await expect(planApprove(fakeCtx(rpc), 42, PROFILE, a, { operator: EOA, mode: "authorize", amount: "1" })).rejects.toThrow(/decimals\(\) could not be read/);
  });

  it("ERC-20 forced with --standard: decimals() is read directly, refused if unreadable", async () => {
    const NODEC = "0x2100000000000000000000000000000000000021";
    const WITHDEC = "0x2200000000000000000000000000000000000022";
    const rpc = chain({
      [NODEC]: { abi: ERC20_ABI, handlers: { balanceOf: () => 10n ** 20n } },
      [WITHDEC]: { abi: ERC20_ABI, handlers: { decimals: () => 8, symbol: () => "W", balanceOf: () => 10n ** 20n } },
    });
    const forced = await asset(rpc, NODEC, "ERC20");
    expect(forced.decimals).toBeUndefined();
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, forced, { to: EOA, amount: "1" })).rejects.toThrow(/--raw|decimals/);
    const ok = await asset(rpc, WITHDEC, "ERC20");
    expect(ok).toMatchObject({ decimals: 8, symbol: "W" });
  });
});

describe("LSP7/LSP8 force decision", () => {
  const r = (kind: RecipientInfo["kind"], lsp1: boolean): RecipientInfo => ({ address: EOA, kind, lsp1, isProfile: lsp1, detection: {} as any });
  it("defaults: EOA → true, LSP1 contract → false, other contract → refuse", () => {
    expect(decideForce(r("eoa", false), undefined).force).toBe(true);
    expect(decideForce(r("eoa-7702", false), undefined).force).toBe(true);
    expect(decideForce(r("contract", true), undefined).force).toBe(false);
    expect(() => decideForce(r("contract", false), undefined)).toThrow(/does not implement LSP1/);
  });
  it("explicit values are honoured, but force=false to a non-LSP1 recipient is refused (it would revert)", () => {
    expect(decideForce(r("contract", false), true).force).toBe(true);
    expect(decideForce(r("contract", true), true).force).toBe(true);
    expect(() => decideForce(r("eoa", false), false)).toThrow(/will revert/);
  });
});

describe("transfer planning", () => {
  it("LSP7 to an EOA: transfer(from=profile, to, amount, force=true, data)", async () => {
    const rpc = chain();
    const p = await planTransfer(fakeCtx(rpc), 42, PROFILE, await asset(rpc, TOK.lsp7), { to: EOA, amount: "1.5" });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]).toMatchObject({ operation: 0, to: TOK.lsp7, value: 0n });
    const d = decode(LSP7_ABI(), p.calls[0].data);
    expect(d.functionName).toBe("transfer");
    expect(d.args).toEqual([PROFILE, EOA, 1_500_000_000_000_000_000n, true, "0x"]);
    expect(p.warnings.join(" ")).toMatch(/EOA: force=true/);
    expect(p.description).toMatch(/transfer 1\.5 /);
  });

  it("LSP7 to a Universal Profile defaults to force=false; insufficient balance and bad precision are refused", async () => {
    const rpc = chain();
    const a = await asset(rpc, TOK.lsp7);
    const p = await planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: OTHER_UP, amount: "2" });
    expect(decode(LSP7_ABI(), p.calls[0].data).args[3]).toBe(false);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: OTHER_UP, amount: "11" })).rejects.toThrow(/insufficient balance/);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: PLAIN_CONTRACT, amount: "1" })).rejects.toThrow(/does not implement LSP1/);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: PROFILE, amount: "1" })).rejects.toThrow(/profile itself/);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, amount: "0" })).rejects.toThrow(/greater than zero/);
  });

  it("LSP8 by token id with ownership check", async () => {
    const rpc = chain();
    const a = await asset(rpc, TOK.lsp8);
    const p = await planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, tokenId: "7" });
    expect(decode(LSP8_ABI(), p.calls[0].data).args).toEqual([PROFILE, EOA, ID7, true, "0x"]);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, tokenId: "8" })).rejects.toThrow(/owned by/);
  });

  it("ERC-20 transfer(to, amount) with token decimals", async () => {
    const rpc = chain();
    const p = await planTransfer(fakeCtx(rpc), 42, PROFILE, await asset(rpc, TOK.erc20), { to: EOA, amount: "12.5" });
    const d = decode(ERC20_ABI, p.calls[0].data);
    expect(d.functionName).toBe("transfer");
    expect(d.args).toEqual([EOA, 12_500_000n]);
    const raw = await planTransfer(fakeCtx(rpc), 42, PROFILE, await asset(rpc, TOK.erc20), { to: EOA, amount: "7", raw: true });
    expect(decode(ERC20_ABI, raw.calls[0].data).args).toEqual([EOA, 7n]);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, await asset(rpc, TOK.erc20), { to: EOA, amount: "0.0000001" })).rejects.toThrow(/decimal places/);
  });

  it("ERC-721: safeTransferFrom by default; a UP recipient needs the onERC721Received extension", async () => {
    const rpc = chain();
    const a = await asset(rpc, TOK.erc721);
    const p = await planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, tokenId: 7 });
    const d = decode(ERC721_ABI, p.calls[0].data);
    expect(d.functionName).toBe("safeTransferFrom");
    expect(d.args).toEqual([PROFILE, EOA, 7n, "0x"]);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: OTHER_UP, tokenId: 7 })).rejects.toThrow(/no onERC721Received LSP17 extension/);
    const unsafe = await planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: OTHER_UP, tokenId: 7, safe: false });
    expect(decode(ERC721_ABI, unsafe.calls[0].data).functionName).toBe("transferFrom");
    expect(unsafe.warnings.join(" ")).toMatch(/skips the ERC-721 receiver check/);
    const withExt = chain({ [OTHER_UP]: { interfaces: UP_IFACES, data: { [lsp17ExtensionKey("0x150b7a02")]: CALLBACKS.toLowerCase() as Hex } } });
    const ok = await planTransfer(fakeCtx(withExt), 42, PROFILE, await asset(withExt, TOK.erc721), { to: OTHER_UP, tokenId: 7 });
    expect(ok.warnings.join(" ")).toMatch(/has the onERC721Received extension/);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, tokenId: 8 })).rejects.toThrow(/owned by/);
  });

  it("ERC-1155 safeTransferFrom(from, to, id, amount, data) with balance check", async () => {
    const rpc = chain();
    const a = await asset(rpc, TOK.erc1155);
    const p = await planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, tokenId: 3, amount: "2" });
    expect(decode(ERC1155_ABI, p.calls[0].data).args).toEqual([PROFILE, EOA, 3n, 2n, "0x"]);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: EOA, tokenId: 3, amount: "6" })).rejects.toThrow(/insufficient balance/);
    await expect(planTransfer(fakeCtx(rpc), 42, PROFILE, a, { to: OTHER_UP, tokenId: 3, amount: "1" })).rejects.toThrow(/onERC1155Received/);
  });

  it("native transfer: value call with empty data and balance check", async () => {
    const rpc = chain();
    const p = await planNativeTransfer(fakeCtx(rpc), 42, PROFILE, "LYX", { to: EOA, amount: "0.25" });
    expect(p.calls).toEqual([{ operation: 0, to: EOA, value: 250_000_000_000_000_000n, data: "0x" }]);
    await expect(planNativeTransfer(fakeCtx(rpc), 42, PROFILE, "LYX", { to: EOA, amount: "2" })).rejects.toThrow(/insufficient LYX/);
  });
});

describe("approval planning", () => {
  it("LSP7 authorize / revoke / increase / decrease", async () => {
    const rpc = chain();
    const a = await asset(rpc, TOK.lsp7);
    const ctx = fakeCtx(rpc);
    const auth = await planApprove(ctx, 42, PROFILE, a, { operator: EOA, mode: "authorize", amount: "3" });
    expect(decode(LSP7_ABI(), auth.calls[0].data)).toMatchObject({ functionName: "authorizeOperator", args: [EOA, 3n * 10n ** 18n, "0x"] });
    const rev = await planApprove(ctx, 42, PROFILE, a, { operator: EOA, mode: "revoke", notify: true });
    expect(decode(LSP7_ABI(), rev.calls[0].data)).toMatchObject({ functionName: "revokeOperator", args: [EOA, PROFILE, true, "0x"] });
    const inc = await planApprove(ctx, 42, PROFILE, a, { operator: EOA, mode: "increase", amount: "1" });
    expect(decode(LSP7_ABI(), inc.calls[0].data).functionName).toBe("increaseAllowance");
    const dec = await planApprove(ctx, 42, PROFILE, a, { operator: EOA, mode: "decrease", amount: "1" });
    expect(decode(LSP7_ABI(), dec.calls[0].data)).toMatchObject({ functionName: "decreaseAllowance", args: [EOA, PROFILE, 10n ** 18n, "0x"] });
    const unl = await planApprove(ctx, 42, PROFILE, a, { operator: EOA, mode: "authorize", unlimited: true });
    expect(decode(LSP7_ABI(), unl.calls[0].data).args[1]).toBe(maxUint256);
    expect(unl.warnings.join(" ")).toMatch(/UNLIMITED/);
    await expect(planApprove(ctx, 42, PROFILE, a, { operator: EOA, mode: "all" })).rejects.toThrow(/not available for LSP7/);
    await expect(planApprove(ctx, 42, PROFILE, a, { operator: PROFILE, mode: "authorize", amount: "1" })).rejects.toThrow(/own operator/);
  });

  it("LSP8 per token id", async () => {
    const rpc = chain();
    const a = await asset(rpc, TOK.lsp8);
    const p = await planApprove(fakeCtx(rpc), 42, PROFILE, a, { operator: EOA, mode: "authorize", tokenId: ID7 });
    expect(decode(LSP8_ABI(), p.calls[0].data)).toMatchObject({ functionName: "authorizeOperator", args: [EOA, ID7, "0x"] });
  });

  it("ERC-20 approve warns on unlimited and on replacing an existing allowance; revoke = approve 0", async () => {
    const rpc = chain();
    const a = await asset(rpc, TOK.erc20);
    const p = await planApprove(fakeCtx(rpc), 42, PROFILE, a, { operator: EOA, mode: "authorize", unlimited: true });
    expect(decode(ERC20_ABI, p.calls[0].data)).toMatchObject({ functionName: "approve", args: [EOA, maxUint256] });
    expect(p.warnings.join(" ")).toMatch(/UNLIMITED approval/);
    expect(p.warnings.join(" ")).toMatch(/existing allowance/);
    const r = await planApprove(fakeCtx(rpc), 42, PROFILE, a, { operator: EOA, mode: "revoke" });
    expect(decode(ERC20_ABI, r.calls[0].data).args).toEqual([EOA, 0n]);
  });

  it("ERC-721 per-token approve vs approval-for-all; ERC-1155 approval-for-all only", async () => {
    const rpc = chain();
    const nft = await asset(rpc, TOK.erc721);
    const one = await planApprove(fakeCtx(rpc), 42, PROFILE, nft, { operator: EOA, mode: "authorize", tokenId: 7 });
    expect(decode(ERC721_ABI, one.calls[0].data)).toMatchObject({ functionName: "approve", args: [EOA, 7n] });
    const all = await planApprove(fakeCtx(rpc), 42, PROFILE, nft, { operator: EOA, mode: "all" });
    expect(decode(ERC721_ABI, all.calls[0].data)).toMatchObject({ functionName: "setApprovalForAll", args: [EOA, true] });
    expect(all.warnings.join(" ")).toMatch(/EVERY token/);
    const m = await asset(rpc, TOK.erc1155);
    const off = await planApprove(fakeCtx(rpc), 42, PROFILE, m, { operator: EOA, mode: "revoke" });
    expect(decode(ERC1155_ABI, off.calls[0].data)).toMatchObject({ functionName: "setApprovalForAll", args: [EOA, false] });
    await expect(planApprove(fakeCtx(rpc), 42, PROFILE, m, { operator: EOA, mode: "increase", amount: "1" })).rejects.toThrow(/not available for ERC1155/);
  });
});

describe("token ids and amounts", () => {
  it("parses LSP8 token ids per LSP8TokenIdFormat", () => {
    expect(parseLsp8TokenId("7", 0)).toBe(ID7);
    expect(parseLsp8TokenId(ID7)).toBe(ID7);
    expect(parseLsp8TokenId("hello", 1)).toBe(`0x68656c6c6f${"0".repeat(54)}`);
    expect(parseLsp8TokenId(EOA, 2)).toBe(pad(EOA.toLowerCase() as Hex, { size: 32 }));
    expect(parseLsp8TokenId("12", 100)).toBe(pad("0x0c", { size: 32 })); // mixed formats, base Number
    expect(() => parseLsp8TokenId("hello", 0)).toThrow(/cannot interpret/);
    expect(() => parseLsp8TokenId("x".repeat(33), 1)).toThrow(/longer than 32 bytes/);
    expect(formatLsp8TokenId(ID7, 0)).toBe("7");
    expect(formatLsp8TokenId(parseLsp8TokenId("hello", 1), 1)).toBe("hello");
    expect(formatLsp8TokenId(parseLsp8TokenId(EOA, 2), 2)).toBe(EOA);
  });

  it("amounts are exact", () => {
    expect(parseAmount("1.25", 2)).toBe(125n);
    expect(() => parseAmount("1.255", 2)).toThrow();
    expect(() => parseAmount(undefined, 2)).toThrow(/required/);
    expect(() => parseAmount("-1", 2)).toThrow(/negative/);
  });
});

