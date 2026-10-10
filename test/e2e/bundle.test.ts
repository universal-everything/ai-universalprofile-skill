// End-to-end: drives the BUILT, shipped bundle (skills/universal-profile/scripts/*.mjs)
// as separate processes — exactly how an agent uses the skill — against the
// local chain (canonical LSP stack at mainnet addresses). Covers journey J1
// (agent-first, self-funded) and the generic "anything as the profile" surface,
// plus the stdio MCP server. Requires `npm run build` first.
import { describe, expect, it, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { concat, encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getHarness, fixture, type Harness } from "../chain/harness.ts";

const root = join(import.meta.dirname, "..", "..");
const scripts = join(root, "skills", "universal-profile", "scripts");

let h: Harness;
let home: string;
const key = generatePrivateKey();
const controller = privateKeyToAccount(key).address;
let env: NodeJS.ProcessEnv;

async function up(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<{ ok: boolean; data: any; error?: any; raw: string; code: number | null }> {
  // async spawn: the local chain's RPC server lives in this process and must keep serving
  const child = spawn(process.execPath, [join(scripts, "up.mjs"), ...args, "--json"], { env: { ...env, ...extraEnv } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const code: number | null = await new Promise((r) => child.on("close", r));
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`non-JSON output for up ${args.join(" ")}:\n${stdout}\n${stderr}`);
  }
  return { ok: parsed.ok, data: parsed.data, error: parsed.error, raw: stdout, code };
}

describe("shipped bundle end-to-end (CLI + MCP processes)", () => {
  beforeAll(async () => {
    expect(existsSync(join(scripts, "up.mjs")), "run npm run build first").toBe(true);
    h = await getHarness();
    home = h.newHome();
    env = { ...process.env, UP_HOME: home, UP_TEST_EPHEMERAL_KEY: key, UP_RPC_ALLOW_STALE: "1", UP_POLL_MS: "50", NODE_NO_WARNINGS: "1" };
    await h.fund(controller, 10n ** 20n);
  });

  let profile: Address;
  let keyManager: Address;

  it("doctor + init create the controller without revealing the key", async () => {
    const d = await up(["doctor", "--offline"]);
    expect(d.data.checks.find((c: any) => c.name === "node").ok).toBe(true);
    const init = await up(["init", "--backend", "memory"]);
    expect(init.ok, init.raw).toBe(true);
    expect(init.data.address).toBe(controller);
    expect(init.raw.toLowerCase()).not.toContain(key.slice(2).toLowerCase());
    expect(statSync(join(home, "config.json")).mode & 0o777).toBe(0o600);
  });

  it("J1: precompute candidates, show them with identicon + QR, deploy the chosen one at the precomputed address", async () => {
    const pre = await up(["account", "precompute", "--count", "3", "--seed", "0x" + "11".repeat(32)]);
    expect(pre.ok, pre.raw).toBe(true);
    const candidates = pre.data.candidates ?? pre.data;
    expect(candidates.length).toBe(3);
    const chosen = candidates[1];
    const shown = await up(["display", "address", chosen.address ?? chosen.profile, "--label", "candidate #2"]);
    expect(shown.ok, shown.raw).toBe(true);
    const media = JSON.parse(shown.raw).media ?? [];
    expect(media.length).toBeGreaterThanOrEqual(2);
    for (const m of media) expect(existsSync(m.path)).toBe(true);
    // agent deploying its own profile; deploy is an account-creation write → human approval string
    const dep = await up(["account", "deploy", "--seed", "0x" + "11".repeat(32), "--candidate", "1", "--approval", "yes, deploy candidate 2"]);
    expect(dep.ok, dep.raw).toBe(true);
    profile = dep.data.profile ?? dep.data.universalProfile ?? dep.data.addresses?.profile;
    keyManager = dep.data.keyManager ?? dep.data.addresses?.keyManager;
    expect(profile).toBe(chosen.address ?? chosen.profile);
    const info = await up(["account", "info", "--profile", profile]);
    expect(info.ok, info.raw).toBe(true);
    expect(JSON.stringify(info.data).toLowerCase()).toContain(controller.toLowerCase());
  });

  it("acts as the profile: native transfer via km and lsp0; target sees the profile as msg.sender", async () => {
    await h.fund(profile, 10n ** 19n);
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const r1 = await up(["exec", "send", "--profile", profile, "--to", recipient, "--value", "1000", "--via", "km", "--approval", "send 1000 wei"]);
    expect(r1.ok, r1.raw).toBe(true);
    const r2 = await up(["exec", "send", "--profile", profile, "--to", recipient, "--value", "2000", "--via", "lsp0", "--approval", "send 2000 wei"]);
    expect(r2.ok, r2.raw).toBe(true);
    expect(BigInt(await h.request("eth_getBalance", [recipient, "latest"]))).toBe(3000n);
  });

  it("dry-run builds and simulates but never changes chain state; --yes inside policy works for zero-value calls", async () => {
    const before = await h.request("eth_getTransactionCount", [controller, "latest"]);
    const dry = await up(["exec", "send", "--profile", profile, "--to", controller, "--value", "1", "--via", "km", "--dry-run"]);
    expect(dry.ok, dry.raw).toBe(true);
    expect(await h.request("eth_getTransactionCount", [controller, "latest"])).toBe(before);
    const noConsent = await up(["exec", "send", "--profile", profile, "--to", controller, "--value", "1", "--via", "km"]);
    expect(noConsent.ok).toBe(false);
    expect(noConsent.error.code).toBe("CONSENT_REQUIRED");
    const capped = await up(["exec", "send", "--profile", profile, "--to", controller, "--value", "1", "--via", "km", "--yes"]);
    expect(capped.error.code).toBe("POLICY_DENIED");
  });

  it("tokens: an LSP7 token owned by the profile is minted, transferred and read through generic + token verbs", async () => {
    const lsp7 = fixture("LSP7Mintable");
    const args = encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "address" }, { type: "uint256" }, { type: "bool" }], ["Agent Token", "AGT", profile, 0n, false]);
    const token = await h.deployRaw(concat([lsp7.bytecode as Hex, args]));
    const mint = await up(["contract", "call", token, "--fn", "mint", "--args", JSON.stringify([profile, "5000000000000000000", true, "0x"]), "--abi", "LSP7Mintable", "--profile", profile, "--via", "km", "--yes"]);
    expect(mint.ok, mint.raw).toBe(true);
    const bal = await up(["token", "balance", token, "--profile", profile]);
    expect(bal.ok, bal.raw).toBe(true);
    expect(JSON.stringify(bal.data)).toContain("5");
    const eoa = privateKeyToAccount(generatePrivateKey()).address;
    // token moves are not autonomous by default …
    const denied = await up(["token", "transfer", token, "--to", eoa, "--amount", "1.5", "--profile", profile, "--via", "km", "--yes"]);
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe("POLICY_DENIED");
    // … until the human delegates them (policy changes always need the human's words)
    const pol = await up(["policy", "set", JSON.stringify({ allowTokenMoves: true, tokenTargets: [token] }), "--approval", "let the agent move this token"]);
    expect(pol.ok, pol.raw).toBe(true);
    const tx = await up(["token", "transfer", token, "--to", eoa, "--amount", "1.5", "--profile", profile, "--via", "km", "--yes"]);
    expect(tx.ok, tx.raw).toBe(true);
    const out = await h.request("eth_call", [{ to: token, data: encodeFunctionData({ abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), args: [eoa] }) }, "latest"]);
    expect(BigInt(out)).toBe(1_500_000_000_000_000_000n);
    const fns = await up(["abi", "functions", token, "--offline"]);
    expect(fns.ok, fns.raw).toBe(true);
  });

  it("permissions: add a scoped human co-controller (admin → approval), read it back, sign as the profile and verify ERC-1271", async () => {
    const human = privateKeyToAccount(generatePrivateKey()).address;
    const add = await up(["controller", "add", human, "--preset", "human-admin", "--profile", profile, "--via", "km", "--approval", "add my wallet as admin"]);
    expect(add.ok, add.raw).toBe(true);
    const show = await up(["permissions", "show", human, "--profile", profile]);
    expect(show.ok, show.raw).toBe(true);
    const sig = await up(["sign", "message", "hello from my agent", "--as", "profile", "--profile", profile, "--approval", "sign hello"]);
    expect(sig.ok, sig.raw).toBe(true);
    const v = await up(["verify-1271", sig.data.signature, "--message", "hello from my agent", "--profile", profile]);
    expect(v.ok, v.raw).toBe(true);
    expect(JSON.stringify(v.data)).toMatch(/0x1626ba7e|"valid":\s*true/);
  });

  it("MCP stdio: initialize, list tools, call a read tool against the same state", async () => {
    const child = spawn(process.execPath, [join(scripts, "up-mcp.mjs")], { env, stdio: ["pipe", "pipe", "pipe"] });
    const lines: any[] = [];
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
    });
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "up_account_info", arguments: { profile } } });
    send({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "up://SKILL.md" } });
    for (let i = 0; i < 300 && lines.length < 4; i++) await new Promise((r) => setTimeout(r, 100));
    child.stdin.end();
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(byId[1].result.serverInfo.name).toBe("universal-profile");
    expect(byId[2].result.tools.length).toBeGreaterThanOrEqual(90);
    expect(byId[3].result.isError, JSON.stringify(byId[3])).toBe(false);
    expect(byId[4].result.contents[0].text).toContain("name: universal-profile");
  });
});
