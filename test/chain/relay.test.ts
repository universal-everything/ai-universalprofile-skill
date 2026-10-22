// J2 (relayer-created or any existing profile) + LSP15 relayer through the verbs:
// profile join (not authorised → human grants → authorised), relayer add/list/quota/
// execute/remove, exec relay with an UNFUNDED agent key (relayer pays gas), chainId
// routing and binding errors from the mock relayer, quota exhaustion, legacy relayers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, initCodeFor, readRecorder, RECORDER_RUNTIME, runVerb as run, startMockRelayer, type MockRelayer } from "../support/mock-relayer.ts";
import "../../src/lsp/verbs.ts";
import "../../src/relayer/verbs.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { RelayerClient } from "../../src/relayer/client.ts";
import { resolveAutoPath } from "../../src/exec/auto.ts";
import { composeNonce } from "../../src/lsp/lsp25.ts";
import { signLsp25 } from "../../src/lsp/lsp25.ts";
import { encodeUpExecute } from "../../src/exec/common.ts";
import { UP_ABI } from "../../src/lsp/abis.ts";
import { DATA_KEYS } from "../../src/lsp/constants.ts";

let h: Harness;
let human: Signer;
let agent: Signer;
let hctx: VerbContext;
let actx: VerbContext;
let profile: Address;
let keyManager: Address;
let recA: Address;
let relayer: MockRelayer;
const bal = async (a: Address) => BigInt(await h.request("eth_getBalance", [a, "latest"]));

beforeAll(async () => {
  h = await getHarness();
  human = testSigner(generatePrivateKey());
  agent = testSigner(generatePrivateKey()); // never funded: J2 agents act through the relayer
  await h.fund(human.address, parseEther("10"));
  hctx = testContext(h.newHome(), human, { approval: "human: approved" });
  const m = await deployProfileFor(hctx, human, h.chainId); // stands in for a relayer/website-created profile
  profile = m.profile;
  keyManager = m.keyManager;
  await h.fund(profile, parseEther("2"));
  recA = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  actx = testContext(h.newHome(), agent, { approval: "human approved the agent's actions in this suite" });
  relayer = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[1], chainIdRequired: true });
}, 120_000);

afterAll(async () => relayer?.close());

describe("J2: join an existing profile", () => {
  it("profile join reports NOT authorised and prints the recommended permission set", async () => {
    const r = await run(actx, "profile join", { address: profile, "allow-targets": [{ address: recA }] });
    expect(r.data.chains).toHaveLength(1);
    expect(r.data.chains[0]).toMatchObject({ chainId: h.chainId, deployed: true, keyManager, authorised: false });
    expect(r.data.chains[0].otherControllers.map((c: any) => c.address)).toContain(human.address);
    expect(r.text).toMatch(/NOT AUTHORISED/);
    expect(r.text).toContain(agent.address);
    expect(r.data.recommendation.preset).toBe("agent-operator");
    expect((await actx.config()).defaultProfile).toBe(profile);
  });

  it("the human grants the recommended set (controller add from the human's side); join now reports AUTHORISED", async () => {
    const rec = (await run(actx, "permissions recommend", { "allow-targets": [{ address: recA }] })).data;
    const g = await run(hctx, "controller add", { profile, address: agent.address, bits: rec.permissions.hex, "allowed-calls": rec.allowedCalls.entries });
    expect(g.data.verified.ok).toBe(true);
    const r = await run(actx, "profile join", { address: profile, alias: "boss" });
    expect(r.data.chains[0]).toMatchObject({ authorised: true, hasRecommended: true, missing: [] });
    expect(r.text).toMatch(/AUTHORISED/);
    expect((await actx.config()).aliases?.boss).toBe(profile);
  });
});

