import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { encodeFollow, locateLsp26, lsp26Registry, LSP26_ABI } from "../../../src/social/lsp26.ts";
import { fakeCtx, fakeRpc } from "../abi/support/fake.ts";
import { LSP26_RUNTIME } from "./support/lsp26-runtime.ts";

const LSP26 = "0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA";
const A = "0x0F4180da178ed1C71398a57ca8Cb177F69591f1f";

describe("LSP26 location", () => {
  it("uses the protocols.json address", () => {
    expect(lsp26Registry().address).toBe(LSP26);
  });

  it("refuses chains where the registry records it as absent — without any RPC call", async () => {
    const rpc = fakeRpc({});
    for (const id of [137, 43114, 11155111]) {
      await expect(locateLsp26(fakeCtx(rpc), id)).rejects.toMatchObject({ code: "NOT_SUPPORTED", message: expect.stringMatching(/not deployed on .*\(\d+\)/), hint: expect.stringMatching(/LUKSO \(42\)/) });
    }
    expect(rpc.calls).toHaveLength(0);
  });

  it("refuses when there is no code (even on listed chains) and accepts listed chains with code", async () => {
    await expect(locateLsp26(fakeCtx(fakeRpc({})), 42)).rejects.toMatchObject({ code: "NOT_SUPPORTED", message: expect.stringMatching(/eth_getCode/) });
    const ok = await locateLsp26(fakeCtx(fakeRpc({ [LSP26]: { code: LSP26_RUNTIME } })), 42);
    expect(ok).toMatchObject({ address: LSP26, registry: "listed", verifiedBy: "eth_getCode", warnings: [] });
    const odd = await locateLsp26(fakeCtx(fakeRpc({ [LSP26]: { code: "0x6001" } })), 42);
    expect(odd.warnings[0]).toMatch(/differs from the canonical LSP26 runtime/);
  });

  it("on chains the registry does not list, the runtime code hash must match the canonical deployment (LSP26 has no ERC-165)", async () => {
    await expect(locateLsp26(fakeCtx(fakeRpc({ [LSP26]: { code: "0x6001" } })), 16661)).rejects.toThrow(/not the canonical LSP26 Follower System/);
    const ok = await locateLsp26(fakeCtx(fakeRpc({ [LSP26]: { code: LSP26_RUNTIME } })), 16661);
    expect(ok).toMatchObject({ registry: "unknown", verifiedBy: "eth_getCode+codehash" });
    expect(ok.warnings[0]).toMatch(/code hash matches/);
  });

  it("encodes follow / followBatch calldata", () => {
    expect(decodeFunctionData({ abi: LSP26_ABI(), data: encodeFollow("follow", A) })).toMatchObject({ functionName: "follow", args: [A] });
    expect(decodeFunctionData({ abi: LSP26_ABI(), data: encodeFollow("unfollowBatch", [A, LSP26]) })).toMatchObject({ functionName: "unfollowBatch", args: [[A, LSP26]] });
  });
});
