import { describe, expect, it } from "vitest";
import { checkEphemeralHome, detectEnvironment, mountFor, parseSystemdVersion, type EnvDeps } from "../../../src/signer/env.ts";
import { enoent, fakeRun, out } from "./helpers.ts";

function deps(over: Partial<EnvDeps> & { files?: Record<string, string>; virt?: string | null; systemd?: string | null } = {}): Partial<EnvDeps> {
  const files = over.files ?? {};
  return {
    platform: over.platform ?? "linux",
    env: over.env ?? {},
    readFile: (p) => files[p] ?? null,
    exists: (p) => p in files,
    run:
      over.run ??
      fakeRun((cmd) => {
        if (cmd === "systemd-detect-virt") return over.virt === undefined || over.virt === null ? enoent(cmd) : { code: over.virt === "none" ? 1 : 0, stdout: out(over.virt + "\n") };
        if (cmd === "systemd-creds") return over.systemd ? { stdout: out(over.systemd) } : enoent(cmd);
        if (cmd === "/usr/sbin/sysctl") return { stdout: out("0\n") };
        return enoent(cmd);
      }),
  };
}

describe("detectEnvironment", () => {
  it("parses systemd versions", () => {
    expect(parseSystemdVersion("systemd 256 (256.7-1)\n+PAM")).toBe(256);
    expect(parseSystemdVersion("nope")).toBe(null);
  });

  it("Linux desktop: not headless, not isolated", async () => {
    const e = await detectEnvironment(deps({ env: { DISPLAY: ":0" }, virt: "none", systemd: "systemd 257 (257)\n" }));
    expect(e).toMatchObject({ platform: "linux", wsl: false, container: null, vm: null, headless: false, isolated: false, systemdVersion: 257 });
  });

  it("WSL via env or kernel release; WSL is neither VM nor container", async () => {
    const a = await detectEnvironment(deps({ env: { WSL_DISTRO_NAME: "Ubuntu" }, virt: "wsl", files: { "/run/systemd/container": "wsl\n" } }));
    expect(a).toMatchObject({ wsl: true, vm: null, container: null, isolated: false });
    const b = await detectEnvironment(deps({ files: { "/proc/sys/kernel/osrelease": "5.15.153.1-microsoft-standard-WSL2" } }));
    expect(b.wsl).toBe(true);
  });

  it("containers: docker, podman, systemd-nspawn (Muse-style), kubernetes, cgroup", async () => {
    expect((await detectEnvironment(deps({ files: { "/.dockerenv": "" } }))).container).toBe("docker");
    expect((await detectEnvironment(deps({ files: { "/run/.containerenv": "" } }))).container).toBe("podman");
    const nspawn = await detectEnvironment(deps({ env: { container: "systemd-nspawn" } }));
    // A container alone is NOT a declared agent VM, but it is an unattended host.
    expect(nspawn).toMatchObject({ container: "systemd-nspawn", isolated: false, unattendedHost: true });
    expect((await detectEnvironment(deps({ env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" } }))).container).toBe("kubernetes");
    expect((await detectEnvironment(deps({ files: { "/proc/1/cgroup": "0::/system.slice/containerd.service" } }))).container).toBe("containerd");
  });

  it("VMs: systemd-detect-virt, DMI fallback, cpu flag; a normal cloud server is never a declared agent VM", async () => {
    const headlessVm = await detectEnvironment(deps({ virt: "kvm" }));
    expect(headlessVm).toMatchObject({ vm: "kvm", headless: true, isolated: false, unattendedHost: true });
    const desktopVm = await detectEnvironment(deps({ virt: "vmware", env: { WAYLAND_DISPLAY: "wayland-0" } }));
    expect(desktopVm).toMatchObject({ vm: "vmware", headless: false, isolated: false, unattendedHost: false });
    const dmi = await detectEnvironment(deps({ files: { "/sys/class/dmi/id/sys_vendor": "Amazon EC2\n" } }));
    expect(dmi.vm).toBe("amazon");
    const cpu = await detectEnvironment(deps({ files: { "/proc/cpuinfo": "processor: 0\nflags\t\t: fpu vme hypervisor lahf_lm\n" } }));
    expect(cpu.vm).toBe("hypervisor");
    expect((await detectEnvironment(deps({ virt: "none", files: { "/proc/cpuinfo": "flags : hypervisor" } }))).vm).toBe(null);
  });

  it("UP_AGENT_HOST declares a cloud agent host", async () => {
    const e = await detectEnvironment(deps({ env: { UP_AGENT_HOST: "dots", DISPLAY: ":0" } }));
    expect(e).toMatchObject({ agentHost: "dots", isolated: true });
    const bad = await detectEnvironment(deps({ env: { UP_AGENT_HOST: "laptop", DISPLAY: ":0" } }));
    expect(bad.agentHost).toBe(null);
    expect(bad.hints.join(" ")).toMatch(/ignored/);
  });

  it("macOS: headless only over SSH; VM via kern.hv_vmm_present", async () => {
    const mac = await detectEnvironment(deps({ platform: "darwin" }));
    expect(mac).toMatchObject({ platform: "darwin", headless: false, vm: null, isolated: false, systemdVersion: null });
    const ssh = await detectEnvironment(deps({ platform: "darwin", env: { SSH_CONNECTION: "1 2 3 4" } }));
    expect(ssh).toMatchObject({ headless: true, ssh: true, isolated: false });
    const vm = await detectEnvironment(deps({ platform: "darwin", run: fakeRun((cmd) => (cmd === "/usr/sbin/sysctl" ? { stdout: out("1\n") } : enoent(cmd))) }));
    expect(vm.vm).toBe("apple");
  });

  it("ephemeral UP_HOME: temp dirs, tmpfs and container overlay roots; persistent volumes are fine", () => {
    expect(checkEphemeralHome("/tmp/up").ephemeral).toBe(true);
    expect(checkEphemeralHome("/private/var/folders/xy/T/up").ephemeral).toBe(true);
    expect(checkEphemeralHome("/scratch/up", { tmpdir: "/scratch" }).ephemeral).toBe(true);
    expect(checkEphemeralHome("/home/agent/.universal-profile").ephemeral).toBe(false);
    const docker = "overlay / overlay rw,relatime 0 0\nproc /proc proc rw 0 0\n/dev/sda1 /data ext4 rw 0 0\n";
    const overlay = checkEphemeralHome("/root/.universal-profile", { procMounts: docker });
    expect(overlay).toMatchObject({ ephemeral: true });
    expect(overlay.reason).toMatch(/overlay/);
    expect(checkEphemeralHome("/data/up", { procMounts: docker }).ephemeral).toBe(false);
    expect(checkEphemeralHome("/home/a/up", { procMounts: "/dev/sda1 / ext4 rw 0 0\ntmpfs /home/a tmpfs rw 0 0\n" }).reason).toMatch(/tmpfs/);
    expect(mountFor("/database/x", "/dev/sda1 / ext4 rw 0 0\n/dev/sdb /data ext4 rw 0 0\n")).toEqual({ mount: "/", fstype: "ext4" });
  });

  it("real detection on this machine does not throw", async () => {
    const e = await detectEnvironment();
    expect(e.platform).toBe(process.platform);
  });
});
