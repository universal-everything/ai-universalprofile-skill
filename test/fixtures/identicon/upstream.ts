// Test infrastructure only (never shipped, never imported by src/):
// loads the verbatim upstream `ethereum-blockies-base64` source from
// ./upstream/ (lukso-network fork @ 1290187d9c099335a06a2f867d5240a6034a6631,
// MIT) inside a fresh node:vm context with a tiny CommonJS shim, so the golden
// identicons are produced by the original algorithm rather than by our port.
// The file hashes are pinned in vectors.json and checked before use.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

export const UPSTREAM_DIR = join(import.meta.dirname, "upstream");

export const UPSTREAM_SOURCE = {
  repository: "https://github.com/lukso-network/ethereum-blockies-base64",
  forkOf: "https://github.com/MyCryptoHQ/ethereum-blockies-base64",
  commit: "1290187d9c099335a06a2f867d5240a6034a6631",
  version: "1.0.2",
  license: "MIT",
  files: {
    "main.js": "f306e0fae4d11a151cb03ad838bd216fc9ff02db2666a7f9034e962a6be36679",
    "hsl2rgb.js": "1a6cc87e46e0094bef4013fa7eea68bdcf83c5779809b37f23b44cc45bfdf365",
    "pnglib.js": "fdc64fdf0e7c5d7602006a44244d17e9b710c8f799560d779383fd17cdf6b18b",
  } as Record<string, string>,
};

export function loadUpstreamMakeBlockie(): (address: string) => string {
  const cache = new Map<string, { exports: any }>();
  const load = (name: string): any => {
    const file = name.replace(/^\.\//, "") + ".js";
    const cached = cache.get(file);
    if (cached) return cached.exports;
    const code = readFileSync(join(UPSTREAM_DIR, file), "utf8");
    const sha = createHash("sha256").update(code).digest("hex");
    if (sha !== UPSTREAM_SOURCE.files[file]) throw new Error(`upstream ${file} hash mismatch: ${sha}`);
    const module = { exports: {} as any };
    cache.set(file, module);
    // Fresh, empty global object: the upstream code only needs Math/String/Array/Object.
    const wrapper = vm.runInNewContext(`(function (require, module, exports) {\n${code}\n})`, {}, { filename: file });
    wrapper(load, module, module.exports);
    return module.exports;
  };
  return load("./main");
}
