// Environment detection for signer selection: OS, WSL, container, VM,
// cloud-agent host hints, headless/SSH session and the systemd version.
// Everything here is read-only and non-interactive (no prompts, no network).
import { existsSync, readFileSync } from "node:fs";
import { runProcess, type RunFn } from "./proc.ts";

export type AgentHost = "dots" | "muse" | "vm";

export interface SignerEnvironment {
  platform: NodeJS.Platform;
  /** Linux running inside WSL (1 or 2). */
  wsl: boolean;
  /** Container technology if detected (docker, podman, systemd-nspawn, kubernetes, lxc, …). */
  container: string | null;
  /** Hypervisor if detected (kvm, qemu, vmware, microsoft, amazon, apple, …). WSL is not counted. */
  vm: string | null;
  /** Cloud agent host declared via UP_AGENT_HOST (dots | muse | vm). */
  agentHost: AgentHost | null;
  /** No graphical session (no DISPLAY/WAYLAND_DISPLAY on Linux, SSH session elsewhere). */
  headless: boolean;
  ssh: boolean;
  /** systemd version from `systemd-creds --version` (null when absent). */
  systemdVersion: number | null;
  /**
   * A declared cloud agent VM (UP_AGENT_HOST=dots|muse|vm) where the
   * owner-approved in-VM key file (`vm-protected-file`) applies. Detected
   * containers/VMs alone do NOT qualify (a normal cloud server is not an agent VM).
   */
  isolated: boolean;
  /** No OS key store can be expected and nobody sits at the machine: headless host or container. */
  unattendedHost: boolean;
  /** Evidence for the decisions above (shown by `up key backend` / `up doctor`). */
  hints: string[];
}

export interface EnvDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  readFile(path: string): string | null;
  exists(path: string): boolean;
  run: RunFn;
}

export function defaultEnvDeps(): EnvDeps {
  return {
    platform: process.platform,
    env: process.env,
    readFile: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    exists: (p) => existsSync(p),
    run: runProcess,
  };
}

const VM_VENDORS: [RegExp, string][] = [
  [/qemu/i, "qemu"],
  [/kvm/i, "kvm"],
  [/vmware/i, "vmware"],
  [/virtualbox|innotek/i, "virtualbox"],
  [/xen/i, "xen"],
  [/amazon ec2/i, "amazon"],
  [/google compute engine|^google$/i, "google"],
  [/microsoft corporation.*virtual|virtual machine/i, "microsoft"],
  [/firecracker/i, "firecracker"],
  [/cloud hypervisor/i, "cloud-hypervisor"],
  [/digitalocean/i, "digitalocean"],
  [/hetzner/i, "hetzner"],
  [/openstack/i, "openstack"],
  [/parallels/i, "parallels"],
  [/bochs/i, "bochs"],
  [/apple virtualization|virtualmac/i, "apple"],
];

export function parseSystemdVersion(out: string): number | null {
  const m = /^systemd\s+(\d+)/m.exec(out);
  return m ? Number(m[1]) : null;
}

function detectWsl(d: EnvDeps, hints: string[]): boolean {
  if (d.platform !== "linux") return false;
  if (d.env.WSL_DISTRO_NAME || d.env.WSL_INTEROP) {
    hints.push(`wsl: WSL_DISTRO_NAME=${d.env.WSL_DISTRO_NAME ?? "?"}`);
    return true;
  }
  const rel = d.readFile("/proc/sys/kernel/osrelease") ?? "";
  if (/microsoft|wsl/i.test(rel)) {
    hints.push("wsl: kernel osrelease mentions Microsoft/WSL");
    return true;
  }
  return false;
}

function detectContainer(d: EnvDeps, hints: string[]): string | null {
  if (d.platform !== "linux") return null;
  const envC = d.env.container?.trim();
  if (envC) {
    hints.push(`container: $container=${envC}`);
    return envC;
  }
  const runC = d.readFile("/run/systemd/container")?.trim();
  if (runC && runC !== "wsl") {
    hints.push(`container: /run/systemd/container=${runC}`);
    return runC;
  }
  if (d.exists("/.dockerenv")) {
    hints.push("container: /.dockerenv present");
    return "docker";
  }
  if (d.exists("/run/.containerenv")) {
    hints.push("container: /run/.containerenv present");
    return "podman";
  }
  if (d.env.KUBERNETES_SERVICE_HOST) {
    hints.push("container: KUBERNETES_SERVICE_HOST set");
    return "kubernetes";
  }
  const cg = d.readFile("/proc/1/cgroup") ?? "";
  const m = /(docker|kubepods|containerd|libpod|lxc)/.exec(cg);
  if (m) {
    hints.push(`container: /proc/1/cgroup mentions ${m[1]}`);
    return m[1] === "kubepods" ? "kubernetes" : m[1] === "libpod" ? "podman" : m[1];
  }
  return null;
}

