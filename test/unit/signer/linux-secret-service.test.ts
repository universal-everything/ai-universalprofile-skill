import { describe, expect, it } from "vitest";
import { recoverMessageAddress } from "viem";
import { LinuxSecretServiceBackend, SECRET_LABEL, parseBool } from "../../../src/signer/linux-secret-service.ts";
import { catchErr, enoent, fakeRun, out } from "./helpers.ts";

interface FakeOpts {
  owner?: boolean;
  locked?: boolean;
  busctl?: boolean; // false → busctl missing (gdbus fallback)
  noCollection?: boolean;
}

function fakeSecrets(o: FakeOpts = {}) {
  const items = new Map<string, string>();
  const owner = o.owner ?? true;
  const locked = o.locked ?? false;
  const run = fakeRun((cmd, args, input) => {
    if (cmd === "busctl") {
      if (o.busctl === false) return enoent(cmd);
      if (args.includes("NameHasOwner")) return { stdout: out(`b ${owner}\n`) };
      if (args.includes("get-property")) {
        expect(args).toContain("--auto-start=no");
        if (o.noCollection) return { code: 1, stderr: "Failed to get property Locked on interface org.freedesktop.Secret.Collection: No such object path '/org/freedesktop/secrets/aliases/default'" };
        return { stdout: out(`b ${locked}\n`) };
      }
    }
    if (cmd === "gdbus") {
      if (args.includes("org.freedesktop.DBus.NameHasOwner")) return { stdout: out(`(${owner},)\n`) };
      if (args.includes("org.freedesktop.DBus.Properties.Get")) return { stdout: out(`(<${locked}>,)\n`) };
    }
    if (cmd === "secret-tool") {
      if (args[0] === "--version") return { code: 0, stdout: out("secret-tool 0.21\n") };
      if (locked) throw new Error("secret-tool must never be called while the keyring is locked (it would prompt)");
      if (args[0] === "search") throw new Error("secret-tool search prints secrets and must never be used");
      const acct = args[args.indexOf("account") + 1];
      if (args[0] === "store") {
        items.set(acct, input);
        return { code: 0 };
      }
      if (args[0] === "lookup") return items.has(acct) ? { stdout: out(items.get(acct)!) } : { code: 1 };
      if (args[0] === "clear") {
        items.delete(acct);
        return { code: 0 };
      }
    }
    return { code: 1, stderr: `unexpected ${cmd} ${args.join(" ")}` };
  });
  return { run, items };
}

const linuxEnv = { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" };

describe("linux-secret-service (mocked)", () => {
  const make = (run: ReturnType<typeof fakeRun>, which: (n: string) => string | null = (n) => n) => new LinuxSecretServiceBackend({ run, platform: "linux", env: linuxEnv, which });

  it("parses busctl and gdbus booleans", () => {
    expect(parseBool("b true\n")).toBe(true);
    expect(parseBool("b false")).toBe(false);
    expect(parseBool("(true,)")).toBe(true);
    expect(parseBool("(<false>,)")).toBe(false);
    expect(parseBool("garbage")).toBe(null);
  });

  it("stores over stdin with attributes service/account and the label; key never in argv", async () => {
    const { run, items } = fakeSecrets();
    const b = make(run);
    const address = await b.create();
    const store = run.calls.find((c) => c.cmd === "secret-tool" && c.args[0] === "store")!;
    expect(store.args).toEqual(["store", `--label=${SECRET_LABEL}`, "service", "universal-profile", "account", address.toLowerCase()]);
    const key = items.get(address.toLowerCase())!;
    expect(store.input).toBe(key);
    for (const c of run.calls) expect(c.args.join(" ")).not.toContain(key.slice(2));
    const signer = await b.load(address);
    expect(signer.protection.level).toBe("os-keyring");
    expect(await recoverMessageAddress({ message: "k", signature: await signer.signMessage("k") })).toBe(address);
    expect(await b.has(address)).toBe(true);
    await b.remove(address);
    expect(await b.has(address)).toBe(false);
  });

  it("detects a locked keyring without calling secret-tool and fails closed", async () => {
    const { run } = fakeSecrets({ locked: true });
    const b = make(run);
    expect(await b.collectionState()).toBe("locked");
    const p = await b.probe();
    expect(p).toMatchObject({ available: false, level: "os-keyring" });
    expect(p.reason).toMatch(/locked/);
    const e = await catchErr(b.load("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"));
    expect(e.code).toBe("SIGNER_LOCKED");
    expect(run.calls.filter((c) => c.cmd === "secret-tool" && c.args[0] !== "--version")).toEqual([]);
  });

  it("does not D-Bus-activate a keyring when no Secret Service is running", async () => {
    const { run } = fakeSecrets({ owner: false });
    const b = make(run);
    expect(await b.collectionState()).toBe("no-service");
    expect(run.calls.some((c) => c.args.includes("get-property"))).toBe(false);
    expect((await b.probe()).available).toBe(false);
  });

  it("falls back to gdbus when busctl is missing", async () => {
    const { run } = fakeSecrets({ busctl: false });
    expect(await make(run).collectionState()).toBe("unlocked");
    const notInstalled = fakeSecrets().run;
    expect(await make(notInstalled, (n) => (n === "busctl" ? null : n)).collectionState()).toBe("unlocked");
    expect(notInstalled.calls.some((c) => c.cmd === "busctl")).toBe(false);
    expect(run.calls.some((c) => c.cmd === "gdbus")).toBe(true);
  });

  it("reports a missing default collection and a missing session bus", async () => {
    expect(await make(fakeSecrets({ noCollection: true }).run).collectionState()).toBe("no-collection");
    const nobus = new LinuxSecretServiceBackend({ run: fakeSecrets().run, platform: "linux", env: {}, which: (n) => n });
    expect(await nobus.collectionState()).toBe("no-service");
  });

  it("probe: unavailable off Linux or without secret-tool; available when unlocked", async () => {
    expect((await new LinuxSecretServiceBackend({ platform: "darwin" }).probe()).available).toBe(false);
    const noTool = fakeRun(() => ({ stdout: out("b true") }));
    expect((await make(noTool, (n) => (n === "secret-tool" ? null : n)).probe()).reason).toMatch(/libsecret-tools/);
    expect(await make(fakeSecrets().run).probe()).toMatchObject({ available: true, unattended: true });
  });
});
