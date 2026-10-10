// One Universal Profile across two chains (two independent in-process EVMs with different
// chain ids, both with the canonical LSP stack at the real addresses):
//  - per-chain controller keys from the real config + signer backend (memory test backend),
//    no signer override: chain A signs with the default key, chain B with its own key;
//  - deployed on A only → profile status, the preflight NOT_DEPLOYED hint, manifest replay on B
//    (same address, B's key pays gas, initial controller stays the default key);
//  - authorised on A only → NOT_AUTHORISED with the per-chain fix; after the grant on B every
//    signing path on B (km, relay + relayer quota login, ERC-1271) uses B's key;
//  - a profile with a different address on B, linked with profile link;
//  - one unreachable chain does not break the overview.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getHarness, getSecondHarness, multiChainHome, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, runVerb, startMockRelayer, type MockRelayer } from "../support/mock-relayer.ts";
import "../../src/lsp/verbs.ts";
import "../../src/relayer/verbs.ts";
import "../../src/signer/verbs.ts";
import type { VerbContext } from "../../src/core/types.ts";
import { paths } from "../../src/core/home.ts";
import { DEFAULT_POLICY, savePolicy } from "../../src/core/policy.ts";
import { writeProfileRecord } from "../../src/core/profile-record.ts";
import { getBackend } from "../../src/signer/index.ts";
import { resetMemoryBackend } from "../../src/signer/memory.ts";
import { controllerAddress } from "../../src/exec/verbs.ts";

const run = runVerb;

let hA: Harness;
let hB: Harness;
let home: string;
let ctx: VerbContext; // the agent: real per-chain key selection from config (no signer override)
let A: number;
let B: number;
const pkA = generatePrivateKey(); // default key
const pkB = generatePrivateKey(); // chain B's own key
const keyA = privateKeyToAccount(pkA).address;
const keyB = privateKeyToAccount(pkB).address;
let profile: Address;
let seed: Hex;
let relayer: MockRelayer;
const savedEph = process.env.UP_TEST_EPHEMERAL_KEY;
const approval = { approval: "human: approved for this multichain test suite" };
const nonceOf = async (h: Harness, a: Address) => Number(BigInt(await h.request("eth_getTransactionCount", [a, "latest"])));

beforeAll(async () => {
  hA = await getHarness();
  hB = await getSecondHarness();
  A = hA.chainId;
  B = hB.chainId;
  process.env.UP_TEST_EPHEMERAL_KEY = "1";
  resetMemoryBackend();
  const mem = getBackend("memory");
  expect(await mem.importKey!(pkA)).toBe(keyA);
  expect(await mem.importKey!(pkB)).toBe(keyB);
  home = multiChainHome([hA, hB]);
  const cfg = JSON.parse(readFileSync(paths.config(home), "utf8"));
  const now = new Date().toISOString();
  writeFileSync(paths.config(home), JSON.stringify({ ...cfg, controller: { address: keyA, backend: "memory", createdAt: now }, chainControllers: { [String(B)]: { address: keyB, backend: "memory", createdAt: now } } }), { mode: 0o600 });
  ctx = testContext(home, undefined, approval);
  await hA.fund(keyA, parseEther("10"));
  await hB.fund(keyB, parseEther("10"));
}, 240_000);

afterAll(async () => {
  await relayer?.close();
  if (savedEph === undefined) delete process.env.UP_TEST_EPHEMERAL_KEY;
  else process.env.UP_TEST_EPHEMERAL_KEY = savedEph;
});

