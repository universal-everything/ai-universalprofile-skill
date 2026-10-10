// Builds the self-contained skill tools into skills/universal-profile/scripts/.
//
// Output layout (all plain, readable ES modules — never minified, so catalogue
// scanners and humans can audit them):
//   scripts/up.mjs          CLI entry          (node scripts/up.mjs <verb> ...)
//   scripts/up-mcp.mjs      stdio MCP server   (node scripts/up-mcp.mjs)
//   scripts/up-doctor.mjs   environment check  (node scripts/up-doctor.mjs)
//   scripts/lib/app.mjs     shared application code (chunk)
//   scripts/lib/vendor-viem.mjs, vendor-erc725.mjs, vendor-qrcode.mjs
//
// Third-party packages are bundled into separate vendor files so that every
// shipped file stays below the 1 MiB-per-file limit of OpenClaw managed
// skill bundles, and so that erc725.js reuses the same viem instance.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync, chmodSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(root, "skills", "universal-profile");
const outDir = join(skillDir, "scripts");
const libDir = join(outDir, "lib");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Source fingerprint: sha256 over the inputs of this build (src/, build script + shims, package
// manifests), with LF line endings. Unlike a git commit id, it is stable when the built bundles
// are committed alongside the sources, so CI can check that committed bundles match a fresh build.
const listFiles = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? listFiles(join(d, n)) : [join(d, n)]));
const sourceInputs = [...listFiles(join(root, "src")), ...listFiles(join(root, "build", "shims")), ...["build/build.mjs", "package.json", "package-lock.json"].map((f) => join(root, f))]
  .map((f) => relative(root, f).split("\\").join("/"))
  .sort();
const sourceHash = createHash("sha256");
for (const f of sourceInputs) sourceHash.update(`${f}\n`).update(readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n")).update("\n");
const source = sourceHash.digest("hex").slice(0, 12);

const REQUIRE_SHIM = `import { createRequire as __upCreateRequire } from "node:module";\nconst require = __upCreateRequire(import.meta.url);\n`;
const banner = (what) =>
  `// ${what}\n` +
  `// Universal Profile Agent Skill v${pkg.version} — MIT-0 — https://github.com/universal-everything/ai-universalprofile-skill\n` +
  `// Built from source fingerprint ${source} (sha256 of src/ and build inputs) with \`npm ci && npm run build\` (esbuild, unminified). Do not edit; edit src/ instead.\n` +
  REQUIRE_SHIM;

const VIEM_SPECIFIERS = /^viem(\/(accounts|chains|account-abstraction|utils|actions))?$/;

/** Rewrites bare imports of vendored packages to the shipped vendor files. */
function vendorRewrite(fromLibDir) {
  const rel = (f) => (fromLibDir ? `./${f}` : `./lib/${f}`);
  return {
    name: "vendor-rewrite",
    setup(b) {
      b.onResolve({ filter: VIEM_SPECIFIERS }, () => ({ path: rel("vendor-viem.mjs"), external: true }));
      b.onResolve({ filter: /^@erc725\/erc725\.js$/ }, () => ({ path: rel("vendor-erc725.mjs"), external: true }));
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
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(libDir, { recursive: true });

// 1) Vendor bundles.
await build({
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
});
await build({
  ...common,
  stdin: { contents: `export { default } from "@erc725/erc725.js";\nexport * from "@erc725/erc725.js";\n`, resolveDir: root, sourcefile: "vendor-erc725.mjs" },
  outfile: join(libDir, "vendor-erc725.mjs"),
  plugins: [{ name: "viem-ext", setup(b) { b.onResolve({ filter: VIEM_SPECIFIERS }, () => ({ path: "./vendor-viem.mjs", external: true })); } }],
  banner: { js: banner("Vendored @erc725/erc725.js (Apache-2.0) — https://github.com/ERC725Alliance/erc725.js") },
});
await build({
  ...common,
  stdin: { contents: `import QRCode from "qrcode";\nexport default QRCode;\n`, resolveDir: root, sourcefile: "vendor-qrcode.mjs" },
  outfile: join(libDir, "vendor-qrcode.mjs"),
  banner: { js: banner("Vendored qrcode (MIT) — https://github.com/soldair/node-qrcode") },
});

// 2) Application: one shared chunk + three thin entry points.
await build({
  ...common,
  entryPoints: [join(root, "src", "app.ts")],
  outfile: join(libDir, "app.mjs"),
  plugins: [vendorRewrite(true)],
  define: { __UP_VERSION__: JSON.stringify(pkg.version), __UP_SOURCE__: JSON.stringify(source) },
  banner: { js: banner("Universal Profile skill — application code") },
});

const entries = {
  "up.mjs": `import { runCli } from "./lib/app.mjs";\nprocess.exitCode = await runCli(process.argv.slice(2));\n`,
  "up-mcp.mjs": `import { runMcpServer } from "./lib/app.mjs";\nawait runMcpServer();\n`,
  "up-doctor.mjs": `import { runCli } from "./lib/app.mjs";\nprocess.exitCode = await runCli(["doctor", ...process.argv.slice(2)]);\n`,
};
for (const [name, body] of Object.entries(entries)) {
  const file = join(outDir, name);
  writeFileSync(file, `#!/usr/bin/env node\n${banner(`Entry point: ${name}`)}${body}`);
  chmodSync(file, 0o755);
}

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
