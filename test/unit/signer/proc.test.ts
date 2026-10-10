import { afterEach, describe, expect, it } from "vitest";
import { childEnv, keystoreService, resolveSystemBinary, runProcess, scrub, stderrSummary } from "../../../src/signer/proc.ts";

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("childEnv", () => {
  it("removes secret-bearing and loader-injection variables, keeps the rest", () => {
    process.env.UP_TEST_EPHEMERAL_KEY = "0x" + "11".repeat(32);
    process.env.UP_BACKUP_PASSPHRASE = "a passphrase that must not leak";
    process.env.LD_PRELOAD = "/tmp/evil.so";
    process.env.LD_AUDIT = "/tmp/evil.so";
    process.env.DYLD_INSERT_LIBRARIES = "/tmp/evil.dylib";
    process.env.UP_SOMETHING = "kept";
    const e = childEnv({ EXTRA: "1" });
    for (const k of ["UP_TEST_EPHEMERAL_KEY", "UP_BACKUP_PASSPHRASE", "LD_PRELOAD", "LD_AUDIT", "DYLD_INSERT_LIBRARIES"]) expect(e[k]).toBeUndefined();
    expect(e.UP_SOMETHING).toBe("kept");
    expect(e.EXTRA).toBe("1");
    expect(e.PATH).toBe(process.env.PATH);
  });
});

describe("resolveSystemBinary", () => {
  it("only looks in system directories", () => {
    const seen: string[] = [];
    expect(resolveSystemBinary("systemd-creds", (p) => (seen.push(p), p === "/bin/systemd-creds"))).toBe("/bin/systemd-creds");
    expect(seen.every((p) => /^\/(usr\/)?s?bin\/|^\/run\/current-system\/sw\/bin\//.test(p))).toBe(true);
    expect(resolveSystemBinary("nope", () => false)).toBe(null);
  });
});

describe("scrub / stderrSummary", () => {
  it("redacts 32-byte hex runs, long base64 blobs and listed secrets but keeps addresses", () => {
    const key = "0x" + "ab".repeat(32);
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const t = scrub(`k=${key} bare=${"cd".repeat(32)} addr=${addr} blob=${"QUJD".repeat(30)} pw=hunter2hunter2`, ["hunter2hunter2"]);
    expect(t).not.toContain("ab".repeat(32));
    expect(t).not.toContain("cd".repeat(32));
    expect(t).not.toContain("QUJD".repeat(30));
    expect(t).not.toContain("hunter2hunter2");
    expect(t).toContain(addr);
    const s = stderrSummary({ code: 1, stdout: Buffer.alloc(0), stderr: `\nfirst ${key}\nsecond\nthird\n` });
    expect(s).toBe("first [redacted] | second");
  });
});

describe("keystoreService", () => {
  it("defaults to universal-profile and validates overrides", () => {
    delete process.env.UP_KEYCHAIN_SERVICE;
    expect(keystoreService()).toBe("universal-profile");
    process.env.UP_KEYCHAIN_SERVICE = "up-test-1";
    expect(keystoreService()).toBe("up-test-1");
    process.env.UP_KEYCHAIN_SERVICE = "a b";
    expect(() => keystoreService()).toThrow(/UP_KEYCHAIN_SERVICE/);
  });
});

describe("runProcess (real child processes)", () => {
  it("passes stdin, captures stdout/stderr and exit codes, without the secret env vars", async () => {
    process.env.UP_TEST_EPHEMERAL_KEY = "0x" + "22".repeat(32);
    const r = await runProcess(process.execPath, ["-e", "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(d.toUpperCase()+':'+(process.env.UP_TEST_EPHEMERAL_KEY??'none'));process.stderr.write('err');process.exit(3)})"], { input: "secret-on-stdin" });
    expect(r.code).toBe(3);
    expect(r.stdout.toString()).toBe("SECRET-ON-STDIN:none");
    expect(r.stderr).toBe("err");
    expect(r.error).toBeUndefined();
  });

  it("reports ENOENT and TIMEOUT instead of throwing", async () => {
    const missing = await runProcess("/nonexistent/definitely-not-here", []);
    expect(missing.error?.code).toBe("ENOENT");
    const slow = await runProcess(process.execPath, ["-e", "setTimeout(()=>{}, 10000)"], { timeoutMs: 200 });
    expect(slow.error?.code).toBe("TIMEOUT");
    expect(slow.code).toBe(null);
  });
});
