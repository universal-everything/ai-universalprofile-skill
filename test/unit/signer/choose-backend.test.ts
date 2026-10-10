import { afterEach, describe, expect, it } from "vitest";
import type { BackendProbe, ProtectionInfo } from "../../../src/core/types.ts";
import type { InternalBackend } from "../../../src/signer/base.ts";
import {
  BACKEND_IDS,
  autoRanking,
  chooseBackend,
  getBackend,
  listBackends,
  loadSignerFromConfig,
  probeAll,
  selectAutoBackend,
  setBackendsForTests,
} from "../../../src/signer/index.ts";
import { resetMemoryBackend } from "../../../src/signer/memory.ts";
import { catchErr, env } from "./helpers.ts";

type Avail = Partial<Record<(typeof BACKEND_IDS)[number], boolean | "attended">>;

function probes(avail: Avail): BackendProbe[] {
  return BACKEND_IDS.map((id) => {
    const a = avail[id];
    return { id, available: Boolean(a), unattended: a === true, level: "os-keychain", reason: a ? "ok" : "unavailable" };
  });
}

describe("selectAutoBackend (documented ranking)", () => {
  const all: Avail = Object.fromEntries(BACKEND_IDS.map((id) => [id, true]));

  it("macOS → macos-keychain; otherwise nothing on a GUI Mac", () => {
    const mac = env({ platform: "darwin" });
    expect(selectAutoBackend(mac, probes(all))).toBe("macos-keychain");
    expect(selectAutoBackend(mac, probes({ "protected-file": true, memory: true, "remote-signer": true }))).toBeUndefined();
    expect(selectAutoBackend(env({ platform: "darwin", headless: true, ssh: true }), probes({ "protected-file": true }))).toBe("protected-file");
  });

  it("Linux → systemd-creds, then Secret Service, then file fallbacks only where allowed", () => {
    const desk = env({ platform: "linux" });
    expect(autoRanking(desk)).toEqual(["linux-systemd-creds", "linux-secret-service"]);
    expect(selectAutoBackend(desk, probes(all))).toBe("linux-systemd-creds");
    expect(selectAutoBackend(desk, probes({ "linux-secret-service": true, "protected-file": true }))).toBe("linux-secret-service");
    expect(selectAutoBackend(desk, probes({ "protected-file": true, "vm-protected-file": true }))).toBeUndefined();

    const headless = env({ platform: "linux", headless: true });
    expect(autoRanking(headless)).toEqual(["linux-systemd-creds", "linux-secret-service", "protected-file"]);
    expect(selectAutoBackend(headless, probes({ "protected-file": true }))).toBe("protected-file");

    // A normal cloud server / container that is not declared as an agent VM: protected-file (init warns), never vm-protected-file.
    const server = env({ platform: "linux", vm: "kvm", headless: true });
    expect(autoRanking(server)).toEqual(["linux-systemd-creds", "linux-secret-service", "protected-file"]);
    expect(selectAutoBackend(server, probes({ "vm-protected-file": true, "protected-file": true }))).toBe("protected-file");
    const container = env({ platform: "linux", container: "docker", headless: false });
    expect(selectAutoBackend(container, probes({ "vm-protected-file": true, "protected-file": true }))).toBe("protected-file");

    // Declared agent VM (UP_AGENT_HOST=muse): the owner-approved in-VM file.
    const muse = env({ platform: "linux", container: "systemd-nspawn", headless: true, isolated: true, agentHost: "muse" });
    expect(autoRanking(muse)).toEqual(["linux-systemd-creds", "linux-secret-service", "vm-protected-file"]);
    expect(selectAutoBackend(muse, probes({ "vm-protected-file": true, "protected-file": true }))).toBe("vm-protected-file");
    // Inside a cloud VM systemd-creds is still preferred when the image has it.
    expect(selectAutoBackend(muse, probes({ "linux-systemd-creds": true, "vm-protected-file": true }))).toBe("linux-systemd-creds");
  });

  it("WSL2 → wsl-dpapi, then systemd-creds, then Secret Service", () => {
    const wsl = env({ platform: "linux", wsl: true });
    expect(autoRanking(wsl)).toEqual(["wsl-dpapi", "linux-systemd-creds", "linux-secret-service"]);
    expect(selectAutoBackend(wsl, probes(all))).toBe("wsl-dpapi");
    expect(selectAutoBackend(wsl, probes({ "linux-systemd-creds": true }))).toBe("linux-systemd-creds");
  });

  it("Windows → windows-dpapi", () => {
    expect(selectAutoBackend(env({ platform: "win32" }), probes(all))).toBe("windows-dpapi");
    expect(selectAutoBackend(env({ platform: "win32" }), probes({ "protected-file": true }))).toBeUndefined();
  });

  it("never picks remote-signer or memory, and skips attended-only backends", () => {
    expect(selectAutoBackend(env({ platform: "linux", isolated: true }), probes({ memory: true, "remote-signer": true }))).toBeUndefined();
    expect(selectAutoBackend(env({ platform: "darwin" }), probes({ "macos-keychain": "attended" }))).toBeUndefined();
    for (const e of [env({ platform: "darwin", headless: true, isolated: true }), env({ platform: "linux", wsl: true, headless: true }), env({ platform: "win32", isolated: true })]) {
      expect(autoRanking(e)).not.toContain("memory");
      expect(autoRanking(e)).not.toContain("remote-signer");
    }
  });
});

