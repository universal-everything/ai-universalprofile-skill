import { afterEach, describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNotKeyMaterialPath, clearSecretsForTests, containsSecret, guardOutput, registerSecret, safeWords, WITHHELD_MESSAGE } from "../../../src/core/secret-guard.ts";
import { parseAbiInput } from "../../../src/abi/codec.ts";
import { createLocalSigner, generateKey } from "../../../src/signer/local-signer.ts";
import { renderError, renderResult } from "../../../src/core/output.ts";
import { UpError } from "../../../src/core/errors.ts";

const PROTECTION = { backend: "memory", label: "test", encryptedAtRest: false, notes: [] } as any;

afterEach(() => clearSecretsForTests());

describe("secret guard: key material never reaches stdout/stderr (the AI provider)", () => {
  it("withholds any output that contains a loaded key, in any case and with or without 0x", () => {
    const key = generatePrivateKey();
    createLocalSigner(key, PROTECTION);
    for (const leak of [key, key.toUpperCase(), key.slice(2), `prefix ${key.slice(2).toUpperCase()} suffix`]) {
      expect(containsSecret(leak)).toBe(true);
      const json = guardOutput(renderResult("x", { data: { oops: leak } }, true), true);
      expect(json).not.toContain(key.slice(2));
      expect(JSON.parse(json)).toEqual({ ok: false, error: { code: "INTERNAL", message: WITHHELD_MESSAGE } });
      expect(guardOutput(renderError("x", new UpError("INTERNAL", `boom ${leak}`), false), false)).toBe(`✗ INTERNAL: ${WITHHELD_MESSAGE}`);
    }
  });

  it("passes normal output through unchanged", () => {
    const key = generatePrivateKey();
    const signer = createLocalSigner(key, PROTECTION);
    const out = renderResult("key address", { data: { address: signer.address }, text: signer.address }, true);
    expect(guardOutput(out, true)).toBe(out);
  });

  it("covers freshly generated keys and passphrases", () => {
    const k = generateKey();
    expect(guardOutput(`x ${k}`, false)).toContain(WITHHELD_MESSAGE);
    registerSecret("correct horse battery staple");
    expect(guardOutput("the passphrase is Correct Horse Battery Staple", false)).toContain(WITHHELD_MESSAGE);
    registerSecret("short"); // too short to be a secret worth matching: ignored
    expect(guardOutput("a short note", false)).toBe("a short note");
  });
});

describe("no verb reads or echoes key material", () => {
  it("withholds JSON-escaped passphrases too", () => {
    registerSecret('pass"word\\with-quotes');
    const out = JSON.stringify({ error: 'bad pass"word\\with-quotes' });
    expect(guardOutput(out, true)).toContain("output withheld");
  });

  it("refuses files in the key store and files that look like keys", () => {
    const home = mkdtempSync(join(tmpdir(), "up-guard-"));
    const old = process.env.UP_HOME;
    process.env.UP_HOME = home;
    try {
      mkdirSync(join(home, "keys"), { recursive: true });
      for (const f of [join(home, "keys", "0xabc.key"), join(home, "keys", "inventory.jsonl"), join(home, "x.key"), join(home, "keystore-backup.json"), join(home, "a.cred")]) {
        expect(() => assertNotKeyMaterialPath(f)).toThrow(/refusing to read/);
      }
      expect(() => assertNotKeyMaterialPath(join(home, "abi.json"))).not.toThrow();
    } finally {
      if (old === undefined) delete process.env.UP_HOME;
      else process.env.UP_HOME = old;
    }
  });

  it("an ABI file that is not JSON never has its content quoted in the error", () => {
    const dir = mkdtempSync(join(tmpdir(), "up-abi-"));
    const f = join(dir, "secret.json");
    writeFileSync(f, "syntheticpw123456");
    let msg = "";
    try {
      parseAbiInput(f);
    } catch (e) {
      msg = JSON.stringify(e) + String((e as Error).message);
    }
    expect(msg).toMatch(/is not valid JSON/);
    expect(msg).not.toContain("syntheticpw");
  });

  it("unknown-command errors never repeat something that may be a key", () => {
    const key = "0x" + "ab".repeat(32);
    expect(safeWords(["key", "import", key])).toBe("key import <hidden>");
  });
});
