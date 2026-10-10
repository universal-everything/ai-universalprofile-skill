import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { recoverMessageAddress } from "viem";
import { KEYCHAIN_LABEL, MacosKeychainBackend, SECURITY_BIN } from "../../../src/signer/macos-keychain.ts";
import { catchErr, enoent, errorText, fakeRun, out } from "./helpers.ts";

/** Fake `security` binary backed by a Map (service|account → secret). */
function fakeSecurity(opts: { readExit?: number; readStderr?: string; timeout?: boolean } = {}) {
  const items = new Map<string, string>();
  const run = fakeRun((cmd, args, input) => {
    expect(cmd).toBe(SECURITY_BIN);
    if (args[0] === "default-keychain") return { stdout: out('    "/Users/test/Library/Keychains/login.keychain-db"\n') };
    if (args[0] === "-i") {
      const m = /^add-generic-password -s (\S+) -a (\S+) -l "([^"]+)" -w ([0-9a-f]+)\n$/.exec(input);
      if (!m) return { code: 1, stderr: "bad command" };
      const k = `${m[1]}|${m[2]}`;
      if (items.has(k)) return { code: 45, stderr: "security: SecKeychainItemCreateFromContent (<default>): The specified item already exists in the keychain.\nadd-generic-password: returned -25299" };
      items.set(k, m[4]);
      return { code: 0 };
    }
    const s = args[args.indexOf("-s") + 1];
    const a = args[args.indexOf("-a") + 1];
    const k = `${s}|${a}`;
    if (opts.timeout) return { code: null, error: { code: "TIMEOUT", message: "timeout" } };
    if (args[0] === "find-generic-password") {
      if (opts.readExit !== undefined) return { code: opts.readExit, stderr: opts.readStderr ?? "" };
      if (!items.has(k)) return { code: 44, stderr: "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." };
      return args.includes("-w") ? { stdout: out(items.get(k) + "\n") } : { stdout: out(`keychain: "/Users/test/Library/Keychains/login.keychain-db"\nclass: "genp"\n`) };
    }
    if (args[0] === "delete-generic-password") {
      if (!items.delete(k)) return { code: 44, stderr: "not found" };
      return { stdout: out("password has been deleted.\n") };
    }
    return { code: 1, stderr: "unexpected" };
  });
  return { run, items };
}

const darwin = { platform: "darwin" as const, exists: () => true };

