// The persistent relay channel and relay outcome attribution on the in-process EVM (canonical LSP stack, real
// Key Manager bytecode) with the mock LSP15 relayer:
//  - the profile's saved random channel is created at the first relayed send — never by a dry run, exec simulate
//    or the nonce verbs — and reused across new contexts (restarts), relayers and the auto path; never channel 0;
//  - --channel overrides one call only; two state folders get their own channels; a restored profile needs an
//    explicit step (and can continue its earlier channel); LUKSO's live relayer refusing the decimal-string
//    nonce gets a compatibility hint without any channel or path switch; the first call on a channel pays the
//    counter's zero→non-zero write once;
//  - an ambiguous or doubtful relay outcome is attributed only to a transaction that carries exactly this signed
//    call (decoded): another call of the same key with this nonce is proven "not executed", undecodable wrappers
//    stay unresolved, batches and concurrent channels are told apart.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getAddress, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, initCodeFor, readRecorder, RECORDER_RUNTIME, runVerb as run, startMockRelayer, type MockRelayer, type MockRelayerOptions } from "../support/mock-relayer.ts";
import "../../src/lsp/verbs.ts";
import "../../src/relayer/verbs.ts";
import { executeAsProfile } from "../../src/exec/transport.ts";
import { executeAuto } from "../../src/exec/auto.ts";
import { encodeUpExecute } from "../../src/exec/common.ts";
import { defaultChannel, encodeExecuteRelayCall, encodeExecuteRelayCallBatch, getRelayNonce, signLsp25, splitNonce } from "../../src/lsp/lsp25.ts";
import { relayChannelState, setChannelEntropy } from "../../src/lsp/relay-channel.ts";
import { paths } from "../../src/core/home.ts";
import { updateProfileRecord } from "../../src/core/profile-record.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";

const APPROVAL = { approval: "test: the human approves every action in this suite" };
const C = 0x1d5ab8e4c3f2a1b09182736455667788n; // the channel the CSPRNG fixture hands out first
let h: Harness;
let signer: Signer;
let ctx: VerbContext;
let profile: Address;
let km: Address;
let rec: Address;
let recOther: Address;
let relayer: MockRelayer;

function fixture(...values: bigint[]): (n: number) => Uint8Array {
  let i = 0;
  return (n) => Buffer.from(values[Math.min(i++, values.length - 1)].toString(16).padStart(n * 2, "0"), "hex");
}
const bodies = (r: MockRelayer) => r.requests.filter((x) => x.path === "POST /api/execute").map((x) => x.body);
const channelOf = (body: any) => BigInt(body.transaction.nonce) >> 128n;
const count = async (a: Address) => (await readRecorder(h.request, a)).count;
const nonceOn = (channel: bigint) => getRelayNonce(ctx, h.chainId, km, signer.address, channel);
const send = (c: VerbContext, extra: Record<string, unknown> = {}, data: Hex = "0x01") =>
  executeAsProfile(c, { chainId: h.chainId, profile, calls: [{ operation: 0, to: rec, value: 0n, data }] }, { via: "relay", relayer: "mock", ...extra } as any);
async function homeWithRelayer(): Promise<VerbContext> {
  const c = testContext(h.newHome(), signer, APPROVAL);
  await c.saveConfig({ ...(await c.config()), relayers: [{ name: "mock", baseUrl: relayer.url, chainIds: [h.chainId], profile: "lsp15" }] });
  return c;
}
/** A call of the SAME key on the same Key Manager with `nonce` and another payload, submitted by someone else. */
async function competitor(nonce: bigint, data: Hex = "0xc0"): Promise<Hex> {
  const payload = encodeUpExecute({ operation: 0, to: recOther, value: 0n, data });
  const sig = await signLsp25(signer, { keyManager: km, chainId: h.chainId, nonce, validityTimestamps: 0n, value: 0n, payload });
  return (await h.sendFrom(h.accounts[3], km, encodeExecuteRelayCall(sig, nonce, 0n, payload))).hash;
}
let relayers = 0;
async function withRelayer(opts: Partial<MockRelayerOptions>, fn: (name: string) => Promise<void>): Promise<void> {
  const r = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[7], ...opts });
  const name = `r${++relayers}`;
  const cfg = await ctx.config();
  await ctx.saveConfig({ ...cfg, relayers: [...(cfg.relayers ?? []), { name, baseUrl: r.url, chainIds: [h.chainId], profile: opts.mode === "lukso-live" ? "lukso-live" : "lsp15" }] });
  try {
    await fn(name);
  } finally {
    await r.close();
  }
}
/** Runtime of a contract that forwards its calldata to `target` (a wrapper the skill cannot decode). */
const forwarder = (target: Address): Hex => `0x36600060003760006000366000600073${target.slice(2).toLowerCase()}5af115602b57005b60006000fd`;

