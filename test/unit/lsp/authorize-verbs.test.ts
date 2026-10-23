// permissions authorize-link / permissions check-grant without a chain: the link is made from the
// agent's PUBLIC address in config (the key store is never touched), dry runs write nothing, no key
// means no link (and no key is created), the human's profile is only included when given, and
// check-grant refuses links it cannot trust. On-chain checks: test/chain/authorize-link.test.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import "../../../src/lsp/verbs.ts";
import { getVerb, inputSchema, mcpToolName } from "../../../src/core/verbs.ts";
import { qrMatrix } from "../../../src/display/qr.ts";
import { testContext } from "../../support/context.ts";
import { runVerb } from "../../support/mock-relayer.ts";
import { renderResult } from "../../../src/core/output.ts";
import { toJson } from "../../../src/core/json.ts";
import type { VerbContext } from "../../../src/core/types.ts";

const AGENT = getAddress("0x5e1c0de0f9b12c2c3ab5a9c1f1b7d0d2a6e4b3c1");
const HUMAN_PROFILE = getAddress("0x9a3dbca554e9f6b9257aaa24010da8377c57c17e");
const OWN_PROFILE = getAddress("0x1234567890abcdef1234567890abcdef12345678");

/** Everything a verb returns goes through redact() before the CLI or MCP shows it: the link must reach the human unchanged. */
async function run(c: VerbContext, name: string, raw: Record<string, unknown> = {}) {
  const r = await runVerb(c, name, raw);
  const shown = JSON.parse(renderResult(name, r as any, true)).data;
  expect(shown, `${name}: redact() altered the result`).toEqual(JSON.parse(toJson(r.data)));
  return r;
}

let home: string;
let ctx: VerbContext;
const savedEnv = { ...process.env };

function homeWith(config: Record<string, unknown>): string {
  const h = mkdtempSync(join(tmpdir(), "up-authorize-"));
  writeFileSync(join(h, "config.json"), JSON.stringify({ version: 1, ...config }), { mode: 0o600 });
  return h;
}

function noKeyStore(c: VerbContext): VerbContext {
  (c as any).signer = async () => {
    throw new Error("the key store must not be touched to make a link");
  };
  return c;
}

