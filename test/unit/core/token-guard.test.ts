import { describe, expect, it } from "vitest";
import { toFunctionSelector, type Address, type Hex } from "viem";
import { guardTokenMoves, isTokenContract, TOKEN_SAFE_SELECTORS } from "../../../src/core/token-guard.ts";
import { DEFAULT_POLICY } from "../../../src/core/policy.ts";

const LSP7 = "0x00000000000000000000000000000000000000a7" as Address;
const ERC20 = "0x00000000000000000000000000000000000000e2" as Address;
const PLAIN = "0x00000000000000000000000000000000000000c0" as Address;
const EOA = "0x00000000000000000000000000000000000000e0" as Address;
const ONE = ("0x" + "0".repeat(63) + "1") as Hex;
const ZERO = ("0x" + "0".repeat(64)) as Hex;

function fakeCtx(): any {
  return {
    rpc: {
      async request(_chainId: number, method: string, params: any[]) {
        const [arg] = params;
        if (method === "eth_getCode") return arg === EOA ? "0x" : "0x6080";
        if (method === "eth_call") {
          const to = arg.to as Address;
          const data = arg.data as Hex;
          const sel = data.slice(0, 10);
          if (sel === "0x01ffc9a7") return to === LSP7 && data.slice(10, 18) === "c52d6008" ? ONE : ZERO;
          if (to === ERC20 && (sel === "0x18160ddd" || sel === "0x70a08231")) return ONE;
          throw new Error("execution reverted");
        }
        throw new Error(method);
      },
    },
  };
}

const sel = (s: string) => toFunctionSelector(s);
const req = (target: Address, selector: Hex, extra: object = {}) => ({ verb: "contract call", risk: "write" as const, chainId: 31337, summary: {}, target, selector, ...extra });

describe("token-move guard (allowlist)", () => {
  it("detects LSP7 by ERC-165 and ERC-20 by shape; plain contracts and EOAs are not tokens", async () => {
    const ctx = fakeCtx();
    expect(await isTokenContract(ctx, 31337, LSP7)).toBe(true);
    expect(await isTokenContract(ctx, 31337, ERC20)).toBe(true);
    expect(await isTokenContract(ctx, 31337, PLAIN)).toBe(false);
    expect(await isTokenContract(ctx, 31337, EOA)).toBe(false);
  });
  it("denies wrapper bypasses on tokens under the default policy (batchCalls, transferAndCall, ERC-777 send, legacy approve)", async () => {
    const ctx = fakeCtx();
    for (const s of ["batchCalls(bytes[])", "transferAndCall(address,uint256,bytes)", "send(address,uint256,bytes)", "authorizeOperator(address,uint256)"]) {
      await expect(guardTokenMoves(ctx, DEFAULT_POLICY, req(LSP7, sel(s)))).rejects.toMatchObject({ code: "POLICY_DENIED" });
      await expect(guardTokenMoves(ctx, DEFAULT_POLICY, req(ERC20, sel(s)))).rejects.toMatchObject({ code: "POLICY_DENIED" });
    }
  });
  it("checks every call of a batch", async () => {
    const ctx = fakeCtx();
    await expect(guardTokenMoves(ctx, DEFAULT_POLICY, req(PLAIN, sel("doSomething()"), { calls: [{ target: PLAIN, selector: sel("doSomething()") }, { target: LSP7, selector: sel("batchCalls(bytes[])") }] }))).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });
  it("allows harmless token functions, non-token targets, native transfers, and delegated tokens", async () => {
    const ctx = fakeCtx();
    expect(TOKEN_SAFE_SELECTORS.has(sel("revokeOperator(address,address,bool,bytes)"))).toBe(true);
    await guardTokenMoves(ctx, DEFAULT_POLICY, req(LSP7, sel("revokeOperator(address,address,bool,bytes)")));
    await guardTokenMoves(ctx, DEFAULT_POLICY, req(LSP7, sel("mint(address,uint256,bool,bytes)")));
    await guardTokenMoves(ctx, DEFAULT_POLICY, req(PLAIN, sel("batchCalls(bytes[])")));
    await guardTokenMoves(ctx, DEFAULT_POLICY, req(EOA, "0x"));
    await guardTokenMoves(ctx, { ...DEFAULT_POLICY, allowTokenMoves: true, tokenTargets: [LSP7] }, req(LSP7, sel("batchCalls(bytes[])")));
    await expect(guardTokenMoves(ctx, { ...DEFAULT_POLICY, allowTokenMoves: true, tokenTargets: [LSP7] }, req(ERC20, sel("transfer(address,uint256)")))).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });
});
