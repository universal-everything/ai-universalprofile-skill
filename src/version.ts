// Injected at build time by esbuild `define`; falls back for tests/source runs.
declare const __UP_VERSION__: string | undefined;
declare const __UP_COMMIT__: string | undefined;
export const VERSION: string = typeof __UP_VERSION__ !== "undefined" ? __UP_VERSION__ : "0.0.0-dev";
export const COMMIT: string = typeof __UP_COMMIT__ !== "undefined" ? __UP_COMMIT__ : "source";