beforeEach(() => {
  delete process.env.UP_AGENT_NAME;
  delete process.env.UP_AUTHORIZE_URL;
  home = homeWith({ controller: { address: AGENT, backend: "test", createdAt: "2026-10-23T00:00:00.000Z" }, defaultChain: 8453 });
  ctx = noKeyStore(testContext(home));
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("permissions authorize-link", () => {
  it("makes a LUKSO link from the public address in config, without the key store", async () => {
    const r = (await run(ctx, "permissions authorize-link", { for: ["social", "sign"], "bot-name": "Nova", purpose: "Follow artists for you" })) as any;
    expect(r.data.url.startsWith(`https://authorize.universalprofile.cloud/authorize?controller=${AGENT}&network=mainnet&name=Nova&purpose=Follow%20artists%20for%20you&permissions=CALL,SIGN,EXECUTE_RELAY_CALL&allowedCalls=0x`)).toBe(true);
    expect(r.data).toMatchObject({ granted: false, status: "link-ready", chainId: 42, network: "LUKSO", controller: { address: AGENT, source: "default key" } });
    expect(r.data.permissions.names).toEqual(["CALL", "SIGN", "EXECUTE_RELAY_CALL"]);
    expect(r.data.restrictions.allowedCalls.described).toHaveLength(4);
    expect(r.data.notGranted).toEqual(expect.arrayContaining(["CHANGEOWNER", "ADDCONTROLLER", "EDITPERMISSIONS"]));
    expect(r.data.connect.extension).toMatch(/Browser Extension/);
    expect(r.data.connect.mobileApp).toMatch(/Mobile Application/);
    expect(r.data.say).toContain(r.data.url);
    expect(r.data.say).toContain(AGENT.slice(-4));
    expect(r.data.say).not.toMatch(/up |--|controller key|EOA|LSP/);
    expect(r.data.next.join(" ")).toMatch(/permissions check-grant/);
    expect(r.text).toMatch(/nothing is granted/i);
  });

  it("attaches a QR code of the link and saves the request (public data only)", async () => {
    const r = (await run(ctx, "permissions authorize-link", { for: ["profile"] })) as any;
    expect(r.media).toHaveLength(1);
    expect(r.media[0].mimeType).toBe("image/png");
    expect(readFileSync(r.media[0].path).subarray(1, 4).toString()).toBe("PNG");
    expect(r.data.qr.version).toBe(qrMatrix(r.data.url, "L").version);
    const saved = JSON.parse(readFileSync(join(home, "authorize-requests.json"), "utf8"));
    expect(saved.requests).toHaveLength(1);
    expect(saved.requests[0]).toMatchObject({ url: r.data.url, chainId: 42, controller: AGENT, capabilities: ["profile"] });
    // public data only: exactly these fields, nothing taken from the key store
    expect(Object.keys(saved.requests[0]).sort()).toEqual(["allowedCalls", "allowedDataKeys", "capabilities", "chainId", "controller", "createdAt", "id", "permissions", "url"]);
    expect(r.data.saved).toMatchObject({ id: saved.requests[0].id });
  });

  it("writes nothing with --dry-run", async () => {
    const dry = noKeyStore(testContext(home, undefined, { dryRun: true }));
    const r = (await run(dry, "permissions authorize-link", { for: ["sign"] })) as any;
    expect(r.data.url).toContain("permissions=SIGN");
    expect(r.data.saved).toBeNull();
    expect(r.media ?? []).toEqual([]);
    expect(existsSync(join(home, "authorize-requests.json"))).toBe(false);
    expect(existsSync(join(home, "media"))).toBe(false);
  });

  it("needs the agent's own key and never creates one", async () => {
    const empty = homeWith({});
    const c = noKeyStore(testContext(empty));
    await expect(run(c, "permissions authorize-link", { for: ["sign"] })).rejects.toMatchObject({ code: "NO_SIGNER", hint: expect.stringMatching(/up start/) });
    expect(existsSync(join(empty, "keys"))).toBe(false);
    expect(JSON.parse(readFileSync(join(empty, "config.json"), "utf8"))).toEqual({ version: 1 });
  });

  it("uses the key the agent signs with on LUKSO when it has one", async () => {
    const perChain = getAddress("0x7777777777777777777777777777777777777777");
    const h = homeWith({ controller: { address: AGENT, backend: "test", createdAt: "x" }, chainControllers: { "42": { address: perChain, backend: "test", createdAt: "x" } } });
    const r = (await run(noKeyStore(testContext(h)), "permissions authorize-link", { for: ["sign"] })) as any;
    expect(r.data.controller).toMatchObject({ address: perChain, source: "key for LUKSO" });
    expect(r.data.url).toContain(`controller=${perChain}`);
  });

  it("includes the human's profile only when it is passed explicitly", async () => {
    const h = homeWith({ controller: { address: AGENT, backend: "test", createdAt: "x" }, defaultProfile: OWN_PROFILE });
    const c = noKeyStore(testContext(h));
    const without = (await run(c, "permissions authorize-link", { for: ["sign"] })) as any;
    expect(without.data.url).not.toContain("rofile=");
    expect(without.data.say).toMatch(/send me your profile address/i);
    const withProfile = (await run(c, "permissions authorize-link", { for: ["sign"], profile: HUMAN_PROFILE })) as any;
    expect(withProfile.data.url).toContain(`&forProfile=${HUMAN_PROFILE}`);
    expect(withProfile.data.profile).toBe(HUMAN_PROFILE);
  });

  it("refuses the agent's own profile (the human's profile is the one to authorise on)", async () => {
    mkdirSync(join(home, "profiles"), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, "profiles", `${OWN_PROFILE.toLowerCase()}.json`), JSON.stringify({ deployment: { kind: "lsp23-erc1167-up", profile: OWN_PROFILE } }), { mode: 0o600 });
    await expect(run(ctx, "permissions authorize-link", { for: ["sign"], profile: OWN_PROFILE })).rejects.toMatchObject({ code: "BAD_ARGS", message: expect.stringMatching(/own profile/) });
  });

  it("gives other networks the manual hand-over instead of a link", async () => {
    await expect(run(ctx, "permissions authorize-link", { for: ["sign"], chain: "8453" })).rejects.toMatchObject({ code: "NOT_SUPPORTED", hint: expect.stringMatching(/permissions recommend --chain 8453/) });
  });

  it("asks for capabilities instead of using a broad default", async () => {
    await expect(run(ctx, "permissions authorize-link", {})).rejects.toMatchObject({ code: "BAD_ARGS", hint: expect.stringMatching(/tokens, nfts, social, profile, pay/) });
  });

  it("uses the host's agent name when none is passed, and skips an unsafe one with a warning", async () => {
    process.env.UP_AGENT_NAME = "Nova";
    expect(((await run(ctx, "permissions authorize-link", { for: ["sign"] })) as any).data.url).toContain("name=Nova");
    process.env.UP_AGENT_NAME = "Nova https://example.org";
    const r = (await run(ctx, "permissions authorize-link", { for: ["sign"] })) as any;
    expect(r.data.url).not.toContain("name=");
    expect(r.warnings.join(" ")).toMatch(/UP_AGENT_NAME/);
  });

  it("refuses an unsafe explicit name", async () => {
    await expect(run(ctx, "permissions authorize-link", { for: ["sign"], "bot-name": `0x${"ab".repeat(32)}` })).rejects.toMatchObject({ code: "BAD_ARGS" });
  });

  it("points to a local copy of the website only through UP_AUTHORIZE_URL=http://localhost", async () => {
    process.env.UP_AUTHORIZE_URL = "http://localhost:3000";
    const r = (await run(ctx, "permissions authorize-link", { for: ["sign"] })) as any;
    expect(r.data.url.startsWith("http://localhost:3000/authorize?")).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/local copy/);
    process.env.UP_AUTHORIZE_URL = "https://evil.example";
    await expect(run(ctx, "permissions authorize-link", { for: ["sign"] })).rejects.toMatchObject({ code: "BAD_ARGS" });
  });
});

