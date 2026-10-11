// Where the backup password comes from (owner decision: it may travel through the chat).
import { afterEach, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { PASSWORD_ALPHABET, checkHint, choosePassword, generatePassword } from "../../../src/backup/password.ts";
import { UpError } from "../../../src/core/errors.ts";
import { clearSecretsForTests, containsSecret } from "../../../src/core/secret-guard.ts";

afterEach(() => {
  clearSecretsForTests();
  delete process.env.UP_MCP_SERVER;
  delete process.env.BACKUP_PW_TEST;
});
const err = async (p: Promise<unknown>) => ((await p.then(() => undefined, (e) => e)) as UpError);

describe("generated password", () => {
  it("is XXXXX-XXXXX-XXXXX-XXXXX from the 56-symbol alphabet, about 116 bits", () => {
    expect(PASSWORD_ALPHABET).toHaveLength(56);
    expect(PASSWORD_ALPHABET).not.toMatch(/[0O1lI]/);
    for (let i = 0; i < 200; i++) expect(generatePassword()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{5}(-[A-HJ-NP-Za-km-z2-9]{5}){3}$/);
    expect(new Set(Array.from({ length: 200 }, generatePassword)).size).toBe(200);
  });

  it("is uniform enough (chi-square smoke test over 56 symbols)", () => {
    const counts = new Map<string, number>();
    const n = 20000;
    let total = 0;
    while (total < n * 20) {
      for (const ch of generatePassword().replace(/-/g, "")) counts.set(ch, (counts.get(ch) ?? 0) + 1), total++;
    }
    const expected = total / 56;
    let chi = 0;
    for (const ch of PASSWORD_ALPHABET) chi += ((counts.get(ch) ?? 0) - expected) ** 2 / expected;
    expect(counts.size).toBe(56);
    expect(chi).toBeLessThan(110); // 55 degrees of freedom: 99.99th percentile is about 95
  });

  it("is the default for export and is not registered with the output guard (it is meant to be returned)", async () => {
    const c = (await choosePassword({}, true))!;
    expect(c).toMatchObject({ source: "generated", generated: true });
    expect(containsSecret(`the password is ${c.password}`)).toBe(false);
  });
});

describe("sources", () => {
  it("--password: at least 12 characters, a warning below 16", async () => {
    expect(((await err(choosePassword({ password: "short-pw" }, true))) as UpError).message).toMatch(/at least 12 characters/);
    const c = (await choosePassword({ password: "twelve-chars" }, true))!;
    expect(c.source).toBe("argument");
    expect(c.warnings[0]).toMatch(/only 12 characters/);
    expect((await choosePassword({ password: "a-much-longer-password" }, true))!.warnings).toEqual([]);
    expect((await choosePassword({ password: "Ünïcödé-pässwörd-1" }, true))!.password).toBe("Ünïcödé-pässwörd-1");
  });

  it("opening a file has no minimum (the app lets people choose 1 to 30 characters) and never generates", async () => {
    expect((await choosePassword({ password: "x" }, false))!.password).toBe("x");
    expect(await choosePassword({}, false)).toBeUndefined();
    expect(((await err(choosePassword({ "generate-password": true }, false))) as UpError).message).toMatch(/only applies when making a backup/);
  });

  it("--password-env reads the variable once and removes it from the process", async () => {
    process.env.BACKUP_PW_TEST = "from-the-environment-1";
    const c = (await choosePassword({ "password-env": "BACKUP_PW_TEST" }, true))!;
    expect(c).toMatchObject({ source: "env", password: "from-the-environment-1" });
    expect(process.env.BACKUP_PW_TEST).toBeUndefined();
    expect(((await err(choosePassword({ "password-env": "BACKUP_PW_TEST" }, true))) as UpError).message).toMatch(/not set or empty/);
    expect(((await err(choosePassword({ "password-env": "bad name!" }, true))) as UpError).message).toMatch(/name of an environment variable/);
  });

  it("--password-stdin reads standard input and strips one trailing newline; it is refused over MCP", async () => {
    const stdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: Readable.from([Buffer.from("typed-in-the-terminal-1\n")]), configurable: true });
    try {
      expect((await choosePassword({ "password-stdin": true }, true))!.password).toBe("typed-in-the-terminal-1");
      process.env.UP_MCP_SERVER = "1";
      expect(((await err(choosePassword({ "password-stdin": true }, true))) as UpError).message).toMatch(/not available over MCP/);
    } finally {
      Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
    }
  });

  it("exactly one source", async () => {
    expect(((await err(choosePassword({ password: "twelve-chars", "generate-password": true }, true))) as UpError).message).toMatch(/only one of/);
    expect(((await err(choosePassword({ password: "twelve-chars", "password-env": "X" }, true))) as UpError).message).toMatch(/only one of/);
  });
});

describe("hint", () => {
  it("is public text: refused when it contains the password, even without dashes or spaces; capped at 255", () => {
    expect(checkHint("  my dog's name  ", "XXXXX-XXXXX-XXXXX-XXXXX")).toBe("my dog's name");
    expect(checkHint(undefined, "pw")).toBeUndefined();
    expect(checkHint("   ", "pw")).toBeUndefined();
    expect(() => checkHint("it is ABCDE-FGHJK-LMNPQ-RSTUV", "ABCDE-FGHJK-LMNPQ-RSTUV")).toThrow(/contains the password/);
    expect(() => checkHint("it is ABCDEFGHJKLMNPQRSTUV", "ABCDE-FGHJK-LMNPQ-RSTUV")).toThrow(/contains the password/);
    expect(() => checkHint("x".repeat(256), "pw")).toThrow(/255/);
  });
});
