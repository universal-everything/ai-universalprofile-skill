#!/usr/bin/env node
// Entry point: up-doctor.mjs
// Universal Profile Agent Skill v0.1.0 — MIT-0 — https://github.com/universal-everything/ai-universalprofile-skill
// Built from source fingerprint d0360c6ba6ce (sha256 of the bundled src/ modules and build inputs) with `npm ci && npm run build` (esbuild, unminified). Do not edit; edit src/ instead.
import { createRequire as __upCreateRequire } from "node:module";
const require = __upCreateRequire(import.meta.url);
import { runCli } from "./lib/app.mjs";
process.exitCode = await runCli(["doctor", ...process.argv.slice(2)]);
