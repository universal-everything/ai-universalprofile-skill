import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { recoverMessageAddress } from "viem";
import { LinuxSystemdCredsBackend, credentialName } from "../../../src/signer/linux-systemd-creds.ts";
import { catchErr, enoent, errorText, fakeRun, out, tempHome } from "./helpers.ts";

/** Fake systemd-creds: "encrypts" as ENC|<name>|base64(plaintext); decrypt checks the name binding. */
function fakeCreds(opts: { version?: string; failEncrypt?: boolean; failDecrypt?: string } = {}) {
  return fakeRun((cmd, args, input) => {
    expect(cmd).toBe("systemd-creds");
    if (args[0] === "--version") return { stdout: out(opts.version ?? "systemd 257 (257.4-1)\n+PAM +AUDIT\n") };
    const name = args.find((a) => a.startsWith("--name="))!.slice(7);
    if (args[0] === "encrypt") {
      if (opts.failEncrypt) return { code: 1, stderr: "Failed to connect to io.systemd.Credentials: No such file or directory" };
      return { stdout: out(`ENC|${name}|${Buffer.from(input).toString("base64")}`) };
    }
    if (args[0] === "decrypt") {
      if (opts.failDecrypt) return { code: 1, stderr: opts.failDecrypt };
      const [tag, n, b64] = input.split("|");
      if (tag !== "ENC" || n !== name) return { code: 1, stderr: "Embedded credential name does not match" };
      return { stdout: Buffer.from(b64, "base64") };
    }
    return { code: 1, stderr: "unexpected" };
  });
}

let home: Awaited<ReturnType<typeof tempHome>>;
beforeEach(async () => {
  home = await tempHome();
});
afterEach(async () => home.cleanup());

describe("linux-systemd-creds (mocked)", () => {
  const make = (run: ReturnType<typeof fakeRun>) => new LinuxSystemdCredsBackend({ run, platform: "linux", dir: () => join(home.dir, "keys"), which: (n) => n });

  it("encrypts over stdin with --user --with-key=auto and a name binding; key never in argv; 0600 blob", async () => {
    const run = fakeCreds();
    const b = make(run);
    const address = await b.create();
    const enc = run.calls.find((c) => c.args[0] === "encrypt")!;
    expect(enc.args).toEqual(["encrypt", "--user", "--with-key=auto", `--name=${credentialName(address.toLowerCase())}`, "-", "-"]);
    expect(enc.input).toMatch(/^0x[0-9a-f]{64}$/);
    const key = enc.input;
    for (const c of run.calls) {
      expect(c.args.join(" ")).not.toContain(key.slice(2));
      expect(c.args.join(" ")).not.toMatch(/with-key=null/);
    }
    const file = join(home.dir, "keys", `${address.toLowerCase()}.cred`);
    expect((await readFile(file, "utf8")).startsWith("ENC|")).toBe(true);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);

    const dec = run.calls.filter((c) => c.args[0] === "decrypt");
    expect(dec[0].args).toEqual(["decrypt", "--user", `--name=up-signer-${address.toLowerCase()}`, "-", "-"]);

    const signer = await b.load(address);
    expect(await recoverMessageAddress({ message: "s", signature: await signer.signMessage("s") })).toBe(address);
    expect(signer.protection).toMatchObject({ level: "os-keychain", encryptedAtRest: true });
    expect(await b.has(address)).toBe(true);
    await b.remove(address);
    expect(await b.has(address)).toBe(false);
  });

  it("maps decrypt failure to SIGNER_LOCKED (fail closed) and scrubs stderr", async () => {
    const good = fakeCreds();
    const address = await make(good).create();
    const leaky = "0x" + "ab".repeat(32);
    const e = await catchErr(make(fakeCreds({ failDecrypt: `Failed to decrypt credential ${leaky}: Bad message` })).load(address));
    expect(e.code).toBe("SIGNER_LOCKED");
    expect(errorText(e)).not.toContain("ab".repeat(32));
    expect(e.hint).toMatch(/restore the key from its backup/);
    expect(e.hint).not.toMatch(/rotat/);
  });

  it("maps encrypt failure to SIGNER_BACKEND_UNAVAILABLE and missing credential to NO_SIGNER", async () => {
    expect((await catchErr(make(fakeCreds({ failEncrypt: true })).create())).code).toBe("SIGNER_BACKEND_UNAVAILABLE");
    expect((await catchErr(make(fakeCreds()).load("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"))).code).toBe("NO_SIGNER");
  });

  it("probe: needs Linux, the binary, systemd >= 256 and a working canary round trip", async () => {
    expect((await new LinuxSystemdCredsBackend({ platform: "darwin" }).probe()).available).toBe(false);
    expect((await make(fakeRun((c) => enoent(c))).probe()).reason).toMatch(/not installed/);
    const notInSystemDirs = new LinuxSystemdCredsBackend({ run: fakeCreds(), platform: "linux", which: () => null });
    expect((await notInSystemDirs.probe()).available).toBe(false);
    expect((await catchErr(notInSystemDirs.create())).code).toBe("SIGNER_BACKEND_UNAVAILABLE");
    const old = await make(fakeCreds({ version: "systemd 255 (255.4-1ubuntu8)\n" })).probe();
    expect(old.available).toBe(false);
    expect(old.reason).toMatch(/255.*256/);
    const broken = await make(fakeCreds({ failEncrypt: true })).probe();
    expect(broken.available).toBe(false);
    expect(broken.reason).toMatch(/systemd-creds.socket/);
    const badDecrypt = await make(fakeCreds({ failDecrypt: "nope" })).probe();
    expect(badDecrypt.available).toBe(false);
    const run = fakeCreds();
    const ok = await make(run).probe();
    expect(ok).toMatchObject({ available: true, unattended: true, level: "os-keychain" });
    expect(run.calls.map((c) => c.args[0])).toEqual(["--version", "encrypt", "decrypt"]);
  });
});
