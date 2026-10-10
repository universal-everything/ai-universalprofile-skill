import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { recoverMessageAddress, type Hex } from "viem";
import { ProtectedFileBackend } from "../../../src/signer/protected-file.ts";
import { catchErr, env, errorText, tempHome } from "./helpers.ts";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex; // hardhat #1
const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const posix = process.platform !== "win32";

let home: Awaited<ReturnType<typeof tempHome>>;
const savedHome = process.env.UP_HOME;

beforeEach(async () => {
  home = await tempHome();
  process.env.UP_HOME = home.dir;
});
afterEach(async () => {
  if (savedHome === undefined) delete process.env.UP_HOME;
  else process.env.UP_HOME = savedHome;
  await home.cleanup();
});

for (const variant of ["protected-file", "vm-protected-file"] as const) {
  describe(variant, () => {
    const make = () => new ProtectedFileBackend(variant, { env: async () => env({ isolated: true, agentHost: "muse" }) });

    it("creates, loads, signs and removes a key with 0600 file / 0700 dir", async () => {
      const b = make();
      const address = await b.create();
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(await b.has(address)).toBe(true);
      const keysDir = join(home.dir, "keys");
      const file = join(keysDir, `${address.toLowerCase()}.key`);
      expect(existsSync(file)).toBe(true);
      if (posix) {
        expect((await stat(file)).mode & 0o777).toBe(0o600);
        expect((await stat(keysDir)).mode & 0o777).toBe(0o700);
      }
      expect(await readFile(file, "utf8")).toMatch(/^0x[0-9a-f]{64}\n$/);
      expect((await readdir(keysDir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);

      const signer = await b.load(address);
      expect(signer.address).toBe(address);
      expect(signer.protection.level).toBe(variant);
      expect(signer.protection.encryptedAtRest).toBe(false);
      const sig = await signer.signMessage("x");
      expect(await recoverMessageAddress({ message: "x", signature: sig })).toBe(address);

      await b.remove(address);
      expect(await b.has(address)).toBe(false);
      expect(existsSync(file)).toBe(false);
      await b.remove(address); // idempotent
    });

    it("imports a known key and refuses to overwrite it", async () => {
      const b = make();
      expect(await b.importKey(KEY)).toBe(ADDR);
      const e = await catchErr(b.importKey(KEY));
      expect(e.code).toBe("INTERNAL");
      expect(errorText(e)).not.toContain(KEY.slice(2));
    });

    it("fails closed with key-free errors on missing, too-open, malformed or symlinked files", async () => {
      const b = make();
      await b.importKey(KEY);
      const file = join(home.dir, "keys", `${ADDR.toLowerCase()}.key`);

      const missing = await catchErr(b.load("0x0000000000000000000000000000000000000001"));
      expect(missing.code).toBe("NO_SIGNER");

      if (posix) {
        await chmod(file, 0o644);
        const open = await catchErr(b.load(ADDR));
        expect(open.code).toBe("SIGNER_LOCKED");
        expect(open.hint).toContain("chmod 600");
        expect(errorText(open)).not.toContain(KEY.slice(2));
        await chmod(file, 0o600);

        await chmod(join(home.dir, "keys"), 0o755);
        const dirOpen = await catchErr(b.load(ADDR));
        expect(dirOpen.code).toBe("SIGNER_LOCKED");
        expect(dirOpen.hint).toContain("chmod 700");
        await chmod(join(home.dir, "keys"), 0o700);
      }

      await writeFile(file, `${KEY}garbage\n`, { mode: 0o600 });
      const malformed = await catchErr(b.load(ADDR));
      expect(malformed.code).toBe("SIGNER_LOCKED");
      expect(errorText(malformed)).not.toContain(KEY.slice(2));

      // A valid key for a different address under this name → refused.
      await writeFile(file, "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba\n", { mode: 0o600 });
      const swapped = await catchErr(b.load(ADDR));
      expect(swapped.code).toBe("SIGNER_LOCKED");
      expect(swapped.message).toContain("different address");

      if (posix) {
        const other = join(home.dir, "elsewhere.key");
        await writeFile(other, `${KEY}\n`, { mode: 0o600 });
        await writeFile(file, "", { mode: 0o600 });
        await b.remove(ADDR);
        await symlink(other, file);
        const link = await catchErr(b.load(ADDR));
        expect(link.code).toBe("SIGNER_LOCKED");
        expect(link.message).toContain("symlink");
      }
    });
  });
}

describe("probe levels", () => {
  it("vm-protected-file: explicit opt-in only; the probe explains the declaration", async () => {
    const undeclared = await new ProtectedFileBackend("vm-protected-file", { env: async () => env({ container: "docker", headless: true }) }).probe();
    expect(undeclared).toMatchObject({ available: true, level: "vm-protected-file" });
    expect(undeclared.reason).toMatch(/UP_AGENT_HOST/);
    expect(undeclared.reason).toMatch(/never chosen automatically/);
    const yes = await new ProtectedFileBackend("vm-protected-file", { env: async () => env({ isolated: true, agentHost: "muse" }) }).probe();
    expect(yes).toMatchObject({ available: true, unattended: true, level: "vm-protected-file" });
    expect(yes.reason).toContain("muse");
  });

  it("protected-file is always available but labelled as not encrypted, with the custody warning", async () => {
    const b = new ProtectedFileBackend("protected-file");
    const p = await b.probe();
    expect(p).toMatchObject({ available: true, level: "protected-file" });
    expect(p.reason).toContain("NOT encrypted at rest");
    expect(b.protectionInfo().encryptedAtRest).toBe(false);
    expect(b.protectionInfo().notes[0]).toContain("add a human controller as recovery");
  });
});
