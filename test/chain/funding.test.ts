// funding suggest on a real (local) chain: the suggestion covers the actual deployment cost and
// follows the $1 / $10 rule when a price is known. The price API is stubbed; nothing leaves the machine.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { runVerb as run } from "../support/mock-relayer.ts";
import "../../src/chain/funding.ts";

let h: Harness;
const realFetch = globalThis.fetch;
let priceCalls = 0;

beforeAll(async () => {
  h = await getHarness();
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.startsWith("https://api.coingecko.com/")) {
      priceCalls++;
      return new Response(JSON.stringify({ ethereum: { usd: 2500 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error(`unexpected network access in test: ${url}`);
    return realFetch(input, init);
  }) as typeof fetch;
}, 120_000);

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("funding suggest", () => {
  it("suggests about $1 / $10 worth, never below the real deployment cost, in plain words", async () => {
    const agent = testSigner(generatePrivateKey());
    const home = h.newHome();
    // treat the local chain as a priced mainnet for this test (the harness marks it as a testnet)
    const overlay = join(home, "cache", "registry", "overlay.json");
    const o = JSON.parse(readFileSync(overlay, "utf8"));
    o.chains = o.chains.map((c: any) => ({ ...c, testnet: false }));
    writeFileSync(overlay, JSON.stringify(o));
    const ctx = testContext(home, agent);
    const r: any = await run(ctx, "funding suggest", {});
    expect(r.data.address).toBe(agent.address);
    expect(Number(r.data.deploymentCost)).toBeGreaterThan(0);
    expect(Number(r.data.starter.amount)).toBeGreaterThanOrEqual(Number(r.data.deploymentCost) * 1.5);
    expect(Number(r.data.more.amount)).toBeGreaterThan(Number(r.data.starter.amount));
    expect(r.data.priceUsd).toBe(2500);
    {
      expect(priceCalls).toBeGreaterThan(0);
      expect(r.data.starter.usd).toBeGreaterThanOrEqual(1);
      expect(r.data.more.usd).toBeGreaterThanOrEqual(10);
      expect(r.text).toMatch(/\(about \$/);
    }
    expect(r.text).toMatch(/Please send about .+ to my address 0x[0-9a-fA-F]{40} \(QR attached\)/);
    expect(r.text).toMatch(/you never have to sign anything/);
    await h.fund(agent.address, parseEther("1"));
    const after: any = await run(ctx, "funding suggest", {});
    expect(after.data.balance).toBe("1");
  });

  it("testnets get coin amounts without any dollar claim", async () => {
    const ctx = testContext(h.newHome(), testSigner(generatePrivateKey()));
    const before = priceCalls;
    const r: any = await run(ctx, "funding suggest", {});
    expect(r.data.priceUsd).toBeUndefined();
    expect(r.data.starter.usd).toBeUndefined();
    expect(r.text).not.toMatch(/\$/);
    expect(r.text).toMatch(/test coins/);
    expect(priceCalls).toBe(before);
  });

  it("Ethereum mainnet gets a $2–$10 range; refill mode reports the balance with its dollar value", async () => {
    const { starterUsd } = await import("../../src/chain/funding.ts");
    expect(starterUsd(1)).toEqual({ min: 2, max: 10 });
    expect(starterUsd(42)).toEqual({ min: 1, max: 1 });
    const agent = testSigner(generatePrivateKey());
    const home = h.newHome();
    const overlay = join(home, "cache", "registry", "overlay.json");
    const o = JSON.parse(readFileSync(overlay, "utf8"));
    o.chains = o.chains.map((c: any) => ({ ...c, testnet: false }));
    writeFileSync(overlay, JSON.stringify(o));
    const ctx = testContext(home, agent);
    await h.fund(agent.address, parseEther("0.0001"));
    const r: any = await run(ctx, "funding suggest", { purpose: "refill" });
    expect(r.text).toMatch(/^I'm running low on gas on .+: I have .+ ETH \(about \$0\.25\) left\./);
    expect(r.text).toMatch(/Could you top me up with about .+ ETH \(about \$[0-9.]+\) to my address 0x[0-9a-fA-F]{40} \(QR attached\)/);
    expect(r.data.balanceUsd).toBe(0.25);
    expect(r.data.low).toBe(true);
    await h.fund(agent.address, parseEther("1")); // now plenty
    const ok: any = await run(ctx, "funding suggest", { purpose: "refill" });
    expect(ok.data.low).toBe(false);
    expect(ok.text).toMatch(/that's enough for now, no top-up needed\./);
    expect(ok.text).not.toMatch(/running low/);
  });
});
