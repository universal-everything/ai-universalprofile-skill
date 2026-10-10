// Permissions lifecycle through the verbs: controller add (human-admin, restricted
// agent-operator), AllowedCalls/AllowedERC725YDataKeys enforcement (decoded
// NotAllowedCall / NotAuthorised / NoERC725YDataKeysAllowed), edit, remove, last-admin
// guard, LSP14 ownership transfer/accept (new Key Manager and EOA) and renounce.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeDeployData, parseEther, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, fixture, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, initCodeFor, readRecorder, RECORDER_RUNTIME, runVerb as run } from "../support/mock-relayer.ts";
import "../../src/lsp/verbs.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { ALL_PERMISSIONS_HEX, DATA_KEYS, PERMISSIONS } from "../../src/lsp/constants.ts";

let h: Harness;
let agent: Signer;
let human: Signer;
let operator: Signer;
let ctx: VerbContext; // agent with human approval
let opCtx: VerbContext; // operator key with --yes only (policy)
let profile: Address;
let recA: Address;
let recB: Address;

const opApproval = (extra = "") => testContext(opCtx.home, operator, { approval: `human approves operator test ${extra}` });

beforeAll(async () => {
  h = await getHarness();
  agent = testSigner(generatePrivateKey());
  human = testSigner(generatePrivateKey());
  operator = testSigner(generatePrivateKey());
  for (const s of [agent, human, operator]) await h.fund(s.address, parseEther("10"));
  const home = h.newHome();
  ctx = testContext(home, agent, { approval: "human: approved for this suite" });
  profile = (await deployProfileFor(ctx, agent, h.chainId)).profile;
  const cfg = await ctx.config();
  await ctx.saveConfig({ ...cfg, defaultProfile: profile });
  await h.fund(profile, parseEther("3"));
  recA = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  recB = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  const opHome = h.newHome();
  opCtx = testContext(opHome, operator, { yes: true });
  const ocfg = await opCtx.config();
  await opCtx.saveConfig({ ...ocfg, defaultProfile: profile });
}, 120_000);

describe("local permission verbs", () => {
  it("permissions encode / decode / presets", async () => {
    const e = await run(ctx, "permissions encode", { names: ["CALL", "TRANSFERVALUE", "SIGN"] });
    expect(BigInt(e.data.hex)).toBe(PERMISSIONS.CALL | PERMISSIONS.TRANSFERVALUE | PERMISSIONS.SIGN);
    const d = await run(ctx, "permissions decode", { value: ALL_PERMISSIONS_HEX });
    expect(d.data.isAllPermissions).toBe(true);
    expect(d.data.names).toContain("EXECUTE_RELAY_CALL");
    await expect(run(ctx, "permissions encode", { names: ["FLY"] })).rejects.toMatchObject({ code: "BAD_ARGS" });
    const p = await run(ctx, "permissions presets");
    expect(p.data.presets.map((x: any) => x.name)).toEqual(["agent-owner", "agent-operator", "agent-reader", "human-admin", "entrypoint-4337", "urd"]);
  });
  it("permissions recommend (hand-over text + JSON)", async () => {
    const r = await run(opCtx, "permissions recommend", { "allow-targets": [{ address: recA }] });
    expect(r.data.controller).toBe(operator.address);
    expect(r.text).toContain(operator.address);
    expect(r.data.allowedCalls.described.at(-1)).toContain(recA);
  });
});

