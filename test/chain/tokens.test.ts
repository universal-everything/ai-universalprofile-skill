// Token verbs end-to-end on the local EVM: LSP7/LSP8 fixtures, a Universal
// Profile controlled through its Key Manager (in-test "km" transport stub), the
// canonical URD maintaining LSP5. Proves reads, calldata, force defaults,
// approvals, the consent path and dry-run.
import { beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, pad, type Address, type Hex } from "viem";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import "../../src/tokens/verbs.ts";
import { coerceArgs, getVerb } from "../../src/core/verbs.ts";
import { bundledAbi } from "../../src/abi/bundled.ts";
import { LSP7_ABI, LSP8_ABI } from "../../src/tokens/assets.ts";
import { deploy, registerKmStub, setupProfile, type KmStub, type ProfileFixture } from "../unit/tokens/support/profile-fixture.ts";
import type { VerbContext } from "../../src/core/types.ts";
import { DEFAULT_POLICY, savePolicy } from "../../src/core/policy.ts";

let h: Harness;
let p: ProfileFixture;
let stub: KmStub;
let lsp7: Address;
let lsp8: Address;
let up2: Address;
let home: string;
let ctx: VerbContext;
const E18 = 10n ** 18n;

async function run(name: string, raw: Record<string, unknown>, c: VerbContext = ctx) {
  const v = getVerb(name)!;
  return v.run(c, coerceArgs(v, { profile: p.up, ...raw }));
}

async function call<T>(to: Address, abi: any, functionName: string, args: unknown[]): Promise<T> {
  const { decodeFunctionResult } = await import("viem");
  const raw = await h.request<Hex>("eth_call", [{ to, data: encodeFunctionData({ abi, functionName, args } as any) }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: raw } as any) as T;
}

beforeAll(async () => {
  h = await getHarness();
  p = await setupProfile(h);
  stub = registerKmStub(h, p);
  lsp7 = await deploy(h, "LSP7Mintable", ["string", "string", "address", "uint256", "bool"], ["Test Token", "TT", p.deployer, 0n, false]);
  lsp8 = await deploy(h, "LSP8Mintable", ["string", "string", "address", "uint256", "uint256"], ["Test NFT", "TN", p.deployer, 1n, 0n]);
  up2 = await deploy(h, "UniversalProfile", ["address"], [p.deployer]);
  // mint to the profile with force=false: the UP implements LSP1, the URD registers LSP5
  await h.sendFrom(p.deployer, lsp7, encodeFunctionData({ abi: bundledAbi("LSP7Mintable"), functionName: "mint", args: [p.up, 1000n * E18, false, "0x"] }));
  await h.sendFrom(p.deployer, lsp8, encodeFunctionData({ abi: bundledAbi("LSP8Mintable"), functionName: "mint", args: [p.up, pad("0x01", { size: 32 }), false, "0x"] }));
  await h.sendFrom(p.deployer, lsp8, encodeFunctionData({ abi: bundledAbi("LSP8Mintable"), functionName: "mint", args: [p.up, pad("0x02", { size: 32 }), false, "0x"] }));
  await h.fund(p.up, 5n * E18);
  home = h.newHome();
  // the human enabled autonomous token moves, but only for the two test tokens
  await savePolicy(home, { ...DEFAULT_POLICY, allowTokenMoves: true, tokenTargets: [lsp7, lsp8] });
  ctx = testContext(home, testSigner(), { yes: true });
}, 180_000);

