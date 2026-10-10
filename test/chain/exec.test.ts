// Execute + sign verbs on an agent-deployed profile: exec send (km/lsp0/relay/auto/userop),
// exec batch, exec simulate, exec call (STATICCALL as the profile), exec receipt (incl.
// decoded revert), nonce, sign message / typed-data (as profile and controller), verify-1271.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, hashTypedData, parseEther, recoverTypedDataAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, initCodeFor, readRecorder, RECORDER_RUNTIME, runVerb as run, startMockRelayer, WHOAMI_RUNTIME, type MockRelayer } from "../support/mock-relayer.ts";
import "../../src/lsp/verbs.ts";
import "../../src/relayer/verbs.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { UP_ABI } from "../../src/lsp/abis.ts";

let h: Harness;
let agent: Signer;
let ctx: VerbContext;
let profile: Address;
let keyManager: Address;
let recA: Address;
let recB: Address;
let whoami: Address;
let relayer: MockRelayer;
const bal = async (a: Address) => BigInt(await h.request("eth_getBalance", [a, "latest"]));

beforeAll(async () => {
  h = await getHarness();
  agent = testSigner(generatePrivateKey());
  await h.fund(agent.address, parseEther("10"));
  ctx = testContext(h.newHome(), agent, { approval: "human: approved for this suite" });
  const m = await deployProfileFor(ctx, agent, h.chainId);
  profile = m.profile;
  keyManager = m.keyManager;
  const cfg = await ctx.config();
  relayer = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[1] });
  await ctx.saveConfig({ ...cfg, defaultProfile: profile, relayers: [{ name: "mock", baseUrl: relayer.url, chainIds: [h.chainId], profile: "lsp15" }] });
  await h.fund(profile, parseEther("5"));
  recA = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  recB = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
  whoami = await h.deployRaw(initCodeFor(WHOAMI_RUNTIME));
}, 120_000);

afterAll(async () => relayer?.close());

describe("exec send through every path", () => {
  for (const via of ["km", "lsp0", "relay"] as const) {
    it(`--via ${via}: native value out of the profile, msg.sender = profile`, async () => {
      const before = await bal(recA);
      const r = await run(ctx, "exec send", { to: recA, value: "0.001ether", via });
      expect(r.data.status).toBe("success");
      expect(r.data.path).toBe(via);
      expect(await bal(recA)).toBe(before + parseEther("0.001"));
      expect((await readRecorder(h.request, recA)).sender).toBe(profile);
      expect(r.data.confirmation).toMatchObject({ actor: profile, keyManager, path: via });
      expect(r.data.confirmation.calls[0].valueFormatted).toBe("0.001 ETH");
    });
  }

  it("--fn/--args encodes and the confirmation block shows the decoded function", async () => {
    const r = await run(ctx, "exec send", { to: recB, fn: "ping(uint256,string)", args: ["42", "hello"] });
    expect(r.data.confirmation.calls[0]).toMatchObject({ function: "ping", args: [42n, "hello"], decodedBy: "abi" });
    expect((await readRecorder(h.request, recB)).sender).toBe(profile);
  });

  it("--fund-from-controller: the controller EOA pays the value, the profile balance is unchanged", async () => {
    const up = await bal(profile);
    const r = await run(ctx, "exec send", { to: recA, value: "1000", "fund-from-controller": true });
    expect(r.data.confirmation.valueSource).toMatch(/controller EOA/);
    expect(await bal(profile)).toBe(up);
  });

  it("--via userop is refused when the opt-in 4337 module is not enabled/registered", async () => {
    const err = await run(ctx, "exec send", { to: recA, data: "0x01", via: "userop" }).catch((e) => e);
    expect(err.code).toBe("NOT_SUPPORTED");
  });

  it("--via auto (the default) picks relay when a relayer with quota covers the chain; km with --fund-from-controller", async () => {
    const r = await run(ctx, "exec send", { to: recA, data: "0x02" });
    expect(r.data.path).toBe("relay");
    expect(r.data.autoDecision.reason).toMatch(/quota/);
    const k = await run(ctx, "exec send", { to: recA, value: "1", "fund-from-controller": true });
    expect(k.data.path).toBe("km");
  });

  it("dry-run never sends", async () => {
    const before = (await readRecorder(h.request, recA)).count;
    const nonce = await h.request("eth_getTransactionCount", [agent.address, "latest"]);
    const r = await run(testContext(ctx.home, agent, { dryRun: true }), "exec send", { to: recA, value: "1" });
    expect(r.data.status).toBe("dry-run");
    expect(r.text).toMatch(/DRY RUN/);
    expect((await readRecorder(h.request, recA)).count).toBe(before);
    expect(await h.request("eth_getTransactionCount", [agent.address, "latest"])).toBe(nonce);
  });
});

