// IPFS upload settings in the local config: stored, never shown back (config get / output redaction).
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../../src/verbs/setup.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { renderResult } from "../../../src/core/output.ts";
import { redact } from "../../../src/core/json.ts";
import { testContext } from "../../support/context.ts";
import { selectProvider } from "../../../src/ipfs/providers.ts";

const run = async (ctx: any, name: string, raw: Record<string, unknown>) => {
  const v = getVerb(name)!;
  return v.run(ctx, coerceArgs(v, raw));
};

const SECRET = "hs256-upload-key-do-not-print-7f3a";
const PINATA = "eyJpinata.jwt.sig-do-not-print";
const KUBO = "Basic dXNlcjpkby1ub3QtcHJpbnQ=";

describe("config set/get for IPFS uploads", () => {
  it("stores credentials (0600 config) but config get and every output path redact them", async () => {
    const home = mkdtempSync(join(tmpdir(), "up-cfg-"));
    const ctx = testContext(home);
    const outs = [
      await run(ctx, "config set", { key: "ipfs-upload-key", value: SECRET }),
      await run(ctx, "config set", { key: "pinata-jwt", value: PINATA }),
      await run(ctx, "config set", { key: "kubo-auth", value: KUBO }),
      await run(ctx, "config set", { key: "kubo-url", value: "http://127.0.0.1:5001/" }),
      await run(ctx, "config set", { key: "ipfs-provider", value: "kubo" }),
      await run(ctx, "config set", { key: "ipfs-gateway", value: "https://gw.example/ipfs" }),
    ];
    for (const o of outs) for (const s of [SECRET, PINATA, KUBO]) expect(JSON.stringify(o)).not.toContain(s);
    const file = join(home, "config.json");
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(stored.ipfsKeys).toEqual({ universalprofile: SECRET, pinata: PINATA, kuboAuth: KUBO });
    expect(stored.ipfs).toEqual({ kuboUrl: "http://127.0.0.1:5001", provider: "kubo", gateway: "https://gw.example/ipfs/" });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);

    const all = await run(ctx, "config get", {});
    const one = await run(ctx, "config get", { key: "ipfsKeys" });
    const kebab = await run(ctx, "config get", { key: "ipfs-keys" });
    for (const r of [all, one, kebab]) {
      const rendered = [JSON.stringify(r.data), renderResult("config get", r, true), renderResult("config get", r, false)].join("\n");
      for (const s of [SECRET, PINATA, KUBO]) expect(rendered).not.toContain(s);
    }
    expect((all.data as any).ipfsKeys).toEqual({ universalprofile: "[redacted]", pinata: "[redacted]", kuboAuth: "[redacted]" });
    expect(one.data).toEqual({ universalprofile: "[redacted]", pinata: "[redacted]", kuboAuth: "[redacted]" });
    expect((all.data as any).ipfs.provider).toBe("kubo"); // public settings stay visible
    // defence in depth: the generic output redaction masks the container too
    expect(redact({ ipfsKeys: { universalprofile: SECRET } })).toEqual({ ipfsKeys: { universalprofile: "[redacted]" } });

    // the stored settings drive provider selection (credential source reported, never the value)
    const sel = selectProvider(await ctx.config(), {});
    expect(sel).toMatchObject({ name: "kubo", credentialSource: "config" });

    // empty value removes a setting
    const removed = await run(ctx, "config set", { key: "ipfs-upload-key", value: "" });
    expect(removed.text).toBe("removed ipfs-upload-key");
    expect(JSON.parse(readFileSync(file, "utf8")).ipfsKeys.universalprofile).toBeUndefined();
  });

  it("validates provider names, gateway and kubo URLs", async () => {
    const ctx = testContext(mkdtempSync(join(tmpdir(), "up-cfg-")));
    await expect(run(ctx, "config set", { key: "ipfs-provider", value: "web3storage" })).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(run(ctx, "config set", { key: "ipfs-gateway", value: "http://gateway.example/ipfs/" })).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(run(ctx, "config set", { key: "kubo-url", value: "http://user:pw@127.0.0.1:5001" })).rejects.toMatchObject({ code: "BAD_ARGS" });
  });
});
