// Cross-process advisory locks in $UP_HOME/locks/. State-changing verbs run under the "write"
// lock, so parallel CLI invocations (or a CLI call next to the MCP server) never race on the
// controller's transaction nonce, LSP25 nonces or the daily policy counter; config.json and each
// profile record have their own locks.
//
// Scope: ONE state folder. The same key used from another UP_HOME, another machine, a wallet app or
// another tool is not serialised by these locks; there is no global nonce reservation.
//
// Ownership: a lock file holds {pid, host, token, at}. The token is new for every acquisition and the
// holder touches the file (heartbeat) while it runs. A lock is taken over only when its holder is
// gone: its pid is dead on this host, or its heartbeat stopped for longer than UP_LOCK_STALE_MS and
// did not resume while the waiter watched two more heartbeat periods (a frozen or suspended process,
// a reused pid, another host). Take-over (an atomic replace) and release both run under a short
// breaker lock and re-check the file there, so no process removes or replaces a lock it does not own.
import { link, mkdir, open, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { UpError } from "./errors.ts";

const staleMs = () => Number(process.env.UP_LOCK_STALE_MS ?? 15 * 60_000);
const waitMs = () => Number(process.env.UP_LOCK_WAIT_MS ?? 10 * 60_000);
/** How often a holder touches its lock file: a quarter of the stale interval, at least once a minute. */
const beatMs = () => Math.max(20, Math.min(staleMs() / 4, 60_000));
/** A lock file is written in one step, so one that stays unreadable this long is damage, not a holder. */
const UNREADABLE_MS = 30_000;
/** The breaker is held for two file operations; one older than this was abandoned. */
const BREAKER_MS = 30_000;
const HOST = hostname();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface LockFile {
  raw: string;
  pid?: number;
  host?: string;
  token?: string;
  /** last sign of life: the newer of the file's mtime (heartbeat) and its `at` */
  beat: number;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

/** Creates `file` holding `content` in one step (hard link of a complete temp file); false when it exists. */
async function createExclusive(file: string, content: string): Promise<boolean> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, content, { mode: 0o600 });
  try {
    await link(tmp, file);
    return true;
  } catch (e: any) {
    if (e?.code === "EEXIST") return false;
    if (!["EPERM", "ENOTSUP", "ENOSYS", "EXDEV", "EOPNOTSUPP"].includes(e?.code)) throw e;
    // filesystem without hard links: exclusive create, content written right after
    try {
      const fh = await open(file, "wx", 0o600);
      try {
        await fh.writeFile(content);
      } finally {
        await fh.close();
      }
      return true;
    } catch (e2: any) {
      if (e2?.code === "EEXIST") return false;
      throw e2;
    }
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/** The lock file as it is now, or undefined when there is none. */
async function inspect(file: string): Promise<LockFile | undefined> {
  try {
    const raw = await readFile(file, "utf8");
    const st = await stat(file);
    let o: any = {};
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object") o = j;
    } catch {}
    return {
      raw,
      pid: Number.isInteger(o.pid) ? o.pid : undefined,
      host: typeof o.host === "string" ? o.host : undefined,
      token: typeof o.token === "string" ? o.token : undefined,
      beat: Math.max(st.mtimeMs, typeof o.at === "number" ? o.at : 0),
    };
  } catch (e: any) {
    if (e?.code === "ENOENT") return undefined;
    throw e;
  }
}

/** dead: the holder is provably gone; quiet: no heartbeat for longer than the stale interval; live otherwise. */
function holderState(l: LockFile, now: number): "dead" | "quiet" | "live" {
  // lock files of older versions carry no host: they were written on this machine
  if (l.pid !== undefined && (l.host === undefined || l.host === HOST) && !alive(l.pid)) return "dead";
  if (l.pid === undefined) return now - l.beat > Math.min(UNREADABLE_MS, staleMs()) ? "dead" : "live";
  return now - l.beat > staleMs() ? "quiet" : "live";
}

/** Atomically replaces `file` (rename over it; retried while another process has it open on Windows). */
async function replaceFile(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, content, { mode: 0o600 });
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, file);
      return;
    } catch (e: any) {
      if (i >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(e?.code)) {
        await unlink(tmp).catch(() => {});
        throw e;
      }
      await sleep(25);
    }
  }
}