describe("batch, simulate, call, receipt, nonce", () => {
  it("exec batch is atomic across two targets (km → KM.executeBatch)", async () => {
    const a = await readRecorder(h.request, recA);
    const b = await readRecorder(h.request, recB);
    const r = await run(ctx, "exec batch", { calls: [{ to: recA, value: "5" }, { to: recB, fn: "x(uint256)", args: ["1"] }], via: "km" });
    expect(r.data.entryCalldata.slice(0, 10)).toBe("0xbf0176ff");
    expect((await readRecorder(h.request, recA)).count).toBe(a.count + 1n);
    expect((await readRecorder(h.request, recB)).count).toBe(b.count + 1n);
    // one failing call reverts the whole batch (simulation catches it)
    const err = await run(ctx, "exec batch", { calls: [{ to: recA, value: "1" }, { to: recB, value: "100000ether" }] }).catch((e) => e);
    expect(err.details.errorName).toBe("ERC725X_InsufficientBalance");
  });

  it("exec simulate returns the confirmation block without consent or sending", async () => {
    const noConsent = testContext(ctx.home, agent, { yes: false });
    const r = await run(noConsent, "exec simulate", { to: recA, value: "1ether", via: "lsp0" });
    expect(r.data.simulated).toBe(true);
    expect(r.data.status).toBe("dry-run");
    const b = await run(noConsent, "exec simulate", { calls: [{ to: recA }, { to: recB }], via: "relay" });
    expect(b.data.path).toBe("relay");
    const err = await run(noConsent, "exec simulate", { to: recA, value: "1000000ether" }).catch((e) => e);
    expect(err.code).toBe("SIMULATION_REVERTED");
  });

  it("exec call: STATICCALL through the profile (msg.sender = profile) and direct mode", async () => {
    const r = await run(ctx, "exec call", { to: whoami, fn: "whoami() view returns (address)" });
    expect(r.data.decoded).toBe(profile);
    expect(r.data.from).toBe(keyManager);
    const d = await run(ctx, "exec call", { to: whoami, fn: "whoami() view returns (address)", mode: "direct" });
    expect(d.data.decoded).toBe(profile);
    const t = await run(ctx, "exec call", { to: keyManager, fn: "target() view returns (address)" });
    expect(t.data.decoded).toBe(profile);
    const raw = await run(ctx, "exec call", { to: whoami, data: "0x" });
    expect(raw.data.raw.toLowerCase()).toContain(profile.slice(2).toLowerCase());
  });

  it("exec receipt decodes events of a success and the revert reason of a failed transaction", async () => {
    const s = await run(ctx, "exec send", { to: recA, value: "7", via: "km" });
    const r = await run(ctx, "exec receipt", { hash: s.data.txHash });
    expect(r.data.status).toBe("success");
    const names = r.data.events.map((e: any) => e.event);
    expect(names).toContain("Executed");
    expect(names).toContain("PermissionsVerified");
    // failed tx: a stranger calls UP.execute (not the owner, not a controller)
    const data = encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, recA, 1n, "0x"] });
    await h.request("evm_setAutomine", [false]); // hardhat throws on failing txs in automine mode
    let hash: Hex;
    try {
      hash = await h.request("eth_sendTransaction", [{ from: h.accounts[6], to: profile, data, gas: "0x100000" }]);
      await h.request("evm_mine", []);
    } finally {
      await h.request("evm_setAutomine", [true]);
    }
    const f = await run(ctx, "exec receipt", { hash });
    expect(f.data.status).toBe("reverted");
    expect(f.data.revert.errorName).toBe("NoPermissionsSet");
    expect((await run(ctx, "exec receipt", { hash: "0x" + "00".repeat(32) })).data.status).toBe("unknown");
  });

  it("nonce", async () => {
    const r = await run(ctx, "nonce", { channel: "77" });
    expect(r.data.controller).toBe(agent.address);
    expect(r.data.relay.map((x: any) => x.channel)).toContain("77");
    expect(r.data.eoaNonce).toBeGreaterThan(0);
  });
});

