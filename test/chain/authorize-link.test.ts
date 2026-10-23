// The authorization-link hand-over end to end on the local EVM with the canonical LSP stack:
// the agent makes a link (grants nothing), the HUMAN's own key writes exactly what the link asks
// (the same LSP6 keys the website writes), check-grant compares on-chain state with the link,
// profile join takes over (no deployment), and the real Key Manager enforces the limits.
// Test keys only; nothing touches a real network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEther, type Address } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { getHarness, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import { deployProfileFor, initCodeFor, RECORDER_RUNTIME, runVerb } from "../support/mock-relayer.ts";
import { renderResult } from "../../src/core/output.ts";
import { toJson } from "../../src/core/json.ts";
import { LSP26_ADDRESS, LSP26_RUNTIME } from "../unit/social/support/lsp26-runtime.ts";
import "../../src/lsp/verbs.ts";
import { setAuthorizeHooksForTests } from "../../src/lsp/authorize-site.ts";
import "../../src/social/verbs.ts";
import "../../src/verbs/index.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";

let h: Harness;
let human: Signer;
let agent: Signer;
let humanCtx: VerbContext;
let agentCtx: VerbContext;
let profile: Address;
let link: any;
let other: Address;

/** Everything a verb returns goes through redact() before the CLI or MCP shows it: nothing may change there. */
async function run(c: VerbContext, name: string, raw: Record<string, unknown> = {}) {
  const r = await runVerb(c, name, raw);
  expect(JSON.parse(renderResult(name, r as any, true)).data, `${name}: redact() altered the result`).toEqual(JSON.parse(toJson(r.data)));
  return r;
}

const humanApproves = (what: string) => testContext(humanCtx.home, human, { approval: `human: ${what}` });
const agentWith = (approval: string) => testContext(agentCtx.home, agent, { approval });

beforeAll(async () => {
  h = await getHarness();
  // the website's network=mainnet is LUKSO (42) in the product; here it is the local chain
  setAuthorizeHooksForTests({ mainnetChainId: h.chainId });
  human = testSigner(generatePrivateKey());
  agent = testSigner(generatePrivateKey());
  for (const s of [human, agent]) await h.fund(s.address, parseEther("10"));
  await h.request("hardhat_setCode", [LSP26_ADDRESS, LSP26_RUNTIME]);
  other = await h.deployRaw(initCodeFor(RECORDER_RUNTIME));

  // the human's EXISTING profile, controlled by the human's own key
  humanCtx = testContext(h.newHome(), human, { approval: "human: set up my profile" });
  profile = (await deployProfileFor(humanCtx, human, h.chainId)).profile;
  const hc = await humanCtx.config();
  await humanCtx.saveConfig({ ...hc, defaultProfile: profile });

  // the agent knows only its own public address (as after `up start`)
  agentCtx = testContext(h.newHome(), agent, { yes: true });
  const cfg = await agentCtx.config();
  await agentCtx.saveConfig({ ...cfg, controller: { address: agent.address, backend: "test", createdAt: new Date().toISOString() } });
}, 180_000);

afterAll(() => setAuthorizeHooksForTests());