describe("macos-keychain (mocked /usr/bin/security)", () => {
  it("stores via `security -i` stdin with the exact command shape and never puts the key in argv", async () => {
    const { run, items } = fakeSecurity();
    const b = new MacosKeychainBackend({ run, ...darwin });
    const address = await b.create();
    const secret = [...items.values()][0];
    expect(secret).toMatch(/^[0-9a-f]{64}$/);

    const add = run.calls.find((c) => c.args[0] === "-i")!;
    expect(add.args).toEqual(["-i"]);
    expect(add.input).toBe(`add-generic-password -s universal-profile -a ${address.toLowerCase()} -l "${KEYCHAIN_LABEL}" -w ${secret}\n`);
    expect(add.input).not.toMatch(/\s-A(\s|$)/);
    expect(add.input).not.toMatch(/\s-T(\s|$)/);
    expect(add.input).not.toMatch(/\s-U(\s|$)/);
    expect(add.input).not.toMatch(/\.keychain/);
    for (const c of run.calls) {
      expect(c.cmd).toBe("/usr/bin/security");
      expect(c.args.join(" ")).not.toContain(secret);
    }
    // read back for verification used find-generic-password -w
    expect(run.calls.some((c) => c.args.join(" ") === `find-generic-password -s universal-profile -a ${address.toLowerCase()} -w`)).toBe(true);

    const signer = await b.load(address);
    expect(signer.protection.level).toBe("os-keychain");
    expect(await recoverMessageAddress({ message: "m", signature: await signer.signMessage("m") })).toBe(address);
    expect(await b.has(address)).toBe(true);
    await b.remove(address);
    expect(await b.has(address)).toBe(false);
    await b.remove(address); // idempotent (exit 44 ignored)
  });

  it("honours UP_KEYCHAIN_SERVICE and rejects unsafe service names", async () => {
    const saved = process.env.UP_KEYCHAIN_SERVICE;
    try {
      process.env.UP_KEYCHAIN_SERVICE = "up-test.svc_1";
      const { run } = fakeSecurity();
      const b = new MacosKeychainBackend({ run, ...darwin });
      await b.create();
      expect(run.calls.find((c) => c.args[0] === "-i")!.input).toContain("-s up-test.svc_1 ");
      process.env.UP_KEYCHAIN_SERVICE = 'evil" -A';
      await expect(b.create()).rejects.toMatchObject({ code: "BAD_ARGS" });
    } finally {
      if (saved === undefined) delete process.env.UP_KEYCHAIN_SERVICE;
      else process.env.UP_KEYCHAIN_SERVICE = saved;
    }
  });

  it("maps -25308 (interaction not allowed) to SIGNER_LOCKED without leaking", async () => {
    const { run } = fakeSecurity({ readExit: 36, readStderr: "security: SecKeychainSearchCopyNext: User interaction is not allowed." });
    const b = new MacosKeychainBackend({ run, ...darwin });
    const e = await catchErr(b.load("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"));
    expect(e.code).toBe("SIGNER_LOCKED");
    expect(e.message).toContain("-25308");
    expect(e.hint).toMatch(/log in/i);
  });

  it("maps a missing item to NO_SIGNER, auth failure/cancel to SIGNER_LOCKED, timeout to SIGNER_LOCKED, ENOENT to unavailable", async () => {
    const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    expect((await catchErr(new MacosKeychainBackend({ run: fakeSecurity().run, ...darwin }).load(addr))).code).toBe("NO_SIGNER");
    expect((await catchErr(new MacosKeychainBackend({ run: fakeSecurity({ readExit: 51, readStderr: "auth failed" }).run, ...darwin }).load(addr))).code).toBe("SIGNER_LOCKED");
    expect((await catchErr(new MacosKeychainBackend({ run: fakeSecurity({ readExit: 128, readStderr: "User canceled the operation." }).run, ...darwin }).load(addr))).code).toBe("SIGNER_LOCKED");
    expect((await catchErr(new MacosKeychainBackend({ run: fakeSecurity({ timeout: true }).run, ...darwin }).load(addr))).code).toBe("SIGNER_LOCKED");
    const noBin = fakeRun((cmd) => enoent(cmd));
    expect((await catchErr(new MacosKeychainBackend({ run: noBin, ...darwin }).load(addr))).code).toBe("SIGNER_BACKEND_UNAVAILABLE");
  });

  it("keeps the item (keys are never deleted) and fails closed when the key cannot be read back after storing", async () => {
    const items = new Map<string, string>();
    const run = fakeRun((_cmd, args, input) => {
      if (args[0] === "-i") {
        const m = /-a (\S+) .* -w ([0-9a-f]+)\n$/.exec(input)!;
        items.set(m[1], m[2]);
        return { code: 0 };
      }
      if (args[0] === "find-generic-password") return { code: 36, stderr: "User interaction is not allowed." };
      if (args[0] === "delete-generic-password") {
        items.delete(args[args.indexOf("-a") + 1]);
        return { code: 0 };
      }
      return { code: 1 };
    });
    const b = new MacosKeychainBackend({ run, ...darwin });
    const e = await catchErr(b.create());
    expect(e.code).toBe("SIGNER_LOCKED");
    expect(items.size).toBe(1);
    expect(run.calls.some((c) => c.args[0] === "delete-generic-password")).toBe(false);
    expect(e.details).toMatchObject({ address: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/), backend: "macos-keychain", kept: true, problem: "read-back-failed" });
    expect(e.message).toMatch(/kept in the store, nothing was deleted/);
    const secret = /-w ([0-9a-f]{64})\n$/.exec(run.calls.find((c) => c.args[0] === "-i")!.input)![1];
    expect(errorText(e)).not.toContain(secret);
  });

  it("scrubs key material from security's stderr in errors", async () => {
    const run = fakeRun((_cmd, args, input) => {
      if (args[0] === "-i") return { code: 1, stderr: `weird failure echoing ${input}` };
      return { code: 0 };
    });
    const b = new MacosKeychainBackend({ run, ...darwin });
    const e = await catchErr(b.create());
    const secret = /-w ([0-9a-f]{64})/.exec(run.calls[0].input)![1];
    expect(errorText(e)).not.toContain(secret);
  });

  it("probe: unavailable off macOS, without the binary, or without a default keychain", async () => {
    expect((await new MacosKeychainBackend({ platform: "linux" }).probe()).available).toBe(false);
    expect((await new MacosKeychainBackend({ platform: "darwin", exists: () => false }).probe()).available).toBe(false);
    const noKc = fakeRun(() => ({ code: 37, stderr: "security: SecKeychainCopyDefault: A default keychain could not be found." }));
    expect((await new MacosKeychainBackend({ run: noKc, ...darwin }).probe()).available).toBe(false);
    const ok = await new MacosKeychainBackend({ run: fakeSecurity().run, ...darwin }).probe();
    expect(ok).toMatchObject({ available: true, unattended: true, level: "os-keychain" });
  });

  it("refuses to run off macOS", async () => {
    await expect(new MacosKeychainBackend({ platform: "linux", run: fakeSecurity().run }).create()).rejects.toMatchObject({ code: "SIGNER_BACKEND_UNAVAILABLE" });
  });
});

// Opt-in real integration test: creates and deletes ONE item in the login keychain.
//   UP_TEST_KEYCHAIN=1 npx vitest run test/unit/signer/macos-keychain.test.ts
const realKeychain = process.platform === "darwin" && process.env.UP_TEST_KEYCHAIN === "1";
describe.runIf(realKeychain)("macos-keychain (real login keychain, opt-in)", () => {
  const service = `up-test-${randomBytes(6).toString("hex")}`;
  const saved = process.env.UP_KEYCHAIN_SERVICE;
  let address: `0x${string}` | undefined;

  beforeAll(() => {
    process.env.UP_KEYCHAIN_SERVICE = service;
  });
  afterAll(() => {
    // Remove every item of the unique test service, whatever happened.
    for (let i = 0; i < 5; i++) {
      try {
        execFileSync(SECURITY_BIN, ["delete-generic-password", "-s", service], { stdio: "ignore" });
      } catch {
        break;
      }
    }
    if (saved === undefined) delete process.env.UP_KEYCHAIN_SERVICE;
    else process.env.UP_KEYCHAIN_SERVICE = saved;
  });

  it("probe, create, load+sign, has, remove", async () => {
    const b = new MacosKeychainBackend();
    expect((await b.probe()).available).toBe(true);
    address = await b.create();
    expect(await b.has(address)).toBe(true);
    // The item is a plain generic password with our label, in the default keychain.
    const attrs = execFileSync(SECURITY_BIN, ["find-generic-password", "-s", service, "-a", address.toLowerCase()], { encoding: "utf8" });
    expect(attrs).toContain(KEYCHAIN_LABEL);
    const signer = await b.load(address);
    expect(await recoverMessageAddress({ message: "keychain", signature: await signer.signMessage("keychain") })).toBe(address);
    await b.remove(address);
    expect(await b.has(address)).toBe(false);
  });
});
