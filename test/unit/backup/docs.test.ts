// The backup documents: every verb is explained where the agent looks, the human-facing wording is
// plain, and the password-versus-keys rule is written down in the places that state the key rules.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import "../../../src/verbs/index.ts";
import { allVerbs } from "../../../src/core/verbs.ts";

const skill = join(import.meta.dirname, "..", "..", "..", "skills", "universal-profile");
const src = join(import.meta.dirname, "..", "..", "..", "src");
const read = (f: string) => readFileSync(join(skill, f), "utf8");

describe("backup documentation", () => {
  it("SKILL.md names every backup verb and the password exception, and tells the agent never to read the file", () => {
    const text = read("SKILL.md");
    for (const v of allVerbs().filter((x) => x.group === "backup")) expect(text, v.name).toContain(`up ${v.name}`);
    expect(text).toMatch(/One exception: the password of an account backup/);
    expect(text).toMatch(/Never read the file/);
    expect(text).toContain("`data.password`");
  });

  it("security.md, onboarding.md and the changelog cover it", () => {
    expect(read("references/security.md")).toMatch(/### Account backups/);
    expect(read("references/security.md")).toMatch(/password may pass through the chat; keys may not/);
    expect(read("references/onboarding.md")).toMatch(/## Backup \(offer once/);
    expect(read("CHANGELOG.md")).toMatch(/Account backups in the Universal Profile mobile app's own format/);
  });

  it("the iteration count is written down where the agent looks: 600,000 stated in the file, absent means exactly 10,000, --legacy for older apps; no stale 10,000-only or app-restore claim", () => {
    expect(read("SKILL.md")).toContain("--legacy");
    const security = read("references/security.md");
    for (const fact of ["600,000", "`secrets.iterations`", "exactly 10,000", "5,000,000", "--legacy"]) expect(security, fact).toContain(fact);
    const verbsMd = read("references/verbs.md");
    expect(verbsMd).toContain("| `--legacy` | boolean |");
    expect(verbsMd).toContain("600,000 iterations");
    expect(read("references/onboarding.md")).toContain("--legacy");
    expect(read("CHANGELOG.md")).toContain("`secrets.iterations`");
    // a default backup opens only in app versions that read secrets.iterations, so nothing promises the app can restore it
    const appRestore = /restorable (on a new machine or )?in the Universal Profile app/;
    for (const f of ["SKILL.md", "README.md", "CHANGELOG.md", "references/security.md", "references/verbs.md", "references/onboarding.md", "references/onboarding-ux.md"]) {
      expect(read(f), f).not.toMatch(/only 10,000 (rounds|times)|hashes the password only|PBKDF2 10,000 rounds|10,000 rounds, fixed by the app/);
      expect(read(f), f).not.toMatch(appRestore);
    }
    // the tools' hints too (account deploy's data.next): in the source and in the shipped bundles built from it
    for (const f of readdirSync(src, { recursive: true, encoding: "utf8" }).filter((n) => n.endsWith(".ts"))) expect(readFileSync(join(src, f), "utf8"), `src/${f}`).not.toMatch(appRestore);
    for (const f of ["scripts/lib/app.mjs", "scripts/lib/backup.mjs"]) expect(read(f), f).not.toMatch(appRestore);
  });

  it("the onboarding-ux step card has goal, messages, attachment, expected reply and a never-list, in plain words", () => {
    const text = read("references/onboarding-ux.md");
    const card = text.slice(text.indexOf("## Backup (offer once"), text.indexOf("## J1 · Step 7"));
    for (const part of ["**Goal:**", "**Message (the question):**", "**Attach:**", "**Expected reply:**", "**Never:**"]) expect(card, part).toContain(part);
    // the lines the human reads (block quotes) contain none of the words the UX rules forbid
    const said = card.split("\n").filter((l) => l.startsWith("  >")).join(" ");
    expect(said).not.toMatch(/\b(json|salt|seed|candidate|deploy|controller key|keystore|calldata|manifest|command|script|private key)\b/i);
    expect(said).toContain("a file and a password");
    expect(said).not.toMatch(/\biterations?\b/i);
    // the quoted messages are the skill's own data.ask.say / data.say: a default backup is not promised to open in every app version
    expect(said).toContain("you can restore it with me.");
    expect(said).toContain("ask me for an app-compatible copy");
  });
});
