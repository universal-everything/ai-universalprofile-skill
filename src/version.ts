// Injected at build time by esbuild `define`; falls back for tests/source runs.
declare const __UP_VERSION__: string | undefined;
declare const __UP_SOURCE__: string | undefined;
export const VERSION: string = typeof __UP_VERSION__ !== "undefined" ? __UP_VERSION__ : "0.0.0-dev";
/** Source fingerprint of the build (sha256 of src/ and build inputs, see build/build.mjs). */
export const SOURCE: string = typeof __UP_SOURCE__ !== "undefined" ? __UP_SOURCE__ : "source";
