// Library-level chain tests for the three account-core transports (km, lsp0,
// relay): msg.sender at the target is the profile, value comes from the profile
// balance (or the controller with fundFromController), batches, revert decoding.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, getAddress, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, initCodeFor, readRecorder, RECORDER_RUNTIME, startMockRelayer, WHOAMI_RUNTIME, type MockRelayer } from "../support/mock-relayer.ts";
import "../../src/exec/index.ts";
import { executeAsProfile, OPERATION, type ExecOutcome } from "../../src/exec/transport.ts";
import { executeAuto } from "../../src/exec/auto.ts";
import { UpError } from "../../src/core/errors.ts";
import { KM_ABI, UP_ABI } from "../../src/lsp/abis.ts";
import { encodeExecuteRelayCallBatch, getRelayNonce, signRelayBatch, defaultChannel, splitNonce, lsp25Digest, signLsp25, recoverLsp25Signer } from "../../src/lsp/lsp25.ts";
import { encodeUpExecute } from "../../src/exec/common.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { relayChannelState } from "../../src/lsp/relay-channel.ts";

let h: Harness;
let signer: Signer;
let ctx: VerbContext;
let profile: Address;
let km: Address;
let recA: Address;
let recB: Address;
let whoami: Address;
let relayer: MockRelayer;

const bal = async (a: Address) => BigInt(await h.request("eth_getBalance", [a, "latest"]));

beforeAll(async () => {
  h = await getHarness();
  signer = testSigner(generatePrivateKey());
  await h.fund(signer.address, parseEther("10"));
  const home = h.newHome();
  ctx = testContext(home, signer, { approval: "test: human approves all actions in this suite" });
  const m = await deployProfileFor(ctx, signer, h.chainId);
  profile = m.profile;
  km = m.keyManager;
  await h.fund(profile, parseEther("5"));
  recA = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  recB = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  whoami = await h.deployRaw(initCodeFor(WHOAMI_RUNTIME));
  relayer = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[1] });
  const cfg = await ctx.config();
  await ctx.saveConfig({ ...cfg, relayers: [{ name: "mock", baseUrl: relayer.url, chainIds: [h.chainId], profile: "lsp15" }] });
}, 120_000);

afterAll(async () => relayer?.close());

const send = (via: "km" | "lsp0" | "relay", to: Address, value: bigint, data: Hex = "0x", extra: Record<string, unknown> = {}) =>
  executeAsProfile(ctx, { chainId: h.chainId, profile, calls: [{ operation: OPERATION.CALL, to, value, data }] }, { via, ...extra } as any);

describe("transports move value as the profile", () => {
  for (const via of ["km", "lsp0", "relay"] as const) {
    it(`${via}: value from the profile balance, msg.sender at target == profile`, async () => {
      const before = await readRecorder(h.request, recA);
      const upBefore = await bal(profile);
      const eoaBefore = await bal(signer.address);
      const out = await send(via, recA, 12345n, "0x12345678");
      expect(out.status).toBe("success");
      expect(out.path).toBe(via);
      expect(out.keyManager).toBe(km);
      const after = await readRecorder(h.request, recA);
      expect(after.sender).toBe(profile);
      expect(after.value).toBe(12345n);
      expect(after.count).toBe(before.count + 1n);
      expect(await bal(profile)).toBe(upBefore - 12345n);
      if (via === "relay") {
        expect(await bal(signer.address)).toBe(eoaBefore); // relayer paid the gas
        expect(out.gasPayer).toMatch(/relayer mock/);
      } else expect(await bal(signer.address)).toBeLessThan(eoaBefore);
      expect(out.confirmation.actor).toBe(profile);
      expect(out.confirmation.entryPath).toBeTruthy();
    });
  }

  it("km with fundFromController: the controller EOA funds the call value (msg.value forwarded)", async () => {
    const upBefore = await bal(profile);
    const out = await send("km", recB, 777n, "0x", { fundFromController: true });
    expect(out.status).toBe("success");
    expect((await readRecorder(h.request, recB)).value).toBe(777n);
    expect(await bal(profile)).toBe(upBefore);
  });

  it("lsp0 with fundFromController", async () => {
    const upBefore = await bal(profile);
    await send("lsp0", recB, 778n, "0x", { fundFromController: true });
    expect((await readRecorder(h.request, recB)).value).toBe(778n);
    expect(await bal(profile)).toBe(upBefore);
  });

  it("batch on km = KM.executeBatch, on lsp0 = UP.executeBatch, on relay = executeBatch payload", async () => {
    for (const via of ["km", "lsp0", "relay"] as const) {
      const a0 = await readRecorder(h.request, recA);
      const b0 = await readRecorder(h.request, recB);
      const out = await executeAsProfile(ctx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 1n, data: "0x" }, { operation: 0, to: recB, value: 2n, data: "0xaa" }] }, { via });
      expect(out.status).toBe("success");
      if (via === "km") expect(out.entryCalldata!.slice(0, 10)).toBe("0xbf0176ff");
      if (via === "lsp0") expect(out.entryCalldata!.slice(0, 10)).toBe("0x31858452");
      expect((await readRecorder(h.request, recA)).count).toBe(a0.count + 1n);
      expect((await readRecorder(h.request, recB)).count).toBe(b0.count + 1n);
    }
  });

  it("setData payload through each path", async () => {
    const key = ("0x" + "ab".repeat(32)) as Hex;
    for (const [i, via] of (["km", "lsp0", "relay"] as const).entries()) {
      const value = ("0x0" + i) as Hex;
      const payload = encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [key, value] });
      const out = await executeAsProfile(ctx, { chainId: h.chainId, profile, payload }, { via });
      expect(out.status).toBe("success");
      const got = await h.request("eth_call", [{ to: profile, data: encodeFunctionData({ abi: UP_ABI, functionName: "getData", args: [key] }) }, "latest"]);
      expect(got.endsWith("0" + i + "0".repeat(62))).toBe(true);
    }
  });
});

