// Generates skills/universal-profile/references/verbs.md from the built verb
// registry, so the per-verb documentation can never drift from the code.
// Run after `npm run build`.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await import(join(root, "skills", "universal-profile", "scripts", "lib", "app.mjs"));
const verbs = app.allVerbs();
const groups = new Map();
for (const v of verbs) (groups.get(v.group) ?? groups.set(v.group, []).get(v.group)).push(v);

const lines = [
  "# Verb reference (generated)",
  "",
  "> Generated from the code by `build/gen-verb-docs.mjs` — do not edit by hand. Every verb is a CLI command (`node scripts/up.mjs <verb> …`) and an MCP tool (`up_<words>`). Global options on every verb: " +
    app.GLOBAL_PARAMS.map((p) => `\`--${p.name}\``).join(", ") +
    ".",
  "",
  `Risk classes: **local** (no chain writes), **read** (chain/HTTP reads), **write** (acts as the profile; needs \`--yes\` inside the delegated policy or \`--approval\`), **admin** (changes control/permissions; needs \`--approval\` with the human's words), **secret** (key lifecycle).`,
  "",
  "## Index",
  "",
];
for (const [g, vs] of [...groups.entries()].sort()) lines.push(`- **${g}**: ${vs.map((v) => `[\`${v.name}\`](#${v.name.replace(/ /g, "-")})`).join(", ")}`);
lines.push("");
for (const [g, vs] of [...groups.entries()].sort()) {
  lines.push(`## ${g}`, "");
  for (const v of vs) {
    lines.push(`### ${v.name}`, "", `${v.summary}`, "");
    if (v.description) lines.push(v.description, "");
    lines.push(`- CLI: \`up ${v.name}${v.params.filter((p) => p.positional !== undefined).sort((a, b) => a.positional - b.positional).map((p) => (p.required ? ` <${p.name}>` : ` [${p.name}]`)).join("")} [options]\``);
    lines.push(`- MCP tool: \`${app.mcpToolName(v.name)}\` · risk: **${v.risk}**`);
    if (v.params.length) {
      lines.push("", "| option | type | required | description |", "| --- | --- | --- | --- |");
      for (const p of v.params) lines.push(`| \`--${p.name}\` | ${p.type}${p.enum ? ` (${p.enum.join("\\|")})` : ""} | ${p.required ? "yes" : ""} | ${p.description.replace(/\|/g, "\\|")}${p.default !== undefined ? ` Default: \`${JSON.stringify(p.default)}\`.` : ""} |`);
    }
    if (v.examples?.length) lines.push("", "Examples:", "", "```", ...v.examples, "```");
    lines.push("");
  }
}
writeFileSync(join(root, "skills", "universal-profile", "references", "verbs.md"), lines.join("\n"));
console.log(`references/verbs.md: ${verbs.length} verbs in ${groups.size} groups`);
