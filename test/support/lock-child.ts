// Test helper (never shipped): holds the product's cross-process lock for a while and logs
// "<tag> enter <ms>" / "<tag> exit <ms>". Run as: node --import tsx lock-child.ts <home> <log> <tag> <holdMs> [name]
import { appendFileSync } from "node:fs";
import { withLock } from "../../src/core/lock.ts";

const [home, log, tag, holdMs, name = "write"] = process.argv.slice(2);
await withLock(home, name, async () => {
  appendFileSync(log, `${tag} enter ${Date.now()}\n`);
  await new Promise((r) => setTimeout(r, Number(holdMs)));
  appendFileSync(log, `${tag} exit ${Date.now()}\n`);
});