/** Minimal fake backend for registry-level tests. */
function fakeBackend(id: string, available: boolean): InternalBackend {
  const prot: ProtectionInfo = { backend: id, level: "os-keychain", unattended: true, encryptedAtRest: true, notes: [] };
  return {
    id,
    label: id,
    protectionInfo: () => prot,
    probe: async () => ({ id, available, unattended: available, level: "os-keychain", reason: available ? "ok" : `${id} missing` }),
    create: async () => {
      throw new Error("n/a");
    },
    load: async () => {
      throw new Error("n/a");
    },
    remove: async () => {},
    has: async () => false,
  };
}

describe("registry and chooseBackend", () => {
  afterEach(() => {
    setBackendsForTests();
    delete process.env.UP_TEST_EPHEMERAL_KEY;
    resetMemoryBackend();
  });

  it("lists all documented backend ids", () => {
    expect(listBackends().map((b) => b.id).sort()).toEqual([...BACKEND_IDS].sort());
  });

  it("getBackend throws SIGNER_BACKEND_UNAVAILABLE for unknown ids", async () => {
    const e = await catchErr(Promise.resolve().then(() => getBackend("nope")));
    expect(e.code).toBe("SIGNER_BACKEND_UNAVAILABLE");
  });

  it("probeAll survives throwing probes", async () => {
    const boom = { ...fakeBackend("macos-keychain", true), probe: async () => Promise.reject(new Error("kaboom")) };
    setBackendsForTests([boom, fakeBackend("protected-file", true)]);
    const ps = await probeAll();
    expect(ps.find((p) => p.id === "macos-keychain")).toMatchObject({ available: false, reason: expect.stringContaining("kaboom") });
  });

  it("auto picks by ranking with mocked probes", async () => {
    setBackendsForTests([fakeBackend("linux-systemd-creds", false), fakeBackend("linux-secret-service", true), fakeBackend("protected-file", true), fakeBackend("memory", true)]);
    expect((await chooseBackend("auto", env({ platform: "linux" }))).id).toBe("linux-secret-service");
  });

  it("auto without an eligible store fails with a hint to opt in explicitly", async () => {
    setBackendsForTests([fakeBackend("linux-systemd-creds", false), fakeBackend("linux-secret-service", false), fakeBackend("protected-file", true)]);
    const e = await catchErr(chooseBackend(undefined, env({ platform: "linux" })));
    expect(e.code).toBe("SIGNER_BACKEND_UNAVAILABLE");
    expect(e.hint).toContain("--backend protected-file");
    expect(e.message).toContain("linux-systemd-creds missing");
  });

  it("explicit choices: available → ok, unavailable → error, remote → NOT_SUPPORTED, unknown → error", async () => {
    setBackendsForTests([fakeBackend("protected-file", true), fakeBackend("vm-protected-file", false), fakeBackend("remote-signer", false)]);
    expect((await chooseBackend("protected-file")).id).toBe("protected-file");
    expect((await catchErr(chooseBackend("vm-protected-file"))).code).toBe("SIGNER_BACKEND_UNAVAILABLE");
    expect((await catchErr(chooseBackend("remote-signer"))).code).toBe("NOT_SUPPORTED");
    expect((await catchErr(chooseBackend("bogus"))).code).toBe("SIGNER_BACKEND_UNAVAILABLE");
  });

  it("remote-signer stub: probe unavailable, operations NOT_SUPPORTED", async () => {
    const r = getBackend("remote-signer");
    expect((await r.probe()).available).toBe(false);
    expect((await catchErr(r.create())).code).toBe("NOT_SUPPORTED");
    expect((await catchErr(r.load("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"))).code).toBe("NOT_SUPPORTED");
  });

  it("loadSignerFromConfig: NO_SIGNER with 'run: up init'; loads from the recorded backend only", async () => {
    const e = await catchErr(loadSignerFromConfig({ version: 1 }));
    expect(e.code).toBe("NO_SIGNER");
    expect(e.hint).toBe("run: up init");

    process.env.UP_TEST_EPHEMERAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const signer = await loadSignerFromConfig({ version: 1, controller: { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", backend: "memory", createdAt: "x" } });
    expect(signer.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(signer.protection.level).toBe("ephemeral");

    delete process.env.UP_TEST_EPHEMERAL_KEY;
    const off = await catchErr(loadSignerFromConfig({ version: 1, controller: { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", backend: "memory", createdAt: "x" } }));
    expect(off.code).toBe("SIGNER_BACKEND_UNAVAILABLE");
  });

  it("memory backend: disabled without UP_TEST_EPHEMERAL_KEY; fixed key returned by the first create()", async () => {
    const m = getBackend("memory");
    expect((await m.probe()).available).toBe(false);
    expect((await catchErr(m.create())).code).toBe("SIGNER_BACKEND_UNAVAILABLE");
    process.env.UP_TEST_EPHEMERAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    expect(await m.create()).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    const second = await m.create();
    expect(second).not.toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(await m.has(second)).toBe(true);
  });
});
