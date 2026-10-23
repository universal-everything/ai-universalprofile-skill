// build/version.mjs: package.json holds the version; every other copy (lockfile root, SKILL.md metadata, plugin.json,
// CHANGELOG, README version blocks, BUILD.json, bundle banners) must agree, `set` bumps all of them without touching
// any dependency, and `release` dates the CHANGELOG entry on the publish day only.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const V = await import(pathToFileURL(join(ROOT, "build", "version.mjs")).href);
const DASH = String.fromCharCode(0x2014);
const NOW = new Date("2026-10-23T12:00:00Z");

function put(root: string, file: string, text: string) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}
const get = (root: string, file: string) => readFileSync(join(root, file), "utf8");

/** A small repository at `version`, released on `status` (a date) or "Unreleased". */
function fixture(version = "0.1.0", status = "2026-10-10"): string {
  const root = mkdtempSync(join(tmpdir(), "up-version-"));
  const name = "@universal-everything/universal-profile-skill";
  put(root, "package.json", JSON.stringify({ name, version, dependencies: { viem: "2.57.4" }, devDependencies: { vitest: "5.0.3" } }, null, 2) + "\n");
  put(
    root,
    "package-lock.json",
    JSON.stringify(
      {
        name,
        version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name, version, dependencies: { viem: "2.57.4" } },
          "node_modules/viem": { version: "2.57.4" },
          // a dependency that happens to share the skill's version string must never change
          "node_modules/tiny": { version },
        },
      },
      null,
      2,
    ) + "\n",
  );
  put(root, "skills/universal-profile/SKILL.md", `---\nname: universal-profile\ndescription: test\nmetadata:\n  version: "${version}"\n  data-version: "2026.10"\n---\n\n# Universal Profile\n`);
  put(root, "skills/universal-profile/platforms/openai/plugin.json", JSON.stringify({ name: "universal-profile", version, license: "MIT-0" }, null, 2) + "\n");
  put(root, "skills/universal-profile/CHANGELOG.md", `# Changelog\n\nIntro.\n\n## [${version}] ${DASH} ${status}\n\n- first\n`);
  put(root, "skills/universal-profile/README.md", `# Skill\n\n## Versions\n\n${V.renderSkillReadmeBlock(version, status)}\n\nRelease history:\n\n- **${version}** (${status === "Unreleased" ? "unreleased" : status}): first.\n`);
  put(root, "README.md", `# Source\n\n${V.renderSourceReadmeBlock(version, status, "2026.10")}\n`);
  put(root, "skills/universal-profile/scripts/BUILD.json", JSON.stringify({ version, source: "x", files: {} }, null, 2) + "\n");
  put(root, "skills/universal-profile/scripts/up.mjs", `#!/usr/bin/env node\n// Entry point: up.mjs\n// Universal Profile Agent Skill v${version} ${DASH} MIT-0 ${DASH} https://example.org\nexport {};\n`);
  return root;
}

