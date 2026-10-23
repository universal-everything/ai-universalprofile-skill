// .github/workflows/release.yml makes the release files (universal-profile-<version>.tar.gz and SHA256SUMS) and then
// runs build/publish-main.mjs, whose first guard refuses a working tree with any change or untracked file. So the files
// go to $RUNNER_TEMP/release, outside the checkout: the v0.2.0 run wrote them into the repository root and stopped at
// that guard. On a small git repository these tests run the workflow's own step, then the real publish-main.mjs (dry
// run), and check the checksum file, the archive and the files the GitHub release uploads.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8").split(/\r?\n/);
const TAG = "v9.8.7";
const ARCHIVE = "universal-profile-9.8.7.tar.gz";
// The v0.2.0 step, for the control: both files in the repository root
// (https://github.com/universal-everything/ai-universalprofile-skill/actions/runs/39901192703).
const ROOT_FILES_STEP = 'V="${GITHUB_REF_NAME#v}"\ntar -C skills -czf "universal-profile-$V.tar.gz" universal-profile\nsha256sum "universal-profile-$V.tar.gz" > SHA256SUMS\n';
// The release job runs on ubuntu-latest; skipped where the step's tools are missing (Windows).
const TOOLS = process.platform !== "win32" && ["bash", "git", "tar", "sha256sum"].every((cmd) => !spawnSync(cmd, ["--version"], { stdio: "ignore" }).error);

function put(root: string, file: string, text: string | Uint8Array) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

type Checkout = { root: string; temp: string; env: NodeJS.ProcessEnv; git: (...args: string[]) => string };

/**
 * A clean checkout, committed and pushed to its `origin`: a small skill folder, this repository's .gitignore and
 * build/publish-main.mjs, and a stand-in for the package gate. Git sees neither the developer's configuration (identity,
 * signing, global ignores) nor an outer repository (a hook's GIT_DIR). $RUNNER_TEMP is a folder next to the checkout.
 */
function checkout(): Checkout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "up-release-")));
  const root = join(base, "repo");
  const temp = join(base, "runner-temp");
  mkdirSync(temp);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const env = { ...inherited, XDG_CONFIG_HOME: base, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  put(root, "skills/universal-profile/SKILL.md", "---\nname: universal-profile\n---\n\n# Universal Profile\n");
  put(root, "skills/universal-profile/scripts/BUILD.json", '{ "version": "9.8.7" }\n');
  put(root, "skills/universal-profile/references/verbs.md", "# Verbs\n");
  put(root, ".gitignore", readFileSync(join(ROOT, ".gitignore")));
  put(root, "build/publish-main.mjs", readFileSync(join(ROOT, "build", "publish-main.mjs")));
  put(root, "build/verify-skill.mjs", "// stands in for the package gate, which publish-main.mjs runs after its clean-tree guard\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  git("init", "-q", "-b", "source");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  git("init", "-q", "--bare", join(base, "origin.git"));
  git("remote", "add", "origin", join(base, "origin.git"));
  git("push", "-q", "origin", "source");
  return { root, temp, env, git };
}

/** The lines of the block scalar (`key: |`) on line `at` of release.yml, without their indentation. */
function block(at: number): string[] {
  const indent = WORKFLOW[at + 1].length - WORKFLOW[at + 1].trimStart().length;
  const lines: string[] = [];
  for (const line of WORKFLOW.slice(at + 1)) {
    if (line.trim() && line.length - line.trimStart().length < indent) break;
    lines.push(line.slice(indent));
  }
  return lines;
}
/** Runs a step script as the runner does (bash -e), in the checkout, for tag v9.8.7. */
function runScript(c: Checkout, script: string) {
  execFileSync("bash", ["-e", "-c", script], { cwd: c.root, env: { ...c.env, GITHUB_REF_NAME: TAG, RUNNER_TEMP: c.temp }, stdio: "pipe" });
}
function runStep(c: Checkout, name: string) {
  const at = WORKFLOW.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(WORKFLOW[at + 1]?.trim(), `release.yml has a step "${name}" with a run script`).toBe("run: |");
  runScript(c, block(at + 1).join("\n"));
}
/** The `files:` the GitHub release step uploads. */
function releaseFiles(): string[] {
  const uses = WORKFLOW.findIndex((line) => line.trim().startsWith("- uses: softprops/action-gh-release@"));
  const at = WORKFLOW.findIndex((line, i) => uses >= 0 && i > uses && line.trim() === "files: |");
  expect(at, "release.yml uploads files: with softprops/action-gh-release").toBeGreaterThan(0);
  return block(at).map((line) => line.trim()).filter(Boolean);
}
/** build/publish-main.mjs as the step after the release files runs it, here as a dry run (the workflow adds --push). */
const publishMain = (c: Checkout) => spawnSync(process.execPath, [join("build", "publish-main.mjs")], { cwd: c.root, env: c.env, encoding: "utf8" });
/** Every file under `dir`, by its relative path, with its bytes as hex. */
const filesIn = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => statSync(join(dir, file)).isFile())
      .sort()
      .map((file) => [file.split(sep).join("/"), readFileSync(join(dir, file)).toString("hex")]),
  );
