// The source fingerprint of the build (build/fingerprint.mjs, used by build/build.mjs) covers exactly the repository
// files a build reads, as esbuild's metafile reports them, plus the fixed build inputs, with LF line endings. A file
// that nothing imports (Finder's .DS_Store, an editor backup, a tool's database next to the sources) cannot change
// it, so a fresh build in CI reproduces the fingerprint of a local build; an imported file always counts, also
// before it is committed. Installed packages (pinned by package-lock.json) and stdin modules are not repository files.
import { describe, expect, it } from "vitest";
import { build, type Metafile } from "esbuild";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const { bundledInputs, sourceFingerprint } = await import(pathToFileURL(join(ROOT, "build", "fingerprint.mjs")).href);
const FIXED = ["build/build.mjs", "package.json"];

function put(root: string, file: string, text: string | Uint8Array) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}
/** A small repository: src/ (an entry, a nested module, JSON), an installed package, a shim, the fixed inputs. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), "up-fingerprint-"));
  put(root, "src/app.ts", 'import { b } from "./sub/b.ts";\nimport data from "./data.json";\nimport dep from "dep";\nexport const a = b + data.x + dep;\n');
  put(root, "src/sub/b.ts", "export const b = 1;\n");
  put(root, "src/data.json", '{ "x": 2 }\n');
  put(root, "node_modules/dep/package.json", '{ "name": "dep", "main": "index.js" }\n');
  put(root, "node_modules/dep/index.js", "module.exports = 3;\n");
  put(root, "build/shims/shim.mjs", "export default 4;\n");
  put(root, "build/build.mjs", "// the build script\n");
  put(root, "package.json", '{ "name": "p" }\n');
  return root;
}
/** Builds like build/build.mjs: an entry point, and a stdin module (named by `sourcefile`) that uses an alias. */
async function metafiles(root: string): Promise<Metafile[]> {
  const common = { absWorkingDir: root, bundle: true, platform: "node" as const, format: "esm" as const, write: false, metafile: true, logLevel: "silent" as const };
  const app = await build({ ...common, entryPoints: [join(root, "src", "app.ts")], outfile: join(root, "out", "app.mjs") });
  const vendor = await build({ ...common, stdin: { contents: 'export { default } from "dep";\nexport { default as s } from "shim";\n', resolveDir: root, sourcefile: "vendor-x.mjs" }, alias: { shim: join(root, "build", "shims", "shim.mjs") }, outfile: join(root, "out", "vendor-x.mjs") });
  return [app.metafile!, vendor.metafile!];
}
const fingerprintOf = async (root: string) => sourceFingerprint(root, [...bundledInputs(root, await metafiles(root), ["vendor-x.mjs"]), ...FIXED]);

describe("source fingerprint", () => {
  it("its inputs are the repository files the bundles read: not installed packages, not stdin modules, not files nobody imports", async () => {
    const root = project();
    put(root, "src/unused.ts", "export const unused = 1;\n");
    expect(bundledInputs(root, await metafiles(root), ["vendor-x.mjs"])).toEqual(["build/shims/shim.mjs", "src/app.ts", "src/data.json", "src/sub/b.ts"]);
  });

  it("untracked local files next to the sources cannot change it; the content of an imported file and a newly imported file do", async () => {
    const root = project();
    const clean = await fingerprintOf(root);
    expect(clean).toMatch(/^[0-9a-f]{12}$/);
    put(root, "src/.DS_Store", Uint8Array.from([0, 0, 0, 1, 66, 117, 100, 49, 0, 0, 16]));
    put(root, "src/sub/.DS_Store", Uint8Array.from([0, 0, 0, 1]));
    put(root, "build/shims/.DS_Store", Uint8Array.from([0, 1]));
    put(root, "src/tool.db", Uint8Array.from([83, 81, 76, 105, 116, 101, 0, 0, 255]));
    put(root, "src/notes.tmp", "local notes\n");
    put(root, "src/unused.ts", "export const unused = 1;\n");
    expect(await fingerprintOf(root)).toBe(clean);

    put(root, "src/sub/b.ts", "export const b = 2;\n");
    const changed = await fingerprintOf(root);
    expect(changed).not.toBe(clean);
    put(root, "src/sub/c.ts", "export const c = 5;\n"); // a new module, not committed anywhere: counted as soon as it is imported
    expect(await fingerprintOf(root)).toBe(changed);
    put(root, "src/sub/b.ts", 'export { c as b } from "./c.ts";\n');
    expect(bundledInputs(root, await metafiles(root), ["vendor-x.mjs"])).toContain("src/sub/c.ts");
    const withNew = await fingerprintOf(root);
    put(root, "src/sub/c.ts", "export const c = 6;\n");
    expect(await fingerprintOf(root)).not.toBe(withNew);
  });

  it("line endings and the order of the inputs do not change it", async () => {
    const root = project();
    const lf = await fingerprintOf(root);
    put(root, "src/app.ts", 'import { b } from "./sub/b.ts";\r\nimport data from "./data.json";\r\nimport dep from "dep";\r\nexport const a = b + data.x + dep;\r\n');
    expect(await fingerprintOf(root)).toBe(lf);
    const inputs = [...bundledInputs(root, await metafiles(root), ["vendor-x.mjs"]), ...FIXED];
    expect(sourceFingerprint(root, [...inputs].reverse())).toBe(lf);
  });

  it("a reported input that is not a file of the repository stops the build instead of being left out", async () => {
    const root = project();
    const metas = await metafiles(root);
    expect(() => bundledInputs(root, metas)).toThrow(/build input vendor-x\.mjs is not a file of the repository/);
    expect(() => bundledInputs(root, [{ inputs: { "src/gone.ts": {} } } as unknown as Metafile])).toThrow(/build input src\/gone\.ts is not a file of the repository/);
    expect(() => bundledInputs(root, [{ inputs: { "../outside.ts": {} } } as unknown as Metafile])).toThrow(/is not a file of the repository/);
  });
});