describe("checkVersion", () => {
  it("accepts a repository whose copies all agree", () => {
    expect(V.checkVersion(fixture(), { now: NOW })).toEqual([]);
  });

  it.each([
    ["SKILL.md metadata", "skills/universal-profile/SKILL.md", (t: string) => t.replace('version: "0.1.0"', 'version: "0.1.1"'), /SKILL\.md: metadata\.version 0\.1\.1/],
    ["plugin.json", "skills/universal-profile/platforms/openai/plugin.json", (t: string) => t.replace('"0.1.0"', '"0.0.9"'), /plugin\.json: version 0\.0\.9/],
    ["the lockfile root", "package-lock.json", (t: string) => t.replace('"version": "0.1.0"', '"version": "0.1.5"'), /package-lock\.json: root version 0\.1\.5/],
    ["the shipped README block", "skills/universal-profile/README.md", (t: string) => t.replace("**Version 0.1.0**", "**Version 9.9.9**"), /README\.md: version block out of date/],
    ["the source README block", "README.md", (t: string) => t.replace("**0.1.0**", "**0.0.1**"), /^README\.md: version block out of date/],
    ["the release history line", "skills/universal-profile/README.md", (t: string) => t.replace("- **0.1.0** (", "- 0.1.0 ("), /release history/],
    ["the CHANGELOG", "skills/universal-profile/CHANGELOG.md", (t: string) => t.replace("[0.1.0]", "[0.0.9]"), /CHANGELOG\.md: newest entry is 0\.0\.9/],
    ["BUILD.json", "skills/universal-profile/scripts/BUILD.json", (t: string) => t.replace('"0.1.0"', '"0.0.8"'), /BUILD\.json: version 0\.0\.8/],
    ["a bundle banner", "skills/universal-profile/scripts/up.mjs", (t: string) => t.replace("v0.1.0", "v0.0.7"), /up\.mjs: built as v0\.0\.7/],
  ])("names a deliberate mismatch in %s", (_label, file, edit, message) => {
    const root = fixture();
    put(root, file, edit(get(root, file)));
    const problems = V.checkVersion(root, { now: NOW });
    expect(problems.join("\n")).toMatch(message);
  });

  it("checks every shipped bundle, also a chunk added later", () => {
    const root = fixture();
    put(root, "skills/universal-profile/scripts/lib/authorize.mjs", `// Universal Profile skill ${DASH} chunk\n// Universal Profile Agent Skill v0.0.6 ${DASH} MIT-0 ${DASH} https://example.org\nexport {};\n`);
    expect(V.checkVersion(root, { now: NOW }).join("\n")).toMatch(/scripts\/lib\/authorize\.mjs: built as v0\.0\.6/);
  });

  it("skips the built files with built: false (before npm run build)", () => {
    const root = fixture();
    put(root, "skills/universal-profile/scripts/BUILD.json", JSON.stringify({ version: "0.0.1" }));
    expect(V.checkVersion(root, { built: false, now: NOW })).toEqual([]);
  });

  it("refuses an older entry above a newer one and a second Unreleased entry", () => {
    const root = fixture();
    put(root, "skills/universal-profile/CHANGELOG.md", `# Changelog\n\n## [0.1.0] ${DASH} 2026-10-10\n\n## [0.2.0] ${DASH} Unreleased\n`);
    const p = V.checkVersion(root, { now: NOW }).join("\n");
    expect(p).toMatch(/must be newer/);
    expect(p).toMatch(/only the newest entry may be Unreleased/);
  });
});

describe("setVersion", () => {
  it("bumps every copy at once and never touches a dependency (minor)", () => {
    const root = fixture();
    const lockBefore = get(root, "package-lock.json");
    const pkgBefore = JSON.parse(get(root, "package.json"));
    expect(V.setVersion(root, "minor")).toEqual({ from: "0.1.0", to: "0.2.0" });
    expect(V.checkVersion(root, { built: false, now: NOW }).join("\n")).toMatch(/release history/); // the human-written history line comes next
    const pkg = JSON.parse(get(root, "package.json"));
    expect(pkg.version).toBe("0.2.0");
    expect(pkg.dependencies).toEqual(pkgBefore.dependencies);
    expect(pkg.devDependencies).toEqual(pkgBefore.devDependencies);
    const lock = JSON.parse(get(root, "package-lock.json"));
    expect([lock.version, lock.packages[""].version]).toEqual(["0.2.0", "0.2.0"]);
    expect(lock.packages["node_modules/tiny"].version).toBe("0.1.0");
    expect(lock.packages["node_modules/viem"].version).toBe("2.57.4");
    const changed = get(root, "package-lock.json").split("\n").filter((l, i) => l !== lockBefore.split("\n")[i]);
    expect(changed).toEqual(['  "version": "0.2.0",', '      "version": "0.2.0",']);
    expect(get(root, "skills/universal-profile/CHANGELOG.md")).toContain(`## [0.2.0] ${DASH} Unreleased\n\n### Added`);
    expect(get(root, "skills/universal-profile/CHANGELOG.md")).toContain(`## [0.1.0] ${DASH} 2026-10-10`);
    expect(get(root, "skills/universal-profile/README.md")).toContain("**Version 0.2.0** (not released yet)");
    expect(V.checkVersion(root, { now: NOW }).join("\n")).toMatch(/BUILD\.json: version 0\.1\.0 \(expected 0\.2\.0; run: npm run build\)/);
  });

  it("renames an Unreleased entry instead of adding a second one, and supports patch, major and X.Y.Z", () => {
    const root = fixture("0.2.0", "Unreleased");
    expect(V.setVersion(root, "patch")).toEqual({ from: "0.2.0", to: "0.2.1" });
    const log = get(root, "skills/universal-profile/CHANGELOG.md");
    expect(log).toContain(`## [0.2.1] ${DASH} Unreleased`);
    expect(log).not.toContain("[0.2.0]");
    expect(V.setVersion(root, "major").to).toBe("1.0.0");
    expect(V.setVersion(root, "1.2.3").to).toBe("1.2.3");
    expect(() => V.setVersion(root, "1.0.0")).toThrow(/greater/);
    expect(() => V.setVersion(root, "sideways")).toThrow(/unknown bump/);
  });
});

