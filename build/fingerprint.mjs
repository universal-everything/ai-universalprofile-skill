// Source fingerprint of the build: sha256 over the repository files the build read, with LF line endings.
// The files are the inputs esbuild reports in its metafiles (exactly the modules it bundled) plus the fixed
// inputs that build.mjs adds (the build scripts and the package manifests; package-lock.json pins the installed
// packages, which are therefore not hashed one by one). A file that nothing imports (Finder's .DS_Store, an editor
// backup, a tool's database next to the sources) is never read, so it cannot change the fingerprint and a fresh
// build in CI reproduces the one of a local build; an imported file always counts, also before it is committed.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The repository files among the inputs of esbuild metafiles, sorted: installed packages (any node_modules/ path)
 * and the stdin modules named in `virtual` (their `sourcefile`) are left out. Anything else that is not a file of
 * the repository stops the build: an input is never left out of the fingerprint silently.
 */
export function bundledInputs(root, metafiles, virtual = []) {
  const out = new Set();
  for (const m of metafiles) {
    for (const key of Object.keys(m.inputs)) {
      const f = key.split("\\").join("/");
      if (virtual.includes(f) || f.split("/").includes("node_modules")) continue;
      let file = false;
      try {
        file = !f.startsWith("../") && statSync(join(root, f)).isFile();
      } catch {}
      if (!file) throw new Error(`build input ${key} is not a file of the repository`);
      out.add(f);
    }
  }
  return [...out].sort();
}

/** First 12 hex digits of sha256 over each file's repository path and content (CRLF read as LF), in path order. */
export function sourceFingerprint(root, files) {
  const hash = createHash("sha256");
  for (const f of [...new Set(files)].sort()) hash.update(`${f}\n`).update(readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n")).update("\n");
  return hash.digest("hex").slice(0, 12);
}
