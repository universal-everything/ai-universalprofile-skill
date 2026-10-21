// Cross-process locks (src/core/lock.ts) with real OS processes: mutual exclusion inside one UP_HOME,
// a heartbeat that keeps a long-running holder's lock, take-over only of holders that are gone, and a
// release that never removes a lock the process no longer owns.
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { withLock } from "../../../src/core/lock.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CHILD = join(ROOT, "test", "support", "lock-child.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const start = (args: string[], env: Record<string, string> = {}): ChildProcess =>
  spawn(process.execPath, ["--import", "tsx", CHILD, ...args], { cwd: ROOT, stdio: "ignore", env: { ...process.env, ...env } });
const exited = (p: ChildProcess) => new Promise<number | null>((res) => (p.exitCode !== null ? res(p.exitCode) : p.on("exit", (c) => res(c))));
const events = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);
async function waitFor(log: string, line: RegExp, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!events(log).some((l) => line.test(l))) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${line} in ${events(log).join(" | ")}`);
    await sleep(20);
  }
}
function intervals(log: string): Record<string, { s: number; e: number }> {
  const m: Record<string, { s: number; e: number }> = {};
  for (const l of events(log)) {
    const [tag, kind, t] = l.split(" ");
    m[tag] ??= { s: NaN, e: NaN };
    if (kind === "enter") m[tag].s = Number(t);
    else m[tag].e = Number(t);
  }
  return m;
}
const overlap = (iv: { s: number; e: number }[]) => [...iv].sort((a, b) => a.s - b.s).some((x, i, a) => i > 0 && x.s < a[i - 1].e);
/** pid of a process that has already exited */
async function deadPid(): Promise<number> {
  const p = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await exited(p);
  return p.pid!;
}
const home = () => mkdtempSync(join(tmpdir(), "up-lock-"));
const lockFile = (h: string, name = "write") => join(h, "locks", `${name}.lock`);

const saved = process.env.UP_LOCK_STALE_MS;
afterEach(() => {
  if (saved === undefined) delete process.env.UP_LOCK_STALE_MS;
  else process.env.UP_LOCK_STALE_MS = saved;
});

describe("lock: real processes on one UP_HOME", () => {
  it("three processes acquiring at the same time never overlap", async () => {
    const h = home();
    const log = join(h, "log");
    const ps = ["p0", "p1", "p2"].map((t) => start([h, log, t, "300"]));
    expect(await Promise.all(ps.map(exited))).toEqual([0, 0, 0]);
    const iv = intervals(log);
    expect(Object.keys(iv).sort()).toEqual(["p0", "p1", "p2"]);
    expect(overlap(Object.values(iv))).toBe(false);
  }, 60_000);

  it("a live holder that runs longer than UP_LOCK_STALE_MS keeps the lock (heartbeat): the next process waits", async () => {
    const h = home();
    const log = join(h, "log");
    const env = { UP_LOCK_STALE_MS: "600" };
    const p0 = start([h, log, "p0", "2600"], env);
    await waitFor(log, /^p0 enter/);
    await sleep(300);
    const p1 = start([h, log, "p1", "100"], env);
    expect(await Promise.all([exited(p0), exited(p1)])).toEqual([0, 0]);
    const iv = intervals(log);
    expect(iv.p1.s).toBeGreaterThanOrEqual(iv.p0.e);
  }, 60_000);

  it("a holder that died without releasing is taken over at once (its pid is gone), long before the stale interval", async () => {
    const h = home();
    const log = join(h, "log");
    const p0 = start([h, log, "p0", "60000"]);
    await waitFor(log, /^p0 enter/);
    p0.kill("SIGKILL");
    await exited(p0);
    const t = Date.now();
    const p1 = start([h, log, "p1", "50"]);
    expect(await exited(p1)).toBe(0);
    expect(intervals(log).p1.s - t).toBeLessThan(15_000);
  }, 60_000);

  it.skipIf(process.platform === "win32")(
    "a suspended holder is taken over only after the stale interval and a grace period; its late release does not remove the new lock",
    async () => {
      const h = home();
      const log = join(h, "log");
      const env = { UP_LOCK_STALE_MS: "600" };
      const p0 = start([h, log, "p0", "1200"], env);
      await waitFor(log, /^p0 enter/);
      process.kill(p0.pid!, "SIGSTOP");
      const stoppedAt = Date.now();
      const p1 = start([h, log, "p1", "3000"], env);
      await waitFor(log, /^p1 enter/);
      expect(intervals(log).p1.s - stoppedAt).toBeGreaterThanOrEqual(600); // never before the stale interval
      const p1Lock = readFileSync(lockFile(h), "utf8");
      process.kill(p0.pid!, "SIGCONT"); // p0 wakes up, finishes its work and releases
      expect(await exited(p0)).toBe(0);
      expect(readFileSync(lockFile(h), "utf8")).toBe(p1Lock); // p0 did not remove p1's lock
      const p2 = start([h, log, "p2", "50"], env);
      expect(await Promise.all([exited(p1), exited(p2)])).toEqual([0, 0]);
      const iv = intervals(log);
      expect(iv.p2.s).toBeGreaterThanOrEqual(iv.p1.e); // p1 still held the lock after p0's release
    },
    60_000,
  );

  it("several processes racing to take over the same dead holder's lock still enter one at a time", async () => {
    const h = home();
    const log = join(h, "log");
    mkdirSync(join(h, "locks"), { recursive: true });
    writeFileSync(lockFile(h), JSON.stringify({ pid: await deadPid(), host: hostname(), token: "gone", at: Date.now() }));
    const ps = ["a", "b", "c", "d"].map((t) => start([h, log, t, "200"]));
    expect(await Promise.all(ps.map(exited))).toEqual([0, 0, 0, 0]);
    const iv = intervals(log);
    expect(Object.keys(iv)).toHaveLength(4);
    expect(overlap(Object.values(iv))).toBe(false);
  }, 60_000);
});

describe("lock: ownership in one process", () => {
  it("release removes only its own lock: a lock taken over meanwhile stays", async () => {
    const h = home();
    const other = JSON.stringify({ pid: process.pid, host: hostname(), token: "someone-else", at: Date.now() });
    await withLock(h, "t", async () => {
      writeFileSync(lockFile(h, "t"), other); // as if another process had taken it over
    });
    expect(readFileSync(lockFile(h, "t"), "utf8")).toBe(other);
  });

  it("releases its own lock and removes the breaker", async () => {
    const h = home();
    await withLock(h, "t", async () => expect(existsSync(lockFile(h, "t"))).toBe(true));
    expect(existsSync(lockFile(h, "t"))).toBe(false);
    expect(existsSync(lockFile(h, "t") + ".break")).toBe(false);
  });

  it("the holder touches its lock file while it runs (heartbeat)", async () => {
    process.env.UP_LOCK_STALE_MS = "400"; // heartbeat every 100 ms
    const h = home();
    await withLock(h, "t", async () => {
      const m0 = statSync(lockFile(h, "t")).mtimeMs;
      await sleep(450);
      expect(statSync(lockFile(h, "t")).mtimeMs).toBeGreaterThan(m0);
    });
  });

  it("a quiet lock of a live process is taken over only after two more heartbeat periods without any sign of life", async () => {
    process.env.UP_LOCK_STALE_MS = "400"; // heartbeat 100 ms → grace 200 ms
    const h = home();
    mkdirSync(join(h, "locks"), { recursive: true });
    const old = (Date.now() - 5_000) / 1000;
    // a live pid (this test's parent) with an old heartbeat: a frozen holder or a reused pid
    writeFileSync(lockFile(h, "t"), JSON.stringify({ pid: process.ppid, host: hostname(), token: "frozen", at: Date.now() - 5_000 }));
    utimesSync(lockFile(h, "t"), old, old);
    let t = Date.now();
    await withLock(h, "t", async () => {});
    expect(Date.now() - t).toBeGreaterThanOrEqual(190);

    // the same holder showing life (touching its file) keeps the lock until it stops for longer than the stale interval
    writeFileSync(lockFile(h, "t"), JSON.stringify({ pid: process.ppid, host: hostname(), token: "frozen2", at: Date.now() - 5_000 }));
    utimesSync(lockFile(h, "t"), old, old);
    t = Date.now();
    const toucher = setInterval(() => {
      const now = new Date();
      if (Date.now() - t < 600) utimesSync(lockFile(h, "t"), now, now);
    }, 50);
    try {
      await withLock(h, "t", async () => {});
    } finally {
      clearInterval(toucher);
    }
    expect(Date.now() - t).toBeGreaterThanOrEqual(600 + 400 + 190);
  });

  it("dead holders are taken over at once, also lock files of older versions ({pid, at}) and unreadable ones once old", async () => {
    process.env.UP_LOCK_STALE_MS = "400";
    const h = home();
    mkdirSync(join(h, "locks"), { recursive: true });
    writeFileSync(lockFile(h, "a"), JSON.stringify({ pid: await deadPid(), at: Date.now() }));
    let t = Date.now();
    await withLock(h, "a", async () => {});
    expect(Date.now() - t).toBeLessThan(2_000);
    writeFileSync(lockFile(h, "b"), "{not json");
    const old = (Date.now() - 5_000) / 1000;
    utimesSync(lockFile(h, "b"), old, old);
    t = Date.now();
    await withLock(h, "b", async () => {});
    expect(Date.now() - t).toBeLessThan(2_000);
  });

  it("two waiters in one process are serialised as well", async () => {
    const h = home();
    const seen: string[] = [];
    const job = (tag: string) => withLock(h, "t", async () => {
      seen.push(`${tag}+`);
      await sleep(50);
      seen.push(`${tag}-`);
    });
    await Promise.all([job("a"), job("b"), job("c")]);
    for (let i = 0; i < seen.length; i += 2) expect(seen[i + 1]).toBe(seen[i].replace("+", "-"));
  });
});