describe("releaseVersion", () => {
  function unreleased() {
    const root = fixture();
    V.setVersion(root, "minor");
    const readme = get(root, "skills/universal-profile/README.md");
    put(root, "skills/universal-profile/README.md", readme.replace("Release history:\n\n", "Release history:\n\n- **0.2.0** (unreleased): links.\n"));
    return root;
  }

  it("dates the entry and the README on the publish day; the release check then passes for the matching tag", () => {
    const root = unreleased();
    expect(V.checkVersion(root, { built: false, release: true, now: NOW }).join("\n")).toMatch(/0\.2\.0 is not dated/);
    expect(V.releaseVersion(root, "2026-10-23", { now: NOW })).toEqual({ version: "0.2.0", date: "2026-10-23" });
    expect(get(root, "skills/universal-profile/CHANGELOG.md")).toContain(`## [0.2.0] ${DASH} 2026-10-23`);
    expect(get(root, "skills/universal-profile/README.md")).toContain("**Version 0.2.0** (released 2026-10-23)");
    expect(get(root, "skills/universal-profile/README.md")).toContain("- **0.2.0** (2026-10-23): links.");
    expect(V.checkVersion(root, { built: false, release: true, tag: "v0.2.0", now: NOW })).toEqual([]);
    expect(V.checkVersion(root, { built: false, release: true, tag: "v0.2.1", now: NOW }).join("\n")).toMatch(/tag v0\.2\.1 does not match/);
  });

  it("refuses future dates, dates before the previous release and malformed dates", () => {
    const root = unreleased();
    expect(() => V.releaseVersion(root, "2026-10-24", { now: NOW })).toThrow(/future/);
    expect(() => V.releaseVersion(root, "2026-10-01", { now: NOW })).toThrow(/before the previous release/);
    expect(() => V.releaseVersion(root, "23.10.2026", { now: NOW })).toThrow(/YYYY-MM-DD/);
  });
});

describe("the CLI and this repository", () => {
  it("check exits 0 on this repository and 1 with the problem named on a broken copy", () => {
    expect(execFileSync("node", [join(ROOT, "build", "version.mjs"), "check"], { encoding: "utf8" })).toMatch(/is consistent/);
    const root = fixture();
    put(root, "skills/universal-profile/SKILL.md", get(root, "skills/universal-profile/SKILL.md").replace('version: "0.1.0"', 'version: "0.1.1"'));
    expect(V.checkVersion(root, { now: NOW }).length).toBeGreaterThan(0);
  });

  it("this repository's copies all agree", () => {
    expect(V.checkVersion(ROOT)).toEqual([]);
  });
});
