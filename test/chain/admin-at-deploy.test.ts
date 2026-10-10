// The human's own wallet as a full co-controller at deployment (--admin): the agent's key sends
// and pays for the deployment, the human signs nothing, and both controllers exist from block one.
import { beforeAll, describe, expect, it } from "vitest";
import { parseEther, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { runVerb as run } from "../support/mock-relayer.ts";
import "../../src/lsp/verbs.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { ALL_PERMISSIONS } from "../../src/lsp/constants.ts";

let h: Harness;
let agent: Signer;
let ctx: VerbContext;
const human = privateKeyToAccount(generatePrivateKey()).address as Address; // never funded, never signs

beforeAll(async () => {
  h = await getHarness();
  agent = testSigner(generatePrivateKey());
  await h.fund(agent.address, parseEther("10"));
  ctx = testContext(h.newHome(), agent, { approval: "human: approved for this test" });
}, 120_000);

describe("deploy with the human's wallet as co-controller (--admin)", () => {
  it("precompute and deploy include the admin; the agent pays; both are controllers with full rights", async () => {
    const seed = "0x" + "ab".repeat(32);
    const without: any = await run(ctx, "account precompute", { seed, count: 1 });
    const pre: any = await run(ctx, "account precompute", { seed, count: 1, admin: human });
    const profile = pre.data.candidates[0].profile as Address;
    expect(profile).not.toBe(without.data.candidates[0].profile); // the admin is part of the address

    const before = BigInt(await h.request("eth_getBalance", [human, "latest"]) as string);
    const r: any = await run(ctx, "account deploy", { seed, candidate: 0, admin: human });
    expect(r.data.status).toBe("deployed");
    expect(r.data.profile).toBe(profile);
    expect(r.warnings?.join() ?? "").not.toMatch(/only admin controller/);
    expect(BigInt(await h.request("eth_getBalance", [human, "latest"]) as string)).toBe(before); // the human paid nothing and signed nothing

    const info: any = await run(ctx, "account info", { profile });
    const byAddr = Object.fromEntries((info.data.controllers as any[]).map((c) => [c.address, BigInt(c.permissions.hex)]));
    expect(byAddr[human]).toBe(ALL_PERMISSIONS);
    expect(byAddr[agent.address]).toBe(ALL_PERMISSIONS);
  });

  it("rejects --admin equal to the initial controller", async () => {
    await expect(run(ctx, "account precompute", { count: 1, admin: agent.address })).rejects.toMatchObject({ code: "BAD_ARGS" });
  });

  it("dry-run tells how much gas the agent's key needs; the real run stops before signing when it is missing", async () => {
    const poor = testSigner(generatePrivateKey()); // never funded
    const pctx = testContext(h.newHome(), poor, { approval: "human: approved for this test" });
    const dry: any = await run(testContext(pctx.home, poor, { dryRun: true }), "account deploy", { seed: "0x" + "cd".repeat(32), candidate: 0 });
    expect(dry.data.status).toBe("dry-run");
    expect(dry.data.gas).toMatchObject({ payer: poor.address, enough: false, balance: "0" });
    expect(Number(dry.data.gas.suggestedFunding)).toBeGreaterThan(Number(dry.data.gas.missing));
    const e = await run(pctx, "account deploy", { seed: "0x" + "cd".repeat(32), candidate: 0 }).catch((x) => x);
    expect(e).toMatchObject({ code: "TX_FAILED", details: { reason: "needs-gas" } });
    expect(e.hint).toMatch(/up display address/);
  });
});
