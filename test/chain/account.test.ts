// J1 end-to-end through the verbs: precompute → deploy (address == precompute) →
// verify owner/KM/permissions/URD/interfaces → manifest replay on a "new chain"
// (snapshot revert) gives the same address → data get/set, extensions, URD.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { encodeDeployData, encodeFunctionData, getAddress, parseEther, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, fixture, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { initCodeFor, readRecorder, RECORDER_RUNTIME, runVerb } from "../support/mock-relayer.ts";
import "../../src/lsp/verbs.ts";
import "../../src/relayer/verbs.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { DATA_KEYS, INTERFACE_IDS, permissionsKey } from "../../src/lsp/constants.ts";
import { UP_ABI } from "../../src/lsp/abis.ts";
import { paths } from "../../src/core/home.ts";

const contractsDir = join(import.meta.dirname, "..", "..", "skills", "universal-profile", "assets", "registry", "lsp-deployments", "contracts");

const run = runVerb;

let h: Harness;
let signer: Signer;
let ctx: VerbContext;
let home: string;
let profile: Address;
let keyManager: Address;
let seed: Hex;

beforeAll(async () => {
  h = await getHarness();
  signer = testSigner(generatePrivateKey());
  await h.fund(signer.address, parseEther("10"));
  home = h.newHome();
  ctx = testContext(home, signer, { approval: "human: approved for this test suite" });
}, 120_000);