describe("two chains, one profile", () => {
  it("the harness really runs two separate chains", async () => {
    expect(A).not.toBe(B);
    expect(Number(BigInt(await hB.request("eth_chainId")))).toBe(B);
    expect(hA.rpcUrl).not.toBe(hB.rpcUrl);
    expect(hB.lsp.LSP23LinkedContractsFactory).toBe(hA.lsp.LSP23LinkedContractsFactory);
  });

  it("selects the signing key per chain from config (default key on A, own key on B)", async () => {
    expect((await ctx.signer(A)).address).toBe(keyA);
    expect((await ctx.signer(B)).address).toBe(keyB);
    expect((await ctx.signer()).address).toBe(keyA); // the verb's chain: the default chain A
    expect(await controllerAddress(ctx, B)).toBe(keyB);
    const k = await run(ctx, "key address", {});
    expect(k.data).toMatchObject({ address: keyA, default: { address: keyA }, chainControllers: [{ chainId: B, address: keyB, backend: "memory" }] });
    expect(k.text).toContain(`Second test EVM (${B}) → ${keyB}`);
    const kb = await run(ctx, "key address", { chain: String(B) });
    expect(kb.data).toMatchObject({ address: keyB, chainId: B, scope: "chain" });
    expect(kb.text).toContain(`the agent's own key on Second test EVM (${B})`);
    // the recommendation to hand over names the key per chain
    const recA = await run(ctx, "permissions recommend", { chain: String(A) });
    expect(recA.data.controller).toBe(keyA);
    expect(recA.warnings!.join(" ")).toContain(`on Second test EVM (${B}) it uses ${keyB}`);
    const recB = await run(ctx, "permissions recommend", { chain: String(B) });
    expect(recB.data.controller).toBe(keyB);
    expect(recB.warnings!.join(" ")).toContain(`on chains without their own key it uses its default key ${keyA}`);
  });

  it("deploys on chain A only: the address is derived from the default key", async () => {
    const pre = await run(ctx, "account precompute", { count: 2, chain: String(A) });
    expect(pre.data.controller).toBe(keyA);
    seed = pre.data.seed;
    profile = pre.data.candidates[0].profile;
    // precompute with chain B still derives from the default key: the address is chain-independent
    const preB = await run(ctx, "account precompute", { count: 2, seed, chain: String(B) });
    expect(preB.data.candidates[0].profile).toBe(profile);
    expect(preB.data.onChainCrossCheck.matches).toBe(true);
    const d = await run(ctx, "account deploy", { seed, candidate: 0, chain: String(A) });
    expect(d.data.status).toBe("deployed");
    expect(d.data.profile).toBe(profile);
    expect(d.data.confirmation.gasPayer).toBe(`controller EOA ${keyA}`);
    expect(await hB.request("eth_getCode", [profile, "latest"])).toBe("0x");
  });

  it("profile status: deployed and ready on A, not deployed on B with the replay as next step; snapshot merged into the record", async () => {
    const r = await run(ctx, "profile status", {});
    const [sa, sb] = r.data.chains;
    expect(r.data.profile).toBe(profile);
    expect(sa).toMatchObject({ chainId: A, deployed: true, isUniversalProfile: true, ready: true, manifest: true });
    expect(sa.controller).toMatchObject({ address: keyA, scope: "default", isController: true, admin: true, canRelay: true, restrictedCalls: false });
    expect(sb).toMatchObject({ chainId: B, deployed: false, ready: false, profile });
    expect(sb.controller).toMatchObject({ address: keyB, scope: "chain", isController: false, lowGas: false });
    expect(sb.nextSteps[0]).toMatch(/^deploy your profile on Second test EVM \(31338\) at the same address: up account deploy --chain local-b/);
    expect(r.data.ready).toEqual([A]);
    expect(r.text).toMatch(new RegExp(`^Your Universal Profile ${profile} — one account on 2 chains`));
    expect(r.text).toContain(`- Local test EVM (${A}): deployed (UP 0.14.0); the agent can act with all permissions`);
    expect(r.text).toContain(`- Second test EVM (${B}): not deployed yet`);
    expect(r.text).toContain("Ready on: Local test EVM.");
    const rec = JSON.parse(readFileSync(paths.profile(home, profile), "utf8"));
    expect(rec.deployment.profile).toBe(profile); // other modules' keys are kept
    expect(rec.status.chains[String(A)]).toMatchObject({ deployed: true, controller: keyA, isController: true, ready: true });
    expect(rec.status.chains[String(B)]).toMatchObject({ deployed: false, controller: keyB, ready: false });
  });

  it("a write on B is stopped by the preflight before anything is signed: not deployed, with the replay hint", async () => {
    const before = await nonceOf(hB, keyB);
    const e = await run(ctx, "exec send", { chain: String(B), to: hB.accounts[5], value: "1" }).catch((x) => x);
    expect(e.code).toBe("NOT_DEPLOYED");
    expect(e.message).toBe(`your Universal Profile ${profile} is not deployed on Second test EVM (${B}) yet (it is one account across chains, but each chain needs its own deployment)`);
    expect(e.hint).toMatch(/up account deploy --chain local-b/);
    expect(e.hint).toMatch(/do not send assets to/);
    expect(e.details).toMatchObject({ chainId: B, deployed: false, manifest: true, controller: keyB });
    expect(await nonceOf(hB, keyB)).toBe(before);
  });

  it("account deploy --chain B replays the manifest: same address, B's key pays gas, and it warns that B's key is not the initial controller", async () => {
    const d = await run(ctx, "account deploy", { chain: String(B) });
    expect(d.data.status).toBe("deployed");
    expect(d.data.profile).toBe(profile);
    expect(d.data.confirmation.gasPayer).toBe(`controller EOA ${keyB}`);
    expect(d.warnings!.join(" ")).toContain(`the profile's initial controller there is ${keyA}`);
    const tx = await hB.request("eth_getTransactionByHash", [d.data.txHash]);
    expect(getAddress(tx.from)).toBe(keyB);
    const m = JSON.parse(readFileSync(paths.profile(home, profile), "utf8")).deployment;
    expect(m.chains).toEqual([A, B]);
  });

  it("authorised on A only: status names the fix, and a write on B fails with NOT_AUTHORISED + the per-chain hint", async () => {
    const r = await run(ctx, "profile status", { chains: [String(A), String(B)] });
    const sb = r.data.chains[1];
    expect(sb).toMatchObject({ deployed: true, ready: false, otherLocalController: { address: keyA } });
    expect(sb.controller.isController).toBe(false);
    expect(sb.nextSteps[0]).toMatch(new RegExp(`^ask the human to authorise this agent's key ${keyB} on Second test EVM \\(${B}\\)`));
    expect(sb.nextSteps[1]).toContain(`up key activate ${keyA} --chain local-b`);
    expect(r.text).toContain(`this agent's key ${keyB} is not a controller here yet`);
    const e = await run(ctx, "exec send", { chain: String(B), to: hB.accounts[5], value: "1" }).catch((x) => x);
    expect(e.code).toBe("NOT_AUTHORISED");
    expect(e.message).toBe(`on Second test EVM (${B}) this agent's key ${keyB} is not a controller of your Universal Profile ${profile}`);
    expect(e.hint).toMatch(/permissions are per chain/);
    expect(e.hint).toContain("up permissions recommend --chain local-b");
    expect(e.hint).toContain(`or use the agent's key ${keyA}, which already is a controller on Second test EVM`);
    expect(e.details).toMatchObject({ errorName: "NoPermissionsSet", chainId: B, controller: keyB, recommendation: { preset: "agent-operator" } });
    // the same action on A works with the default key
    const ok = await run(ctx, "exec send", { chain: String(A), to: hA.accounts[5], value: "0", via: "km" });
    expect(ok.data.status).toBe("success");
    expect(getAddress((await hA.request("eth_getTransactionByHash", [ok.data.txHash])).from)).toBe(keyA);
  });

  it("after the grant on B (by an admin key), every path on B signs with B's key", async () => {
    // the human / an admin controller grants B's key on B (here: the default key, which is admin there)
    const admin = testContext(home, testSigner(pkA), approval);
    const grant = { chain: String(B), address: keyB, permissions: ["SUPER_TRANSFERVALUE", "SUPER_CALL", "SIGN", "EXECUTE_RELAY_CALL"], via: "km" };
    // the default key has gas on A only: the gas error names the chain and the funding command for it
    const noGas = await run(admin, "controller add", grant).catch((x) => x);
    expect(noGas.code).toBe("TX_FAILED");
    expect(noGas.hint).toBe(`ask the human to fund the agent's key ${keyA} on Second test EVM (${B}) with ETH for gas: up display address ${keyA} --chain local-b (QR code); or use a relayer if one covers Second test EVM (up relayer list)`);
    await hB.fund(keyA, parseEther("1"));
    const g = await run(admin, "controller add", grant);
    expect(g.data.verified.ok).toBe(true);
    await hB.fund(profile, parseEther("1"));
    // direct Key Manager path
    const km = await run(ctx, "exec send", { chain: String(B), to: hB.accounts[6], value: "5", via: "km" });
    expect(km.data.status).toBe("success");
    expect(km.data.gasPayer).toBe(`controller EOA ${keyB}`);
    expect(getAddress((await hB.request("eth_getTransactionByHash", [km.data.txHash])).from)).toBe(keyB);
    // relayer quota login + LSP25 relay call on B are signed by B's key
    relayer = await startMockRelayer({ request: hB.request, chainId: B, relayerAccount: hB.accounts[1], chainIdRequired: true });
    await run(ctx, "relayer add", { url: relayer.url, name: "mock-b", chains: [String(B)] });
    const q = await run(ctx, "relayer quota", { chain: String(B) });
    expect(q.data.hasQuota).toBe(true);
    expect(relayer.quotaChecks.at(-1)).toMatchObject({ recovered: keyB, ok: true });
    const rl = await run(ctx, "exec send", { chain: String(B), to: hB.accounts[6], value: "7", via: "relay" });
    expect(rl.data.status).toBe("success");
    const pv = rl.data.confirmation.events.find((x: any) => x.event === "PermissionsVerified");
    expect(getAddress(pv.args.signer)).toBe(keyB);
    // ERC-1271 as the profile on B: signed by B's key, verified by the profile on B
    const sig = await run(ctx, "sign message", { message: "hello from the profile on chain B", chain: String(B) });
    expect(sig.data.signer).toBe(keyB);
    expect(sig.data.verification.valid).toBe(true);
    const sigA = await run(ctx, "sign message", { message: "hello from the profile on chain A", chain: String(A) });
    expect(sigA.data.signer).toBe(keyA);
    // status: ready on both chains, B through the relayer
    const st = await run(ctx, "profile status", {});
    expect(st.data.ready).toEqual([A, B]);
    expect(st.data.chains[1]).toMatchObject({ relayUsable: true, relayer: { name: "mock-b" } });
    expect(st.data.chains[1].controller).toMatchObject({ address: keyB, isController: true, restrictedCalls: false, restrictedDataKeys: false });
  });

  it("a missing permission on B is explained for B: NotAuthorised + the exact grant command there", async () => {
    const e = await run(ctx, "account data set", { chain: String(B), key: "LSP3Profile", value: { json: { LSP3Profile: { name: "b" } }, url: "ipfs://QmB" }, via: "km" }).catch((x) => x);
    expect(e.details.errorName).toBe("NotAuthorised");
    expect(e.hint).toContain(`on Second test EVM the agent's key ${keyB} lacks SETDATA on your profile ${profile}`);
    expect(e.hint).toContain(`up controller edit ${keyB} --add SETDATA --chain local-b`);
  });

  it("key activate --chain switches one chain only; activating the default key there makes the chain use it again; no key is dropped", async () => {
    const back = await run(ctx, "key activate", { address: keyA, chain: String(B) });
    expect(back.data).toMatchObject({ address: keyA, chainId: B, scope: "default", changed: true });
    let cfg = await ctx.config();
    expect(cfg.chainControllers).toBeUndefined();
    expect(cfg.previousControllers).toEqual([expect.objectContaining({ address: keyB, chainId: B })]);
    expect((await ctx.signer(B)).address).toBe(keyA);
    const again = await run(ctx, "key activate", { address: keyB, chain: String(B) });
    expect(again.data).toMatchObject({ address: keyB, scope: "chain", changed: true });
    cfg = await ctx.config();
    expect(cfg.chainControllers?.[String(B)].address).toBe(keyB);
    expect(cfg.controller!.address).toBe(keyA);
    expect(cfg.previousControllers ?? []).toEqual([]);
    expect((await ctx.signer(B)).address).toBe(keyB);
    expect((await ctx.signer(A)).address).toBe(keyA);
  });
});