describe("controllers", () => {
  it("controller add --preset human-admin (admin: needs the human's approval)", async () => {
    const yesOnly = testContext(ctx.home, agent, { yes: true });
    await expect(run(yesOnly, "controller add", { address: human.address, preset: "human-admin" })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    const r = await run(ctx, "controller add", { address: human.address, preset: "human-admin" });
    expect(r.data.status).toBe("success");
    expect(r.data.verified.ok).toBe(true);
    expect(r.data.confirmation.change.explanation.length).toBeGreaterThan(5);
    await expect(run(ctx, "controller add", { address: human.address, preset: "human-admin" })).rejects.toThrow(/already a controller/);
  });

  it("controller add --preset agent-operator restricted to one target; dry-run first changes nothing", async () => {
    const dry = await run(testContext(ctx.home, agent, { dryRun: true }), "controller add", { address: operator.address, preset: "agent-operator", "allowed-calls": [{ callTypes: ["CALL", "VALUE"], address: recA }] });
    expect(dry.data.status).toBe("dry-run");
    expect((await run(ctx, "permissions show", { controller: operator.address })).data.authorised).toBe(false);
    const r = await run(ctx, "controller add", { address: operator.address, preset: "agent-operator", "allowed-calls": [{ callTypes: ["CALL", "VALUE"], address: recA }] });
    expect(r.data.verified.ok).toBe(true);
    expect(r.data.verified.allowedCalls).toEqual([`VALUE+CALL → ${recA}, any standard, any function`]);
    const show = await run(opCtx, "permissions show", {});
    expect(show.data.authorised).toBe(true);
    expect(show.data.names.sort()).toEqual(["CALL", "EXECUTE_RELAY_CALL", "SETDATA", "SIGN", "STATICCALL", "TRANSFERVALUE"]);
    const list = await run(ctx, "permissions list", {});
    expect(list.data.controllers.map((c: any) => c.address)).toEqual([agent.address, h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"], human.address, operator.address]);
  });

  it("the restricted controller can call the allowed target (as the profile) and is rejected elsewhere", async () => {
    const ok = await run(opApproval(), "exec send", { to: recA, value: "1000", data: "0xabcdef01" });
    expect(ok.data.status).toBe("success");
    const rec = await readRecorder(h.request, recA);
    expect(rec.sender).toBe(profile);
    expect(rec.value).toBe(1000n);
    const err = await run(opApproval(), "exec send", { to: recB, data: "0xabcdef01" }).catch((e) => e);
    expect(err.code).toBe("SIMULATION_REVERTED");
    expect(err.details.errorName).toBe("NotAllowedCall");
    expect(err.hint).toMatch(/AllowedCalls/);
    const err2 = await run(opApproval(), "controller add", { address: recB, preset: "agent-reader" }).catch((e) => e);
    expect(err2.details.errorName).toBe("NotAuthorised");
    expect(err2.details.args[1]).toBe("ADDCONTROLLER");
  });

  it("allowed-calls set / show extends the scope", async () => {
    const r = await run(ctx, "allowed-calls set", { controller: operator.address, calls: [{ callTypes: ["CALL", "VALUE"], address: recA }, { callTypes: "CALL", address: recB, selector: "0xabcdef01" }] });
    expect(r.data.status).toBe("success");
    const s = await run(opCtx, "allowed-calls show", {});
    expect(s.data.entries).toHaveLength(2);
    expect((await run(opApproval(), "exec send", { to: recB, data: "0xabcdef01" })).data.status).toBe("success");
    const wrongFn = await run(opApproval(), "exec send", { to: recB, data: "0x11111111" }).catch((e) => e);
    expect(wrongFn.details.errorName).toBe("NotAllowedCall");
    await expect(run(ctx, "allowed-calls set", { controller: operator.address, calls: [{ callTypes: "CALL", address: "*" }] })).rejects.toThrow(/InvalidWhitelistedCall/);
  });

  it("SETDATA needs AllowedERC725YDataKeys: allowed-keys set / show", async () => {
    const lsp3 = { json: { LSP3Profile: { name: "op" } }, url: "ipfs://QmOp" };
    const e1 = await run(opApproval(), "account data set", { key: "LSP3Profile", value: lsp3 }).catch((e) => e);
    expect(e1.details.errorName).toBe("NoERC725YDataKeysAllowed");
    await run(ctx, "allowed-keys set", { controller: operator.address, keys: ["LSP3Profile"] });
    expect((await run(opCtx, "allowed-keys show", {})).data.keys).toEqual([DATA_KEYS.LSP3Profile]);
    expect((await run(opApproval(), "account data set", { key: "LSP3Profile", value: lsp3 })).data.status).toBe("success");
    const e2 = await run(opApproval(), "account data set", { key: "0x" + "ab".repeat(32), value: "0x01" }).catch((e) => e);
    expect(e2.details.errorName).toBe("NotAllowedERC725YDataKey");
  });

  it("controller edit --remove / --add (incl. the opt-in 4337 bit)", async () => {
    const r = await run(ctx, "controller edit", { address: operator.address, remove: ["TRANSFERVALUE"], add: ["4337"] });
    expect(r.data.change.removed).toEqual(["TRANSFERVALUE"]);
    expect(r.data.change.added).toEqual(["_4337_PERMISSION"]);
    expect(r.data.verified.ok).toBe(true);
    const err = await run(opApproval(), "exec send", { to: recA, value: "1" }).catch((e) => e);
    expect(err.details.errorName).toBe("NotAuthorised");
    expect(err.details.args[1]).toBe("TRANSFERVALUE");
  });

  it("controller remove clears permissions and compacts AddressPermissions[]", async () => {
    const r = await run(ctx, "controller remove", { address: operator.address });
    expect(r.data.verified.ok).toBe(true);
    const list = await run(ctx, "permissions list", {});
    expect(list.data.controllers.map((c: any) => c.address)).toEqual([agent.address, h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"], human.address]);
    const err = await run(opApproval(), "exec send", { to: recA, data: "0x01" }).catch((e) => e);
    expect(err.details.errorName).toBe("NoPermissionsSet");
    // swap-with-last: remove the URD from the middle, then re-add it
    await run(ctx, "controller remove", { address: h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"] });
    const l2 = await run(ctx, "permissions list", {});
    expect(l2.data.controllers.map((c: any) => [c.index, c.address])).toEqual([[0, agent.address], [1, human.address]]);
    await run(ctx, "controller add", { address: h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"], bits: "0x20080" });
  });

  it("refuses to remove/strip the last admin controller unless the approval says so explicitly", async () => {
    await run(ctx, "controller remove", { address: human.address });
    const e1 = await run(ctx, "controller remove", { address: agent.address }).catch((e) => e);
    expect(e1.code).toBe("CONSENT_REQUIRED");
    expect(e1.message).toMatch(/LAST controller/);
    const e2 = await run(ctx, "controller edit", { address: agent.address, permissions: ["CALL"] }).catch((e) => e);
    expect(e2.code).toBe("CONSENT_REQUIRED");
    // explicit approval on a throwaway profile
    const t = (await deployProfileFor(ctx, agent, h.chainId)).profile;
    const lockCtx = testContext(ctx.home, agent, { approval: "I understand this removes the last admin controller and locks the profile" });
    const r = await run(lockCtx, "controller edit", { profile: t, address: agent.address, permissions: ["CALL", "STATICCALL"] });
    expect(r.data.status).toBe("success");
    const after = await run(ctx, "permissions show", { profile: t, controller: agent.address });
    expect(after.data.admin).toBe(false);
  });
});

describe("agent-operator preset reaches existing (legacy) tokens", () => {
  it("LSP7 0.14.0 (0xb3c4928f), LSP7 0.19.0 and LSP8 0.14.0 token contracts are callable; other contracts are not", async () => {
    const rec = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "skills", "universal-profile", "assets", "registry", "lsp-deployments", "contracts", `${n}.json`), "utf8")).versions as any[];
    const tokens: Record<string, Address> = {};
    for (const n of ["LSP7MintableInit", "LSP8MintableInit"]) for (const v of rec(n)) tokens[`${n}@${v.version}`] = await h.deployViaNick(v.salt, v.creationBytecode);
    const op2 = testSigner(generatePrivateKey());
    await h.fund(op2.address, parseEther("1"));
    await run(ctx, "controller add", { address: op2.address, preset: "agent-operator" });
    const c2 = testContext(h.newHome(), op2, { approval: "ok" });
    for (const k of ["LSP7MintableInit@0.14.0", "LSP7MintableInit@0.19.0", "LSP8MintableInit@0.14.0", "LSP8MintableInit@0.19.0"]) {
      const r = await run(c2, "exec send", { profile, to: tokens[k], fn: "balanceOf(address)", args: [profile], via: "km" });
      expect(r.data.status, k).toBe("success");
    }
    const e = await run(c2, "exec send", { profile, to: recA, data: "0x01", via: "km" }).catch((x) => x);
    expect(e.details.errorName).toBe("NotAllowedCall");
  });
});

describe("ownership (LSP14)", () => {
  it("transfer to a new Key Manager + accept through it; the agent keeps executing via the new KM", async () => {
    const p = (await deployProfileFor(ctx, agent, h.chainId)).profile;
    const kmAbi = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "skills", "universal-profile", "assets", "abis", "lsp", "LSP6KeyManager.json"), "utf8")).abi as Abi;
    const newKm = await h.deployRaw(encodeDeployData({ abi: kmAbi, bytecode: fixture("LSP6KeyManager").bytecode as Hex, args: [p] }));
    await expect(run(ctx, "ownership accept", { profile: p })).rejects.toThrow(/no pending ownership transfer/);
    const t = await run(ctx, "ownership transfer", { profile: p, "new-owner": newKm });
    expect(t.data.newOwnerKind).toBe("key-manager");
    let info = await run(ctx, "account info", { profile: p });
    expect(info.data.pendingOwner).toBe(newKm);
    const a = await run(ctx, "ownership accept", { profile: p });
    expect(a.data.newOwner).toBe(newKm);
    info = await run(ctx, "account info", { profile: p });
    expect(info.data.km.keyManager).toBe(newKm);
    await h.fund(p, 10n);
    const s = await run(ctx, "exec send", { profile: p, to: recA, value: "3" });
    expect(s.data.keyManager).toBe(newKm);
  });

  it("transfer to an EOA (warns) + accept by that EOA", async () => {
    const p = (await deployProfileFor(ctx, agent, h.chainId)).profile;
    const t = await run(ctx, "ownership transfer", { profile: p, "new-owner": human.address });
    expect(t.warnings?.join()).toMatch(/EOA/);
    const hctx = testContext(h.newHome(), human, { approval: "I accept ownership" });
    const a = await run(hctx, "ownership accept", { profile: p });
    expect(a.data.newOwner).toBe(human.address);
    const info = await run(ctx, "account info", { profile: p });
    expect(info.data.km.ownerKind).toBe("eoa");
    await expect(run(ctx, "exec send", { profile: p, to: recA, data: "0x01" })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("renounce: approval mentioning 'renounce' per step, start → wait 200 blocks → confirm", async () => {
    const p = (await deployProfileFor(ctx, agent, h.chainId)).profile;
    await expect(run(ctx, "ownership renounce", { profile: p })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    const rctx = testContext(ctx.home, agent, { approval: "I want to renounce ownership of this test profile" });
    const s1 = await run(rctx, "ownership renounce", { profile: p });
    expect(s1.data.step).toBe("start");
    expect(s1.data.window).toBeTruthy();
    await expect(run(rctx, "ownership renounce", { profile: p })).rejects.toThrow(/can be confirmed between/);
    await h.request("hardhat_mine", ["0xc8"]);
    const s2 = await run(rctx, "ownership renounce", { profile: p });
    expect(s2.data.step).toBe("confirm");
    const info = await run(ctx, "account info", { profile: p });
    expect(info.data.km.owner).toBe(zeroAddress);
    expect(info.data.km.ownerKind).toBe("none");
  });
});
