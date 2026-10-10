#!/usr/bin/env node
// Entry point: up-mcp.mjs
// Universal Profile Agent Skill v0.1.0 — MIT-0 — https://github.com/universal-everything/ai-universalprofile-skill
// Built from source fingerprint 89811a86f0b3 (sha256 of src/ and build inputs) with `npm ci && npm run build` (esbuild, unminified). Do not edit; edit src/ instead.
import { createRequire as __upCreateRequire } from "node:module";
const require = __upCreateRequire(import.meta.url);
import { runMcpServer } from "./lib/app.mjs";
await runMcpServer();