describe("EIP-712 typed data is signed with the key of the chain it names (domain.chainId)", () => {
  const typed = (chainId: number | string) => ({
    domain: { name: "Multichain test", version: "1", chainId, verifyingContract: "0x00000000000000000000000000000000000000aa" },
    types: { Mail: [{ name: "contents", type: "string" }] },
    primaryType: "Mail",
    message: { contents: `hello on ${chainId}` },
  });

  it("as profile: domain chain B with default chain A → B's key, the profile on B, verified on B", async () => {
    const r = await run(ctx, "sign typed-data", { "typed-data": typed(B) });
    expect(r.data).toMatchObject({ as: "profile", chainId: B, signer: keyB, profile });
    expect(r.data.verification.valid).toBe(true);
    // matching explicit --chain is fine; the hex form of the chain id too
    const same = await run(ctx, "sign typed-data", { "typed-data": typed("0x" + B.toString(16)), chain: String(B) });
    expect(same.data).toMatchObject({ chainId: B, signer: keyB });
    const onA = await run(ctx, "sign typed-data", { "typed-data": typed(A), chain: String(A) });
    expect(onA.data).toMatchObject({ chainId: A, signer: keyA });
    expect(onA.data.verification.valid).toBe(true);
  });

  it("as controller: domain chain B → B's key (the signature recovers to it), never the default key", async () => {
    const td = typed(B);
    const r = await run(ctx, "sign typed-data", { "typed-data": td, as: "controller" });
    expect(r.data).toMatchObject({ as: "controller", chainId: B, signer: keyB });
    const { recoverTypedDataAddress } = await import("viem");
    expect(await recoverTypedDataAddress({ ...(td as any), signature: r.data.signature })).toBe(keyB);
  });

  it("a mismatching explicit --chain is refused in both modes before any key is used or consent asked", async () => {
    for (const as of ["profile", "controller"]) {
      const e = await run(ctx, "sign typed-data", { "typed-data": typed(B), chain: String(A), as }).catch((x) => x);
      expect(e.code).toBe("BAD_ARGS");
      expect(e.message).toContain(`the typed data is for chain ${B} (domain.chainId) but --chain is ${A}`);
    }
    const bad = await run(ctx, "sign typed-data", { "typed-data": typed("not-a-chain"), as: "controller" }).catch((x) => x);
    expect(bad.code).toBe("BAD_ARGS");
  });
});