describe("authorization link on a local chain", () => {
  it("the link grants nothing: check-grant says not authorised yet", async () => {
    link = (await run(agentCtx, "permissions authorize-link", { for: ["social", "profile"], profile, "bot-name": "Nova" })).data;
    expect(link).toMatchObject({ granted: false, status: "link-ready", profile, chainId: h.chainId });
    expect(link.url).toContain("network=mainnet");
    const r = await run(agentCtx, "permissions check-grant", {});
    expect(r.data).toMatchObject({ status: "not-authorised", authorised: false, chainId: h.chainId });
  });

  it("the human writes exactly what the link asks: exact", async () => {
    const add = await run(humanApproves("add Nova with the link's permissions"), "controller add", {
      address: agent.address,
      permissions: link.permissions.names,
      "allowed-calls": link.restrictions.allowedCalls.entries,
      "allowed-keys": link.restrictions.allowedDataKeys.keys,
    });
    expect(add.data.status).toBe("success");
    const r = await run(agentCtx, "permissions check-grant", {});
    expect(r.data).toMatchObject({ status: "exact", authorised: true, withinRequest: true });
    expect(r.data.differences).toMatchObject({ missingPermissions: [], extraPermissions: [], missingAllowedCalls: [], extraAllowedCalls: [], missingDataKeys: [], extraDataKeys: [] });
    expect(r.data.next[0]).toBe(`up profile join ${profile} --chains ${h.chainId}`);
  });

  it("profile join takes over: no deployment, the human's profile stays separate, link-based comparison", async () => {
    const r = await run(agentCtx, "profile join", { address: profile, chains: [String(h.chainId)] });
    const status = r.data.chains[0];
    expect(status).toMatchObject({ deployed: true, authorised: true, hasRecommended: true, missing: [] });
    expect(r.data.authorizeRequest).toMatchObject({ permissions: link.permissions.names });
    expect(r.text).not.toMatch(/missing recommended/);
    const record = JSON.parse(readFileSync(join(agentCtx.home, "profiles", `${profile.toLowerCase()}.json`), "utf8"));
    expect(record.joined).toBeTruthy();
    expect(record.deployment).toBeUndefined();
    const identity = await run(agentCtx, "profile identity", {});
    expect(identity.data.profiles.find((p: any) => p.address === profile)).toMatchObject({ role: "joined" });
    expect(identity.data.say).toMatch(/your Universal Profile/);
  });

  it("the real Key Manager enforces the limits: follow works, anything else is refused", async () => {
    const f = await run(agentWith("human: follow 0x…0001 for me"), "follow", { address: "0x0000000000000000000000000000000000000001", via: "km", profile });
    expect(f.data.outcome.status).toBe("success");
    const call = await run(agentWith("human: test call"), "exec send", { to: other, data: "0xabcdef01", via: "km", profile }).catch((e) => e);
    expect(call.details.errorName).toBe("NotAllowedCall");
    const lsp3 = { json: { LSP3Profile: { name: "Nova test" } }, url: "ipfs://QmTest" };
    const ok = await run(agentWith("human: update my profile name"), "account data set", { key: "LSP3Profile", value: lsp3, via: "km", profile });
    expect(ok.data.status).toBe("success");
    const no = await run(agentWith("human: test data"), "account data set", { key: `0x${"ab".repeat(32)}`, value: "0x01", via: "km", profile }).catch((e) => e);
    expect(no.details.errorName).toBe("NotAllowedERC725YDataKey");
  });

  it("a narrower grant is reported as narrower", async () => {
    await run(humanApproves("remove the relay permission from Nova"), "controller edit", { address: agent.address, remove: ["EXECUTE_RELAY_CALL"] });
    const r = await run(agentCtx, "permissions check-grant", {});
    expect(r.data).toMatchObject({ status: "narrower", withinRequest: true });
    expect(r.data.differences.missingPermissions).toEqual(["EXECUTE_RELAY_CALL"]);
    expect(r.data.say).toMatch(/part of what I asked/);
  });

  it("a broader grant is reported, with warnings about unrestricted and admin power", async () => {
    await run(humanApproves("give Nova super call and add controller"), "controller edit", { address: agent.address, add: ["SUPER_CALL", "ADDCONTROLLER"] });
    const r = await run(agentCtx, "permissions check-grant", {});
    expect(r.data).toMatchObject({ status: "broader", withinRequest: false });
    expect(r.data.differences.extraPermissions).toEqual(expect.arrayContaining(["ADDCONTROLLER", "SUPER_CALL"]));
    const w = r.warnings!.join(" ");
    expect(w).toMatch(/control over owners, controllers or permissions/);
    expect(w).toMatch(/unrestricted SUPER_CALL/);
    expect(r.data.say).toMatch(/more than I asked/);
  });

  it("checks a link handed back with --request", async () => {
    const r = await run(agentCtx, "permissions check-grant", { request: link.url });
    expect(r.data.source).toBe("request");
    expect(r.data.status).toBe("broader");
  });
});
