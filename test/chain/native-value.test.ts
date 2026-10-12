// Native value through the profile on the local chain (regression for a reported LYX → token swap that
// failed with InsufficientETH()). A router-like mock reverts with InsufficientETH() unless msg.value
// covers the amount in its calldata (like a WRAP_ETH step). On km, lsp0 and relay it must see
// msg.sender = profile and msg.value = the inner ERC725X value, paid from the profile's balance, while
// the transaction sent by the agent's key (or the relayer) carries no value and never goes to the
// router. A missing, mis-scaled or unfunded value stops in simulation with a decoded reason; the
// agent's gas money is never used instead.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, initCodeFor, readRecorder, RECORDER_RUNTIME, runVerb as run, startMockRelayer, type MockRelayer } from "../support/mock-relayer.ts";
import { DEFAULT_POLICY, savePolicy } from "../../src/core/policy.ts";
import { KM_ABI } from "../../src/lsp/abis.ts";
import "../../src/lsp/verbs.ts";
import "../../src/relayer/verbs.ts";
import "../../src/abi/verbs.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";

/**
 * Test-only router mock (models no real deployment): swapNativeIn(uint256 amountIn) reverts with
 * InsufficientETH() (0x6a12f104) when msg.value < amountIn, else records slot0 = msg.sender,
 * slot1 = msg.value, slot2 += 1 (read with readRecorder).
 *   PUSH1 4 CALLDATALOAD CALLVALUE LT PUSH1 0x1a JUMPI | record like RECORDER_RUNTIME | STOP
 *   0x1a: JUMPDEST PUSH4 0x6a12f104 PUSH1 0xe0 SHL PUSH1 0 MSTORE PUSH1 4 PUSH1 0 REVERT
 */
const NATIVE_IN_ROUTER_RUNTIME: Hex = "0x6004353410601a573360005534600155600254600101600255005b636a12f10460e01b60005260046000fd";
const ROUTER_ABI = parseAbi(["function swapNativeIn(uint256 amountIn) payable"]);
const FIVE = parseEther("5");
const swapData = (amountIn: bigint) => encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapNativeIn", args: [amountIn] });
const PATHS = ["km", "lsp0", "relay"] as const;

let h: Harness;
let agent: Signer;
let ctx: VerbContext;
let profile: Address;
let keyManager: Address;
let router: Address;
let recorder: Address;
let relayer: MockRelayer;
const bal = async (a: Address) => BigInt(await h.request("eth_getBalance", [a, "latest"]));
const nonceOf = (a: Address) => h.request("eth_getTransactionCount", [a, "latest"]);

beforeAll(async () => {
  h = await getHarness();
  agent = testSigner(generatePrivateKey());
  await h.fund(agent.address, parseEther("10"));
  ctx = testContext(h.newHome(), agent, { approval: "human: swap 5 coins for the token as the profile" });
  const m = await deployProfileFor(ctx, agent, h.chainId);
  profile = m.profile;
  keyManager = m.keyManager;
  relayer = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[1] });
  const cfg = await ctx.config();
  await ctx.saveConfig({ ...cfg, defaultProfile: profile, relayers: [{ name: "mock", baseUrl: relayer.url, chainIds: [h.chainId], profile: "lsp15" }] });
  router = await h.deployRaw(initCodeFor(NATIVE_IN_ROUTER_RUNTIME));
  recorder = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));
}, 120_000);

afterAll(async () => relayer?.close());

