// Locates the bundled assets/ directory both in the shipped skill
// (scripts/lib/app.mjs -> ../../assets) and when running from source (tests).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

export function assetsDir(): string {
  if (cached) return cached;
  if (process.env.UP_ASSETS_DIR) return (cached = resolve(process.env.UP_ASSETS_DIR));
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "assets"), // skills/universal-profile/scripts/lib -> skills/universal-profile/assets
    join(here, "..", "..", "skills", "universal-profile", "assets"), // src/core -> repo root
  ];
  for (const c of candidates) if (existsSync(join(c, "registry"))) return (cached = c);
  throw new Error(`assets directory not found (looked in ${candidates.join(", ")}); set UP_ASSETS_DIR`);
}

export function skillDir(): string {
  return dirname(assetsDir());
}

const jsonCache = new Map<string, unknown>();

/** Reads and caches a JSON file relative to assets/. */
export function assetJson<T = any>(...rel: string[]): T {
  const file = join(assetsDir(), ...rel);
  if (!jsonCache.has(file)) jsonCache.set(file, JSON.parse(readFileSync(file, "utf8")));
  return jsonCache.get(file) as T;
}

export function assetText(...rel: string[]): string {
  return readFileSync(join(assetsDir(), ...rel), "utf8");
}

export function assetExists(...rel: string[]): boolean {
  return existsSync(join(assetsDir(), ...rel));
}