describe("refusals, simulation and dry-run", () => {
  it("refuses DELEGATECALL and calls to the Key Manager up front", async () => {
    await expect(executeAsProfile(ctx, { chainId: h.chainId, profile, calls: [{ operation: OPERATION.DELEGATECALL, to: recA, value: 0n, data: "0x" }] }, { via: "km" })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    await expect(send("km", km, 0n, "0x12345678")).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    await expect(executeAsProfile(ctx, { chainId: h.chainId, profile, calls: [{ operation: OPERATION.CREATE, to: recA, value: 0n, data: "0x00" }] }, { via: "km" })).rejects.toMatchObject({ code: "BAD_ARGS" });
  });

  it("decodes the ERC725X insufficient-balance revert before signing", async () => {
    const err = await send("km", recA, parseEther("1000"), "0x").catch((e) => e);
    expect(err).toBeInstanceOf(UpError);
    expect(err.code).toBe("SIMULATION_REVERTED");
    expect(err.details.errorName).toBe("ERC725X_InsufficientBalance");
  });

  it("dry-run builds + simulates but never sends (all paths)", async () => {
    const dctx = testContext(ctx.home, signer, { dryRun: true });
    const before = await readRecorder(h.request, recA);
    const nonce = await h.request("eth_getTransactionCount", [signer.address, "latest"]);
    const reqs = relayer.requests.length;
    for (const via of ["km", "lsp0", "relay"] as const) {
      const out = await executeAsProfile(dctx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 1n, data: "0x" }] }, { via });
      expect(out.status).toBe("dry-run");
      expect(out.txHash).toBeUndefined();
    }
    expect((await readRecorder(h.request, recA)).count).toBe(before.count);
    expect(await h.request("eth_getTransactionCount", [signer.address, "latest"])).toBe(nonce);
    expect(relayer.requests.slice(reqs).filter((r) => r.path.includes("execute") || r.path.includes("quota"))).toEqual([]);
  });

  it("a write with value is refused without consent (POLICY_DENIED under --yes, CONSENT_REQUIRED without)", async () => {
    const yesCtx = testContext(ctx.home, signer, { yes: true });
    await expect(executeAsProfile(yesCtx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 1n, data: "0x" }] }, { via: "km" })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    const noCtx = testContext(ctx.home, signer, { yes: false });
    await expect(executeAsProfile(noCtx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 0n, data: "0x01" }] }, { via: "km" })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    // zero-value call inside the default policy passes with --yes
    const out = await executeAsProfile(yesCtx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 0n, data: "0x01" }] }, { via: "km" });
    expect(out.status).toBe("success");
  });
});

