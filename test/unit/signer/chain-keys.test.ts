// Per-chain controller keys through the key verbs: key activate --chain, key address,
// key backup selection. Keys are permanent: switching keeps the previous key listed. fakeContext resolves every --chain to 42.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coerceArgs } from "../../../src/core/verbs.ts";
import type { VerbDef } from "../../../src/core/types.ts";
import { internalBackend } from "../../../src/signer/index.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import { initVerb, keyActivateVerb, keyAddressVerb, keyNewCandidateVerb, readCandidates } from "../../../src/signer/verbs.ts";
import { assertNoSecret, catchErr, fakeContext, tempHome } from "./helpers.ts";

const run = (v: VerbDef, ctx: any, raw: Record<string, unknown> = {}) => v.run(ctx, coerceArgs(v, raw));

let home: Awaited<ReturnType<typeof tempHome>>;
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };

beforeEach(async () => {
  home = await tempHome();
  process.env.UP_HOME = home.dir;
  process.env.UP_TEST_EPHEMERAL_KEY = "1";
  resetMemoryBackend();
});
afterEach(async () => {
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await home.cleanup();
});

async function setup() {
  const f = fakeContext(home.dir, { approval: "human: yes" });
  const def = ((await run(initVerb, f.ctx, { backend: "memory" })).data as any).address as string;
  const cand = ((await run(keyNewCandidateVerb, f.ctx)).data as any).address as string;
  return { ...f, def, cand };
}

describe("key activate --chain: one chain only", () => {
  it("needs the human; switches only that chain; the default key stays", async () => {
    const { ctx, getConfig, def, cand } = await setup();
    const plain = fakeContext(home.dir, {}, getConfig());
    const denied = await catchErr(run(keyActivateVerb, plain.ctx, { address: cand, chain: "42" }));
    expect(denied.code).toBe("CONSENT_REQUIRED");
    expect(plain.consents[0]).toMatchObject({ verb: "key activate", risk: "secret", chainId: 42 });
    const r = await run(keyActivateVerb, ctx, { address: cand, chain: "42" });
    expect(r.data).toMatchObject({ address: cand, chainId: 42, scope: "chain", previous: def, changed: true });
    expect(r.text).toContain("every other chain keeps its key");
    const cfg = getConfig();
    expect(cfg.controller!.address).toBe(def);
    expect(cfg.chainControllers).toEqual({ "42": expect.objectContaining({ address: cand, backend: "memory" }) });
    expect(cfg.previousControllers).toBeUndefined();
    expect(await readCandidates(home.dir)).toEqual([]);
    const noop = await run(keyActivateVerb, ctx, { address: cand, chain: "42" });
    expect((noop.data as any).changed).toBe(false);
    assertNoSecret(r, await internalBackend("memory").exportPrivateKey!(cand as any));
  });

  it("a second own key for the chain keeps the first listed; activating the default key there makes the chain use the default again", async () => {
    const { ctx, getConfig, def, cand } = await setup();
    await run(keyActivateVerb, ctx, { address: cand, chain: "42" });
    const cand2 = ((await run(keyNewCandidateVerb, ctx)).data as any).address as string;
    await run(keyActivateVerb, ctx, { address: cand2, chain: "42" });
    let cfg = getConfig();
    expect(cfg.chainControllers!["42"].address).toBe(cand2);
    expect(cfg.previousControllers).toEqual([expect.objectContaining({ address: cand, chainId: 42 })]);
    const back = await run(keyActivateVerb, ctx, { address: def, chain: "42" });
    expect(back.data).toMatchObject({ scope: "default", changed: true });
    expect(back.text).toContain(`uses its default key ${def} again`);
    cfg = getConfig();
    expect(cfg.chainControllers).toBeUndefined();
    expect(cfg.previousControllers!.map((x) => x.address)).toEqual([cand, cand2]);
    // nothing deleted: every key is still in the store
    for (const a of [def, cand, cand2]) expect(await internalBackend("memory").has(a as any)).toBe(true);
  });

  it("switching the default key keeps chain keys and the previous default; a chain whose key becomes the default just uses the default", async () => {
    const { ctx, getConfig, def, cand } = await setup();
    await run(keyActivateVerb, ctx, { address: cand, chain: "42" });
    const r = await run(keyActivateVerb, ctx, { address: cand }); // the chain key becomes the default
    expect((r.data as any).chainControllers).toEqual([]);
    const cfg = getConfig();
    expect(cfg.controller!.address).toBe(cand);
    expect(cfg.chainControllers).toBeUndefined();
    expect(cfg.previousControllers!.map((x) => x.address)).toEqual([def]);
  });

  it("refuses a key that is not in the store", async () => {
    const { ctx } = await setup();
    const e = await catchErr(run(keyActivateVerb, ctx, { address: "0x" + "ab".repeat(20), chain: "42" }));
    expect(e.code).toBe("NO_SIGNER");
  });
});

describe("chain-agnostic key verbs report the default key plus per-chain keys", () => {
  it("key address: default (old shape kept) + chainControllers; --chain gives the key used there", async () => {
    const { ctx, def, cand } = await setup();
    const before = await run(keyAddressVerb, ctx);
    expect(before.data).toMatchObject({ address: def, backend: "memory", level: "ephemeral", chainControllers: [] });
    expect(before.text).toBe(`${def} (memory)\nOther keys of the agent (kept in their store, never deleted): ${cand} (memory, not used yet)`);
    await run(keyActivateVerb, ctx, { address: cand, chain: "42" });
    const after = await run(keyAddressVerb, ctx);
    expect(after.data).toMatchObject({ address: def, default: { address: def }, chainControllers: [{ chainId: 42, address: cand, backend: "memory" }] });
    expect(after.text).toContain(`chain 42 → ${cand} (memory)`);
    const onChain = await run(keyAddressVerb, ctx, { chain: "42" });
    expect(onChain.data).toMatchObject({ address: cand, chainId: 42, scope: "chain" });
  });
});