beforeAll(async () => {
  h = await getHarness();
  signer = testSigner(generatePrivateKey());
  await h.fund(signer.address, parseEther("10"));
  ctx = testContext(h.newHome(), signer, APPROVAL);
  const m = await deployProfileFor(ctx, signer, h.chainId);
  profile = m.profile;
  km = m.keyManager;
  await h.fund(profile, parseEther("2"));
  rec = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  recOther = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  relayer = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[1] });
  await ctx.saveConfig({ ...(await ctx.config()), relayers: [{ name: "mock", baseUrl: relayer.url, chainIds: [h.chainId], profile: "lsp15" }] });
}, 120_000);
afterAll(async () => relayer?.close());
afterEach(() => setChannelEntropy());

describe("the profile's saved relay channel", () => {
  it("dry runs, exec simulate and the nonce verbs create nothing; the first relayed send creates the channel and uses it (never channel 0)", async () => {
    const record = readFileSync(paths.profile(ctx.home, profile), "utf8");
    const dry = await send(testContext(ctx.home, signer, { dryRun: true }));
    expect(dry.status).toBe("dry-run");
    expect(dry.confirmation.lsp25).toMatchObject({ channel: null, nonce: null, sequence: "0" });
    expect((dry.confirmation.lsp25 as any).channelSource).toMatch(/^none yet: the first relayed send creates one random channel/);
    expect((await run(ctx, "exec simulate", { profile, to: rec, data: "0x01", via: "relay", relayer: "mock" })).data.simulated).toBe(true);
    const n = await run(ctx, "nonce", { profile });
    expect(n.data.relayChannel).toBeNull();
    expect(n.data.relayChannelNote).toMatch(/^not created yet/);
    expect((await run(ctx, "nonce channel", { profile })).data).toMatchObject({ relayChannel: null, created: false });
    expect(readFileSync(paths.profile(ctx.home, profile), "utf8")).toBe(record);
    expect(bodies(relayer)).toHaveLength(0);

    setChannelEntropy(fixture(0n, 2n, C)); // trivial draws are redrawn
    const out = await send(ctx);
    expect(out.status).toBe("success");
    expect(out.confirmation.lsp25).toMatchObject({ channel: C.toString(), channelSource: "created now (random, saved)", nonce: (C << 128n).toString(), sequence: "0" });
    expect(out.warnings ?? []).toEqual([]); // a fresh key used no earlier channel: nothing to tell the human (the creation is in the confirmation)
    expect(bodies(relayer).at(-1).transaction.nonce).toBe("0x" + (C << 128n).toString(16));
    expect((await relayChannelState(ctx.home, profile)).saved?.channel).toBe(C);
    expect(JSON.parse(readFileSync(paths.profile(ctx.home, profile), "utf8"))).toMatchObject({ deployment: { profile }, relayChannel: { channel: C.toString(), source: "random" } });
    expect(await nonceOn(C)).toBe((C << 128n) + 1n);
    expect(await nonceOn(0n)).toBe(0n);
  });

  it("migration: when this key relayed before on an earlier default channel, creating the saved channel says so; old counters are untouched", async () => {
    const upgraded = await homeWithRelayer();
    const legacy = defaultChannel("mock", h.chainId);
    expect((await send(upgraded, { channel: legacy }, "0x05")).status).toBe("success"); // what the previous version did by default
    expect((await relayChannelState(upgraded.home, profile)).saved).toBeUndefined(); // an explicit channel creates nothing
    setChannelEntropy(fixture(0x3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3cn));
    const out = await send(upgraded, {}, "0x06");
    expect(out.confirmation.lsp25).toMatchObject({ channel: 0x3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3cn.toString(), channelSource: "created now (random, saved)" });
    expect(out.warnings?.join(" ")).toContain(`This key relayed before on channel ${legacy} (sequence 1): those counters stay on chain (up nonce shows them)`);
    expect(splitNonce(await nonceOn(legacy)).sequence).toBe(1n);
    const n = await run(upgraded, "nonce", { profile });
    expect(n.data.relay.find((x: any) => x.channel === legacy.toString())).toMatchObject({ label: "earlier default channel of relayer mock (before saved channels)", sequence: "1" });
  });

  it("migration: the notice is not lost when the send that created the channel fails; it comes with every send (and dry run) until a call executes on the saved channel", async () => {
    const upgraded = await homeWithRelayer();
    const legacy = defaultChannel("mock", h.chainId);
    expect((await send(upgraded, { channel: legacy }, "0x15")).status).toBe("success");
    const note = `This key relayed before on channel ${legacy} (sequence `;
    expect((await send(testContext(upgraded.home, signer, { dryRun: true }), {}, "0x16")).warnings?.join(" ")).toContain(note);
    const N = 0x4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4dn;
    setChannelEntropy(fixture(N));
    // the first real send creates the channel and then stops at the consent (neither --yes nor an approval)
    await expect(send(testContext(upgraded.home, signer, { yes: false }), {}, "0x16")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect((await relayChannelState(upgraded.home, profile)).saved?.channel).toBe(N);
    const next = await send(upgraded, {}, "0x16");
    expect(next.status).toBe("success");
    expect(next.confirmation.lsp25).toMatchObject({ channel: N.toString(), channelSource: "saved", sequence: "0" });
    expect(next.warnings?.join(" ")).toContain(note);
    const later = await send(upgraded, {}, "0x17");
    expect(later.confirmation.lsp25).toMatchObject({ channel: N.toString(), sequence: "1" });
    expect(later.warnings?.join(" ") ?? "").not.toContain("relayed before");
  });

  it("an address another profile links here belongs to that profile: relays use its channel, and the first ones name the channel this key used for the address before", async () => {
    const own = await homeWithRelayer();
    const [P, X] = [0x0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0an, 0x0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0bn];
    setChannelEntropy(fixture(P, X));
    expect((await send(own, {}, "0x18")).status).toBe("success"); // nothing links it yet: the address is its own profile
    expect((await relayChannelState(own.home, profile)).saved?.channel).toBe(P);
    // the human links this address as profile L's address on this chain (what `profile link` stores in L's record)
    const L = getAddress("0x" + "5e".repeat(20));
    await updateProfileRecord(own.home, L, () => ({ chainAddresses: { [String(h.chainId)]: profile } }));
    const next = await send(own, {}, "0x19");
    expect(next.status).toBe("success");
    expect(channelOf(bodies(relayer).at(-1))).toBe(X);
    expect((await relayChannelState(own.home, L)).saved?.channel).toBe(X);
    expect((await relayChannelState(own.home, profile)).saved?.channel).toBe(P); // never removed or replaced
    expect(next.warnings?.join(" ")).toContain(`channel ${P} (sequence 1)`);
    const n = await run(own, "nonce", { profile });
    expect(n.data.identity).toBe(L);
    expect(n.data.relayChannel.channel).toBe(X.toString());
    expect(n.data.relay.find((x: any) => x.channel === P.toString())).toMatchObject({ sequence: "1", label: expect.stringContaining(`saved relay channel of ${profile} itself`) });
  });

  it("the same channel after a restart (new context), through another relayer, the auto path and the verbs; it is never replaced", async () => {
    const legacy = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[2], mode: "legacy" });
    try {
      const cfg = await ctx.config();
      await ctx.saveConfig({ ...cfg, relayers: [...(cfg.relayers ?? []), { name: "legacy", baseUrl: legacy.url, chainIds: [h.chainId], profile: "lsp15" }] });
      const restarted = testContext(ctx.home, signer, APPROVAL);
      setChannelEntropy(fixture(0xbadn)); // would show up if a new channel were made
      expect((await send(restarted, { relayer: "legacy" })).status).toBe("success");
      expect(channelOf(bodies(legacy).at(-1))).toBe(C);
      const auto = await executeAuto(restarted, { chainId: h.chainId, profile, calls: [{ operation: 0, to: rec, value: 0n, data: "0x02" }] }, { via: "auto", relayer: "mock" });
      expect(auto.path).toBe("relay");
      expect(channelOf(bodies(relayer).at(-1))).toBe(C);
      const v = await run(restarted, "exec relay", { profile, to: rec, data: "0x03", relayer: "mock" });
      expect(v.data.confirmation.lsp25).toMatchObject({ channel: C.toString(), channelSource: "saved" });
      expect((await relayChannelState(ctx.home, profile)).saved?.channel).toBe(C);
    } finally {
      await legacy.close();
    }
  });

  it("--channel (0x string through the verb) is for one call only: the saved channel and its counter stay as they are", async () => {
    const n0 = await nonceOn(C);
    const X = (1n << 127n) + 99n;
    const r = await run(ctx, "exec relay", { profile, to: rec, data: "0x04", relayer: "mock", channel: "0x" + X.toString(16) });
    expect(r.data.status).toBe("success");
    expect(channelOf(bodies(relayer).at(-1))).toBe(X);
    expect(r.data.confirmation.lsp25).toMatchObject({ channel: X.toString(), nonce: (X << 128n).toString() });
    expect(r.data.confirmation.lsp25.channelSource).toBe(`--channel for this call only; the saved channel (${C}) is unchanged`);
    expect(r.warnings?.join(" ")).toContain(`instead of the saved relay channel ${C} (advanced)`);
    expect(await nonceOn(C)).toBe(n0);
    expect((await relayChannelState(ctx.home, profile)).saved?.channel).toBe(C);
  });

  it("two state folders with the same key on one profile relay at the same time on their own channels, without a conflict", async () => {
    const other = await homeWithRelayer();
    setChannelEntropy(fixture(0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7an));
    const [a, b] = await Promise.all([send(ctx, {}, "0x0a"), send(other, {}, "0x0b")]);
    expect([a.status, b.status]).toEqual(["success", "success"]);
    expect((await relayChannelState(other.home, profile)).saved?.channel).toBe(0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7an);
    expect(channelOf(bodies(relayer).at(-1))).not.toBe(channelOf(bodies(relayer).at(-2)));
  });

  it("a profile restored from a backup gets no implicit channel (send and dry run stop before signing); continuing the earlier channel works", async () => {
    const restored = await homeWithRelayer();
    await updateProfileRecord(restored.home, profile, () => ({ imported: { file: "agent - universal-profiles-backup-2026-10-21.json", chains: [] } }));
    const before = bodies(relayer).length;
    await expect(send(restored)).rejects.toMatchObject({ code: "NOT_SUPPORTED", details: { code: "relay_channel_not_created", restored: true } });
    await expect(send(testContext(restored.home, signer, { dryRun: true }))).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(bodies(relayer).length).toBe(before);
    const n0 = await nonceOn(C);
    const adopted = await run(restored, "nonce channel create", { profile, channel: C.toString() });
    expect(adopted.data).toMatchObject({ created: true, relayChannel: { channel: C.toString(), source: "adopted" } });
    expect((await send(restored, {}, "0x0c")).status).toBe("success");
    expect(channelOf(bodies(relayer).at(-1))).toBe(C);
    expect(await nonceOn(C)).toBe(n0 + 1n); // one ordered sequence: an earlier pending call on it could not also execute
  });

  it("the first call on a channel pays the counter's zero→non-zero storage write; the next call on the same channel is cheaper (local EVM, relative)", async () => {
    const fresh = await homeWithRelayer();
    await send(ctx, {}, "0x0d"); // the target's storage is warm for both calls below
    setChannelEntropy(fixture(0x5eed5eed5eed5eed5eed5eed5eed5eedn));
    const first = await send(fresh, {}, "0x0d");
    const second = await send(fresh, {}, "0x0d");
    expect(first.confirmation.lsp25).toMatchObject({ channelSource: "created now (random, saved)", sequence: "0" });
    expect(second.confirmation.lsp25).toMatchObject({ channelSource: "saved", sequence: "1" });
    const [g1, g2] = [BigInt(first.gasUsed!), BigInt(second.gasUsed!)];
    console.log(`[gas] relayed call: first on a new channel ${g1}, next on the same channel ${g2}, difference ${g1 - g2}`);
    expect(g1 - g2).toBeGreaterThanOrEqual(15_000n);
  });

  it("LUKSO's live relayer refusing the decimal-string nonce: compatibility hint, nothing executed, no channel or path switch suggested", async () => {
    await withRelayer({ mode: "lukso-live", respond: async (b) => (typeof b.transaction.nonce === "string" ? [400, { message: "nonce must be a number" }] : undefined) }, async (name) => {
      const c0 = await count(rec);
      const err = await send(ctx, { relayer: name }, "0x0e").catch((e) => e);
      expect(err.code).toBe("RELAYER_ERROR");
      expect(err.details).toMatchObject({ status: 400, nonceFormat: "exact decimal string", fallback: "none" });
      expect(err.hint).toMatch(/^LUKSO's live relayer may not accept a nonce sent as an exact decimal string .* Retrying on the same channel is safe/);
      expect(err.hint).not.toMatch(/--channel 0|--via km/);
      expect(await count(rec)).toBe(c0);
    });
  });
});