describe("reads", () => {
  it("token balance: native, LSP7 (human units), LSP8 (count + ids)", async () => {
    const n = (await run("token balance", { native: true })).data as any;
    expect(n).toMatchObject({ native: true, balance: (5n * E18).toString(), balanceFormatted: "5" });
    const b7 = (await run("token balance", { asset: lsp7 })).data as any;
    expect(b7).toMatchObject({ standard: "LSP7", decimals: 18, balanceFormatted: "1000", symbol: "TT", name: "Test Token" });
    const b8 = (await run("token balance", { asset: lsp8 })).data as any;
    expect(b8).toMatchObject({ standard: "LSP8", count: "2", tokenIdFormat: 0 });
    expect(b8.tokenIds.map((x: any) => x.readable)).toEqual(["1", "2"]);
  });

  it("token metadata: LSP4 name/symbol/type, decimals, supply, owner; LSP8 per-token data", async () => {
    const m = (await run("token metadata", { asset: lsp7 })) as any;
    expect(m.data).toMatchObject({ standard: "LSP7", name: "Test Token", symbol: "TT", decimals: 18, totalSupplyFormatted: "1000", owner: p.deployer });
    expect(m.data.lsp4).toMatchObject({ tokenType: 0, tokenTypeName: "Token", creatorsCount: 0 });
    expect(m.warnings.join(" ")).toMatch(/chosen by the token contract/);
    const m8 = (await run("token metadata", { asset: lsp8, "token-id": "2" })).data as any;
    expect(m8.lsp4).toMatchObject({ tokenTypeName: "NFT", lsp8TokenIdFormat: 0, lsp8TokenIdFormatName: "Number" });
    expect(m8.token).toMatchObject({ id: pad("0x02", { size: 32 }), idReadable: "2", owner: p.up });
  });

  it("token list: LSP5 (via the URD) + log scan, balances re-verified on-chain", async () => {
    const r = (await run("token list", {})).data as any;
    const byAsset = Object.fromEntries(r.assets.map((a: any) => [a.asset, a]));
    expect(byAsset[lsp7]).toMatchObject({ standard: "LSP7", verifiedOnchain: true, balance: (1000n * E18).toString(), balanceFormatted: "1000" });
    expect(byAsset[lsp7].sources).toEqual(expect.arrayContaining(["lsp5", "logs"]));
    // the canonical v0.14 URD records the interface id it knows (0xb3c4928f), not the token's
    // current 0xc52d6008 — both are mapped to LSP7, which is why legacy ids are kept
    expect(byAsset[lsp7].lsp5.interfaceId).toBe("0xb3c4928f");
    expect(byAsset[lsp8]).toMatchObject({ standard: "LSP8", verifiedOnchain: true, balance: "2" });
    expect(r.sources.map((s: any) => `${s.source}:${s.status}`)).toEqual(["lsp5:ok", "logs:ok"]); // no indexer for the local chain
    const lsp5Only = (await run("token list", { source: "lsp5" })).data as any;
    expect(lsp5Only.sources.map((s: any) => s.source)).toEqual(["lsp5"]);
  });
});