describe("J1: precompute → deploy → verify", () => {
  it("account precompute returns reproducible candidates cross-checked with the on-chain factory", async () => {
    const r = await run(ctx, "account precompute", { count: 4 });
    expect(r.data.candidates).toHaveLength(4);
    expect(r.data.controller).toBe(signer.address);
    expect(r.data.preset).toBe("agent-owner");
    expect(r.data.onChainCrossCheck.matches).toBe(true);
    // One labelled picture and a plain explanation, numbered 1..n (choice n = candidate n-1).
    const media = (r as any).media;
    expect(media).toHaveLength(1);
    expect(media[0].description).toContain(`4 = ${r.data.candidates[3].profile}`);
    expect(r.data.choices.map((c: any) => [c.choice, c.candidate, c.address])).toEqual(r.data.candidates.map((c: any, i: number) => [i + 1, i, c.profile]));
    expect(r.data.say).toMatch(/^My profile needs an address\. It's permanent and the same on every network\./);
    expect(r.data.say).toContain(`1 · ${r.data.candidates[0].profile.slice(0, 6).toLowerCase()}…${r.data.candidates[0].profile.slice(-4).toLowerCase()}`);
    expect(r.data.say).not.toContain(r.data.candidates[0].profile);
    expect(r.data.say).toMatch(/The picture shows each address's pattern with its number\./);
    expect(r.data.say).not.toMatch(/\bup |salt|seed|identicon|candidate/i);
    expect(r.data.next[0]).toMatch(/text first, then the picture/);
    seed = r.data.seed;
    const again = await run(ctx, "account precompute", { count: 4, seed });
    expect(again.data.candidates).toEqual(r.data.candidates);
    const one = await run(ctx, "account precompute", { salt: r.data.candidates[2].salt });
    expect(one.data.candidates[0].profile).toBe(r.data.candidates[2].profile);
    profile = r.data.candidates[2].profile;
    keyManager = r.data.candidates[2].keyManager;
  });

  it("dry-run deploy simulates but changes nothing", async () => {
    const dctx = testContext(home, signer, { dryRun: true });
    const nonce = await h.request("eth_getTransactionCount", [signer.address, "latest"]);
    const r = await run(dctx, "account deploy", { seed, candidate: 2 });
    expect(r.data.status).toBe("dry-run");
    // the agent sends and pays; the human is asked for nothing but a yes
    expect(r.data.sentBy).toBe(signer.address);
    expect(r.data.say).toMatch(/I send and pay this myself from my gas address/);
    expect(r.data.say).not.toMatch(/sign (it|the deployment) in your wallet|which wallet/i);
    expect(r.data.next.join(" ")).toMatch(/Never ask the human to sign/);
    expect(r.text).toMatch(/sent and paid by the agent's key/);
    expect(r.data.profile).toBe(profile);
    expect(await h.request("eth_getCode", [profile, "latest"])).toBe("0x");
    expect(await h.request("eth_getTransactionCount", [signer.address, "latest"])).toBe(nonce);
    expect(existsSync(paths.profile(home, profile))).toBe(false);
  });

  let snapshot: string;
  it("account deploy: deployed address == precomputed, owner = KM, KM.target() = UP, permissions, URD", async () => {
    snapshot = await h.request("evm_snapshot", []);
    const r = await run(ctx, "account deploy", { seed, candidate: 2 });
    expect(r.data.status).toBe("deployed");
    expect(r.data.profile).toBe(profile);
    expect(r.data.keyManager).toBe(keyManager);
    expect(Object.values(r.data.verified).every(Boolean)).toBe(true);
    expect(r.data.onChainCompute.matches).toBe(true);
    expect(r.warnings?.join()).toMatch(/human-admin/);
    expect(r.data.next.at(-1)).toMatch(/offer the human a backup .*up backup list/); // a new profile: suggest a backup, once
    expect((await ctx.config()).defaultProfile).toBe(profile);
    const m = JSON.parse(readFileSync(paths.profile(home, profile), "utf8")).deployment;
    expect(m.deployments[String(h.chainId)].txHash).toBe(r.data.txHash);
    expect(m.chains).toEqual([h.chainId]);
  });

  it("re-running deploy on the same chain reports already-deployed (no revert, no new tx)", async () => {
    const r = await run(ctx, "account deploy", { profile });
    expect(r.data.status).toBe("already-deployed");
  });

  it("manifest replay on a 'new chain' (state reverted) yields the identical address", async () => {
    await h.request("evm_revert", [snapshot]);
    expect(await h.request("eth_getCode", [profile, "latest"])).toBe("0x");
    const r = await run(ctx, "account deploy", { profile });
    expect(r.data.status).toBe("deployed");
    expect(r.data.profile).toBe(profile);
    expect(r.data.keyManager).toBe(keyManager);
  });

  it("account manifest show / export", async () => {
    const s = await run(ctx, "account manifest show", { profile });
    expect(s.data.consistent).toBe(true);
    expect(s.data.manifest.controller).toBe(signer.address);
    const out = join(home, "export.json");
    const e = await run(ctx, "account manifest export", { profile, out });
    expect(e.data.file).toBe(out);
    expect(JSON.parse(readFileSync(out, "utf8")).profile).toBe(profile);
    const inline = await run(ctx, "account manifest export", { profile });
    expect(inline.data.deployCalldata).toMatch(/^0x6a66a753/);
  });

  it("account info: interfaces (LSP0/ERC1271/ERC725X/Y/LSP1/LSP14/LSP17/LSP20 + KM LSP6/LSP25/LSP20/ERC1271), controllers, URD", async () => {
    const r = await run(ctx, "account info", {});
    const d = r.data;
    expect(d.deployed).toBe(true);
    expect(d.version).toBe("0.14.0");
    expect(d.km.keyManager).toBe(keyManager);
    expect(d.km.ownerKind).toBe("key-manager");
    for (const [k, v] of Object.entries(d.interfaces)) expect(v, k).toBe(true);
    for (const [k, v] of Object.entries(d.keyManagerInterfaces)) expect(v, k).toBe(true);
    expect(d.controllers.map((c: any) => c.address)).toEqual([signer.address, h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"]]);
    expect(d.controllers[0].permissions.isAllPermissions).toBe(true);
    expect(d.controllers[1].permissions.names.sort()).toEqual(["REENTRANCY", "SUPER_SETDATA"]);
    expect(d.universalReceiverDelegate).toBe(h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"]);
    expect(d.thisAgent).toMatchObject({ controller: signer.address, isController: true });
    expect(d.warnings).toEqual([]);
  });

  it("LSP7/LSP8 interface ids match the deployed upstream implementations", async () => {
    const rec = (n: string) => JSON.parse(readFileSync(join(contractsDir, `${n}.json`), "utf8")).versions as any[];
    const supports = async (a: Address, id: string) => {
      const r = await h.request("eth_call", [{ to: a, data: encodeFunctionData({ abi: UP_ABI, functionName: "supportsInterface", args: [id as Hex] }) }, "latest"]);
      return BigInt(r) === 1n;
    };
    const found: Record<string, string[]> = {};
    for (const [n, ids] of [["LSP7MintableInit", ["LSP7DigitalAsset", "LSP7DigitalAsset_v0_14", "LSP7DigitalAsset_v0_12"]], ["LSP8MintableInit", ["LSP8IdentifiableDigitalAsset", "LSP8IdentifiableDigitalAsset_v0_14", "LSP8IdentifiableDigitalAsset_v0_12"]]] as const) {
      for (const v of rec(n)) {
        const a = await h.deployViaNick(v.salt, v.creationBytecode);
        for (const id of ids) if (await supports(a, (INTERFACE_IDS as any)[id])) (found[`${n}@${v.version}`] ??= []).push(id);
      }
    }
    // Observed on the canonical deployments (lsp-smart-contracts deployments/ records):
    expect(found).toEqual({
      "LSP7MintableInit@0.14.0": ["LSP7DigitalAsset_v0_14"],
      "LSP7MintableInit@0.17.3": ["LSP7DigitalAsset"],
      "LSP7MintableInit@0.19.0": ["LSP7DigitalAsset"],
      "LSP8MintableInit@0.14.0": ["LSP8IdentifiableDigitalAsset"],
      "LSP8MintableInit@0.17.3": ["LSP8IdentifiableDigitalAsset"],
      "LSP8MintableInit@0.19.0": ["LSP8IdentifiableDigitalAsset"],
    });
  });
});

describe("more interface ids on deployed contracts", () => {
  it("LSP9 Vault and LSP17 Extension (ERCTokenCallbacks)", async () => {
    const supports = async (a: Address, id: string) => BigInt(await h.request("eth_call", [{ to: a, data: encodeFunctionData({ abi: UP_ABI, functionName: "supportsInterface", args: [id as Hex] }) }, "latest"])) === 1n;
    const vaultAbi = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "skills", "universal-profile", "assets", "abis", "lsp", "LSP9Vault.json"), "utf8")).abi as Abi;
    const vault = await h.deployRaw(encodeDeployData({ abi: vaultAbi, bytecode: fixture("LSP9Vault").bytecode as Hex, args: [h.accounts[0]] }));
    expect(await supports(vault, INTERFACE_IDS.LSP9Vault)).toBe(true);
    expect(await supports(vault, INTERFACE_IDS.LSP0ERC725Account)).toBe(false);
    expect(await supports(h.lsp.ERCTokenCallbacks, INTERFACE_IDS.LSP17Extension)).toBe(true);
    expect(await supports(h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"], INTERFACE_IDS.LSP1UniversalReceiverDelegate)).toBe(true);
  });

  it("deploying a profile whose only controller has no admin bits needs an explicit 'locks the profile' approval", async () => {
    const p = await run(ctx, "account precompute", { count: 1, preset: "agent-operator" });
    expect(p.warnings?.join()).toMatch(/nobody could ever change permissions/);
    const err = await run(ctx, "account deploy", { salt: p.data.candidates[0].salt, preset: "agent-operator" }).catch((e) => e);
    expect(err.code).toBe("CONSENT_REQUIRED");
    const ok = await run(testContext(home, signer, { approval: "I understand: no admin controller, this locks the profile permissions" }), "account deploy", { salt: p.data.candidates[0].salt, preset: "agent-operator" });
    expect(ok.data.status).toBe("deployed");
  });
});

describe("ERC725Y data", () => {
  it("account data get by name, dynamic name and array", async () => {
    const perms = await run(ctx, "account data get", { key: `AddressPermissions:Permissions:${signer.address}` });
    expect(perms.data.key).toBe(permissionsKey(signer.address));
    expect(perms.data.routing.class).toBe("controller-permissions");
    const arr = await run(ctx, "account data get", { key: "AddressPermissions[]" });
    expect(arr.data.length).toBe("2");
    expect(arr.data.elements.map((e: string) => getAddress(e))).toEqual([signer.address, h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"]]);
    const urd = await run(ctx, "account data get", { key: "LSP1UniversalReceiverDelegate" });
    expect(getAddress(urd.data.value)).toBe(h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"]);
  });

  it("account data set (schema-encoded VerifiableURI + raw key, batch) through KM and relay-less lsp0", async () => {
    const lsp3 = { json: { LSP3Profile: { name: "agent", description: "test" } }, url: "ipfs://QmAgentProfile" };
    const r = await run(ctx, "account data set", { key: "LSP3Profile", value: lsp3 });
    expect(r.data.status).toBe("success");
    expect(r.data.confirmation.dataWrites[0].class).toBe("data");
    const back = await run(ctx, "account data get", { key: "LSP3Profile" });
    expect(back.data.value.url).toBe("ipfs://QmAgentProfile");
    const k = ("0x" + "cd".repeat(32)) as Hex;
    const b = await run(ctx, "account data set", { pairs: [{ key: k, value: "0x1234" }, { key: "LSP3Profile", value: lsp3 }], via: "lsp0" });
    expect(b.data.path).toBe("lsp0");
    expect((await run(ctx, "account data get", { key: k })).data.raw).toBe("0x1234");
    const info = await run(ctx, "account info", { "fetch-metadata": false });
    expect(info.data.lsp3.url).toBe("ipfs://QmAgentProfile");
  });

  it("dry-run data set never changes chain state", async () => {
    const k = ("0x" + "ef".repeat(32)) as Hex;
    const r = await run(testContext(home, signer, { dryRun: true }), "account data set", { key: k, value: "0x99" });
    expect(r.data.status).toBe("dry-run");
    expect((await run(ctx, "account data get", { key: k })).data.raw).toBe("0x");
  });

  it("writing a permission key via data set is an admin action (needs approval)", async () => {
    const yesOnly = testContext(home, signer, { yes: true });
    const err = await run(yesOnly, "account data set", { key: permissionsKey(signer.address), value: "0x" + "00".repeat(31) + "01" }).catch((e) => e);
    expect(err.code).toBe("CONSENT_REQUIRED");
  });
});

describe("extensions and URD (admin)", () => {
  it("account extensions add → calls to the selector are forwarded by the profile; remove → unknown selector", async () => {
    const ext = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
    const r = await run(ctx, "account extensions add", { selector: "0x12345678", address: ext });
    expect(r.data.status).toBe("success");
    await h.sendFrom(h.accounts[5], profile, "0x12345678");
    expect((await readRecorder(h.request, ext)).sender).toBe(profile);
    const info = await run(ctx, "account info", { extensions: ["0x12345678"] });
    expect(info.data.extensions[0]).toMatchObject({ selector: "0x12345678", address: ext });
    await run(ctx, "account extensions remove", { selector: "0x12345678" });
    await expect(h.sendFrom(h.accounts[5], profile, "0x12345678")).rejects.toThrow();
  });

  it("account urd set grants the new URD SUPER_SETDATA + REENTRANCY; switching back and removing the old one", async () => {
    const old = h.lsp["LSP1UniversalReceiverDelegateUP@0.12.1"];
    const cur = h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"];
    const r = await run(ctx, "account urd set", { address: old });
    expect(r.data.status).toBe("success");
    let info = await run(ctx, "account info", {});
    expect(info.data.universalReceiverDelegate).toBe(old);
    expect(info.data.controllers.find((c: any) => c.address === old).permissions.names.sort()).toEqual(["REENTRANCY", "SUPER_SETDATA"]);
    const back = await run(ctx, "account urd set", { address: cur });
    expect(back.warnings?.join()).toMatch(/keeps its controller permissions/);
    await run(ctx, "controller remove", { address: old });
    info = await run(ctx, "account info", {});
    expect(info.data.universalReceiverDelegate).toBe(cur);
    expect(info.data.controllers.map((c: any) => c.address)).toEqual([signer.address, cur]);
    // receiving value still works through the URD
    await h.sendFrom(h.accounts[5], profile, "0x", 1n);
  });
});