describe("relay specifics", () => {
  it("uses the profile's saved random relay channel (not the relayer×chain channel, not 0), sends the full packed nonce and chainId top-level; quota signature verified", async () => {
    const saved = (await relayChannelState(ctx.home, profile)).saved!; // created by the first relayed send above
    expect(saved.channel).toBeGreaterThanOrEqual(4n);
    const legacy = defaultChannel("mock", h.chainId);
    expect(saved.channel).not.toBe(legacy);
    const l0 = await getRelayNonce(ctx, h.chainId, km, signer.address, legacy);
    const n0 = await getRelayNonce(ctx, h.chainId, km, signer.address, saved.channel);
    const out = await send("relay", recA, 0n, "0x99");
    const n1 = await getRelayNonce(ctx, h.chainId, km, signer.address, saved.channel);
    expect(n1).toBe(n0 + 1n);
    expect(splitNonce(n1).channelId).toBe(saved.channel);
    expect(await getRelayNonce(ctx, h.chainId, km, signer.address, legacy)).toBe(l0);
    expect(out.confirmation.lsp25).toMatchObject({ channel: saved.channel.toString(), channelSource: "saved", nonce: n0.toString() });
    expect(out.confirmation.attribution).toEqual({ transaction: out.txHash, entry: "executeRelayCall" });
    const exec = relayer.requests.filter((r) => r.path === "POST /api/execute").at(-1)!;
    expect(exec.body.chainId).toBe(h.chainId);
    expect(exec.body.address).toBe(profile);
    expect(exec.body.transaction.nonce).toBe("0x" + n0.toString(16));
    expect(relayer.quotaChecks.at(-1)).toMatchObject({ ok: true, recovered: signer.address, version: 2 });
    expect((await relayChannelState(ctx.home, profile)).saved).toEqual(saved); // never rotated
  });

  it("validity window in the past is decoded as RelayCallExpired before anything is sent", async () => {
    const block = await h.request("eth_getBlockByNumber", ["latest", false]);
    const now = BigInt(block.timestamp);
    const before = relayer.requests.filter((r) => r.path === "POST /api/execute").length;
    const err = await send("relay", recA, 0n, "0x", { validFrom: now - 1000n, validUntil: now - 500n }).catch((e) => e);
    expect(err.code).toBe("SIMULATION_REVERTED");
    expect(err.details.errorName).toBe("RelayCallExpired");
    const err2 = await send("relay", recA, 0n, "0x", { validFrom: now + 10_000n, validUntil: now + 20_000n }).catch((e) => e);
    expect(err2.details.errorName).toBe("RelayCallBeforeStartTime");
    expect(relayer.requests.filter((r) => r.path === "POST /api/execute").length).toBe(before);
  });

  it("explicit channels are independent; channel 0 is sequential", async () => {
    const n0 = await getRelayNonce(ctx, h.chainId, km, signer.address, 0n);
    await send("relay", recA, 0n, "0x01", { channel: 0n });
    await send("relay", recA, 0n, "0x02", { channel: 7n });
    expect(await getRelayNonce(ctx, h.chainId, km, signer.address, 0n)).toBe(n0 + 1n);
    expect(splitNonce(await getRelayNonce(ctx, h.chainId, km, signer.address, 7n))).toEqual({ channelId: 7n, sequence: 1n });
  });

  it("a lying relayer (fake hash, or a real unrelated hash) is detected from the chain receipt", async () => {
    const liar = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[1], lie: true });
    const unrelated = await h.sendFrom(h.accounts[4], recB, "0x");
    const liar2 = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[1], lieWithHash: unrelated.hash });
    const cfg = await ctx.config();
    await ctx.saveConfig({ ...cfg, relayers: [...(cfg.relayers ?? []), { name: "liar", baseUrl: liar.url, chainIds: [h.chainId], profile: "lsp15" }, { name: "liar2", baseUrl: liar2.url, chainIds: [h.chainId], profile: "lsp15" }] });
    process.env.UP_RECEIPT_TIMEOUT_MS = "1500";
    process.env.UP_RELAY_AMBIGUOUS_WAIT_MS = "500";
    try {
      const err = await send("relay", recA, 0n, "0x", { relayer: "liar" }).catch((e) => e);
      expect(err.code).toBe("RELAYER_ERROR");
      expect(err.message).toMatch(/no receipt/);
      const err2 = await send("relay", recA, 0n, "0x", { relayer: "liar2" }).catch((e) => e);
      expect(err2.code).toBe("RELAYER_ERROR");
      expect(err2.message).toMatch(/did not execute this signed call/);
      for (const e of [err, err2]) {
        expect(e.hint).not.toMatch(/--via km/);
        expect(e.details).toMatchObject({ ambiguous: true, keyManager: km, signer: signer.address, fallback: "none" });
      }
    } finally {
      delete process.env.UP_RECEIPT_TIMEOUT_MS;
      delete process.env.UP_RELAY_AMBIGUOUS_WAIT_MS;
      await liar.close();
      await liar2.close();
    }
  });

  it("lukso-live profile: taskId tracking, quota reported unavailable, the full nonce as a 0x hex uint (wire = signed = executed by the Key Manager)", async () => {
    const live = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[2], mode: "lukso-live" });
    const cfg = await ctx.config();
    await ctx.saveConfig({ ...cfg, relayers: [...(cfg.relayers ?? []), { name: "live", baseUrl: live.url, chainIds: [h.chainId], profile: "lukso-live" }] });
    // no implicit channel 0: the saved channel (high 128 bits) and its live counter (low 128 bits), read with getNonce
    const saved = (await relayChannelState(ctx.home, profile)).saved!;
    const n0 = await getRelayNonce(ctx, h.chainId, km, signer.address, saved.channel);
    expect(n0 > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    const out = await send("relay", recA, 0n, "0x55", { relayer: "live" });
    expect(out.status).toBe("success");
    expect(out.relayTaskId).toMatch(/^task-/);
    expect(out.warnings?.join()).toMatch(/LUKSO account/);
    expect(out.warnings?.join()).not.toMatch(/JSON number|decimal string|not verified/);
    const req = live.requests.find((r) => r.path === "POST /api/execute")!;
    expect(req.status).toBe(201);
    expect(req.body.chainId).toBeUndefined();
    expect(req.body.transaction.nonce).toBe("0x" + n0.toString(16));
    expect(req.raw).toContain(`"nonce":"0x${n0.toString(16)}"`);
    expect(splitNonce(BigInt(req.body.transaction.nonce)).channelId).toBe(saved.channel);
    expect(out.confirmation.lsp25).toMatchObject({ nonce: n0.toString(), channel: saved.channel.toString() });
    // the value on the wire is the one signed and the one the Key Manager used
    const t = req.body.transaction;
    expect(await recoverLsp25Signer({ keyManager: km, chainId: h.chainId, nonce: BigInt(t.nonce), validityTimestamps: BigInt(t.validityTimestamps), value: 0n, payload: t.abi }, t.signature)).toBe(signer.address);
    const mined = await h.request("eth_getTransactionByHash", [out.txHash]);
    const call = decodeFunctionData({ abi: KM_ABI, data: mined.input });
    expect(call.functionName).toBe("executeRelayCall");
    expect(call.args?.[1]).toBe(BigInt(t.nonce));
    expect(await getRelayNonce(ctx, h.chainId, km, signer.address, saved.channel)).toBe(n0 + 1n);
    await live.close();
  });

  it("no relayer for the chain → precise hint", async () => {
    const other = testContext(h.newHome(), signer, { approval: "ok" });
    const err = await executeAsProfile(other, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 0n, data: "0x" }] }, { via: "relay" }).catch((e) => e);
    expect(err.code).toBe("RELAYER_ERROR");
    expect(err.hint).toMatch(/up relayer add/);
  });

  it("executeRelayCallBatch with sequential nonces (library) verified on chain", async () => {
    const ch = 99n;
    const start = splitNonce(await getRelayNonce(ctx, h.chainId, km, signer.address, ch)).sequence;
    const items = [{ payload: encodeUpExecute({ operation: 0, to: recA, value: 0n, data: "0x01" }) }, { payload: encodeUpExecute({ operation: 0, to: recB, value: 0n, data: "0x02" }) }];
    const signed = await signRelayBatch(signer, { keyManager: km, chainId: h.chainId, channelId: ch, startSequence: start, validityTimestamps: 0n }, items);
    const a0 = await readRecorder(h.request, recA);
    await h.sendFrom(h.accounts[3], km, encodeExecuteRelayCallBatch(signed));
    expect((await readRecorder(h.request, recA)).count).toBe(a0.count + 1n);
    expect(splitNonce(await getRelayNonce(ctx, h.chainId, km, signer.address, ch)).sequence).toBe(start + 2n);
  });

  it("digest/recovery matches the Key Manager's recovery (InvalidRelayNonce carries the recovered signer)", async () => {
    const payload = encodeUpExecute({ operation: 0, to: recA, value: 0n, data: "0x" });
    const msg = { keyManager: km, chainId: h.chainId, nonce: 123456789n, validityTimestamps: 0n, value: 0n, payload };
    const sig = await signLsp25(signer, msg);
    expect(await recoverLsp25Signer(msg, sig)).toBe(signer.address);
    const data = encodeFunctionData({ abi: KM_ABI, functionName: "executeRelayCall", args: [sig, msg.nonce, 0n, payload] });
    const err = await h.request("eth_call", [{ to: km, data }, "latest"]).catch((e: any) => e);
    const raw: string = err?.data?.data ?? err?.data ?? "";
    expect(raw.slice(0, 10)).toBe("0xc9bd9eb9"); // InvalidRelayNonce(address signer, uint256 nonce, bytes signature)
    expect(getAddress("0x" + raw.slice(10 + 24, 10 + 64))).toBe(signer.address); // same signer recovered on chain
    expect(lsp25Digest(msg)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("auto path and STATICCALL", () => {
  it("auto picks relay when the relayer covers the chain with quota > 0, else km", async () => {
    const out = await executeAuto(ctx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 0n, data: "0x" }] }, { via: "auto", relayer: "mock" });
    expect(out.path).toBe("relay");
    expect(out.autoDecision?.reason).toMatch(/quota/);
    const other = testContext(h.newHome(), signer, { approval: "ok" });
    const out2 = await executeAuto(other, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 0n, data: "0x" }] }, { via: "auto" });
    expect(out2.path).toBe("km");
  });

  it("STATICCALL through execute returns the profile as msg.sender", async () => {
    const data = encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [3n, whoami, 0n, "0x"] });
    const ret = await h.request("eth_call", [{ from: km, to: profile, data }, "latest"]);
    expect(ret.toLowerCase()).toContain(profile.slice(2).toLowerCase());
    expect(zeroAddress).toBeTruthy();
  });
});

