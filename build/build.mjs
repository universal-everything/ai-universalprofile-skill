// Builds the self-contained skill tools into skills/universal-profile/scripts/.
//
// Output layout (all plain, readable ES modules — never minified, so catalogue
// scanners and humans can audit them):
//   scripts/up.mjs          CLI entry          (node scripts/up.mjs <verb> ...)
//   scripts/up-mcp.mjs      stdio MCP server   (node scripts/up-mcp.mjs)
//   scripts/up-doctor.mjs   environment check  (node scripts/up-doctor.mjs)
//   scripts/lib/app.mjs     shared application code (chunk)
//   scripts/lib/backup.mjs  the backup verbs' code, loaded on demand by app.mjs (see step 2)
//   scripts/lib/vendor-viem.mjs, vendor-erc725.mjs, vendor-qrcode.mjs
//
// Third-party packages are bundled into separate vendor files so that every
// shipped file stays below the 1 MiB-per-file limit of OpenClaw managed
// skill bundles, and so that erc725.js reuses the same viem instance.
import { build } from "esbuild";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync, chmodSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledInputs, sourceFingerprint } from "./fingerprint.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(root, "skills", "universal-profile");
const outDir = join(skillDir, "scripts");
const libDir = join(outDir, "lib");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Source fingerprint (build/fingerprint.mjs): sha256 over the repository files this build reads, i.e. every module
// the bundles below contain (esbuild's metafiles), plus the build scripts and package manifests, with LF line
// endings. Local files that nothing imports (.DS_Store …) cannot change it. Unlike a git commit id, it is stable
// when the built bundles are committed alongside the sources, so CI can check that committed bundles match a fresh
// build. It is known only after bundling, so the bundles carry a one-off placeholder until they are written.
const STAMP = `__UP_SOURCE_${randomBytes(8).toString("hex")}__`;
const FIXED_INPUTS = ["build/build.mjs", "build/fingerprint.mjs", "package.json", "package-lock.json"];

const REQUIRE_SHIM = `import { createRequire as __upCreateRequire } from "node:module";\nconst require = __upCreateRequire(import.meta.url);\n`;
const banner = (what) =>
  `// ${what}\n` +
  `// Universal Profile Agent Skill v${pkg.version} — MIT-0 — https://github.com/universal-everything/ai-universalprofile-skill\n` +
  `// Built from source fingerprint ${STAMP} (sha256 of the bundled src/ modules and build inputs) with \`npm ci && npm run build\` (esbuild, unminified). Do not edit; edit src/ instead.\n` +
  REQUIRE_SHIM;

const VIEM_SPECIFIERS = /^viem(\/(accounts|chains|account-abstraction|utils|actions))?$/;

/** Rewrites bare imports of vendored packages to the shipped vendor files. */
function vendorRewrite(fromLibDir) {
  const rel = (f) => (fromLibDir ? `./${f}` : `./lib/${f}`);
  return {
    name: "vendor-rewrite",
    setup(b) {
      b.onResolve({ filter: VIEM_SPECIFIERS }, () => ({ path: rel("vendor-viem.mjs"), external: true }));
      // the schemas subpath too: vendor-erc725.mjs exports them, so app.mjs does not carry a second copy (~10 KB)
      b.onResolve({ filter: /^@erc725\/erc725\.js(\/schemas)?$/ }, () => ({ path: rel("vendor-erc725.mjs"), external: true }));
      b.onResolve({ filter: /^qrcode$/ }, () => ({ path: rel("vendor-qrcode.mjs"), external: true }));
    },
  };
}

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
  legalComments: "inline",
  sourcemap: false,
  logLevel: "warning",
  charset: "utf8",
  // erc725.js pulls cross-fetch; Node >= 22 has a global fetch.
  alias: { "cross-fetch": join(root, "build", "shims", "cross-fetch.mjs") },
  // paths in the metafiles and in the bundles' comments are relative to the repository, wherever the build is started
  absWorkingDir: root,
  metafile: true,
  write: false,
};

// Every bundle is built in memory; the files are written at the end, once the fingerprint is known.
const outputs = new Map();
const metafiles = [];
const virtual = []; // stdin modules: their `sourcefile` name is a metafile input, not a file
async function bundle(options) {
  if (options.stdin) virtual.push(options.stdin.sourcefile);
  const r = await build(options);
  metafiles.push(r.metafile);
  return r;
}
const keep = (r) => {
  for (const f of r.outputFiles) outputs.set(f.path, f.text);
};

// 1) Vendor bundles.
keep(await bundle({
  ...common,
  stdin: {
    contents: [
      `export * from "viem";`,
      `export { privateKeyToAccount, generatePrivateKey, publicKeyToAddress, signMessage as accountsSignMessage, sign as accountsSign, serializeSignature as accountsSerializeSignature } from "viem/accounts";`,
      `export { entryPoint06Abi, entryPoint06Address, getUserOperationHash } from "viem/account-abstraction";`,
      `export { lukso, luksoTestnet } from "viem/chains";`,
    ].join("\n"),
    resolveDir: root,
    sourcefile: "vendor-viem.mjs",
  },
  outfile: join(libDir, "vendor-viem.mjs"),
  banner: { js: banner("Vendored viem (MIT) — https://github.com/wevm/viem") },
}));
keep(await bundle({
  ...common,
  stdin: { contents: `export { default } from "@erc725/erc725.js";\nexport * from "@erc725/erc725.js";\nexport * from "@erc725/erc725.js/schemas";\n`, resolveDir: root, sourcefile: "vendor-erc725.mjs" },
  outfile: join(libDir, "vendor-erc725.mjs"),
  plugins: [{ name: "viem-ext", setup(b) { b.onResolve({ filter: VIEM_SPECIFIERS }, () => ({ path: "./vendor-viem.mjs", external: true })); } }],
  banner: { js: banner("Vendored @erc725/erc725.js (Apache-2.0) — https://github.com/ERC725Alliance/erc725.js") },
}));
keep(await bundle({
  ...common,
  stdin: { contents: `import QRCode from "qrcode";\nexport default QRCode;\n`, resolveDir: root, sourcefile: "vendor-qrcode.mjs" },
  outfile: join(libDir, "vendor-qrcode.mjs"),
  banner: { js: banner("Vendored qrcode (MIT) — https://github.com/soldair/node-qrcode") },
}));