describe("a different address on one chain: profile link", () => {
  let other: Address;

  it("links a Universal Profile that lives at another address on B (human approval), and every verb on B acts as it", async () => {
    const m = await deployProfileFor(testContext(hB.newHome(), testSigner(pkB), approval), testSigner(pkB), B, { controller: keyB });
    other = m.profile;
    expect(other).not.toBe(profile);
    const noApproval = testContext(home, undefined, { yes: true });
    await expect(run(noApproval, "profile link", { address: other, chain: String(B) })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    // even with admin actions delegated (policy.allowAdmin), linking needs the human's own words
    await savePolicy(home, { ...DEFAULT_POLICY, allowAdmin: true });
    await expect(run(noApproval, "profile link", { address: other, chain: String(B) })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await savePolicy(home, DEFAULT_POLICY);
    await expect(run(ctx, "profile link", { address: other })).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(run(ctx, "profile link", { address: hB.accounts[7], chain: String(B) })).rejects.toMatchObject({ code: "NOT_DEPLOYED" });
    const l = await run(ctx, "profile link", { address: other, chain: String(B) });
    expect(l.data).toMatchObject({ profile, chainId: B, linked: other, agentKey: keyB, agentIsController: true, changed: true });
    expect(l.warnings!.join(" ")).toContain(`your profile's usual address ${profile} also has code on Second test EVM`);
    expect(await ctx.profile(undefined, B)).toBe(other);
    expect(await ctx.profile(undefined, A)).toBe(profile);
    expect(await ctx.identity()).toBe(profile);
    const info = await run(ctx, "account info", { chain: String(B) });
    expect(info.data.profile).toBe(other);
    expect(info.data.thisAgent).toMatchObject({ controller: keyB, isController: true });
    const st = await run(ctx, "profile status", {});
    expect(st.data.chains[1]).toMatchObject({ chainId: B, profile: other, linked: true, ready: true });
    expect(st.text).toContain(`deployed at its linked address ${other}`);
    // the replay is refused on a linked chain: the profile already exists there
    await expect(run(ctx, "account deploy", { chain: String(B) })).rejects.toThrow(/linked to/);
    // counterparties are never mapped: sending TO the usual address on B stays that address
    const dry = testContext(home, undefined, { dryRun: true });
    const s = await run(dry, "exec send", { chain: String(B), to: profile, value: "0", via: "km" });
    expect(s.data.profile).toBe(other);
    expect(s.data.confirmation.calls[0].to).toBe(profile);
  });

  it("unlink restores the usual address on B (and also always needs the human's words)", async () => {
    await savePolicy(home, { ...DEFAULT_POLICY, allowAdmin: true });
    await expect(run(testContext(home, undefined, { yes: true }), "profile link", { unlink: true, chain: String(B) })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await savePolicy(home, DEFAULT_POLICY);
    expect(await ctx.profile(undefined, B)).toBe(other);
    const u = await run(ctx, "profile link", { unlink: true, chain: String(B) });
    expect(u.data).toMatchObject({ linked: null, removedLink: other, changed: true });
    expect(await ctx.profile(undefined, B)).toBe(profile);
    const rec = JSON.parse(readFileSync(paths.profile(home, profile), "utf8"));
    expect(rec.chainAddresses).toEqual({});
    expect(rec.deployment.profile).toBe(profile);
  });
});

describe("profile status: chains known from profile join", () => {
  it("includes a chain where join found the profile deployed, even when it is not configured", async () => {
    const h2 = multiChainHome([hA, hB]);
    const cfg = JSON.parse(readFileSync(paths.config(h2), "utf8"));
    writeFileSync(paths.config(h2), JSON.stringify({ ...cfg, chains: [A], controller: { address: keyA, backend: "memory", createdAt: "x" } }), { mode: 0o600 });
    await writeProfileRecord(h2, profile, { joined: { at: "t", chains: [{ chainId: B, deployed: true, authorised: false }, { chainId: 999_999_001, deployed: false, authorised: false }] } });
    const r = await run(testContext(h2, undefined, approval), "profile status", { profile });
    expect(r.data.chains.map((c: any) => c.chainId)).toEqual([A, B]);
    expect(r.data.chains[1]).toMatchObject({ chainId: B, deployed: true });
  });
});

describe("per-chain error isolation", () => {
  it("an unreachable chain is reported with its fix while the other chains are still checked", async () => {
    const overlayFile = join(home, "cache", "registry", "overlay.json");
    const overlay = JSON.parse(readFileSync(overlayFile, "utf8"));
    overlay.chains.push({ ...hA.overlayChain, chainId: 31339, name: "Dead test EVM", slug: "dead", rpcs: [{ url: "http://127.0.0.1:9/", source: "user", trust: "user" }] });
    writeFileSync(overlayFile, JSON.stringify(overlay));
    const fresh = testContext(home, undefined, approval); // re-reads the registry overlay
    const r = await run(fresh, "profile status", { chains: [String(A), "31339", String(B)] });
    expect(r.data.chains.map((c: any) => c.chainId)).toEqual([A, 31339, B]);
    expect(r.data.chains[0].ready).toBe(true);
    expect(r.data.chains[2].ready).toBe(true);
    expect(r.data.chains[1]).toMatchObject({ chainId: 31339, ready: false, errorCode: "RPC_UNAVAILABLE" });
    expect(r.data.chains[1].nextSteps[0]).toContain("up chains rpc find 31339");
    expect(r.warnings!.join(" ")).toContain("Dead test EVM (31339) could not be checked");
    expect(r.text).toContain("- Dead test EVM (31339): could not be checked");
  });
});
