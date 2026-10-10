// Profile metadata (LSP3) end-to-end on the local chain: J1 deploy → dry-run → consent →
// upload images + JSON to a mock IPFS node (Kubo API + gateway) → fetch-back verification →
// setData(LSP3Profile) as the profile → stored VerifiableURI decodes to the uploaded JSON;
// merge / remove / no-op; fail-closed paths (hash mismatch, unverifiable current metadata,
// missing permission, not deployed, no provider); profile join's "ask for metadata" flag.
// The product default metadata chain is LUKSO mainnet (42); here it is pointed at the
// local chain through the test hook, and profile.link is a mock (no external service).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, keccak256, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { ERC725 } from "@erc725/erc725.js";
import { LSP3Schema } from "@erc725/erc725.js/schemas";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, runVerb, startMockRelayer } from "../support/mock-relayer.ts";
import { paths } from "../../src/core/home.ts";
import { startMockIpfs, type MockIpfs } from "../support/mock-ipfs.ts";
import { pngBytes, webpLossy, SVG } from "../support/images.ts";
import "../../src/lsp/verbs.ts";
import "../../src/verbs/setup.ts";
import "../../src/relayer/verbs.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { DATA_KEYS } from "../../src/lsp/constants.ts";
import { METADATA_DEFAULT_CHAIN_ID, metadataHooks, setMetadataHooksForTests } from "../../src/lsp/metadata.ts";

const run = runVerb;

let h: Harness;
let ipfs: MockIpfs;
let signer: Signer;
let ctx: VerbContext;
let home: string;
let profile: Address;
let files: { png: string; webp: string; svg: string; dir: string };
const profileLinkCalls: string[] = [];
/** Any request to a non-loopback host during this suite (must stay empty: no real external service is contacted). */
const external: string[] = [];
const realFetch = globalThis.fetch;

