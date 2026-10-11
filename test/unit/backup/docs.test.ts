// The backup documents: every verb is explained where the agent looks, the human-facing wording is
// plain, and the password-versus-keys rule is written down in the places that state the key rules.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../../../src/verbs/index.ts";
import { allVerbs } from "../../../src/core/verbs.ts";

const skill = join(import.meta.dirname, "..", "..", "..", "skills", "universal-profile");
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

  it("the onboarding-ux step card has goal, messages, attachment, expected reply and a never-list, in plain words", () => {
    const text = read("references/onboarding-ux.md");
    const card = text.slice(text.indexOf("## Backup (offer once"), text.indexOf("## J1 · Step 7"));
    for (const part of ["**Goal:**", "**Message (the question):**", "**Attach:**", "**Expected reply:**", "**Never:**"]) expect(card, part).toContain(part);
    // the lines the human reads (block quotes) contain none of the words the UX rules forbid
    const said = card.split("\n").filter((l) => l.startsWith("  >")).join(" ");
    expect(said).not.toMatch(/\b(json|salt|seed|candidate|deploy|controller key|keystore|calldata|manifest|command|script|private key)\b/i);
    expect(said).toContain("a file and a password");
  });
});