describe("relayer verbs and the relay path", () => {
  it("relayer add negotiates capabilities; relayer list", async () => {
    const r = await run(actx, "relayer add", { url: relayer.url, name: "mock" });
    expect(r.data.relayer).toMatchObject({ name: "mock", chainIds: [h.chainId], profile: "lsp15" });
    expect(r.data.capabilities).toMatchObject({ legacy: false, lsp15Version: "1.1", chainIdRequired: true });
    const l = await run(actx, "relayer list", {});
    expect(l.data.relayers.map((x: any) => x.name)).toContain("mock");
    await expect(run(actx, "relayer add", { url: relayer.url, name: "bad", chains: ["1"] })).rejects.toThrow(/do not list chain/);
  });

  it("relayer quota: LSP15 signed message verified by the relayer (v2 includes chainId)", async () => {
    const q = await run(actx, "relayer quota", {});
    expect(q.data).toMatchObject({ available: true, hasQuota: true, signatureVersion: 2, chainId: h.chainId });
    expect(relayer.quotaChecks.at(-1)).toMatchObject({ ok: true, recovered: agent.address, version: 2 });
    const dry = await run(testContext(actx.home, agent, { dryRun: true }), "relayer quota", {});
    expect(dry.data.dryRun).toBe(true);
  });

  it("exec relay: value from the profile, msg.sender = profile, relayer pays gas, the unfunded agent pays nothing", async () => {
    expect(await bal(agent.address)).toBe(0n);
    const before = await bal(recA);
    const r = await run(actx, "exec relay", { to: recA, value: "12345", data: "0x01020304" });
    expect(r.data.status).toBe("success");
    expect(await bal(recA)).toBe(before + 12345n);
    expect((await readRecorder(h.request, recA)).sender).toBe(profile);
    expect(await bal(agent.address)).toBe(0n);
    const req = relayer.requests.filter((x) => x.path === "POST /api/execute").at(-1)!;
    expect(req.body.chainId).toBe(h.chainId);
    expect(req.body.transaction.abi.slice(0, 10)).toBe("0x44c028fe");
  });

  it("exec send --via auto chooses relay (relayer covers the chain, quota > 0)", async () => {
    const r = await run(actx, "exec send", { to: recA, data: "0x05", via: "auto" });
    expect(r.data.path).toBe("relay");
    expect(r.text).toMatch(/path chosen: relay/);
  });

  it("relayer execute with a call; payloads the controller may not run are refused before signing", async () => {
    const r = await run(actx, "relayer execute", { to: recA, data: "0x06" });
    expect(r.data.status).toBe("success");
    const payload = encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [DATA_KEYS.LSP3Profile, "0x01"] });
    const err = await run(actx, "relayer execute", { payload }).catch((e) => e);
    expect(err.code).toBe("SIMULATION_REVERTED");
    expect(err.details.errorName).toBe("NoERC725YDataKeysAllowed");
  });

  it("exec relay with an expired validity window decodes RelayCallExpired; nothing reaches the relayer", async () => {
    const now = BigInt((await h.request("eth_getBlockByNumber", ["latest", false])).timestamp);
    const n = relayer.requests.length;
    const err = await run(actx, "exec relay", { to: recA, data: "0x07", "valid-from": Number(now - 3600n), "valid-until": Number(now - 1800n) }).catch((e) => e);
    expect(err.details.errorName).toBe("RelayCallExpired");
    expect(relayer.requests.slice(n).some((x) => x.path === "POST /api/execute")).toBe(false);
  });

  it("nonce verb shows the saved relay channel (advanced by the relays above), channel 0 and the relayer's earlier default channel", async () => {
    const r = await run(actx, "nonce", {});
    expect(r.data.keyManager).toBe(keyManager);
    expect(r.data.relayChannel.channel).toMatch(/^\d+$/);
    const saved = r.data.relay.find((x: any) => x.label.startsWith("saved relay channel"));
    expect(saved.channel).toBe(r.data.relayChannel.channel);
    expect(Number(saved.sequence)).toBeGreaterThanOrEqual(3);
    expect(r.data.relay.find((x: any) => x.label.includes("earlier default channel of relayer mock")).sequence).toBe("0");
    expect(r.data.relay.some((x: any) => x.channel === "0")).toBe(true);
    expect(r.data.eoaNonce).toBe(0);
    // the explicit verb shows the same channel and never replaces it
    const c = await run(actx, "nonce channel", {});
    expect(c.data).toMatchObject({ profile, created: false, relayChannel: { channel: r.data.relayChannel.channel } });
    const again = await run(actx, "nonce channel create", {});
    expect(again.data).toMatchObject({ created: false, relayChannel: { channel: r.data.relayChannel.channel } });
    await expect(run(actx, "nonce channel create", { channel: "12345" })).rejects.toMatchObject({ code: "BAD_ARGS", message: /never replaced/ });
  });

  it("dry-run relay: no signature, no relayer request, no state change", async () => {
    const n = relayer.requests.length;
    const before = (await readRecorder(h.request, recA)).count;
    const r = await run(testContext(actx.home, agent, { dryRun: true }), "exec relay", { to: recA, data: "0x08" });
    expect(r.data.status).toBe("dry-run");
    expect(r.data.confirmation.quota).toMatch(/^not checked in dry-run/);
    expect(relayer.requests.length).toBe(n);
    expect((await readRecorder(h.request, recA)).count).toBe(before);
  });
});