/** fetch used by the metadata verbs: profile.link is mocked, everything else (the local mock IPFS) is real. */
const routedFetch = async (url: string, init?: RequestInit) => {
  if (url.startsWith("https://profile.link/")) {
    profileLinkCalls.push(url);
    const addr = url.split("/")[3].toLowerCase();
    return new Response(JSON.stringify({ address: addr, checksummed: getAddress(addr), name: "agent-test", resolved: "agent-test", link: "https://profile.link/agent-test%40" + addr.slice(2, 6) }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return globalThis.fetch(url, init);
};

function guardFetch() {
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!/^http:\/\/127\.0\.0\.1[:/]/.test(url)) {
      external.push(url);
      throw new Error(`external request blocked in tests: ${url}`);
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

async function configureIpfs(c: VerbContext) {
  await run(c, "config set", { key: "ipfs-provider", value: "kubo" });
  await run(c, "config set", { key: "kubo-url", value: ipfs.url });
  await run(c, "config set", { key: "ipfs-gateway", value: ipfs.gateway });
}

/** Consented actions of this verb recorded in the local audit log of `home`. */
const auditCount = (home: string) => (existsSync(paths.audit(home)) ? readFileSync(paths.audit(home), "utf8").split("\n").filter((l) => l.includes('"action":"profile metadata set"')).length : 0);

const lsp3Raw = async (p: Address = profile): Promise<Hex> => (await run(ctx, "account data get", { key: "LSP3Profile", profile: p })).data.raw;

beforeAll(async () => {
  h = await getHarness();
  guardFetch();
  ipfs = await startMockIpfs();
  process.env.UP_IPFS_BACKOFF_MS = "1";
  setMetadataHooksForTests({ defaultChainId: h.chainId, luksoAliases: { [h.chainId]: "mainnet" }, env: {}, fetch: routedFetch as any });
  signer = testSigner(generatePrivateKey());
  await h.fund(signer.address, parseEther("10"));
  home = h.newHome();
  ctx = testContext(home, signer, { approval: "human: yes, publish my profile name and pictures" });
  await configureIpfs(ctx);
  const dir = mkdtempSync(join(tmpdir(), "up-img-"));
  files = { png: join(dir, "me.png"), webp: join(dir, "cover.webp"), svg: join(dir, "logo.svg"), dir };
  writeFileSync(files.png, pngBytes(256, 256, 7));
  writeFileSync(files.webp, webpLossy(1500, 500));
  writeFileSync(files.svg, SVG);
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  expect(external).toEqual([]);
  setMetadataHooksForTests();
  delete process.env.UP_IPFS_BACKOFF_MS;
  await ipfs?.close();
});

beforeEach(() => ipfs.reset());

describe("J1: a freshly deployed profile is offered profile metadata", () => {
  it("the product default metadata chain is LUKSO mainnet; this suite points the hook at the local chain", () => {
    expect(METADATA_DEFAULT_CHAIN_ID).toBe(42);
    expect(metadataHooks().defaultChainId).toBe(h.chainId);
  });

  it("account deploy on the metadata chain returns next: ask the human for name/pictures (optional)", async () => {
    const pre = await run(ctx, "account precompute", { count: 1 });
    const r = await run(ctx, "account deploy", { seed: pre.data.seed, candidate: 0 });
    expect(r.data.status).toBe("deployed");
    profile = r.data.profile;
    expect(r.data.next[0]).toMatch(/profile name, description, profile picture and background image/);
    expect(r.text).toMatch(/up profile metadata set/);
    expect(await lsp3Raw()).toBe("0x");
  });

  it("profile metadata show on a profile without metadata suggests asking the human", async () => {
    const r = await run(ctx, "profile metadata show", {});
    expect(r.data).toMatchObject({ chainId: h.chainId, defaultChain: true, deployed: true, hasMetadata: false });
    expect(r.text).toMatch(/no profile metadata/);
    expect(r.data.suggest).toMatch(/profile metadata set/);
  });
});

describe("profile metadata set", () => {
  const inputs = () => ({ name: "Ada", description: "Research agent.\nSecond line.", links: "Website=https://example.com,X=https://x.com/ada", tags: "agent,research", "profile-image": files.png, "background-image": files.webp });

  it("--dry-run: full summary, previews, simulation on the metadata chain; nothing uploaded, signed or sent", async () => {
    const nonce = await h.request("eth_getTransactionCount", [signer.address, "latest"]);
    const r: any = await run(testContext(home, signer, { dryRun: true }), "profile metadata set", inputs());
    expect(r.data.dryRun).toBe(true);
    expect(r.data.chainId).toBe(h.chainId);
    expect(r.data.simulation).toMatchObject({ path: "km", status: "dry-run" });
    expect(r.data.providerReady).toBe(true);
    expect(r.data.changed.sort()).toEqual(["backgroundImage", "description", "links", "name", "profileImage", "tags"]);
    const up = r.data.confirmation.uploads;
    expect(up[0]).toMatchObject({ what: "profile image", width: 256, height: 256, type: "image/png", source: "file", file: "me.png" });
    expect(up[1]).toMatchObject({ what: "background image", width: 1500, height: 500, type: "image/webp" });
    expect(r.data.confirmation.publicForever).toMatch(/public/);
    expect(r.data.confirmation.chainChoice).toMatch(/default/);
    expect(r.media.map((m: any) => m.mimeType).sort()).toEqual(["image/png", "image/webp"]);
    expect(r.text).toMatch(/DRY RUN — nothing uploaded, signed or sent/);
    expect(ipfs.uploads).toHaveLength(0);
    expect(await h.request("eth_getTransactionCount", [signer.address, "latest"])).toBe(nonce);
    expect(await lsp3Raw()).toBe("0x");
  });

  it("without approval or policy: CONSENT_REQUIRED with the confirmation block, before any upload", async () => {
    const e = await run(testContext(home, signer, { yes: false }), "profile metadata set", inputs()).catch((x) => x);
    expect(e.code).toBe("CONSENT_REQUIRED");
    expect(e.details.confirmation.uploads).toHaveLength(3);
    expect(ipfs.uploads).toHaveLength(0);
  });

  it("uploads images + JSON, verifies each through the gateway, writes LSP3Profile as the profile, returns the profile URL", async () => {
    const audits = auditCount(home);
    const r: any = await run(ctx, "profile metadata set", inputs());
    expect(auditCount(home)).toBe(audits + 1); // one consent covers the uploads and the write
    expect(r.data.status).toBe("success");
    expect(r.data.path).toBe("km");
    // 2 images + 1 JSON, all to the Kubo API; each one fetched back through the gateway
    expect(ipfs.uploads.map((u) => u.files[0].filename)).toEqual(["profileImage.png", "backgroundImage.webp", "LSP3Profile.json"]);
    const cids = r.data.uploaded.map((u: any) => u.url.slice("ipfs://".length));
    expect(ipfs.gets).toEqual(cids);
    // the stored value decodes (erc725.js) to the uploaded JSON's URL and keccak256
    const raw = await lsp3Raw();
    expect(raw).toBe(r.data.value);
    const decoded = ERC725.decodeData([{ keyName: "LSP3Profile", value: raw }], LSP3Schema as any)[0].value as any;
    expect(decoded.url).toBe(r.data.metadataUrl);
    const jsonBytes = ipfs.store.get(decoded.url.slice(7))!;
    expect(decoded.verification).toEqual({ method: "keccak256(utf8)", data: keccak256(jsonBytes) });
    const json = JSON.parse(Buffer.from(jsonBytes).toString("utf8"));
    expect(json.LSP3Profile).toMatchObject({ name: "Ada", description: "Research agent.\nSecond line.", tags: ["agent", "research"], links: [{ title: "Website", url: "https://example.com" }, { title: "X", url: "https://x.com/ada" }], avatar: [] });
    const png = ipfs.uploads[0].files[0].bytes;
    expect(json.LSP3Profile.profileImage).toEqual([{ width: 256, height: 256, url: `ipfs://${cids[0]}`, verification: { method: "keccak256(bytes)", data: keccak256(png) } }]);
    expect(json.LSP3Profile.backgroundImage[0]).toMatchObject({ width: 1500, height: 500, url: `ipfs://${cids[1]}` });
    expect(r.data.stored.verified).toBe(true);
    expect(r.data.profileUrl).toMatchObject({ source: "profile.link", url: `https://profile.link/agent-test@${profile.slice(2, 6).toLowerCase()}` });
    expect(profileLinkCalls.at(-1)).toBe(`https://profile.link/${profile}/resolve`);
    expect(r.text).toMatch(/Profile metadata updated/);
    expect(r.text).toMatch(/Profile page: https:\/\/profile\.link\//);
  });

  it("profile metadata show verifies the JSON hash and (with --verify-images) every image", async () => {
    const r: any = await run(ctx, "profile metadata show", { "verify-images": true });
    expect(r.data).toMatchObject({ hasMetadata: true, hashCheck: "match", metadata: { name: "Ada", tags: ["agent", "research"] } });
    expect(r.data.imageChecks.map((c: any) => c.hashCheck)).toEqual(["match", "match"]);
    expect(r.data.untrusted).toMatch(/UNTRUSTED/);
    expect(r.text).toMatch(/hash verified/);
    expect(r.data.profileUrl.url).toMatch(/^https:\/\/profile\.link\/agent-test@/);
  });

  it("profile url", async () => {
    const r: any = await run(ctx, "profile url", {});
    expect(r.data).toMatchObject({ chainId: h.chainId, source: "profile.link", universalEverything: `https://universaleverything.io/${profile}?network=mainnet` });
  });

  it("merge (default): only the given field changes; images keep their URLs; only the JSON is uploaded", async () => {
    const before = JSON.parse(Buffer.from(ipfs.store.get(ERC725.decodeData([{ keyName: "LSP3Profile", value: await lsp3Raw() }], LSP3Schema as any)[0].value.url.slice(7))!).toString());
    const r: any = await run(ctx, "profile metadata set", { description: "Updated." });
    expect(r.data.changed).toEqual(["description"]);
    expect(ipfs.uploads).toHaveLength(1);
    expect(r.data.metadata.LSP3Profile).toEqual({ ...before.LSP3Profile, description: "Updated." });
  });

  it("--remove background-image deletes it; repeating the same values is a no-op without upload or transaction", async () => {
    const r: any = await run(ctx, "profile metadata set", { remove: ["background-image"] });
    expect(r.data.metadata.LSP3Profile.backgroundImage).toEqual([]);
    expect(r.data.metadata.LSP3Profile.name).toBe("Ada");
    ipfs.reset();
    const nonce = await h.request("eth_getTransactionCount", [signer.address, "latest"]);
    const same: any = await run(ctx, "profile metadata set", { name: "Ada" });
    expect(same.data.changed).toBe(false);
    expect(same.text).toMatch(/Nothing to change/);
    expect(ipfs.uploads).toHaveLength(0);
    expect(await h.request("eth_getTransactionCount", [signer.address, "latest"])).toBe(nonce);
  });

  it("an image already on IPFS (ipfs://) is verified through the gateway and not uploaded again", async () => {
    const cur = await run(ctx, "profile metadata show", {});
    const imgUrl = cur.data.metadata.profileImage[0].url;
    ipfs.reset();
    const r: any = await run(ctx, "profile metadata set", { "background-image": imgUrl });
    expect(ipfs.uploads.map((u) => u.files[0].filename)).toEqual(["LSP3Profile.json"]);
    expect(r.data.metadata.LSP3Profile.backgroundImage[0]).toMatchObject({ url: imgUrl, width: 256, height: 256 });
  });

  it("refuses SVG and contradicting flags before anything happens", async () => {
    const e = await run(ctx, "profile metadata set", { "profile-image": files.svg }).catch((x) => x);
    expect(e.code).toBe("BAD_ARGS");
    expect(e.hint).toMatch(/PNG/);
    const c = await run(ctx, "profile metadata set", { name: "x", remove: ["name"] }).catch((x) => x);
    expect(c.message).toMatch(/contradict/);
    expect(ipfs.uploads).toHaveLength(0);
  });
});

describe("fail closed", () => {
  it("current metadata that does not match its on-chain hash cannot be merged (nothing uploaded)", async () => {
    const before = await lsp3Raw();
    ipfs.mode.corrupt = true;
    const e = await run(ctx, "profile metadata set", { name: "Mallory" }).catch((x) => x);
    expect(e.code).toBe("IPFS_ERROR");
    expect(e.details.reason).toBe("existing-unverified");
    expect(e.hint).toMatch(/--replace/);
    expect(ipfs.uploads).toHaveLength(0);
    expect(await lsp3Raw()).toBe(before);
  });

  it("a fetch-back hash mismatch after upload stops before the write (value unchanged)", async () => {
    const before = await lsp3Raw();
    ipfs.mode.corrupt = true;
    const e = await run(ctx, "profile metadata set", { name: "Fresh", replace: true }).catch((x) => x);
    expect(e.code).toBe("IPFS_ERROR");
    expect(e.details.reason).toBe("verification-failed");
    expect(ipfs.uploads).toHaveLength(1);
    // the file is public now: it is reported (unverified), never silently orphaned
    expect(e.details.uploaded).toEqual([expect.objectContaining({ what: "metadata JSON", verified: false })]);
    expect(e.hint).toMatch(/sent to IPFS, public: metadata JSON ipfs:\/\//);
    expect(await lsp3Raw()).toBe(before);
  });

  it("a concurrent change of LSP3Profile while preparing a merge stops the write (nothing overwritten)", async () => {
    const before = await lsp3Raw();
    const other = { json: { LSP3Profile: { name: "changed elsewhere" } }, url: "ipfs://QmElsewhere" };
    ipfs.mode.beforeUploadResponse = async (rec) => {
      if (rec.files[0]?.filename === "LSP3Profile.json") await run(ctx, "account data set", { key: "LSP3Profile", value: other });
    };
    const e = await run(ctx, "profile metadata set", { description: "racing" }).catch((x) => x);
    expect(e.code).toBe("TX_FAILED");
    expect(e.details.reason).toBe("concurrent-change");
    expect(e.details.uploaded.map((u: any) => u.what)).toEqual(["metadata JSON"]);
    const now = ERC725.decodeData([{ keyName: "LSP3Profile", value: await lsp3Raw() }], LSP3Schema as any)[0].value as any;
    expect(now.url).toBe("ipfs://QmElsewhere");
    ipfs.mode.beforeUploadResponse = undefined;
    await run(ctx, "account data set", { key: "LSP3Profile", value: before }); // restore for the following tests
  });

  it("no upload provider configured: dry-run says so; the real run fails with the configuration options, before any upload", async () => {
    const bare = testContext(h.newHome(), signer, { approval: "human: approved" });
    await run(bare, "config set", { key: "ipfs-gateway", value: ipfs.gateway }); // reads stay on the mock; no upload credentials
    const dry: any = await run(testContext(bare.home, signer, { dryRun: true }), "profile metadata set", { profile, name: "Ada 2" });
    expect(dry.data.providerReady).toBe(false);
    expect(dry.warnings.join()).toMatch(/no IPFS upload provider/);
    const e = await run(bare, "profile metadata set", { profile, name: "Ada 2" }).catch((x) => x);
    expect(e.code).toBe("IPFS_ERROR");
    expect(e.details.reason).toBe("no-upload-credentials");
    expect(e.hint).toMatch(/UP_IPFS_UPLOAD_KEY/);
    expect(ipfs.uploads).toHaveLength(0);
  });

  it("not deployed on the metadata chain: NOT_DEPLOYED explaining the LUKSO default and the explicit --chain option", async () => {
    const e = await run(ctx, "profile metadata set", { profile: "0x00000000000000000000000000000000DeaDBeef", name: "x" }).catch((x) => x);
    expect(e.code).toBe("NOT_DEPLOYED");
    expect(e.message).toMatch(/LUKSO mainnet by default/);
    expect(e.hint).toMatch(/explicitly .* --chain/);
  });

  it("an explicit --chain other than the metadata chain is reported as such", async () => {
    setMetadataHooksForTests({ ...metadataHooks(), defaultChainId: 4242 });
    try {
      const r: any = await run(testContext(home, signer, { dryRun: true }), "profile metadata set", { chain: String(h.chainId), name: "Elsewhere" });
      expect(r.data.confirmation.chainChoice).toBe("explicit --chain");
      expect(r.warnings.join()).toMatch(/not on LUKSO mainnet/);
    } finally {
      setMetadataHooksForTests({ ...metadataHooks(), defaultChainId: h.chainId });
    }
  });
});

describe("permission to write LSP3Profile", () => {
  let op: Signer;
  let opCtx: VerbContext;
  beforeAll(async () => {
    op = testSigner(generatePrivateKey());
    await h.fund(op.address, parseEther("1"));
    opCtx = testContext(h.newHome(), op, { approval: "human: approved" });
    await configureIpfs(opCtx);
    await run(ctx, "controller add", { address: op.address, permissions: ["SETDATA"] });
  });

  it("SETDATA without an allowed LSP3Profile key: NOT_AUTHORISED naming the exact grant; nothing uploaded", async () => {
    const e = await run(opCtx, "profile metadata set", { profile, name: "op" }).catch((x) => x);
    expect(e.code).toBe("NOT_AUTHORISED");
    expect(e.message).toMatch(/LSP3Profile/);
    expect(e.hint).toContain(`up allowed-keys set ${op.address} --keys LSP3Profile`);
    expect(e.hint).not.toMatch(/--add SETDATA/); // it already has SETDATA
    expect(ipfs.uploads).toHaveLength(0);
  });

  it("after the human allows LSP3Profile the same key can set metadata", async () => {
    await run(ctx, "allowed-keys set", { controller: op.address, keys: ["LSP3Profile"] });
    const r: any = await run(opCtx, "profile metadata set", { profile, tags: "operator" });
    expect(r.data.status).toBe("success");
    expect(r.data.metadata.LSP3Profile).toMatchObject({ name: "Ada", tags: ["operator"] }); // merged: the failed --replace above changed nothing
  });
});

describe("relay path (gasless for the agent)", () => {
  it("auto picks the relayer; one consent; the unfunded agent pays nothing", async () => {
    const human = testSigner(generatePrivateKey());
    await h.fund(human.address, parseEther("5"));
    const agent = testSigner(generatePrivateKey()); // never funded
    const m = await deployProfileFor(testContext(h.newHome(), human, {}), human, h.chainId, { controller: agent.address });
    const relayer = await startMockRelayer({ request: h.request, chainId: h.chainId, relayerAccount: h.accounts[1], chainIdRequired: true });
    try {
      const actx = testContext(h.newHome(), agent, { approval: "human: yes, set it via the relayer" });
      await configureIpfs(actx);
      await run(actx, "relayer add", { url: relayer.url, name: "mock" });
      const dry: any = await run(testContext(actx.home, agent, { dryRun: true }), "profile metadata set", { profile: m.profile, name: "Relayed" });
      expect(dry.data.simulation.path).toBe("relay");
      const r: any = await run(actx, "profile metadata set", { profile: m.profile, name: "Relayed", "profile-image": files.png });
      expect(r.data).toMatchObject({ path: "relay", status: "success" });
      expect(r.data.autoDecision.path).toBe("relay");
      expect(r.data.confirmation.profileMetadata.autoDecision.path).toBe("relay");
      expect(r.data.stored.verified).toBe(true);
      expect(BigInt(await h.request("eth_getBalance", [agent.address, "latest"]))).toBe(0n);
      expect(auditCount(actx.home)).toBe(1);
      expect(relayer.requests.some((x) => x.path === "POST /api/execute")).toBe(true);
    } finally {
      await relayer.close();
    }
  });
});

describe("J2: profile join flags a profile without metadata", () => {
  it("askHuman is true while LSP3Profile is empty and false once it is set", async () => {
    const human = testSigner(generatePrivateKey());
    await h.fund(human.address, parseEther("5"));
    const hctx = testContext(h.newHome(), human, { approval: "human: approved" });
    const m = await deployProfileFor(hctx, human, h.chainId);
    const agent = testSigner(generatePrivateKey());
    const actx = testContext(h.newHome(), agent, {});
    const r: any = await run(actx, "profile join", { address: m.profile });
    expect(r.data.metadata).toMatchObject({ chainId: h.chainId, deployed: true, hasMetadata: false, askHuman: true });
    expect(r.text).toMatch(/no profile metadata/);
    await run(hctx, "account data set", { profile: m.profile, key: "LSP3Profile", value: { json: { LSP3Profile: { name: "human" } }, url: "ipfs://QmHuman" } });
    const again: any = await run(actx, "profile join", { address: m.profile });
    expect(again.data.metadata).toMatchObject({ hasMetadata: true, askHuman: false });
    expect(again.text).not.toMatch(/no profile metadata/);
  });
});
