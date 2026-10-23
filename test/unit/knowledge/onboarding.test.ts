import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const join_ = join;
import { getVerb, mcpToolName } from "../../../src/core/verbs.ts";
import { UNIVERSAL_RELAYER_CHAINS, UNIVERSAL_RELAYER_WEBSITE, onboardingPaths, onboardingText } from "../../../src/knowledge/onboarding.ts";
import { RECOMMENDED_CHAINS } from "../../../src/chain/recommended.ts";
import "../../../src/knowledge/onboarding.ts";
import { testContext, testSigner } from "../../support/context.ts";
import type { VerbContext } from "../../../src/core/types.ts";

let ctx: VerbContext;

beforeAll(() => {
  ctx = testContext(mkdtempSync(join(tmpdir(), "up-onboarding-")));
});

describe("onboarding options", () => {
  it("offers the three paths in order: own gas, Universal Relayer, existing profile", () => {
    const paths = onboardingPaths(ctx);
    expect(paths.map((p) => p.id)).toEqual(["self-funded", "universal-relayer", "existing-profile"]);
    expect(paths.map((p) => p.journey)).toEqual(["J1", "J2-relayer", "J2"]);
    for (const p of paths) {
      expect(p.title.length).toBeGreaterThan(10);
      expect(p.subtitle.length).toBeGreaterThan(30);
      expect(p.next.length).toBeGreaterThan(0);
    }
  });

  it("self-funded path says the human funds each network and no outside service is needed", () => {
    const [own] = onboardingPaths(ctx);
    expect(own.title).toMatch(/you provide the gas/);
    expect(own.subtitle).toMatch(/each network/);
    expect(own.subtitle).toMatch(/No outside service/);
  });

  it("Universal Relayer path names its networks from the registry and marks the missing link as a TODO", () => {
    const relayer = onboardingPaths(ctx)[1];
    expect(relayer.networks!.map((n) => n.chainId)).toEqual(UNIVERSAL_RELAYER_CHAINS);
    for (const name of ["LUKSO", "Ethereum", "Base", "BNB Smart Chain", "Arbitrum One", "Robinhood Chain", "Polygon", "Avalanche C-Chain"]) expect(relayer.subtitle).toContain(name);
    expect(relayer.subtitle).toMatch(/separate website with its own terms/);
    expect(UNIVERSAL_RELAYER_WEBSITE).toBeUndefined();
    expect(relayer.url).toBeUndefined();
    expect(relayer.todo).toMatch(/not published yet/);
    expect(onboardingText(onboardingPaths(ctx))).toContain("The website link is coming soon.");
  });

  it("existing profile path starts with the authorization link on LUKSO and keeps the manual hand-over elsewhere", () => {
    const existing = onboardingPaths(ctx)[2];
    expect(existing.next[0]).toMatch(/^up permissions authorize-link --for /);
    expect(existing.next).toEqual(expect.arrayContaining(["up permissions check-grant --profile <profileAddress>", "up profile join <profileAddress>", "up permissions recommend --chain <id>"]));
    expect(existing.subtitle).not.toMatch(/deploy|new profile/i);
  });

  it("shows the website once it is set", () => {
    const paths = onboardingPaths(ctx, "https://relayer.example/start");
    expect(paths[1]).toMatchObject({ url: "https://relayer.example/start" });
    expect(paths[1].todo).toBeUndefined();
    const text = onboardingText(paths);
    expect(text).toContain("https://relayer.example/start");
    expect(text).not.toContain("coming soon");
  });

  it("is a local verb with an MCP tool and ready-to-show text", async () => {
    const verb = getVerb("onboarding options")!;
    expect(verb.risk).toBe("local");
    expect(mcpToolName(verb.name)).toBe("up_onboarding_options");
    const r = await verb.run(ctx, {});
    expect((r.data as any).paths).toHaveLength(3);
    expect(r.text).toMatch(/^How should I get my Universal Profile\?/);
    expect(r.text).toMatch(/1\. Create my own account/);
    expect(r.text).toMatch(/2\. Create it with the Universal Relayer/);
    expect(r.text).toMatch(/3\. Use a Universal Profile you already have/);
  });
});

describe("onboarding on a fresh setup", () => {
  it("profile join without configured networks asks for them instead of checking stale ones", async () => {
    await import("../../../src/lsp/verbs.ts");
    const join = getVerb("profile join")!;
    const fresh = testContext(mkdtempSync(join_(tmpdir(), "up-onboarding-fresh-")), testSigner());
    await expect(join.run(fresh, { address: "0x0000000000000000000000000000000000000001" })).rejects.toMatchObject({
      code: "BAD_ARGS",
      message: "no chain selected",
      hint: expect.stringMatching(/up config set chains/),
    });
  });
});

describe("recommended networks", () => {
  it("chains list: mainnets only by default, recommended first with LUKSO on top; testnets only on request", async () => {
    await import("../../../src/verbs/setup.ts");
    const list = getVerb("chains list")!;
    const r: any = await list.run(ctx, {});
    const chains = r.data.chains as { chainId: number; testnet: boolean; recommended: boolean }[];
    expect(chains.every((c) => !c.testnet)).toBe(true);
    expect(r.data.recommended).toEqual([...RECOMMENDED_CHAINS]);
    expect(RECOMMENDED_CHAINS[0]).toBe(42);
    expect(chains.slice(0, RECOMMENDED_CHAINS.length).map((c) => c.chainId)).toEqual([...RECOMMENDED_CHAINS]);
    expect(chains.filter((c) => c.recommended)).toHaveLength(RECOMMENDED_CHAINS.length);
    expect(r.text.split("\n")[0]).toMatch(/^★ recommended: LUKSO, Ethereum/);
    expect(r.text).toMatch(/testnets only on request/);
    const t: any = await list.run(ctx, { testnets: true });
    expect(t.data.chains.length).toBeGreaterThan(0);
    expect(t.data.chains.every((c: any) => c.testnet)).toBe(true);
    const all: any = await list.run(ctx, { all: true });
    expect(all.data.count).toBe(r.data.count + t.data.count);
    const asked: any = await list.run(ctx, { filter: "4201" }); // an explicit request still finds LUKSO Testnet
    expect(asked.data.chains.map((c: any) => c.chainId)).toEqual([4201]);
  });

  it("onboarding options names the recommended networks, LUKSO first, and no testnet", async () => {
    const r: any = await getVerb("onboarding options")!.run(ctx, {});
    expect(r.data.recommendedNetworks.map((n: any) => n.chainId)).toEqual([...RECOMMENDED_CHAINS]);
    expect(r.text).toMatch(/Recommended networks: LUKSO, Ethereum, Base, Arbitrum One, BNB Smart Chain and Polygon \(LUKSO first\)\./);
    expect(r.text.toLowerCase()).not.toContain("testnet");
  });
});
