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
let deployed: Address;
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
    deployed = profile;
    await run(ctx, "controller add", { address: later, preset: "agent-reader", profile, chain: String(hA.chainId) });
    expect(await controllersOn(hA.chainId, profile)).toEqual(expect.arrayContaining([agentKey, later]));

    const replay: any = await run(ctx, "account deploy", { profile, chain: String(hB.chainId) });
    expect(replay.data.profile).toBe(profile); // same address on the new chain
    const onB = await controllersOn(hB.chainId, profile);
    expect(onB).toContain(agentKey);
    expect(onB).not.toContain(later);
  });

  it("the key that created the profile is permanent: after switching to another key it stays listed and is found as the key with access on the new chain", async () => {
    const k2 = ((await run(ctx, "key new-candidate", {})) as any).data.address as Address;
    await run(ctx, "key activate", { address: k2 });
    expect((await ctx.config()).controller!.address).toBe(k2);
    const keys: any = await run(ctx, "key address", {});
    expect(keys.data.otherKeys).toEqual([expect.objectContaining({ address: agentKey, kind: "previous" })]);
    expect(await getBackend("memory").has(agentKey)).toBe(true);
    const st: any = await run(ctx, "profile status", { profile: deployed, chains: [String(hB.chainId)] });
    expect(st.data.chains[0]).toMatchObject({ deployed: true, otherLocalController: { address: agentKey } });
    await run(ctx, "key activate", { address: agentKey }); // back to the first key; k2 stays listed
    expect((await ctx.config()).previousControllers!.map((k) => k.address)).toEqual([k2]);
  });
});