describe("negative relay / LSP20 cases (testing plan §2 relay class)", () => {
  const relayData = async (signerX: Signer, nonce: bigint, kmForDigest: Address, chainId = h.chainId) => {
    const payload = encodeUpExecute({ operation: 0, to: recA, value: 0n, data: "0x" });
    const sig = await signLsp25(signerX, { keyManager: kmForDigest, chainId, nonce, validityTimestamps: 0n, value: 0n, payload });
    return encodeFunctionData({ abi: KM_ABI, functionName: "executeRelayCall", args: [sig, nonce, 0n, payload] });
  };
  const revertName = async (to: Address, data: Hex) => {
    const err = await h.request("eth_call", [{ to, data }, "latest"]).catch((e: any) => e);
    const raw: string = err?.data?.data ?? err?.data ?? "";
    const { decodeRevert } = await import("../../src/chain/tx.ts");
    return decodeRevert(raw as Hex).errorName;
  };

  it("replayed nonce → InvalidRelayNonce (and the mock relayer maps it to 409 nonce_conflict)", async () => {
    const ch = 4242n;
    const n = await getRelayNonce(ctx, h.chainId, km, signer.address, ch);
    const data = await relayData(signer, n, km);
    await h.sendFrom(h.accounts[3], km, data);
    expect(await revertName(km, data)).toBe("InvalidRelayNonce");
    const payload = encodeUpExecute({ operation: 0, to: recA, value: 0n, data: "0x" });
    const sig = await signLsp25(signer, { keyManager: km, chainId: h.chainId, nonce: n, validityTimestamps: 0n, value: 0n, payload });
    const { RelayerClient } = await import("../../src/relayer/client.ts");
    const err = await new RelayerClient({ name: "mock", baseUrl: relayer.url, chainIds: [h.chainId], profile: "lsp15" }).execute({ address: profile, chainId: h.chainId, transaction: { abi: payload, signature: sig, nonce: n, validityTimestamps: 0n } }).catch((e) => e);
    expect(err.details.code).toBe("nonce_conflict");
    expect(err.details.fallback).toBe("none"); // ambiguous: the nonce may be pending at the relayer
    expect(err.hint).not.toMatch(/--via km/);
  });

  it("signature for another Key Manager or chain recovers a different signer → InvalidRelayNonce (never executes)", async () => {
    const n = await getRelayNonce(ctx, h.chainId, km, signer.address, 0n);
    expect(await revertName(km, await relayData(signer, n, recA))).toBe("InvalidRelayNonce");
    expect(await revertName(km, await relayData(signer, n, km, 1))).toBe("InvalidRelayNonce");
  });

  it("signer without EXECUTE_RELAY_CALL: refused client-side, NotAuthorised on chain", async () => {
    const limited = testSigner(generatePrivateKey());
    await executeAsProfile(ctx, { chainId: h.chainId, profile, payload: (await import("../../src/lsp/controllers.ts")).buildAddController(await (await import("../../src/lsp/profile.ts")).readControllers(ctx, h.chainId, profile), limited.address, { permissions: 0x800n, allowedCalls: [{ callTypes: ["CALL"], address: recA }] }).payload }, { via: "km" });
    const lctx = testContext(ctx.home, limited, { approval: "ok" });
    const err = await executeAsProfile(lctx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 0n, data: "0x" }] }, { via: "relay" }).catch((e) => e);
    expect(err.code).toBe("NOT_AUTHORISED");
    expect(err.message).toMatch(/EXECUTE_RELAY_CALL/);
    const n = await getRelayNonce(ctx, h.chainId, km, limited.address, 0n);
    const data = await relayData(limited, n, km);
    const e2 = await h.request("eth_call", [{ to: km, data }, "latest"]).catch((e: any) => e);
    const { decodeRevert } = await import("../../src/chain/tx.ts");
    const d = decodeRevert((e2?.data?.data ?? e2?.data) as Hex);
    expect(d.errorName).toBe("NotAuthorised");
    expect((d.args as any[])[1]).toBe("EXECUTE_RELAY_CALL");
    // the same controller can still use the direct KM path for its allowed call (after funding)
    await h.fund(limited.address, parseEther("1"));
    expect((await executeAsProfile(lctx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 0n, data: "0x" }] }, { via: "km" })).status).toBe("success");
  });

  it("LSP20 path: a non-controller is refused by the chain preflight with the per-chain fix, and the Key Manager agrees (NoPermissionsSet)", async () => {
    const stranger = testSigner(generatePrivateKey());
    await h.fund(stranger.address, parseEther("1"));
    const sctx = testContext(ctx.home, stranger, { approval: "ok" });
    const err = await executeAsProfile(sctx, { chainId: h.chainId, profile, calls: [{ operation: 0, to: recA, value: 0n, data: "0x" }] }, { via: "lsp0" }).catch((e) => e);
    // same code the relay path always used for "not a controller"; nothing was simulated, signed or sent
    expect(err.code).toBe("NOT_AUTHORISED");
    expect(err.details.errorName).toBe("NoPermissionsSet");
    expect(err.message).toContain(`this agent's key ${stranger.address} is not a controller of your Universal Profile ${profile}`);
    expect(err.message).toContain(`(${h.chainId})`);
    expect(err.hint).toMatch(/ask the human to authorise/);
    expect(err.hint).toMatch(/up permissions recommend --chain local/);
    // the on-chain check the preflight anticipates: LSP20 verification through the Key Manager
    const onchain = await h.request("eth_call", [{ from: stranger.address, to: profile, data: encodeUpExecute({ operation: 0, to: recA, value: 0n, data: "0x" }) }, "latest"]).catch((e: any) => e);
    const { decodeRevert } = await import("../../src/chain/tx.ts");
    expect(decodeRevert((onchain?.data?.data ?? onchain?.data) as Hex).errorName).toBe("NoPermissionsSet");
  });
});

