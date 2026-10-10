import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEther } from "viem";
import { displaySymbol, friendlyAmount, priceIdFor, priceUsd } from "../../../src/chain/funding.ts";
import { testContext } from "../../support/context.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("funding helpers", () => {
  it("shows rollup coins as ETH and maps native coins to price ids", () => {
    expect(displaySymbol("BaseETH")).toBe("ETH");
    expect(displaySymbol("ArbitrumOneETH")).toBe("ETH");
    expect(displaySymbol("LYX")).toBe("LYX");
    expect(priceIdFor("LYX")).toBe("lukso-token-2");
    expect(priceIdFor("BaseETH")).toBe("ethereum");
    expect(priceIdFor("BNB")).toBe("binancecoin");
    expect(priceIdFor("POL")).toBe("polygon-ecosystem-token");
    expect(priceIdFor("AVAX")).toBe("avalanche-2");
    expect(priceIdFor("xDAI")).toBe("usd");
    expect(priceIdFor("LYXt")).toBeUndefined(); // testnet coin: no fiat claim
    expect(priceIdFor("WEMIX")).toBeUndefined();
  });

  it("rounds amounts up to two significant digits", () => {
    expect(friendlyAmount(parseEther("4.19431"))).toBe("4.2");
    expect(friendlyAmount(parseEther("41.9431"))).toBe("42");
    expect(friendlyAmount(parseEther("0.000398"))).toBe("0.00040");
    expect(friendlyAmount(parseEther("0.00137"))).toBe("0.0014");
    expect(friendlyAmount(0n)).toBe("0");
  });

  it("fetches the price once, caches it for 10 minutes, keeps a stale price when the API fails, and makes no claim without one", async () => {
    const ctx = testContext(mkdtempSync(join(tmpdir(), "up-funding-")));
    let calls = 0;
    const ok = async (url: string) => {
      calls++;
      expect(url).toMatch(/^https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price\?ids=lukso-token-2&vs_currencies=usd$/);
      return json({ "lukso-token-2": { usd: 0.25 } });
    };
    const t0 = 1_000_000;
    expect(await priceUsd(ctx, "LYX", { fetch: ok, now: t0 })).toBe(0.25);
    expect(await priceUsd(ctx, "LYX", { fetch: ok, now: t0 + 60_000 })).toBe(0.25);
    expect(calls).toBe(1);
    const down = async () => json({ error: "rate limited" }, 429);
    expect(await priceUsd(ctx, "LYX", { fetch: down, now: t0 + 11 * 60_000 })).toBe(0.25); // stale beats nothing
    expect(await priceUsd(ctx, "WEMIX", { fetch: ok })).toBeUndefined();
    expect(await priceUsd(ctx, "xDAI", { fetch: ok })).toBe(1);
  });
});
