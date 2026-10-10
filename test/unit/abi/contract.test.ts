import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { enforceTrustPolicy, isSensitiveDataKey, isValueMoving, parseNativeValue, resolveCall, valueMovingReason } from "../../../src/abi/contract.ts";
import { bundledAbi } from "../../../src/abi/bundled.ts";
import { lsp17ExtensionKey } from "../../../src/abi/proxy.ts";
import { fakeCtx, fakeRpc } from "./support/fake.ts";
import { LSP26_RUNTIME } from "../social/support/lsp26-runtime.ts";
import type { VerbContext } from "../../../src/core/types.ts";

const LSP26 = "0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA";
const UNKNOWN = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x7000000000000000000000000000000000000007";
const A = "0x0F4180da178ed1C71398a57ca8Cb177F69591f1f";
const DISPATCH = ("0x6080604052" + "8063a9059cbb14" + "61002557" + "00") as Hex;
const UP = bundledAbi("UniversalProfile");
const fn = (abi: any, name: string) => abi.find((x: any) => x.type === "function" && x.name === name);

function withFlags(ctx: VerbContext, flags: Partial<VerbContext["flags"]>): VerbContext {
  return { ...ctx, flags: { ...ctx.flags, ...flags } };
}

describe("value-moving classification (plan §2)", () => {
  const f = (name: string) => ({ name, inputs: [] });
  it("asset transfers, approvals, ownership and wrappers are value-moving; mint/follow/vote are not", () => {
    for (const n of ["transfer", "transferFrom", "safeTransferFrom", "transferBatch", "approve", "increaseAllowance", "authorizeOperator", "setApprovalForAll", "permit", "transferOwnership", "transferRemote", "swapExactTokensForTokens", "multicall"]) expect(isValueMoving(f(n), 0n), n).toBe(true);
    for (const n of ["mint", "follow", "poke", "delegate", "revokeOperator", "decreaseAllowance"]) expect(isValueMoving(f(n), 0n), n).toBe(false);
    expect(valueMovingReason(f("poke"), 1n)).toMatch(/native value/);
  });

  it("setData is value-moving only for permission / LSP17 / LSP1-delegate keys", () => {
    const setData = fn(UP, "setData");
    const benign = encodeFunctionData({ abi: UP, functionName: "setData", args: [`0x${"11".repeat(32)}`, "0x1234"] });
    expect(valueMovingReason(setData, 0n, benign)).toBeUndefined();
    const perm = encodeFunctionData({ abi: UP, functionName: "setData", args: [`0x4b80742de2bf82acb3630000${A.slice(2).toLowerCase()}`, `0x${"ff".repeat(32)}`] });
    expect(valueMovingReason(setData, 0n, perm)).toMatch(/permission\/extension\/delegate key/);
    const batch = encodeFunctionData({ abi: UP, functionName: "setDataBatch", args: [[`0x${"11".repeat(32)}`, lsp17ExtensionKey("0x150b7a02")], ["0x", "0x"]] });
    expect(valueMovingReason(fn(UP, "setDataBatch"), 0n, batch)).toMatch(/cee78b40/);
    expect(isSensitiveDataKey("0xdf30dba06db6a30e65354d9a64c609861f089545ca58c6b4dbe31a5f338cb0e3")).toBe(true); // AddressPermissions[]
    expect(isSensitiveDataKey("0x0cfc51aec37c55a4d0b1a65c6255c4bf2fbdf6277f3cc0730c45b828b6db8b47")).toBe(true); // LSP1UniversalReceiverDelegate
  });

  it("execute*/batch wrappers are always value-moving (inner calls are not trusted), incl. overloads and case variants", () => {
    const follow = encodeFunctionData({ abi: bundledAbi("LSP26FollowerSystem"), functionName: "follow", args: [A] });
    const data = encodeFunctionData({ abi: UP, functionName: "execute", args: [0n, A, 0n, follow] });
    expect(valueMovingReason(fn(UP, "execute"), 0n, data)).toMatch(/wraps other calls/);
    expect(isValueMoving(fn(UP, "executeBatch"), 0n)).toBe(true);
    for (const n of ["Execute", "executeRelayCall", "batchCalls", "multicall", "aggregate3", "handleAggregatedOps", "withdrawStake", "transferAndCall", "approveAndCall", "sendFrom", "redeem"]) expect(isValueMoving({ name: n, inputs: [] }, 0n), n).toBe(true);
  });

  it("setData overloads with key arrays are inspected key by key (no hiding behind a benign first key)", () => {
    const legacy = parseAbi(["function setData(bytes32[] keys, bytes[] values)"])[0];
    const perm = `0x4b80742de2bf82acb3630000${A.slice(2).toLowerCase()}` as Hex;
    const data = encodeFunctionData({ abi: [legacy], functionName: "setData", args: [[`0x${"11".repeat(32)}`, perm], ["0x", "0x"]] });
    expect(valueMovingReason(legacy, 0n, data)).toMatch(/4b80742de2bf/);
    expect(valueMovingReason({ name: "SetDataX", inputs: [] }, 0n)).toMatch(/could not be inspected/);
  });

  it("parses native values", () => {
    expect(parseNativeValue(undefined)).toBe(0n);
    expect(parseNativeValue("0.01")).toBe(10_000_000_000_000_000n);
    expect(parseNativeValue("1000 wei")).toBe(1000n);
    expect(parseNativeValue("2gwei")).toBe(2_000_000_000n);
    expect(() => parseNativeValue("-1")).toThrow();
    expect(() => parseNativeValue("0.0000000000000000001")).toThrow(/decimal places/);
  });
});