/** Removes an abandoned breaker, but only the very file that was judged abandoned. */
async function clearAbandoned(breaker: string, seen: LockFile): Promise<void> {
  const moved = `${breaker}.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    await rename(breaker, moved);
  } catch {
    return; // gone or replaced meanwhile
  }
  const got = await readFile(moved, "utf8").catch(() => undefined);
  if (got !== seen.raw) await link(moved, breaker).catch(() => {}); // not the one we judged: put it back
  await unlink(moved).catch(() => {});
}

/** Runs `fn` while holding `<file>.break`; false when the breaker could not be had within BREAKER_MS. */
async function underBreaker(file: string, fn: () => Promise<boolean>): Promise<boolean> {
  const breaker = `${file}.break`;
  const mine = JSON.stringify({ pid: process.pid, host: HOST, token: randomBytes(8).toString("hex"), at: Date.now() });
  const until = Date.now() + BREAKER_MS;
  for (let d = 5; ; d = Math.min(d * 2, 200)) {
    if (await createExclusive(breaker, mine)) break;
    const b = await inspect(breaker);
    if (b && ((b.pid !== undefined && (b.host === undefined || b.host === HOST) && !alive(b.pid)) || Date.now() - b.beat > BREAKER_MS)) await clearAbandoned(breaker, b);
    if (Date.now() > until) return false;
    await sleep(d);
  }
  try {
    return await fn();
  } finally {
    if ((await inspect(breaker).catch(() => undefined))?.raw === mine) await unlink(breaker).catch(() => {});
  }
}

export async function withLock<T>(home: string, name: string, fn: () => Promise<T>): Promise<T> {
  const dir = join(home, "locks");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${name}.lock`);
  const token = randomBytes(16).toString("hex");
  const record = () => JSON.stringify({ pid: process.pid, host: HOST, token, at: Date.now() });
  const started = Date.now();
  let delay = 50;
  let watched: { raw: string; beat: number; since: number } | undefined;
  for (;;) {
    if (await createExclusive(file, record())) break;
    const cur = await inspect(file);
    if (!cur) continue; // released meanwhile: try again at once
    const now = Date.now();
    const state = holderState(cur, now);
    let takeOver = state === "dead";
    if (state === "quiet") {
      // no heartbeat for longer than the stale interval: a suspended holder gets two more heartbeat periods to resume
      if (!watched || watched.raw !== cur.raw || watched.beat !== cur.beat) watched = { raw: cur.raw, beat: cur.beat, since: now };
      else takeOver = now - watched.since >= 2 * beatMs();
    } else if (state === "live") watched = undefined;
    if (
      takeOver &&
      (await underBreaker(file, async () => {
        const again = await inspect(file);
        if (!again || again.raw !== cur.raw || again.beat > cur.beat || holderState(again, Date.now()) === "live") return false;
        await replaceFile(file, record());
        return true;
      }))
    )
      break;
    if (Date.now() - started > waitMs()) {
      const who = cur.pid !== undefined ? `, held by process ${cur.pid}${cur.host && cur.host !== HOST ? ` on ${cur.host}` : ""}` : "";
      throw new UpError("INTERNAL", `another up process is still sending (lock ${file}${who})`, { hint: "wait for it to finish, then retry" });
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 1000);
  }
  const heartbeat = setInterval(() => {
    void inspect(file)
      .then((cur) => (cur?.token === token ? utimes(file, new Date(), new Date()) : undefined))
      .catch(() => {});
  }, beatMs());
  heartbeat.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    // release only our own lock: a holder that was taken over (suspended too long) must not remove the new one
    await underBreaker(file, async () => {
      if ((await inspect(file))?.token === token) await unlink(file);
      return true;
    }).catch(() => {});
  }
}
