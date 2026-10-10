// The initial controllers are part of the profile address (LSP23 salt), and on every new chain only
// they have access: controllers added later on one chain do not exist on the next. Nobody can deploy
// the same address with other owners ("squatting").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEther, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getHarness, getSecondHarness, multiChainHome, type Harness } from "./harness.ts";
import { testContext } from "../support/context.ts";
import { runVerb as run } from "../support/mock-relayer.ts";
import "../../src/lsp/verbs.ts";
import "../../src/signer/verbs.ts";
import type { VerbContext } from "../../src/core/types.ts";
import { paths } from "../../src/core/home.ts";
import { getBackend } from "../../src/signer/index.ts";
import { resetMemoryBackend } from "../../src/signer/memory.ts";

let hA: Harness;
let hB: Harness;
let ctx: VerbContext;
const pk = generatePrivateKey();
const agentKey = privateKeyToAccount(pk).address as Address;
const later = privateKeyToAccount(generatePrivateKey()).address as Address; // added on chain A after deployment
const savedEph = process.env.UP_TEST_EPHEMERAL_KEY;
const seed = ("0x" + "5a".repeat(32)) as `0x${string}`;

beforeAll(async () => {
  hA = await getHarness();
  hB = await getSecondHarness();
  process.env.UP_TEST_EPHEMERAL_KEY = "1";
  resetMemoryBackend();
  await getBackend("memory").importKey!(pk);
  const home = multiChainHome([hA, hB]);
  const cfg = JSON.parse(readFileSync(paths.config(home), "utf8"));
  writeFileSync(paths.config(home), JSON.stringify({ ...cfg, controller: { address: agentKey, backend: "memory", createdAt: new Date().toISOString() } }), { mode: 0o600 });
  ctx = testContext(home, undefined, { approval: "human: approved for this test" });
  await hA.fund(agentKey, parseEther("10"));
  await hB.fund(agentKey, parseEther("10"));
}, 240_000);

afterAll(() => {
  if (savedEph === undefined) delete process.env.UP_TEST_EPHEMERAL_KEY;
  else process.env.UP_TEST_EPHEMERAL_KEY = savedEph;
});

const controllersOn = async (chain: number, profile: Address) => {
  const info: any = await run(ctx, "account info", { profile, chain: String(chain) });
  return (info.data.controllers as any[]).map((c) => c.address as Address);
};

describe("initial controllers", () => {
  it("are part of the address: another first controller gives another address (no squatting)", async () => {
    const mine: any = await run(ctx, "account precompute", { seed, count: 1, chain: String(hA.chainId) });
    const other: any = await run(ctx, "account precompute", { seed, count: 1, controller: later, chain: String(hA.chainId) });
    expect(other.data.candidates[0].profile).not.toBe(mine.data.candidates[0].profile);
  });

  it("on a new chain only the initial controllers have access; controllers added later elsewhere do not carry over", async () => {
    const d: any = await run(ctx, "account deploy", { seed, candidate: 0, chain: String(hA.chainId) });
    const profile = d.data.profile as Address;
    await run(ctx, "controller add", { address: later, preset: "agent-reader", profile, chain: String(hA.chainId) });
    expect(await controllersOn(hA.chainId, profile)).toEqual(expect.arrayContaining([agentKey, later]));

    const replay: any = await run(ctx, "account deploy", { profile, chain: String(hB.chainId) });
    expect(replay.data.profile).toBe(profile); // same address on the new chain
    const onB = await controllersOn(hB.chainId, profile);
    expect(onB).toContain(agentKey);
    expect(onB).not.toContain(later);
  });

  it("the rotation plan never tells the agent to delete the key that created a profile", async () => {
    const plan: any = await run(ctx, "key rotate-plan", {});
    const last = plan.data.steps[plan.data.steps.length - 1];
    expect(last.title).toMatch(/Keep the old key/);
    expect(last.detail).toMatch(/Do NOT delete/);
    expect(JSON.stringify(plan.data.steps)).not.toMatch(/then delete it from the key store/);
  });
});