describe("quota login is signed only after approval on the explicit relay path", () => {
  it("refused consent → no /quota request, nothing signed; approved → quota checked, recorded in the confirmation", async () => {
    const before = relayer.quotaChecks.length;
    const noConsent = testContext(actx.home, agent, { yes: false });
    await expect(run(noConsent, "exec relay", { to: recA, data: "0x0b" })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(relayer.quotaChecks.length).toBe(before);
    expect(relayer.requests.filter((x) => x.path === "POST /api/quota").length).toBe(before);
    const r = await run(actx, "exec relay", { to: recA, data: "0x0c" });
    expect(r.data.confirmation.quota).toMatch(/checked AFTER approval/);
    expect(r.data.confirmation.quotaResult.available).toBe(true);
    expect(relayer.quotaChecks.length).toBe(before + 1);
  });
  it("auto records that the quota login was signed before approval to choose the path", async () => {
    const r = await run(actx, "exec send", { to: recA, data: "0x0d" });
    expect(r.data.path).toBe("relay");
    expect(r.data.confirmation.autoDecision.quotaLogin).toMatch(/signed BEFORE approval to choose the path — LSP15 \/quota login message only/);
  });
});

describe("relayer-side checks (chainId extension) and client error mapping", () => {
  it("missing chainId → 400 chainId_required; unsupported chain → chain_unsupported", async () => {
    const res = await fetch(`${relayer.url}/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: profile, transaction: { abi: "0x12345678", signature: "0x" + "11".repeat(65), nonce: "0x1" } }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("chainId_required");
    const client = new RelayerClient({ name: "mock", baseUrl: relayer.url, chainIds: [h.chainId, 999], profile: "lsp15" });
    const err = await client.execute({ address: profile, chainId: 999, transaction: { abi: "0x12345678", signature: ("0x" + "11".repeat(65)) as Hex, nonce: 1n, validityTimestamps: 0n } }).catch((e) => e);
    expect(err.details.code).toBe("chain_unsupported");
  });

  it("a signature bound to another chain is rejected as chain_binding_mismatch", async () => {
    const payload = encodeUpExecute({ operation: 0, to: recA, value: 0n, data: "0x" });
    const nonce = composeNonce(0n, 0n);
    const sig = await signLsp25(agent, { keyManager, chainId: 1, nonce, validityTimestamps: 0n, value: 0n, payload });
    const client = new RelayerClient({ name: "mock", baseUrl: relayer.url, chainIds: [h.chainId], profile: "lsp15" });
    const err = await client.execute({ address: profile, chainId: h.chainId, transaction: { abi: payload, signature: sig, nonce, validityTimestamps: 0n } }).catch((e) => e);
    expect(err.code).toBe("RELAYER_ERROR");
    expect(err.details.code).toBe("chain_binding_mismatch");
    expect(err.details.fallback).toBe("none");
  });

  it("quota exhausted: relay refused before signing; auto falls back to km", async () => {
    const empty = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[2], quota: { quota: 0, unit: "gas", totalQuota: 20_000_000, resetDate: 0 } });
    await run(actx, "relayer add", { url: empty.url, name: "empty" });
    const err = await run(actx, "exec relay", { to: recA, data: "0x09", relayer: "empty" }).catch((e) => e);
    expect(err.code).toBe("RELAYER_ERROR");
    expect(err.details.code).toBe("quota_exhausted");
    const d = await resolveAutoPath(actx, h.chainId, profile, agent, "empty");
    expect(d.path).toBe("km");
    expect(d.reason).toMatch(/quota is 0/);
    await run(actx, "relayer remove", { name: "empty" });
    await empty.close();
  });

  it("legacy relayer (no capability document): works with base-URL-per-chain", async () => {
    const legacy = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[3], mode: "legacy" });
    const add = await run(actx, "relayer add", { url: legacy.url, name: "legacy", chains: [String(h.chainId)] });
    expect(add.data.capabilities.legacy).toBe(true);
    const r = await run(actx, "exec relay", { to: recA, data: "0x0a", relayer: "legacy" });
    expect(r.data.status).toBe("success");
    await run(actx, "relayer remove", { name: "legacy" });
    expect((await run(actx, "relayer list", {})).data.relayers.map((x: any) => x.name)).not.toContain("legacy");
    await legacy.close();
  });
});

describe("signing as the profile from a joined profile (SIGN in agent-operator)", () => {
  it("sign message --as profile validates via ERC-1271 on chain; verify-1271", async () => {
    const s = await run(actx, "sign message", { message: "login to example.org nonce 42" });
    expect(s.data.verification.valid).toBe(true);
    const v = await run(actx, "verify-1271", { signature: s.data.signature, message: "login to example.org nonce 42" });
    expect(v.data.valid).toBe(true);
    const bad = await run(actx, "verify-1271", { signature: s.data.signature, message: "something else" });
    expect(bad.data.valid).toBe(false);
  });
});