describe("permissions check-grant (offline refusals)", () => {
  it("needs a saved link or --request", async () => {
    await expect(run(ctx, "permissions check-grant", { profile: HUMAN_PROFILE })).rejects.toMatchObject({ code: "BAD_ARGS", hint: expect.stringMatching(/authorize-link/) });
  });

  it("refuses a link to another website", async () => {
    await expect(run(ctx, "permissions check-grant", { profile: HUMAN_PROFILE, request: `https://evil.example/authorize?controller=${AGENT}&network=mainnet&permissions=SIGN` })).rejects.toMatchObject({ code: "BAD_ARGS" });
  });

  it("needs the human's profile when the link does not name it", async () => {
    await run(ctx, "permissions authorize-link", { for: ["sign"] });
    await expect(run(ctx, "permissions check-grant", {})).rejects.toMatchObject({ code: "BAD_ARGS", message: expect.stringMatching(/profile/) });
  });

  it("refuses a profile that differs from the one the link was made for", async () => {
    await run(ctx, "permissions authorize-link", { for: ["sign"], profile: HUMAN_PROFILE });
    const saved = JSON.parse(readFileSync(join(home, "authorize-requests.json"), "utf8"));
    await expect(run(ctx, "permissions check-grant", { profile: OWN_PROFILE, request: saved.requests[0].url })).rejects.toMatchObject({ code: "BAD_ARGS", message: expect.stringMatching(/made for/) });
  });
});

describe("verb surface", () => {
  it("authorize-link is local (no network, no consent), check-grant is a read", () => {
    const link = getVerb("permissions authorize-link")!;
    const check = getVerb("permissions check-grant")!;
    expect(link.risk).toBe("local");
    expect(check.risk).toBe("read");
    expect(mcpToolName(link.name)).toBe("up_permissions_authorize_link");
    expect(mcpToolName(check.name)).toBe("up_permissions_check_grant");
    for (const v of [link, check]) {
      const s = inputSchema(v) as any;
      expect(s.type).toBe("object");
      for (const p of v.params) expect(p.description.length, `${v.name} --${p.name}`).toBeGreaterThan(10);
    }
  });
});