// 2) Application: one shared chunk + three thin entry points, and the code of the backup verbs as a
//    second chunk that app.mjs loads on demand (dynamic import in src/backup/verbs.ts). Together they
//    would pass the 1 MiB file limit, and they must share one copy of every app module (the registry
//    of secrets, the error classes ...), so backup.mjs imports those from app.mjs instead of bundling them:
//    a) bundle src/backup/run.ts with every module outside src/backup left as an import "shared:<path>",
//    b) bundle app.mjs with a namespace export of each such module,
//    c) rewrite the "shared:" imports of backup.mjs into reads from those namespaces.
const srcDir = join(root, "src") + sep;
const backupDir = join(root, "src", "backup") + sep;
const shared = new Set();
const defines = { __UP_VERSION__: JSON.stringify(pkg.version), __UP_SOURCE__: JSON.stringify(STAMP) };
const lazy = await bundle({
  ...common,
  entryPoints: [join(root, "src", "backup", "run.ts")],
  outfile: join(libDir, "backup.mjs"),
  plugins: [
    vendorRewrite(true),
    {
      name: "shared-with-app",
      setup(b) {
        b.onResolve({ filter: /^\.\.?\// }, async (args) => {
          if (args.pluginData?.skip) return undefined;
          const r = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: { skip: true } });
          if (r.errors.length || !r.path.startsWith(srcDir) || r.path.startsWith(backupDir)) return r;
          const rel = relative(root, r.path).split(sep).join("/");
          shared.add(rel);
          return { path: `shared:${rel}`, external: true };
        });
      },
    },
  ],
  define: defines,
  banner: { js: banner("Universal Profile skill — backup verbs (loaded on demand by app.mjs)") },
});
const sharedList = [...shared].sort();
const ns = (rel) => `$s${sharedList.indexOf(rel)}`;
let lazyCode = lazy.outputFiles[0].text.replace(/^import\s*\{([^}]*)\}\s*from\s*"shared:([^"]+)";?$/gm, (_m, names, rel) => `const {${names.replace(/\s+as\s+/g, ": ")}} = ${ns(rel)};`);
if (lazyCode.includes("shared:")) throw new Error("backup.mjs: an import of an app module was not bridged (only named imports are supported)");
lazyCode = lazyCode.replace(/^(\/\/[^\n]*\n)+/, (header) => `${header}import { ${sharedList.map(ns).join(", ")} } from "./app.mjs";\n`);
outputs.set(join(libDir, "backup.mjs"), lazyCode);

keep(await bundle({
  ...common,
  stdin: { contents: [`export * from "./src/app.ts";`, ...sharedList.map((rel) => `export * as ${ns(rel)} from "./${rel}";`)].join("\n"), resolveDir: root, sourcefile: "app.ts" },
  outfile: join(libDir, "app.mjs"),
  plugins: [
    vendorRewrite(true),
    {
      name: "backup-on-demand",
      setup(b) {
        b.onResolve({ filter: /^\.\/run\.ts$/ }, (args) => (args.importer.endsWith(join("src", "backup", "verbs.ts")) ? { path: "./backup.mjs", external: true } : undefined));
      },
    },
  ],
  define: defines,
  banner: { js: banner("Universal Profile skill — application code") },
}));

const entries = {
  "up.mjs": `import { runCli } from "./lib/app.mjs";\nprocess.exitCode = await runCli(process.argv.slice(2));\n`,
  "up-mcp.mjs": `import { runMcpServer } from "./lib/app.mjs";\nawait runMcpServer();\n`,
  "up-doctor.mjs": `import { runCli } from "./lib/app.mjs";\nprocess.exitCode = await runCli(["doctor", ...process.argv.slice(2)]);\n`,
};
for (const [name, body] of Object.entries(entries)) outputs.set(join(outDir, name), `#!/usr/bin/env node\n${banner(`Entry point: ${name}`)}${body}`);

// The fingerprint, now that every input is known; then the output folder is replaced in one go.
const source = sourceFingerprint(root, [...bundledInputs(root, metafiles, virtual), ...FIXED_INPUTS]);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(libDir, { recursive: true });
for (const [file, text] of outputs) writeFileSync(file, text.split(STAMP).join(source));
for (const name of Object.keys(entries)) chmodSync(join(outDir, name), 0o755);

// 3) Size gate + manifest of hashes.
const LIMIT = 1024 * 1024;
const manifest = {};
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
let failed = false;
for (const f of walk(outDir)) {
  const buf = readFileSync(f);
  const relPath = relative(skillDir, f);
  manifest[relPath] = { bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  if (buf.length > LIMIT) {
    console.error(`✗ ${relPath} is ${buf.length} bytes (> 1 MiB limit)`);
    failed = true;
  }
}
writeFileSync(join(outDir, "BUILD.json"), JSON.stringify({ version: pkg.version, source, files: manifest }, null, 2) + "\n");
for (const [f, m] of Object.entries(manifest)) console.log(`${String(m.bytes).padStart(9)}  ${f}`);
if (failed) process.exit(1);