describe("a 5-coin swap call goes through the profile on every path", () => {
  for (const via of PATHS) {
    it(`--via ${via}: the router sees the profile and 5 coins, the profile pays them, the transaction itself carries 0`, async () => {
      await h.fund(profile, parseEther("6"));
      const keyBefore = await bal(agent.address);
      const before = await readRecorder(h.request, router);
      const r = await run(ctx, "exec send", { to: router, data: swapData(FIVE), value: "5lyx", via });
      expect(r.data.status).toBe("success");
      expect(await readRecorder(h.request, router)).toEqual({ sender: profile, value: FIVE, count: before.count + 1n });
      expect(await bal(profile)).toBe(parseEther("1"));
      // the plan shown before signing
      expect(r.data.confirmation).toMatchObject({ actor: profile, path: via, totalValue: FIVE.toString(), totalValueFormatted: "5 ETH", valueSource: "profile balance (ERC725X value field)" });
      expect(r.data.confirmation.calls[0]).toMatchObject({ operation: "CALL", to: router, value: FIVE.toString() });
      expect(r.data.confirmation.entry.value).toBe("0");
      expect(r.warnings ?? []).toEqual([]);
      // the transaction on chain goes to the Key Manager (km, relay) or the profile (lsp0), never to the router, with value 0
      const tx = await h.request("eth_getTransactionByHash", [r.data.txHash]);
      const receipt = await h.request("eth_getTransactionReceipt", [r.data.txHash]);
      expect(BigInt(tx.value)).toBe(0n);
      expect(getAddress(tx.to)).toBe(via === "lsp0" ? profile : keyManager);
      if (via === "relay") {
        expect(getAddress(tx.from)).toBe(h.accounts[1]);
        expect(r.data.confirmation.lsp25.signedValue).toBe("0");
        expect(await bal(agent.address)).toBe(keyBefore); // the relayer paid the gas
      } else {
        expect(getAddress(tx.from)).toBe(agent.address);
        expect(keyBefore - (await bal(agent.address))).toBe(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)); // gas, nothing else
      }
    });
  }

  for (const via of PATHS) {
    it(`exec batch --via ${via}: a zero-value call plus the 5-coin swap; nothing rides on the transaction`, async () => {
      await h.fund(profile, parseEther("6"));
      const r = await run(ctx, "exec batch", { calls: [{ to: recorder, fn: "ping(uint256)", args: ["1"] }, { to: router, data: swapData(FIVE), value: "5lyx" }], via });
      expect(r.data.status).toBe("success");
      expect(await readRecorder(h.request, router)).toMatchObject({ sender: profile, value: FIVE });
      expect(await bal(profile)).toBe(parseEther("1"));
      expect(BigInt((await h.request("eth_getTransactionByHash", [r.data.txHash])).value)).toBe(0n);
      if (via === "km") expect(decodeFunctionData({ abi: KM_ABI, data: r.data.entryCalldata }).args![0]).toEqual([0n, 0n]);
    });
  }

  it("exec simulate checks the exact wrapper (the Key Manager entry with value 0), not a direct call to the router", async () => {
    await h.fund(profile, parseEther("6"));
    const s = await run(testContext(ctx.home, agent, { yes: false }), "exec simulate", { to: router, data: swapData(FIVE), value: "5lyx", via: "km" });
    expect(s.data).toMatchObject({ simulated: true, status: "dry-run" });
    expect(s.data.confirmation.entry).toMatchObject({ to: keyManager, value: "0", function: "execute(bytes)" });
  });

  it("contract call --value 5lyx attaches 5 coins as the profile (a bare 5 there means 5 coins as well)", async () => {
    for (const value of ["5lyx", "5"]) {
      await h.fund(profile, parseEther("6"));
      const r = (await run(ctx, "contract call", { address: router, fn: "swapNativeIn", args: [FIVE.toString()], abi: ["function swapNativeIn(uint256 amountIn) payable"], value, via: "km", offline: true })).data;
      expect(r.value, value).toBe(FIVE.toString());
      expect(r.outcome.status).toBe("success");
      expect(await readRecorder(h.request, router)).toMatchObject({ sender: profile, value: FIVE });
      expect(await bal(profile)).toBe(parseEther("1"));
    }
  });
});