async function detectVm(d: EnvDeps, wsl: boolean, hints: string[]): Promise<string | null> {
  if (wsl) return null;
  if (d.platform === "linux") {
    const r = await d.run("systemd-detect-virt", ["--vm"], { timeoutMs: 5_000 });
    if (!r.error) {
      const v = r.stdout.toString("utf8").trim();
      if (r.code === 0 && v && v !== "none") {
        hints.push(`vm: systemd-detect-virt --vm=${v}`);
        return v;
      }
      if (v === "none") return null;
    }
    const dmi = [d.readFile("/sys/class/dmi/id/sys_vendor"), d.readFile("/sys/class/dmi/id/product_name")].filter(Boolean).join(" ").trim();
    for (const [re, name] of VM_VENDORS) {
      if (dmi && re.test(dmi)) {
        hints.push(`vm: DMI "${dmi.slice(0, 60)}"`);
        return name;
      }
    }
    const cpu = d.readFile("/proc/cpuinfo") ?? "";
    if (/^flags\s*:.*\bhypervisor\b/m.test(cpu)) {
      hints.push("vm: cpu flag 'hypervisor'");
      return "hypervisor";
    }
    return null;
  }
  if (d.platform === "darwin") {
    const r = await d.run("/usr/sbin/sysctl", ["-n", "kern.hv_vmm_present"], { timeoutMs: 5_000 });
    if (!r.error && r.code === 0 && r.stdout.toString("utf8").trim() === "1") {
      hints.push("vm: kern.hv_vmm_present=1");
      return "apple";
    }
  }
  return null;
}

async function detectSystemd(d: EnvDeps, hints: string[]): Promise<number | null> {
  if (d.platform !== "linux") return null;
  const r = await d.run("systemd-creds", ["--version"], { timeoutMs: 5_000 });
  if (r.error || r.code !== 0) return null;
  const v = parseSystemdVersion(r.stdout.toString("utf8"));
  if (v !== null) hints.push(`systemd ${v}`);
  return v;
}

export async function detectEnvironment(deps: Partial<EnvDeps> = {}): Promise<SignerEnvironment> {
  const d: EnvDeps = { ...defaultEnvDeps(), ...deps };
  const hints: string[] = [];
  const ssh = Boolean(d.env.SSH_CONNECTION || d.env.SSH_CLIENT || d.env.SSH_TTY);
  const wsl = detectWsl(d, hints);
  const container = detectContainer(d, hints);
  const [vm, systemdVersion] = await Promise.all([detectVm(d, wsl, hints), detectSystemd(d, hints)]);

  let headless: boolean;
  if (d.platform === "linux") {
    const gui = Boolean(d.env.DISPLAY || d.env.WAYLAND_DISPLAY) || d.env.XDG_SESSION_TYPE === "x11" || d.env.XDG_SESSION_TYPE === "wayland";
    headless = !gui;
  } else {
    headless = ssh;
  }
  if (headless) hints.push(ssh ? "headless: SSH session" : "headless: no graphical session");

  let agentHost: AgentHost | null = null;
  const declared = d.env.UP_AGENT_HOST?.trim().toLowerCase();
  if (declared) {
    if (declared === "dots" || declared === "muse" || declared === "vm") agentHost = declared;
    else if (declared === "cloud" || declared === "cloud-vm") agentHost = "vm";
    else hints.push(`UP_AGENT_HOST=${declared.slice(0, 32)} ignored (expected dots, muse or vm)`);
    if (agentHost) hints.push(`agent host declared: ${agentHost}`);
  }

  const isolated = agentHost !== null;
  const unattendedHost = headless || container !== null;
  return { platform: d.platform, wsl, container, vm, agentHost, headless, ssh, systemdVersion, isolated, unattendedHost, hints };
}

let cached: Promise<SignerEnvironment> | undefined;

/** Cached detection for the current process. */
export function environment(): Promise<SignerEnvironment> {
  if (!cached) cached = detectEnvironment();
  return cached;
}

export interface EphemeralCheck {
  ephemeral: boolean;
  reason?: string;
}

const TMP_PREFIXES = ["/tmp/", "/var/tmp/", "/dev/shm/", "/private/tmp/", "/private/var/tmp/", "/private/var/folders/", "/run/user/"];
const VOLATILE_FS = new Set(["tmpfs", "ramfs", "overlay", "aufs", "devtmpfs"]);

/** Mount point/fstype covering `path` from /proc/mounts content (longest prefix wins). */
export function mountFor(path: string, procMounts: string): { mount: string; fstype: string } | null {
  let best: { mount: string; fstype: string } | null = null;
  for (const line of procMounts.split("\n")) {
    const parts = line.split(" ");
    if (parts.length < 3) continue;
    const mount = parts[1].replace(/\\040/g, " ");
    const inside = mount === "/" || path === mount || path.startsWith(mount.endsWith("/") ? mount : `${mount}/`);
    if (inside && (!best || mount.length > best.mount.length)) best = { mount, fstype: parts[2] };
  }
  return best;
}

/**
 * Heuristic: does the state directory look like it will not survive (temp
 * directory, tmpfs, or a container's overlay root without a volume)?
 */
export function checkEphemeralHome(home: string, deps: { tmpdir?: string; procMounts?: string | null } = {}): EphemeralCheck {
  const p = home.endsWith("/") ? home : `${home}/`;
  const tmp = deps.tmpdir ? (deps.tmpdir.endsWith("/") ? deps.tmpdir : `${deps.tmpdir}/`) : undefined;
  for (const prefix of [...TMP_PREFIXES, ...(tmp ? [tmp] : [])]) {
    if (p.startsWith(prefix)) return { ephemeral: true, reason: `it is inside the temporary directory ${prefix.slice(0, -1)}` };
  }
  if (deps.procMounts) {
    const m = mountFor(home, deps.procMounts);
    if (m && VOLATILE_FS.has(m.fstype)) {
      return { ephemeral: true, reason: m.fstype === "overlay" || m.fstype === "aufs" ? `it is on the container's ${m.fstype} filesystem (${m.mount}), not on a persistent volume` : `it is on a ${m.fstype} (in-memory) filesystem` };
    }
  }
  return { ephemeral: false };
}

/** Tests only: replace or clear the cached environment. */
export function setEnvironmentForTests(env: SignerEnvironment | undefined): void {
  cached = env ? Promise.resolve(env) : undefined;
}