describe("ambiguous relay outcomes never suggest another path", () => {
  it("502 after broadcast: the nonce is polled, the landed transaction is found and reported", async () => {
    const r = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[7], failAfterSubmit: true });
    const cfg = await ctx.config();
    await ctx.saveConfig({ ...cfg, relayers: [...(cfg.relayers ?? []), { name: "flaky-after", baseUrl: r.url, chainIds: [h.chainId], profile: "lsp15" }] });
    const before = await readRecorder(h.request, recA);
    const out = await send("relay", recA, 0n, "0xfeed", { relayer: "flaky-after" });
    expect(out.status).toBe("success");
    expect(out.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(out.warnings?.join()).toMatch(/this exact signed call executed in 0x[0-9a-f]{64} \(executeRelayCall, decoded from that transaction\)/);
    expect(out.confirmation.attribution).toEqual({ transaction: out.txHash, entry: "executeRelayCall" });
    expect((await readRecorder(h.request, recA)).count).toBe(before.count + 1n);
    await r.close();
  });

  it("502 without broadcast: fails with KM/signer/nonce/window details and the do-not-resend hint (no --via km)", async () => {
    const r = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[7], failBeforeSubmit: true });
    const cfg = await ctx.config();
    await ctx.saveConfig({ ...cfg, relayers: [...(cfg.relayers ?? []), { name: "flaky-before", baseUrl: r.url, chainIds: [h.chainId], profile: "lsp15" }] });
    process.env.UP_RELAY_AMBIGUOUS_WAIT_MS = "300";
    try {
      const err = await send("relay", recA, 0n, "0xbeef", { relayer: "flaky-before" }).catch((e) => e);
      expect(err.code).toBe("RELAYER_ERROR");
      expect(err.hint).toMatch(/^do not resend and do not re-sign: this signed call stays executable until unix \d+\. A used nonce \(up nonce\) alone does not show that it was this call/);
      expect(err.hint).not.toMatch(/--via km/);
      expect(err.details).toMatchObject({ ambiguous: true, code: "relay_outcome_unknown", fallback: "none", keyManager: km, signer: signer.address });
      expect(err.details.nonce).toMatch(/^\d+$/);
      expect(err.details.validUntil).toMatch(/^\d+$/);
    } finally {
      delete process.env.UP_RELAY_AMBIGUOUS_WAIT_MS;
      await r.close();
    }
  });
});

