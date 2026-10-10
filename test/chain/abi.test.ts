// ABI discovery, standard detection and generic contract verbs against the
// local EVM with the bundled bytecode fixtures and the canonical LSP stack.
import { beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { getHarness, type Harness } from "./harness.ts";
import { testContext } from "../support/context.ts";
import "../../src/abi/verbs.ts";
import { coerceArgs, getVerb } from "../../src/core/verbs.ts";
import { detectStandards, INTERFACE_IDS } from "../../src/abi/detect.ts";
import { discoverAbi } from "../../src/abi/discovery.ts";
import { bundledAbi } from "../../src/abi/bundled.ts";
import { deploy, controllerSigner, registerKmStub, setupProfile, type ProfileFixture } from "../unit/tokens/support/profile-fixture.ts";
import { LSP26_RUNTIME } from "../unit/social/support/lsp26-runtime.ts";
import type { VerbContext } from "../../src/core/types.ts";

const LSP26 = "0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA" as Address;
const UP_INIT = "0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F";

let h: Harness;
let p: ProfileFixture;
let lsp7: Address;
let lsp8: Address;
let clone: Address;
let ctx: VerbContext;

async function run(name: string, raw: Record<string, unknown>, c: VerbContext = ctx) {
  const v = getVerb(name)!;
  return v.run(c, coerceArgs(v, raw));
}

beforeAll(async () => {
  h = await getHarness();
  p = await setupProfile(h);
  lsp7 = await deploy(h, "LSP7Mintable", ["string", "string", "address", "uint256", "bool"], ["Test Token", "TT", p.deployer, 0n, false]);
  lsp8 = await deploy(h, "LSP8Mintable", ["string", "string", "address", "uint256", "uint256"], ["Test NFT", "TN", p.deployer, 1n, 0n]);
  await h.request("hardhat_setCode", [LSP26, LSP26_RUNTIME]);
  clone = await h.deployRaw(`0x3d602d80600a3d3981f3363d3d373d3d3d363d73${UP_INIT.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3` as Hex);
  registerKmStub(h, p);
  ctx = testContext(h.newHome(), controllerSigner(p), { yes: true });
}, 180_000);

describe("standard detection against real bytecode", () => {
  it("confirms the current ERC-165 ids of the bundled LSP contracts", async () => {
    const d7 = await detectStandards(ctx, h.chainId, lsp7);
    expect(d7.primary).toBe("LSP7");
    expect(d7.interfaces.LSP7DigitalAsset).toBe(INTERFACE_IDS.LSP7DigitalAsset[0]);
    expect(d7.legacyInterface).toBeUndefined();
    expect(d7.lsp4).toMatchObject({ supported: true, tokenType: 0, tokenTypeName: "Token" });
    expect(d7.erc20?.decimals).toBe(18);
    const d8 = await detectStandards(ctx, h.chainId, lsp8);
    expect(d8.primary).toBe("LSP8");
    expect(d8.interfaces.LSP8IdentifiableDigitalAsset).toBe(INTERFACE_IDS.LSP8IdentifiableDigitalAsset[0]);
    expect(d8.lsp4?.tokenTypeName).toBe("NFT");
    const dup = await detectStandards(ctx, h.chainId, p.up);
    expect(dup.primary).toBe("LSP0");
    for (const k of ["LSP0ERC725Account", "LSP1UniversalReceiver", "ERC725X", "ERC725Y", "ERC1271", "LSP14Ownable2Step", "LSP17Extendable"] as const) expect(dup.interfaces[k], k).toBe(INTERFACE_IDS[k][0]);
    const dkm = await detectStandards(ctx, h.chainId, p.km);
    expect(dkm.primary).toBe("LSP6");
    expect(dkm.interfaces.LSP6KeyManager).toBe(INTERFACE_IDS.LSP6KeyManager[0]);
    // LSP26 does not implement ERC-165: it is identified by address + runtime code hash instead
    const d26 = await detectStandards(ctx, h.chainId, LSP26);
    expect(d26.erc165).toBe(false);
    const eoa = await detectStandards(ctx, h.chainId, h.accounts[5]);
    expect(eoa.kind).toBe("eoa");
  });
});

describe("ABI discovery on the local chain (bundled / onchain trust)", () => {
  it("canonical LSP26 address → bundled; LSP7 → onchain via ERC-165; UP clone → bundled via ERC-1167", async () => {
    const r26 = await discoverAbi(ctx, h.chainId, LSP26, { offline: true });
    expect(r26).toMatchObject({ trust: "bundled", source: "bundled:LSP26FollowerSystem" });
    const r7 = await discoverAbi(ctx, h.chainId, lsp7, { offline: true });
    expect(r7).toMatchObject({ trust: "onchain", source: "erc165:LSP7" });
    const rc = await discoverAbi(ctx, h.chainId, clone, { offline: true });
    expect(rc).toMatchObject({ trust: "bundled", source: "bundled:UniversalProfileInit@0.14.0" });
    expect(rc.proxy).toMatchObject({ kind: "erc1167", implementation: UP_INIT });
    const rup = await discoverAbi(ctx, h.chainId, p.up, { offline: true });
    expect(rup).toMatchObject({ trust: "onchain", source: "erc165:LSP0" });
    expect(rup.attempts.some((a) => a.source === "lsp17")).toBe(true);
  });

  it("abi fetch / functions / resolve-proxy verbs", async () => {
    const f = (await run("abi fetch", { address: lsp7, offline: true })).data as any;
    expect(f).toMatchObject({ trust: "onchain", signable: true, standards: ["LSP7"] });
    expect(f.counts.functions).toBeGreaterThan(10);
    const fns = (await run("abi functions", { address: LSP26, offline: true })).data as any;
    expect(fns.functions.find((x: any) => x.signature === "follow(address)")).toMatchObject({ kind: "write", selector: "0x4dbf27cc" });
    expect(fns.functions.find((x: any) => x.signature === "isFollowing(address,address)")).toMatchObject({ kind: "read", selector: "0x99ec3a42" });
    const rp = (await run("abi resolve-proxy", { address: clone })).data as any;
    expect(rp).toMatchObject({ isProxy: true, kind: "erc1167", implementationKnownAs: "UniversalProfileInit@0.14.0" });
    const rpUp = (await run("abi resolve-proxy", { address: p.up })).data as any;
    expect(rpUp.isProxy).toBe(false);
    expect(rpUp.lsp17Extensions).toEqual([]);
  });

  it("contract read decodes view results with the discovered ABI", async () => {
    await h.sendFrom(p.deployer, lsp7, encodeFunctionData({ abi: bundledAbi("LSP7Mintable"), functionName: "mint", args: [h.accounts[3], 5n * 10n ** 18n, true, "0x"] }));
    const r = (await run("contract read", { address: lsp7, fn: "balanceOf", args: [h.accounts[3]], offline: true })).data as any;
    expect(r.outputs[0].value).toBe("5000000000000000000");
    expect(r.trust).toBe("onchain");
    const s = (await run("contract read", { address: lsp7, fn: "decimals()", offline: true })).data as any;
    expect(s.outputs[0].value).toBe(18);
  });

  it("protocols verify checks code presence + pinned code hash on a chain the registry does not list", async () => {
    const r = (await run("protocols verify", { name: "lsp26FollowerSystem" })).data as any;
    expect(r.results[0]).toMatchObject({ protocol: "lsp26FollowerSystem", summary: "present" });
    expect(r.results[0].results[0]).toMatchObject({ status: "present", registry: "unknown", codeHashMatch: true });
    const m = (await run("protocols verify", { name: "permit2" })).data as any;
    expect(m.results[0].summary).toBe("absent");
  });
});

describe("contract call through the profile (km transport stub)", () => {
  it("bundled ABI: follow() executes as the profile", async () => {
    const target = h.accounts[6];
    const r = (await run("contract call", { address: LSP26, fn: "follow", args: [target], via: "km", profile: p.up, offline: true })).data as any;
    expect(r).toMatchObject({ trust: "bundled", approvalRequired: false, signature: "follow(address)" });
    expect(r.outcome.status).toBe("success");
    const read = (await run("contract read", { address: LSP26, fn: "isFollowing", args: [p.up, target], offline: true })).data as any;
    expect(read.outputs[0].value).toBe(true);
  });

  it("guessed ABI: refused without a human approval; dry-run shows what would be needed", async () => {
    const weird = "0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e" as Address;
    await h.request("hardhat_setCode", [weird, "0x60806040528063a9059cbb146100255700"]);
    await expect(run("contract call", { address: weird, fn: "transfer", args: [h.accounts[2], "1"], via: "km", profile: p.up, offline: true })).rejects.toMatchObject({ code: "ABI_UNTRUSTED" });
    const dry = testContext(ctx.home, controllerSigner(p), { dryRun: true });
    const r = (await run("contract call", { address: weird, fn: "transfer", args: [h.accounts[2], "1"], via: "km", profile: p.up, offline: true }, dry)) as any;
    expect(r.data.outcome.status).toBe("dry-run");
    expect(r.data.approvalRequired).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/needs --approval/);
  });

  it("bundled --abi matched on-chain (ERC-165 + selector in bytecode): mint on a profile-owned LSP7 passes with --yes", async () => {
    const owned = await deploy(h, "LSP7Mintable", ["string", "string", "address", "uint256", "bool"], ["Profile Token", "PT", p.up, 0n, false]);
    const r = (await run("contract call", { address: owned, fn: "mint", args: [p.up, "7", true, "0x"], abi: "LSP7Mintable", via: "km", profile: p.up, offline: true })).data as any;
    expect(r.trust).toBe("bundled");
    expect(r.abiSource).toMatch(/^bundled:LSP7Mintable \(matched on-chain: standard LSP7 detected on-chain; selector 0x[0-9a-f]{8} present in the runtime code\)$/);
    expect(r.approvalRequired).toBe(false);
    expect(r.outcome.status).toBe("success");
    const bal = (await run("contract read", { address: owned, fn: "balanceOf", args: [p.up], offline: true })).data as any;
    expect(bal.outputs[0].value).toBe("7");
    // an inline (unverifiable) ABI for a value-moving function still needs a human approval
    await expect(
      run("contract call", { address: owned, fn: "burn", args: [p.up, "1", "0x"], abi: ["function burn(address from, uint256 amount, bytes data)"], via: "km", profile: p.up, offline: true }),
    ).rejects.toMatchObject({ code: "ABI_UNTRUSTED" });
  });

  it("refuses to 'send' a view function and non-payable value", async () => {
    await expect(run("contract call", { address: LSP26, fn: "followerCount", args: [p.up], via: "km", profile: p.up, offline: true })).rejects.toThrow(/nothing to send/);
    await expect(run("contract call", { address: LSP26, fn: "follow", args: [h.accounts[7]], value: "0.1", via: "km", profile: p.up, offline: true })).rejects.toThrow(/not payable/);
  });
});