describe("a missing or wrong value stops before anything is sent", () => {
  it("no --value, or a bare --value 5 (5 wei): decoded InsufficientETH() with a hint on km, lsp0 and relay; nothing sent", async () => {
    await h.fund(profile, parseEther("6"));
    const nonce = await nonceOf(agent.address);
    const count = (await readRecorder(h.request, router)).count;
    for (const value of [undefined, "5"]) {
      for (const via of PATHS) {
        const e = await run(ctx, "exec send", { to: router, data: swapData(FIVE), value, via }).catch((x) => x);
        expect(e.code, `${via} ${value}`).toBe("SIMULATION_REVERTED");
        expect(e.message).toMatch(/InsufficientETH\(\)/);
        expect(e.details.errorName).toBe("InsufficientETH");
        expect(e.hint).toMatch(/5lyx/);
      }
    }
    expect(await nonceOf(agent.address)).toBe(nonce);
    expect((await readRecorder(h.request, router)).count).toBe(count);
    expect(await bal(profile)).toBe(parseEther("6"));
  });

  it("a bare number below 1 gwei is shown as wei and warned about in the dry run (send, batch, simulate)", async () => {
    const dry = testContext(ctx.home, agent, { dryRun: true });
    const d = await run(dry, "exec send", { to: recorder, value: "5", via: "km" });
    expect(d.data.status).toBe("dry-run");
    expect(d.data.confirmation.calls[0]).toMatchObject({ value: "5", valueFormatted: "0.000000000000000005 ETH" });
    expect(d.warnings?.join(" ")).toMatch(/--value 5 has no unit, so it is 5 wei/);
    expect((await run(dry, "exec send", { to: recorder, value: "5lyx", via: "km" })).warnings ?? []).toEqual([]);
    const b = await run(dry, "exec batch", { calls: [{ to: recorder, value: "5" }, { to: recorder, value: "5lyx" }], via: "km" });
    expect((b.warnings ?? []).filter((w: string) => /no unit/.test(w))).toEqual([expect.stringMatching(/^calls\[0\]\.value 5 has no unit/)]);
    const s = await run(testContext(ctx.home, agent, { yes: false }), "exec simulate", { to: recorder, value: "5", via: "km" });
    expect(s.warnings?.join(" ")).toMatch(/no unit/);
  });

  it("a profile short of 5 coins fails with ERC725X_InsufficientBalance and a fund-the-profile hint; the key's 10 coins are never used", async () => {
    await h.fund(profile, parseEther("1"));
    const keyBefore = await bal(agent.address);
    expect(keyBefore > FIVE).toBe(true);
    for (const via of PATHS) {
      const e = await run(ctx, "exec send", { to: router, data: swapData(FIVE), value: "5lyx", via }).catch((x) => x);
      expect(e.code, via).toBe("SIMULATION_REVERTED");
      expect(e.details).toMatchObject({ errorName: "ERC725X_InsufficientBalance", args: [parseEther("1"), FIVE] });
      expect(e.hint).toMatch(/profile address \(not the gas address\)/);
    }
    expect(await bal(agent.address)).toBe(keyBefore);
    expect(await bal(profile)).toBe(parseEther("1"));
  });
});

describe("--fund-from-controller spends the agent's gas money", () => {
  it("needs the human's own approval even where the policy allows the value; the dry run shows the plan; with approval the key pays", async () => {
    await savePolicy(ctx.home, { ...DEFAULT_POLICY, maxValuePerTx: { "*": parseEther("10").toString() } });
    try {
      await h.fund(profile, parseEther("2"));
      const yes = testContext(ctx.home, agent, { yes: true });
      const before = (await readRecorder(h.request, recorder)).count;
      for (const via of ["km", "lsp0"] as const) {
        const e = await run(yes, "exec send", { to: recorder, value: "1lyx", "fund-from-controller": true, via }).catch((x) => x);
        expect(e.code, via).toBe("CONSENT_REQUIRED");
        expect(e.message).toMatch(/gas money/);
        expect(e.details.confirmation.valueSource).toMatch(/controller EOA/);
      }
      expect((await readRecorder(h.request, recorder)).count).toBe(before);
      // the same payment from the profile's balance is inside the policy
      expect((await run(yes, "exec send", { to: recorder, value: "1lyx", via: "km" })).data.status).toBe("success");
      expect(await bal(profile)).toBe(parseEther("1"));
      const d = await run(testContext(ctx.home, agent, { dryRun: true }), "exec send", { to: recorder, value: "1lyx", "fund-from-controller": true, via: "km" });
      expect(d.data.confirmation.entry.value).toBe(parseEther("1").toString());
      const r = await run(ctx, "exec send", { to: recorder, value: "1lyx", "fund-from-controller": true, via: "km" });
      expect(r.data.status).toBe("success");
      expect(await bal(profile)).toBe(parseEther("1"));
      expect(BigInt((await h.request("eth_getTransactionByHash", [r.data.txHash])).value)).toBe(parseEther("1"));
    } finally {
      await savePolicy(ctx.home, DEFAULT_POLICY);
    }
  });
});
