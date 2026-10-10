import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { recoverMessageAddress } from "viem";
import { PS_CANARY, PS_PROTECT, PS_UNPROTECT, WindowsDpapiBackend, parsePsOutput, powershellArgs, wslAutomountRoot } from "../../../src/signer/windows-dpapi.ts";
import { catchErr, enoent, env, errorText, fakeRun, out, tempHome } from "./helpers.ts";

/** Fake powershell.exe: "DPAPI" = base64("DP:" + plaintext). */
function fakePs(opts: { fail?: string; noise?: boolean } = {}) {
  return fakeRun((_cmd, args, input) => {
    expect(args.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
    expect(args).toHaveLength(5);
    const script = args[4];
    if (opts.fail) return { code: 3, stderr: opts.fail };
    const prefix = opts.noise ? "﻿#< CLIXML\r\n" : "";
    if (script === PS_PROTECT) return { stdout: out(`${prefix}UPOK:${Buffer.from("DP:" + input.trim()).toString("base64")}\r\n`) };
    if (script === PS_UNPROTECT) {
      const plain = Buffer.from(input.trim(), "base64").toString("utf8");
      if (!plain.startsWith("DP:")) return { code: 3, stderr: "UPERR:System.Security.Cryptography.CryptographicException:80090005" };
      return { stdout: out(`${prefix}UPOK:${plain.slice(3)}\r\n`) };
    }
    if (script === PS_CANARY) return { stdout: out(`UPOK:${input.trim()}`) };
    return { code: 1, stderr: "unexpected script" };
  });
}

let home: Awaited<ReturnType<typeof tempHome>>;
beforeEach(async () => {
  home = await tempHome();
});
afterEach(async () => home.cleanup());

describe("DPAPI scripts", () => {
  it("contain no double quotes (command-line safe) and use CurrentUser scope only", () => {
    for (const s of [PS_PROTECT, PS_UNPROTECT, PS_CANARY]) {
      expect(s).not.toContain('"');
      expect(s).not.toContain("\\");
      expect(s).not.toMatch(/LocalMachine/);
      expect(s).toMatch(/DataProtectionScope\]::CurrentUser/);
      expect(s).toContain("[Console]::In.ReadToEnd()");
    }
    expect(powershellArgs("x")).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "x"]);
  });

  it("parses output after the UPOK marker despite BOM/CLIXML noise", () => {
    expect(parsePsOutput("﻿#< CLIXML\r\nUPOK:abc\r\n")).toBe("abc");
    expect(parsePsOutput("nothing")).toBe(null);
  });
});

for (const mode of ["windows", "wsl"] as const) {
  describe(`${mode === "windows" ? "windows-dpapi" : "wsl-dpapi"} (mocked powershell)`, () => {
    const platform = mode === "windows" ? "win32" : "linux";
    const make = (run: ReturnType<typeof fakeRun>, exists: (p: string) => boolean = () => true, wslConf: string | null = null) =>
      new WindowsDpapiBackend(mode, { run, platform, env: async () => env({ wsl: mode === "wsl" }), exists, dir: () => join(home.dir, "keys"), readFile: () => wslConf });

    it("protects via stdin (never argv/script), stores the blob, unprotects and signs", async () => {
      const run = fakePs({ noise: true });
      const b = make(run);
      const address = await b.create();
      const protect = run.calls.find((c) => c.args[4] === PS_PROTECT)!;
      const key = protect.input;
      expect(key).toMatch(/^0x[0-9a-f]{64}$/);
      for (const c of run.calls) expect(c.args.join(" ")).not.toContain(key.slice(2));
      const signer = await b.load(address);
      expect(signer.protection.backend).toBe(mode === "windows" ? "windows-dpapi" : "wsl-dpapi");
      expect(await recoverMessageAddress({ message: "w", signature: await signer.signMessage("w") })).toBe(address);
      expect(await b.has(address)).toBe(true);
      await b.remove(address);
      expect(await b.has(address)).toBe(false);
    });

    it("uses an absolute Windows PowerShell path, never $PATH", async () => {
      const b = make(fakePs());
      if (mode === "windows") expect(b.powershellPath()).toMatch(/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
      else {
        expect(b.powershellPath()).toBe("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");
        const custom = make(fakePs(), (p) => p.startsWith("/win/"), "[automount]\nroot = /win/\n");
        expect(custom.powershellPath()).toBe("/win/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");
        const none = make(fakePs(), () => false);
        expect(none.powershellPath()).toBe(null);
        expect((await none.probe()).available).toBe(false);
        expect((await catchErr(none.create())).code).toBe("SIGNER_BACKEND_UNAVAILABLE");
      }
    });

    it("maps CryptographicException on unprotect to SIGNER_LOCKED with the HRESULT", async () => {
      const address = await make(fakePs()).create();
      const e = await catchErr(make(fakePs({ fail: "UPERR:System.Security.Cryptography.CryptographicException:8009000B" })).load(address));
      expect(e.code).toBe("SIGNER_LOCKED");
      expect(e.message).toContain("HRESULT 0x8009000B");
      expect(e.hint).toMatch(/interactive Windows logon/);
    });

    it("maps a missing powershell to SIGNER_BACKEND_UNAVAILABLE and missing blob to NO_SIGNER", async () => {
      expect((await catchErr(make(fakeRun((c) => enoent(c))).create())).code).toBe("SIGNER_BACKEND_UNAVAILABLE");
      expect((await catchErr(make(fakePs()).load("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"))).code).toBe("NO_SIGNER");
    });

    it("scrubs key material from PowerShell stderr", async () => {
      const run = fakeRun((_c, _a, input) => ({ code: 1, stderr: `failed on ${input}` }));
      const e = await catchErr(make(run).create());
      expect(errorText(e)).not.toContain(run.calls[0].input.slice(2));
    });

    it("probe: canary round trip decides availability", async () => {
      expect(await make(fakePs()).probe()).toMatchObject({ available: true, level: "os-keychain" });
      const failed = await make(fakePs({ fail: "UPERR:System.Security.Cryptography.CryptographicException:8009000B" })).probe();
      expect(failed.available).toBe(false);
      expect(failed.reason).toMatch(/S4U/);
      expect((await make(fakeRun((c) => enoent(c))).probe()).available).toBe(false);
    });
  });
}

describe("wslAutomountRoot", () => {
  it("parses [automount] root and defaults to /mnt/", () => {
    expect(wslAutomountRoot(null)).toBe("/mnt/");
    expect(wslAutomountRoot("[boot]\nsystemd=true\n")).toBe("/mnt/");
    expect(wslAutomountRoot("[automount]\nenabled = true\nroot = /\n")).toBe("/");
    expect(wslAutomountRoot("[automount]\nroot=/drives # comment\n[network]\nroot = /x/\n")).toBe("/drives/");
    expect(wslAutomountRoot("[network]\nroot = /x/\n")).toBe("/mnt/");
  });
});

describe("platform gating", () => {
  it("windows-dpapi only on win32, wsl-dpapi only inside WSL", async () => {
    expect((await new WindowsDpapiBackend("windows", { platform: "darwin" }).probe()).available).toBe(false);
    expect((await new WindowsDpapiBackend("wsl", { platform: "linux", env: async () => env({ wsl: false }) }).probe()).reason).toMatch(/WSL/);
    await expect(new WindowsDpapiBackend("wsl", { platform: "linux", env: async () => env({ wsl: false }), run: fakePs() }).create()).rejects.toMatchObject({ code: "SIGNER_BACKEND_UNAVAILABLE" });
  });
});
