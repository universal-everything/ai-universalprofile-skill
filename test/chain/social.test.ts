// LSP26 social verbs on the local EVM: the canonical LSP26 runtime is placed at
// its mainnet address, the profile acts through the in-test "km" transport stub.
import { beforeAll, describe, expect, it } from "vitest";
import { decodeFunctionData, type Address } from "viem";
import { getHarness, type Harness } from "./harness.ts";
import { testContext } from "../support/context.ts";
import "../../src/social/verbs.ts";
import { coerceArgs, getVerb } from "../../src/core/verbs.ts";
import { LSP26_ABI } from "../../src/social/lsp26.ts";
import { controllerSigner, registerKmStub, setupProfile, type KmStub, type ProfileFixture } from "../unit/tokens/support/profile-fixture.ts";
import { LSP26_ADDRESS, LSP26_RUNTIME } from "../unit/social/support/lsp26-runtime.ts";
import type { VerbContext } from "../../src/core/types.ts";

let h: Harness;
let p: ProfileFixture;
let stub: KmStub;
let ctx: VerbContext;
let A: Address, B: Address, C: Address;

async function run(name: string, raw: Record<string, unknown>, c: VerbContext = ctx) {
  const v = getVerb(name)!;
  return v.run(c, coerceArgs(v, { profile: p.up, ...raw }));
}

beforeAll(async () => {
  h = await getHarness();
  p = await setupProfile(h);
  stub = registerKmStub(h, p);
  await h.request("hardhat_setCode", [LSP26_ADDRESS, LSP26_RUNTIME]);
  [A, B, C] = [h.accounts[3], h.accounts[4], h.accounts[5]];
  ctx = testContext(h.newHome(), controllerSigner(p), { yes: true });
}, 180_000);

describe("LSP26 follower system", () => {
  it("follow → is-following → idempotent re-follow", async () => {
    const r = (await run("follow", { address: A, via: "km" })) as any;
    expect(r.data).toMatchObject({ action: "follow", changed: true, followSystem: LSP26_ADDRESS });
    expect(r.data.outcome.status).toBe("success");
    expect(r.warnings.join(" ")).toMatch(/code hash matches/); // local chain is not in the bundled list
    const sent = stub.requests.at(-1)!;
    expect(sent.calls![0].to).toBe(LSP26_ADDRESS);
    expect(decodeFunctionData({ abi: LSP26_ABI(), data: sent.calls![0].data })).toMatchObject({ functionName: "follow", args: [A] });
    expect(((await run("is-following", { address: A })).data as any).isFollowing).toBe(true);
    const n = stub.requests.length;
    const again = (await run("follow", { address: A, via: "km" })).data as any;
    expect(again.changed).toBe(false);
    expect(stub.requests.length).toBe(n); // nothing sent
  });

  it("follow batch skips existing follows, self and duplicates", async () => {
    const r = (await run("follow batch", { addresses: [A, B, C, B, p.up], via: "km" })).data as any;
    expect(r.addresses).toEqual([B, C]);
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { address: A, reason: "already following" },
        { address: p.up, reason: "self" },
        { address: B, reason: "duplicate" },
      ]),
    );
    expect(decodeFunctionData({ abi: LSP26_ABI(), data: stub.requests.at(-1)!.calls![0].data })).toMatchObject({ functionName: "followBatch", args: [[B, C]] });
  });

  it("followers: counts and paged lists in both directions", async () => {
    const mine = (await run("followers", {})).data as any;
    expect(mine).toMatchObject({ followerCount: "0", followingCount: "3", following: [A, B, C], followers: [] });
    const paged = (await run("followers", { kind: "following", start: 1, limit: 1 })).data as any;
    expect(paged.following).toEqual([B]);
    const ofA = (await run("followers", { address: A, kind: "followers" })).data as any;
    expect(ofA).toMatchObject({ followerCount: "1", followers: [p.up] });
    const beyond = (await run("followers", { kind: "following", start: 10 })).data as any;
    expect(beyond.following).toEqual([]);
  });

  it("unfollow and unfollow batch", async () => {
    expect(((await run("unfollow", { address: A, via: "km" })).data as any).changed).toBe(true);
    expect(((await run("is-following", { address: A })).data as any).isFollowing).toBe(false);
    expect(((await run("unfollow", { address: A, via: "km" })).data as any).changed).toBe(false);
    const r = (await run("follow batch", { addresses: [`${B},${C}`, A], unfollow: true, via: "km" })).data as any;
    expect(r.addresses).toEqual([B, C]);
    expect(r.skipped).toEqual([{ address: A, reason: "not following" }]);
    expect(((await run("followers", { kind: "counts" })).data as any).followingCount).toBe("0");
  });

  it("refuses to follow itself and honours dry-run", async () => {
    await expect(run("follow", { address: p.up, via: "km" })).rejects.toThrow(/cannot follow itself/);
    const dry = testContext(ctx.home, controllerSigner(p), { dryRun: true });
    const r = (await run("follow", { address: C, via: "km" }, dry)).data as any;
    expect(r.outcome.status).toBe("dry-run");
    expect(((await run("is-following", { address: C })).data as any).isFollowing).toBe(false);
  });
});