describe("transfers through the profile", () => {
  it("LSP7 to an EOA: force defaults to true, decoded call in the confirmation, balances move", async () => {
    const eoa = h.accounts[3];
    const r = (await run("token transfer", { asset: lsp7, to: eoa, amount: "12.5", via: "km" })) as any;
    expect(r.data.outcome.status).toBe("success");
    expect(r.data.details).toMatchObject({ force: true, recipientKind: "eoa", amountFormatted: "12.5" });
    expect(r.warnings.join(" ")).toMatch(/force=true is required/);
    const req = stub.requests.at(-1)!;
    expect(req.description).toMatch(/transfer 12\.5 "TT"/);
    expect(req.calls![0]).toMatchObject({ operation: 0, to: lsp7, value: 0n });
    expect(decodeFunctionData({ abi: LSP7_ABI(), data: req.calls![0].data }).args).toEqual([p.up, eoa, 12_500_000_000_000_000_000n, true, "0x"]);
    expect(await call<bigint>(lsp7, LSP7_ABI(), "balanceOf", [eoa])).toBe(12_500_000_000_000_000_000n);
  });

  it("LSP7 to another Universal Profile: force=false (LSP1 recipient is notified)", async () => {
    const r = (await run("token transfer", { asset: lsp7, to: up2, amount: "1", via: "km" })).data as any;
    expect(r.details).toMatchObject({ force: false, recipientIsProfile: true, recipientLsp1: true });
    expect(await call<bigint>(lsp7, LSP7_ABI(), "balanceOf", [up2])).toBe(E18);
  });

  it("refuses a contract recipient without LSP1 unless --force true", async () => {
    await expect(run("token transfer", { asset: lsp7, to: lsp8, amount: "1", via: "km" })).rejects.toThrow(/does not implement LSP1/);
    const before = stub.requests.length;
    await run("token transfer", { asset: lsp7, to: lsp8, amount: "1", via: "km", force: true });
    expect(stub.requests.length).toBe(before + 1);
    expect(await call<bigint>(lsp7, LSP7_ABI(), "balanceOf", [lsp8])).toBe(E18);
  });

  it("dry-run builds and asks nothing to be sent", async () => {
    const dry = testContext(home, testSigner(), { dryRun: true });
    const eoa = h.accounts[4];
    const r = (await run("token transfer", { asset: lsp7, to: eoa, amount: "3", via: "km" }, dry)).data as any;
    expect(r.outcome.status).toBe("dry-run");
    expect(await call<bigint>(lsp7, LSP7_ABI(), "balanceOf", [eoa])).toBe(0n);
  });

  it("the consent path sees the inner token selector + token contract (policy.allowTokenMoves / tokenTargets)", async () => {
    // default policy: token moves need a human approval; the denial names the LSP7 transfer selector
    const strictHome = h.newHome();
    const def = testContext(strictHome, testSigner(), { yes: true });
    await expect(run("token transfer", { asset: lsp7, to: h.accounts[4], amount: "1", via: "km" }, def)).rejects.toMatchObject({ code: "POLICY_DENIED", message: expect.stringMatching(/0x760d9bba/) });
    // allowTokenMoves restricted to another token: the token contract (not the recipient) is checked
    await savePolicy(strictHome, { ...DEFAULT_POLICY, allowTokenMoves: true, tokenTargets: [lsp8] });
    await expect(run("token transfer", { asset: lsp7, to: h.accounts[4], amount: "1", via: "km" }, testContext(strictHome, testSigner(), { yes: true }))).rejects.toMatchObject({ code: "POLICY_DENIED", message: expect.stringMatching(/tokenTargets/) });
    // an explicit human approval always works
    const ok = (await run("token transfer", { asset: lsp7, to: h.accounts[4], amount: "1", via: "km" }, testContext(strictHome, testSigner(), { approval: "yes, send 1 TT to account 4" }))).data as any;
    expect(ok.outcome.status).toBe("success");
    const req = stub.requests.at(-1)!;
    expect(req.calls![0].to).toBe(lsp7);
    expect(req.calls![0].data.slice(0, 10)).toBe("0x760d9bba");
  });

  it("without --yes or --approval the consent model blocks the write", async () => {
    const strict = testContext(home, testSigner(), { yes: false });
    await expect(run("token transfer", { asset: lsp7, to: h.accounts[4], amount: "1", via: "km" }, strict)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  });

  it("LSP8 by token id; ownership is checked first", async () => {
    const eoa = h.accounts[5];
    const r = (await run("token transfer", { asset: lsp8, to: eoa, "token-id": "1", via: "km" })).data as any;
    expect(r.details).toMatchObject({ tokenIdReadable: "1", force: true });
    expect(await call<Address>(lsp8, LSP8_ABI(), "tokenOwnerOf", [pad("0x01", { size: 32 })])).toBe(eoa);
    await expect(run("token transfer", { asset: lsp8, to: eoa, "token-id": "1", via: "km" })).rejects.toThrow(/owned by/);
  });

  it("native coin transfer needs an approval under the default policy (value cap 0)", async () => {
    const eoa = h.accounts[6];
    const before = BigInt(await h.request<Hex>("eth_getBalance", [eoa, "latest"]));
    await expect(run("token transfer", { native: true, to: eoa, amount: "0.5", via: "km" })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    const approved = testContext(home, testSigner(), { approval: "yes, send 0.5 to account 6" });
    const r = (await run("token transfer", { native: true, to: eoa, amount: "0.5", via: "km" }, approved)).data as any;
    expect(r.outcome.status).toBe("success");
    expect(BigInt(await h.request<Hex>("eth_getBalance", [eoa, "latest"])) - before).toBe(E18 / 2n);
  });
});

describe("approvals and operators", () => {
  it("LSP7 authorize → operators shows the allowance → revoke clears it", async () => {
    const op = h.accounts[7];
    await run("token approve", { asset: lsp7, operator: op, amount: "5", via: "km" });
    const ops = (await run("token operators", { asset: lsp7 })).data as any;
    expect(ops.operators).toEqual([{ operator: op, allowance: (5n * E18).toString(), allowanceFormatted: "5" }]);
    await run("token approve", { asset: lsp7, operator: op, mode: "increase", amount: "1", via: "km" });
    expect(((await run("token operators", { asset: lsp7, operator: op })).data as any).operators[0].allowanceFormatted).toBe("6");
    await run("token approve", { asset: lsp7, operator: op, mode: "revoke", via: "km" });
    expect(((await run("token operators", { asset: lsp7 })).data as any).operators).toEqual([]);
  });

  it("LSP8 operator per token id", async () => {
    const op = h.accounts[8];
    await run("token approve", { asset: lsp8, operator: op, "token-id": "2", via: "km" });
    const r = (await run("token operators", { asset: lsp8, "token-id": "2" })).data as any;
    expect(r.operators).toEqual([op]);
    const one = (await run("token operators", { asset: lsp8, "token-id": "2", operator: op })).data as any;
    expect(one.isOperator).toBe(true);
    await run("token approve", { asset: lsp8, operator: op, "token-id": "2", mode: "revoke", via: "km" });
    expect(((await run("token operators", { asset: lsp8, "token-id": "2" })).data as any).operators).toEqual([]);
  });
});