describe("relay outcome attribution: only a transaction that carries exactly this signed call counts", () => {
  const saved = { wait: process.env.UP_RELAY_AMBIGUOUS_WAIT_MS };
  beforeAll(() => {
    process.env.UP_RELAY_AMBIGUOUS_WAIT_MS = "1500";
  });
  afterAll(() => {
    if (saved.wait === undefined) delete process.env.UP_RELAY_AMBIGUOUS_WAIT_MS;
    else process.env.UP_RELAY_AMBIGUOUS_WAIT_MS = saved.wait;
  });

  it("502 before submission while another call of the same key uses this nonce: nonce_used_by_other_call, this call did NOT execute (audit D1)", async () => {
    let comp: Hex | undefined;
    await withRelayer({ respond: async (b) => ((comp = await competitor(BigInt(b.transaction.nonce))), [502, { error: "chain_submission_failed", message: "upstream timeout" }]) }, async (name) => {
      const [a0, o0] = [await count(rec), await count(recOther)];
      const err = await send(ctx, { relayer: name }, "0xdead").catch((e) => e);
      expect(err.code).toBe("RELAYER_ERROR");
      expect(err.message).toMatch(/this signed call did NOT execute and can no longer execute/);
      expect(err.details).toMatchObject({ code: "nonce_used_by_other_call", fallback: "none", otherTransaction: comp!.toLowerCase(), otherEntry: "executeRelayCall", channel: C.toString() });
      expect(err.hint).not.toMatch(/--via km|--channel/);
      expect(await count(rec)).toBe(a0);
      expect(await count(recOther)).toBe(o0 + 1n);
    });
  });

  it("502 after submission while later calls of the same key land too (same channel, another channel): the reported transaction is this call's", async () => {
    let ours: Hex | undefined;
    const others: Hex[] = [];
    await withRelayer(
      {
        respond: async (b) => {
          const t = b.transaction;
          const n = BigInt(t.nonce);
          ours = (await h.sendFrom(h.accounts[7], km, encodeExecuteRelayCall(t.signature, n, BigInt(t.validityTimestamps), t.abi))).hash;
          others.push(await competitor(n + 1n)); // same channel, next sequence: the newest PermissionsVerified of this key
          others.push(await competitor(((n >> 128n) + 1n) << 128n)); // another channel of the same key
          return [502, { error: "chain_submission_failed", message: "gateway timeout after broadcast" }];
        },
      },
      async (name) => {
        const out = await send(ctx, { relayer: name }, "0xfeed");
        expect(out.status).toBe("success");
        expect(out.txHash).toBe(ours!.toLowerCase());
        expect(others.map((x) => x.toLowerCase())).not.toContain(out.txHash);
        expect(out.confirmation.attribution).toEqual({ transaction: out.txHash, entry: "executeRelayCall" });
        expect(out.warnings?.join(" ")).toMatch(/this exact signed call executed in/);
      },
    );
  });

  it("a relayer returning the hash of another call of the same key that used this nonce is not believed: nonce_used_by_other_call", async () => {
    let comp: Hex | undefined;
    await withRelayer({ respond: async (b) => ((comp = await competitor(BigInt(b.transaction.nonce), "0xbad0")), [200, { transactionHash: comp, chainId: h.chainId }]) }, async (name) => {
      const a0 = await count(rec);
      const err = await send(ctx, { relayer: name }, "0x5ec0").catch((e) => e);
      expect(err.code).toBe("RELAYER_ERROR");
      expect(err.message).toMatch(/did not execute this signed call \(it carries another call with this nonce \(executeRelayCall\)\)/);
      expect(err.details).toMatchObject({ code: "nonce_used_by_other_call", otherTransaction: comp!.toLowerCase() });
      expect(await count(rec)).toBe(a0);
    });
  });

  it("a relayer returning the hash of the same key's call with another nonce: this call is not done and may still land (relay_outcome_unknown)", async () => {
    await withRelayer({ respond: async (b) => [200, { transactionHash: await competitor(((BigInt(b.transaction.nonce) >> 128n) + 7n) << 128n), chainId: h.chainId }] }, async (name) => {
      const err = await send(ctx, { relayer: name }, "0x5ec1").catch((e) => e);
      expect(err.message).toMatch(/did not execute this signed call \(it does not carry this call\)/);
      expect(err.details).toMatchObject({ code: "relay_outcome_unknown", fallback: "none", channel: C.toString() });
      expect(err.hint).toMatch(/^do not resend and do not re-sign/);
    });
  });

  it("this call executed inside executeRelayCallBatch together with another call: recognised as this call (batch item)", async () => {
    let batch: Hex | undefined;
    await withRelayer(
      {
        respond: async (b) => {
          const t = b.transaction;
          const n = BigInt(t.nonce);
          const payload = encodeUpExecute({ operation: 0, to: recOther, value: 0n, data: "0xb2" });
          const next = { signature: await signLsp25(signer, { keyManager: km, chainId: h.chainId, nonce: n + 1n, validityTimestamps: 0n, value: 0n, payload }), nonce: n + 1n, validityTimestamps: 0n, value: 0n, payload };
          batch = (await h.sendFrom(h.accounts[7], km, encodeExecuteRelayCallBatch([{ signature: t.signature, nonce: n, validityTimestamps: BigInt(t.validityTimestamps), value: 0n, payload: t.abi }, next]))).hash;
          return [200, { transactionHash: batch, chainId: h.chainId }];
        },
      },
      async (name) => {
        const a0 = await count(rec);
        const out = await send(ctx, { relayer: name }, "0xb1");
        expect(out.status).toBe("success");
        expect(out.txHash).toBe(batch);
        expect(out.confirmation.attribution).toEqual({ transaction: batch, entry: "executeRelayCallBatch[0]" });
        expect(await count(rec)).toBe(a0 + 1n);
      },
    );
  });

  it("this call executed through a contract that wraps it: unresolved, never claimed as success (or failure) from bytes in the calldata", async () => {
    const fwd = await h.deployRaw(initCodeFor(forwarder(km)));
    let wrapped: Hex | undefined;
    await withRelayer(
      {
        respond: async (b) => {
          const t = b.transaction;
          wrapped = (await h.sendFrom(h.accounts[7], fwd, encodeExecuteRelayCall(t.signature, BigInt(t.nonce), BigInt(t.validityTimestamps), t.abi))).hash;
          return [200, { transactionHash: wrapped, chainId: h.chainId }];
        },
      },
      async (name) => {
        const a0 = await count(rec);
        const err = await send(ctx, { relayer: name }, "0xa1").catch((e) => e);
        expect(err.code).toBe("RELAYER_ERROR");
        expect(err.message).toMatch(/whether THIS call executed is not proven/);
        expect(err.details).toMatchObject({ code: "relay_outcome_unresolved", fallback: "none", transactions: [wrapped!.toLowerCase()] });
        expect(err.hint).toMatch(/^do not resend and do not re-sign/);
        expect(await count(rec)).toBe(a0 + 1n); // it did run: the skill says "not proven" instead of guessing
      },
    );
  });

  it("two state folders racing with the same key on one explicit channel: exactly one call executes, the other never reports success", async () => {
    const other = await homeWithRelayer();
    const Z = (1n << 100n) + 12345n;
    const rs = await Promise.allSettled([send(ctx, { channel: Z }, "0x0e"), send(other, { channel: Z }, "0x0f")]);
    const done = rs.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled");
    expect(done).toHaveLength(1);
    expect(done[0].value.status).toBe("success");
    const e = (rs.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    expect(e.code === "SIMULATION_REVERTED" ? e.details.errorName : e.details?.code).toMatch(/^(InvalidRelayNonce|nonce_used_by_other_call)$/);
    expect(splitNonce(await nonceOn(Z)).sequence).toBe(1n);
  });
});