describe("raw payload consent (decodeProfilePayload)", () => {
  it("raw execute payload with value is checked against the policy like a call (value, target, selector)", async () => {
    const yesCtx = testContext(ctx.home, signer, { yes: true });
    const payload = encodeUpExecute({ operation: 0, to: recA, value: 5n, data: "0x12345678" });
    const err = await executeAsProfile(yesCtx, { chainId: h.chainId, profile, payload }, { via: "km" }).catch((e) => e);
    expect(err.code).toBe("POLICY_DENIED");
    expect(err.message).toMatch(/value 5 wei exceeds/);
    expect(err.details.confirmation.payloadDecoded).toMatchObject({ kind: "execute", totalValue: "5", targets: [recA], innerSelectors: ["0x12345678"] });
  });
  it("raw executeBatch payloads are checked per call; unknown payloads (batchCalls) need a human", async () => {
    const { encodeUpExecuteBatch } = await import("../../src/exec/common.ts");
    const { savePolicy, DEFAULT_POLICY } = await import("../../src/core/policy.ts");
    const home2 = h.newHome();
    await savePolicy(home2, { ...DEFAULT_POLICY, targets: [recA] });
    const y = testContext(home2, signer, { yes: true });
    const batch = encodeUpExecuteBatch([{ operation: 0, to: recA, value: 0n, data: "0x" }, { operation: 0, to: recB, value: 0n, data: "0x" }]);
    await expect(executeAsProfile(y, { chainId: h.chainId, profile, payload: batch }, { via: "km" })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    const batchCalls = encodeFunctionData({ abi: UP_ABI, functionName: "batchCalls", args: [[encodeUpExecute({ operation: 0, to: recA, value: 0n, data: "0x" })]] });
    // the KM rejects batchCalls (InvalidERC725Function) in simulation; via LSP0 it simulates fine and then needs a human
    const e1 = await executeAsProfile(y, { chainId: h.chainId, profile, payload: batchCalls }, { via: "km" }).catch((e) => e);
    expect(e1.details.errorName).toBe("InvalidERC725Function");
    const e2 = await executeAsProfile(y, { chainId: h.chainId, profile, payload: batchCalls }, { via: "lsp0" }).catch((e) => e);
    expect(e2.code).toBe("CONSENT_REQUIRED");
    expect(e2.details.confirmation.payloadKind).toBe("unknown");
  });
  it("raw execute payload with DELEGATECALL is refused up front", async () => {
    const payload = encodeUpExecute({ operation: 4, to: recA, value: 0n, data: "0x" });
    await expect(executeAsProfile(ctx, { chainId: h.chainId, profile, payload }, { via: "relay" })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });
});