describe("signing", () => {
  const td = {
    domain: { name: "Orders", version: "1", chainId: 31337, verifyingContract: "0x0000000000000000000000000000000000000001" },
    types: { Order: [{ name: "owner", type: "address" }, { name: "amount", type: "uint256" }] },
    primaryType: "Order",
    message: { owner: "0x0000000000000000000000000000000000000002", amount: "5" },
  };

  it("sign message --as profile (ERC-1271 via the KM, SIGN) and --as controller", async () => {
    const p = await run(ctx, "sign message", { message: "hello profile" });
    expect(p.data.verification.valid).toBe(true);
    expect(await recoverMessageAddress({ message: "hello profile", signature: p.data.signature })).toBe(agent.address);
    const c = await run(ctx, "sign message", { message: "0x1234", hex: true, as: "controller" });
    expect(c.data.verification).toBeUndefined();
    expect(await recoverMessageAddress({ message: { raw: "0x1234" }, signature: c.data.signature })).toBe(agent.address);
  });

  it("sign typed-data --as profile verifies on chain; flagged as order-like; verify-1271 by hash and by typed data", async () => {
    const r = await run(ctx, "sign typed-data", { "typed-data": td });
    expect(r.data.verification.valid).toBe(true);
    expect(r.warnings?.join()).toMatch(/Order/);
    expect(r.data.hash).toBe(hashTypedData({ ...td, message: { ...td.message, amount: 5n } } as any));
    expect(await recoverTypedDataAddress({ ...(td as any), message: { ...td.message, amount: 5n }, signature: r.data.signature })).toBe(agent.address);
    expect((await run(ctx, "verify-1271", { signature: r.data.signature, hash: r.data.hash })).data.valid).toBe(true);
    expect((await run(ctx, "verify-1271", { signature: r.data.signature, "typed-data": td })).data.valid).toBe(true);
    expect((await run(ctx, "verify-1271", { signature: r.data.signature, hash: "0x" + "00".repeat(32) })).data.valid).toBe(false);
  });

  it("signing needs consent; dry-run does not sign", async () => {
    await expect(run(testContext(ctx.home, agent, { yes: false }), "sign message", { message: "x" })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    const d = await run(testContext(ctx.home, agent, { dryRun: true }), "sign message", { message: "x" });
    expect(d.data.dryRun).toBe(true);
    expect(d.data.signature).toBeUndefined();
  });

  it("a controller without SIGN cannot sign as the profile", async () => {
    const other = testSigner(generatePrivateKey());
    await run(ctx, "controller add", { address: other.address, permissions: ["STATICCALL"], "allowed-calls": [{ callTypes: ["STATICCALL"], address: whoami }] });
    const err = await run(testContext(ctx.home, other, { approval: "ok" }), "sign message", { message: "x" }).catch((e) => e);
    expect(err.code).toBe("NOT_AUTHORISED");
    expect(err.message).toMatch(/SIGN/);
  });
});

describe("blind-hash and value-moving signature guards", () => {
  const hash32 = ("0x" + "5a".repeat(32)) as Hex;
  it("32-byte messages (blind hashes) are always refused, even with a human approval (--hex bytes, a 0x…64 string, or 32 utf-8 bytes)", async () => {
    const yes = testContext(ctx.home, agent, { yes: true });
    for (const c of [yes, ctx]) {
      for (const raw of [{ message: hash32, hex: true }, { message: hash32 }, { message: "a".repeat(32) }, { message: hash32, hex: true, as: "controller" }]) {
        const e = await run(c, "sign message", raw).catch((x) => x);
        expect(e.code, JSON.stringify(raw)).toBe("POLICY_DENIED");
        expect(e.message).toMatch(/32-byte/);
      }
    }
    expect((await run(yes, "sign message", { message: "a".repeat(31) })).data.verification.valid).toBe(true);
  });

  it("blind-hash refusal does not depend on knowing where ERC-4337 is enabled (any profile, any chain)", async () => {
    const ext = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
    await run(ctx, "account extensions add", { selector: "0x3a871cdd", address: ext });
    try {
      const other = (await deployProfileFor(ctx, agent, h.chainId)).profile;
      for (const extra of [{ as: "controller" }, { as: "profile" }, { as: "controller", profile: other }]) {
        const e = await run(ctx, "sign message", { message: hash32, hex: true, ...extra }).catch((x) => x);
        expect(e.code).toBe("POLICY_DENIED");
      }
      // ordinary messages are unaffected
      expect((await run(ctx, "sign message", { message: "hello again" })).data.verification.valid).toBe(true);
    } finally {
      await run(ctx, "account extensions remove", { selector: "0x3a871cdd" });
    }
  });

  it("Permit / Permit2 / Order typed data is value-moving: approval required, admin risk", async () => {
    const yes = testContext(ctx.home, agent, { yes: true });
    const permit2 = {
      domain: { name: "Permit2", chainId: 31337, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
      types: { PermitSingle: [{ name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }] },
      primaryType: "PermitSingle",
      message: { spender: "0x0000000000000000000000000000000000000003", sigDeadline: "1" },
    };
    const e = await run(yes, "sign typed-data", { "typed-data": permit2 }).catch((x) => x);
    expect(e.code).toBe("CONSENT_REQUIRED");
    expect(e.message).toMatch(/typed data/);
    expect((await run(ctx, "sign typed-data", { "typed-data": permit2 })).data.verification.valid).toBe(true);
    // every EIP-712 signature needs the human (e.g. marketplace orders that are not named "Order")
    const login = { domain: { name: "Login", version: "1" }, types: { Login: [{ name: "nonce", type: "uint256" }] }, primaryType: "Login", message: { nonce: "1" } };
    expect((await run(yes, "sign typed-data", { "typed-data": login }).catch((x) => x)).code).toBe("CONSENT_REQUIRED");
    expect((await run(ctx, "sign typed-data", { "typed-data": login })).data.verification.valid).toBe(true);
  });
});

