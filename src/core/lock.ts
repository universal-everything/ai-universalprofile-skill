// Cross-process advisory lock in $UP_HOME/locks/. State-changing verbs run under
// it so parallel CLI invocations (or a CLI call next to the MCP server) never race
// on the controller's transaction nonce, LSP25 nonces or the daily policy counter.
// Stale locks (holder process gone, or older than the timeout) are taken over.
import { writeFile, link, readFile, unlink, mkdir, stat, open } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { UpError } from "./errors.ts";

const STALE_MS = Number(process.env.UP_LOCK_STALE_MS ?? 15 * 60_000);
const WAIT_MS = Number(process.env.UP_LOCK_WAIT_MS ?? 10 * 60_000);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

export async function withLock<T>(home: string, name: string, fn: () => Promise<T>): Promise<T> {
  const dir = join(home, "locks");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${name}.lock`);
  const started = Date.now();
  let delay = 50;
  for (;;) {
    // Atomic acquisition: the lock content is written to a unique temp file first and then
    // hard-linked into place, so a lock file never exists without its owner record.
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
    await writeFile(tmp, JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600 });
    try {
      await link(tmp, file);
      await unlink(tmp).catch(() => {});
      break;
    } catch (e: any) {
      await unlink(tmp).catch(() => {});
      if (["EPERM", "ENOTSUP", "ENOSYS", "EXDEV", "EOPNOTSUPP"].includes(e?.code)) {
        // filesystem without hard links: exclusive create (content written immediately after)
        try {
          const fh = await open(file, "wx", 0o600);
          await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
          await fh.close();
          break;
        } catch (e2: any) {
          if (e2?.code !== "EEXIST") throw e2;
        }
      } else if (e?.code !== "EEXIST") throw e;
    }
    let stale = false;
    try {
      const info = JSON.parse(await readFile(file, "utf8"));
      stale = !alive(info.pid) || Date.now() - info.at > STALE_MS;
    } catch {
      // unreadable lock: held, unless it is clearly old
      const st = await stat(file).catch(() => undefined);
      stale = st ? Date.now() - st.mtimeMs > 30_000 : true;
    }
    if (stale) {
      // take over only if the file is still the same stale lock (re-read right before removal)
      const again = await readFile(file, "utf8").catch(() => undefined);
      const st = await stat(file).catch(() => undefined);
      if (again !== undefined && st && (() => { try { const i = JSON.parse(again); return !alive(i.pid) || Date.now() - i.at > STALE_MS; } catch { return Date.now() - st.mtimeMs > 30_000; } })()) {
        await unlink(file).catch(() => {});
      }
      continue;
    }
    if (Date.now() - started > WAIT_MS) throw new UpError("INTERNAL", `another up process is still sending (lock ${file})`, { hint: "wait for it to finish, then retry" });
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 1000);
  }
  try {
    return await fn();
  } finally {
    await unlink(file).catch(() => {});
  }
}