describe("resolveCall + trust policy", () => {
  it("bundled ABI (canonical LSP26 with matching code hash): follow() needs no approval", async () => {
    const ctx = fakeCtx(fakeRpc({ [LSP26]: { code: LSP26_RUNTIME } }));
    const call = await resolveCall(ctx, 42, LSP26, { fn: "follow", args: [A], offline: true });
    expect(call).toMatchObject({ trust: "bundled", source: "bundled:LSP26FollowerSystem", readOnly: false });
    expect(call.encoded.signature).toBe("follow(address)");
    expect(enforceTrustPolicy(ctx, call, 0n, { to: LSP26, data: call.encoded.data })).toEqual({ requiresApproval: false });
  });

  it("guessed ABI: any state-changing call requires a human approval", async () => {
    const ctx = fakeCtx(fakeRpc({ [UNKNOWN]: { code: DISPATCH } }));
    const call = await resolveCall(ctx, 42, UNKNOWN, { fn: "transfer", args: [A, "1"], offline: true });
    expect(call.trust).toBe("guessed");
    expect(call.warnings.join(" ")).toMatch(/GUESSED/);
    let err: any;
    try {
      enforceTrustPolicy(ctx, call, 0n, { to: UNKNOWN, data: call.encoded.data });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ABI_UNTRUSTED");
    expect(err.details.confirmation).toMatchObject({ target: UNKNOWN, calldata: call.encoded.data, trust: "guessed", signature: "transfer(address,uint256)" });
    expect(enforceTrustPolicy(withFlags(ctx, { approval: "yes, send it" }), call, 0n, { to: UNKNOWN, data: call.encoded.data })).toMatchObject({ requiresApproval: true });
    expect(enforceTrustPolicy(withFlags(ctx, { dryRun: true }), call, 0n, { to: UNKNOWN, data: call.encoded.data })).toMatchObject({ requiresApproval: true });
  });

  it("a bundled --abi is promoted to 'bundled' only when the target matches it on-chain", async () => {
    // LSP7 token (ERC-165) whose runtime dispatcher contains mint(address,uint256,bool,bytes) = 0x7580d920
    const mintSel = "7580d920";
    const code = (`0x6080604052` + `63${mintSel}14` + `61002557` + `8063a9059cbb14` + `00`) as Hex;
    const ctx = fakeCtx(fakeRpc({ [TOKEN]: { code, interfaces: ["0xc52d6008", "0x629aa694"], data: {} } }));
    const call = await resolveCall(ctx, 42, TOKEN, { fn: "mint", args: [A, "1", true, "0x"], abi: "LSP7Mintable", offline: true });
    expect(call.trust).toBe("bundled");
    expect(call.source).toMatch(/bundled:LSP7Mintable \(matched on-chain: standard LSP7 detected on-chain; selector 0x7580d920 present/);
    expect(enforceTrustPolicy(ctx, call, 0n, { to: TOKEN, data: call.encoded.data })).toEqual({ requiresApproval: false });
    // same bundled ABI on a contract whose bytecode lacks the selector → caller-supplied
    const ctx2 = fakeCtx(fakeRpc({ [TOKEN]: { code: DISPATCH, interfaces: ["0xc52d6008", "0x629aa694"], data: {} } }));
    const c2 = await resolveCall(ctx2, 42, TOKEN, { fn: "mint", args: [A, "1", true, "0x"], abi: "LSP7Mintable", offline: true });
    expect(c2.trust).toBe("user");
    expect(c2.warnings.join(" ")).toMatch(/selector 0x7580d920 was not found/);
    // a bundled ERC20 ABI on a contract with no detectable standard → caller-supplied
    const ctx3 = fakeCtx(fakeRpc({ [UNKNOWN]: { code: "0x6001" } }));
    const c3 = await resolveCall(ctx3, 42, UNKNOWN, { fn: "approve", args: [A, "5"], abi: "ERC20", offline: true });
    expect(c3.trust).toBe("user");
    expect(c3.warnings.join(" ")).toMatch(/no standard interface was detected/);
    expect(() => enforceTrustPolicy(ctx3, c3, 0n, { to: UNKNOWN, data: c3.encoded.data })).toThrow(/human approval required: value-moving call \(approve\(\)/);
  });

  it("inline ABIs and bare signatures stay 'user': harmless calls pass with a warning, value-moving ones need approval", async () => {
    const ctx = fakeCtx(fakeRpc({ [UNKNOWN]: { code: "0x6001" } }));
    const inline = await resolveCall(ctx, 42, UNKNOWN, { fn: "transfer", args: [A, "5"], abi: ["function transfer(address to, uint256 amount)"], offline: true });
    expect(inline.trust).toBe("user");
    expect(inline.warnings.join(" ")).toMatch(/not verified against the contract/);
    expect(() => enforceTrustPolicy(ctx, inline, 0n, { to: UNKNOWN, data: inline.encoded.data })).toThrow(/human approval required/);
    const harmless = await resolveCall(ctx, 42, UNKNOWN, { fn: "poke(uint256)", args: [1], offline: true });
    expect(harmless.trust).toBe("user");
    expect(enforceTrustPolicy(ctx, harmless, 0n, { to: UNKNOWN, data: harmless.encoded.data })).toEqual({ requiresApproval: false });
    expect(() => enforceTrustPolicy(ctx, harmless, 1n, { to: UNKNOWN, data: harmless.encoded.data })).toThrow(/value-moving/);
  });

  it("explains when a function cannot be resolved", async () => {
    const ctx = fakeCtx(fakeRpc({ [LSP26]: { code: LSP26_RUNTIME } }));
    await expect(resolveCall(ctx, 42, LSP26, { fn: "nope", offline: true })).rejects.toMatchObject({ code: "ABI_NOT_FOUND" });
  });
});

describe("review regressions: provenance is never laundered", () => {
  it("canonicalTrusted: pinned hash > registry chain listing; unlisted versions/chains are not trusted", async () => {
    const { canonicalTrusted } = await import("../../../src/abi/discovery.ts");
    const { canonicalContracts } = await import("../../../src/abi/bundled.ts");
    const { keccak256 } = await import("viem");
    const ctx = fakeCtx(fakeRpc({}));
    const upInit = canonicalContracts().get("0x3024d38ea2434ba6635003dc1bdc0dab5882ed4f")!;
    expect(canonicalTrusted(ctx, upInit, 42, keccak256("0x6001"))).toMatchObject({ ok: true, pinned: false });
    expect(canonicalTrusted(ctx, { ...upInit, version: "9.9.9" }, 42, keccak256("0x6001"))).toMatchObject({ ok: false, reason: expect.stringMatching(/does not list UniversalProfileInit 9\.9\.9/) });
    const lsp26 = canonicalContracts().get(LSP26.toLowerCase())!;
    expect(canonicalTrusted(ctx, lsp26, 16661, keccak256(LSP26_RUNTIME))).toMatchObject({ ok: true, pinned: true });
    expect(canonicalTrusted(ctx, lsp26, 42, keccak256("0x6001"))).toMatchObject({ ok: false, reason: expect.stringMatching(/does not match its known deployments/) });
  });

  it("matchBundledAbi ignores explorer-only implementations and canonical-mismatch records", async () => {
    const { matchBundledAbi } = await import("../../../src/abi/contract.ts");
    const { parseAbiInput } = await import("../../../src/abi/codec.ts");
    const mintSel = "7580d920";
    const IMPL = "0x2222222222222222222222222222222222222222";
    const implCode = (`0x6080604052` + `63${mintSel}14` + `00`) as Hex;
    const ctx = fakeCtx(fakeRpc({ [TOKEN]: { code: DISPATCH }, [IMPL]: { code: implCode } }));
    const src = parseAbiInput("LSP7Mintable");
    const mint = src.abi.find((x: any) => x.type === "function" && x.name === "mint") as any;
    const base: any = { chainId: 42, address: TOKEN, abi: [], trust: "onchain", source: "x", fetchedAt: "", attempts: [], notes: [], standards: ["LSP7"] };
    // verified EIP-1967 proxy: the implementation's code is inspected → match
    expect(await matchBundledAbi(ctx, 42, TOKEN, src, mint, { ...base, proxy: { isProxy: true, kind: "eip1967", implementation: IMPL, evidence: [] } })).toMatchObject({ ok: true });
    // explorer-only hint: the target's own code is inspected → no match
    expect(await matchBundledAbi(ctx, 42, TOKEN, src, mint, { ...base, proxy: { isProxy: true, kind: "explorer", implementation: IMPL, evidence: [] } })).toMatchObject({ ok: false });
    expect(await matchBundledAbi(ctx, 42, TOKEN, src, mint, { ...base, canonicalMismatch: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/does not match the known deployment/) });
  });
});