const glob = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`);

describe.skipIf(!TOOLS)("release.yml: the release files are made outside the checkout", () => {
  it("the step leaves the checkout clean, so publish-main.mjs (the next step) passes its clean-tree guard", () => {
    const c = checkout();
    runStep(c, "tarball + checksums");
    expect(c.git("status", "--porcelain")).toBe("");
    const publish = publishMain(c);
    expect(publish.stderr).not.toMatch(/not clean/);
    expect(publish.status).toBe(0);
    expect(publish.stdout).toMatch(/version 9\.8\.7[\s\S]*dry run/);
  });

  it("SHA256SUMS lists the bare archive name and verifies in its folder; the archive holds exactly the skill folder, as universal-profile/", () => {
    const c = checkout();
    runStep(c, "tarball + checksums");
    const dir = join(c.temp, "release");
    expect(readdirSync(c.temp)).toEqual(["release"]);
    expect(readdirSync(dir).sort()).toEqual(["SHA256SUMS", ARCHIVE]);
    const sha256 = createHash("sha256").update(readFileSync(join(dir, ARCHIVE))).digest("hex");
    expect(readFileSync(join(dir, "SHA256SUMS"), "utf8")).toBe(`${sha256}  ${ARCHIVE}\n`);
    expect(execFileSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: dir, encoding: "utf8" }).trim()).toBe(`${ARCHIVE}: OK`);
    const unpacked = realpathSync(mkdtempSync(join(tmpdir(), "up-release-unpacked-")));
    execFileSync("tar", ["-xzf", join(dir, ARCHIVE), "-C", unpacked]);
    expect(readdirSync(unpacked)).toEqual(["universal-profile"]);
    expect(filesIn(join(unpacked, "universal-profile"))).toEqual(filesIn(join(c.root, "skills", "universal-profile")));
  });

  it("the GitHub release uploads exactly those two files, from $RUNNER_TEMP/release", () => {
    const c = checkout();
    runStep(c, "tarball + checksums");
    const patterns = releaseFiles();
    expect(patterns).toEqual(["${{ runner.temp }}/release/universal-profile-*.tar.gz", "${{ runner.temp }}/release/SHA256SUMS"]);
    const made = readdirSync(join(c.temp, "release")).map((file) => `${c.temp}/release/${file}`);
    for (const pattern of patterns) expect(made.filter((file) => glob(pattern.replace("${{ runner.temp }}", c.temp)).test(file)), pattern).toHaveLength(1);
  });

  it("control: the same files in the repository root, where the v0.2.0 release run wrote them, make publish-main.mjs refuse", () => {
    const c = checkout();
    runScript(c, ROOT_FILES_STEP);
    expect(c.git("status", "--porcelain")).toBe(`?? SHA256SUMS\n?? ${ARCHIVE}\n`);
    const publish = publishMain(c);
    expect(publish.status).toBe(1);
    expect(publish.stderr).toMatch(/✗ working tree is not clean/);
  });
});
