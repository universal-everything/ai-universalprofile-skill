// Publishes the shipped skill to the `main` branch, with SKILL.md at the repository root.
//
// `main` holds only the built skill (so every installer finds SKILL.md at the root and
// installs stay within the 256-file / 8 MiB skill bundle limits); development happens on
// `source`. This script adds ONE commit on top of origin/main whose tree is exactly the
// committed `skills/universal-profile/` directory of the current source commit. It never
// rewrites main's history and never touches the working tree.
//
//   node build/publish-main.mjs          checks + dry run (prints what would be published)
//   node build/publish-main.mjs --push   creates the commit and pushes it to origin/main
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const push = process.argv.includes("--push");
const PREFIX = "skills/universal-profile";

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

// 1) The skill must be committed exactly as built and verified.
if (git("status", "--porcelain", "--", ".")) fail("working tree is not clean; commit (including the rebuilt scripts) first");
execFileSync("node", [join(root, "build", "verify-skill.mjs")], { cwd: root, stdio: "inherit" });

const head = git("rev-parse", "HEAD");
const short = head.slice(0, 7);
const tree = git("rev-parse", `HEAD:${PREFIX}`);
const files = git("ls-tree", "-r", "--name-only", tree).split("\n").filter(Boolean);
if (!files.includes("SKILL.md")) fail(`${PREFIX}/SKILL.md is not committed`);

// 2) The source commit should be on the remote, so the published commit can point to it.
git("fetch", "--quiet", "origin");
const onRemote = git("branch", "-r", "--contains", head);
if (!onRemote) console.warn(`! source commit ${short} is not on any remote branch yet; push it first so the publish commit links to published source`);

let parent = "";
try {
  parent = git("rev-parse", "--verify", "--quiet", "refs/remotes/origin/main");
} catch {}
if (parent && git("rev-parse", `${parent}^{tree}`) === tree) {
  console.log(`main already publishes this skill tree (${tree.slice(0, 12)}); nothing to do.`);
  process.exit(0);
}

// 3) Never drop edits made directly on main (e.g. a README fix in the GitHub UI): every file
//    changed on main since the last publish must already be identical in the tree to publish.
if (parent) {
  const lastPublish = git("log", parent, "--grep=^publish universal-profile ", "-1", "--format=%H");
  if (lastPublish && lastPublish !== parent) {
    // The main-side edits are "contained" when their patch applies in reverse onto the tree to
    // publish (checked in a throwaway index; the real index and working tree are untouched).
    const patch = execFileSync("git", ["diff", "--binary", lastPublish, parent], { cwd: root, encoding: "utf8" });
    const indexFile = join(mkdtempSync(join(tmpdir(), "up-publish-")), "index");
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    let contained = true;
    try {
      execFileSync("git", ["read-tree", tree], { cwd: root, env, stdio: "ignore" });
      execFileSync("git", ["apply", "--cached", "--reverse", "--check", "-"], { cwd: root, env, input: patch, stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      contained = false;
    } finally {
      rmSync(dirname(indexFile), { recursive: true, force: true });
    }
    if (!contained) {
      const changed = git("diff", "--name-only", lastPublish, parent).split("\n").filter(Boolean);
      fail(
        `main has direct edits since the last publish (${lastPublish.slice(0, 7)}..${parent.slice(0, 7)}) that ${PREFIX}/ does not contain yet:\n  ${changed.join("\n  ")}\n` +
          `  port them first: git diff ${lastPublish.slice(0, 7)} ${parent.slice(0, 7)} | git apply --directory=${PREFIX}, then rebuild, commit and push`,
      );
    }
  }
}

const version = JSON.parse(git("show", `HEAD:${PREFIX}/scripts/BUILD.json`)).version;
const message = `publish universal-profile v${version} from source ${short}\n\nTree: ${PREFIX}/ of https://github.com/universal-everything/ai-universalprofile-skill/commit/${head}`;
console.log(`skill: ${files.length} files, tree ${tree.slice(0, 12)}, version ${version}, source ${short}`);
console.log(`parent: ${parent ? `origin/main ${parent.slice(0, 7)}` : "none (first publish)"}`);

if (!push) {
  console.log("dry run: re-run with --push to publish to origin/main");
  process.exit(0);
}

const commit = execFileSync("git", ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message], { cwd: root, encoding: "utf8" }).trim();
execFileSync("git", ["push", "origin", `${commit}:refs/heads/main`], { cwd: root, stdio: "inherit" });
console.log(`✓ published ${commit.slice(0, 7)} to main`);
