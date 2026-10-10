import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../../src/verbs/index.ts";
import { getVerb } from "../../../src/core/verbs.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import { fakeContext, tempHome } from "../signer/helpers.ts";
import { testContext } from "../../support/context.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

let home: Awaited<ReturnType<typeof tempHome>>;
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY, host: process.env.UP_AGENT_HOST };

beforeEach(async () => {
  home = await tempHome();
  process.env.UP_HOME = home.dir;
  process.env.UP_TEST_EPHEMERAL_KEY = "1";
  delete process.env.UP_AGENT_HOST;
  resetMemoryBackend();
});
afterEach(async () => {
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph], ["UP_AGENT_HOST", saved.host]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await home.cleanup();
});

// Words a non-technical human should never see in `say`.
const JARGON = /(`|\bup (start|init|doctor|config)\b|\bnode\b|\bscripts?\b|\.mjs|\bnpm\b|\bcli\b|\bjson\b|\bbackend\b|\bcontroller key\b|\bconfig\b|--|\bkeychain\b|protected-file|\btestnet\b)/i;

describe("start", () => {
  it("fresh machine: creates the agent's key without asking anything and returns a plain three-choice welcome", async () => {
    const { ctx, consents } = fakeContext(home.dir);
    const r: any = await getVerb("start")!.run(ctx, {});
    expect(consents).toEqual([]);
    expect(r.data).toMatchObject({ stage: "choose-path", ready: true, keyCreated: true });
    expect(r.data.controller).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const say: string = r.data.say;
    expect(say).toMatch(/How would you like to do it\?/);
    expect(say).toMatch(/1\. Create my own account/);
    expect(say).toMatch(/2\. Create it with the Universal Relayer/);
    expect(say).toMatch(/3\. Use a Universal Profile you already have/);
    expect(say).toMatch(/I recommend option 1, starting on LUKSO\. I can also add .+ at any time\./);
    expect(say).not.toMatch(JARGON);
    expect(say).not.toContain(r.data.controller); // no addresses before they are needed
    expect(r.data.next.join(" ")).toMatch(/never mention commands/);
  });

  it("is idempotent: a second run keeps the same key", async () => {
    const { ctx } = fakeContext(home.dir);
    const first: any = await getVerb("start")!.run(ctx, {});
    const second: any = await getVerb("start")!.run(ctx, {});
    expect(second.data.keyCreated).toBe(false);
    expect(second.data.controller).toBe(first.data.controller);
  });

  it("with a profile already configured it offers help in plain words instead of onboarding again", async () => {
    writeFileSync(join(home.dir, "config.json"), JSON.stringify({ version: 1, defaultProfile: "0xCDeC110F9c255357E37f46CD2687be1f7E9B02F7", chains: [42, 8453] }));
    const ctx = testContext(home.dir); // real registry for chain names
    const r: any = await getVerb("start")!.run(ctx, {});
    expect(r.data.stage).toBe("ready");
    expect(r.data.say).toBe("My Universal Profile is set up on LUKSO and Base. What would you like me to do?");
    expect(r.data.say).not.toMatch(JARGON);
  });

  it("names the recommended networks after LUKSO from the registry", async () => {
    const ctx = testContext(home.dir);
    const r: any = await getVerb("start")!.run(ctx, {});
    expect(r.data.say).toContain("I recommend option 1, starting on LUKSO. I can also add Ethereum, Base, Arbitrum One, BNB Smart Chain and Polygon at any time.");
  });

  it("--host records the cloud agent VM for key storage", async () => {
    const { ctx } = fakeContext(home.dir);
    await getVerb("start")!.run(ctx, { host: "dots" });
    expect(process.env.UP_AGENT_HOST).toBe("dots");
  });

  it("test mode never writes into a real OS key store", async () => {
    const { chooseBackend } = await import("../../../src/signer/index.ts");
    expect((await chooseBackend("auto")).id).toBe("memory");
  });
});
