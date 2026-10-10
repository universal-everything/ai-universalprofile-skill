// Release gate for the shipped skill folder (skills/universal-profile):
//  - Agent Skills spec: SKILL.md frontmatter (name == dir, description <= 1024,
//    compatibility <= 500), SKILL.md < 500 lines, references one level deep
//  - catalogue constraints: text files only, every file <= 1 MiB, total <= 8 MiB,
//    <= 256 files (OpenClaw managed bundles), no symlinks, no OS junk files
//  - hygiene: no absolute local paths, no secret-looking strings, no minified lines
//  - build manifest hashes match the files on disk
import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { dirname, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "skills", "universal-profile");
const problems = [];
const warn = [];
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  const s = lstatSync(p);
  if (s.isSymbolicLink()) {
    problems.push(`symlink not allowed: ${relative(skill, p)}`);
    return [];
  }
  return s.isDirectory() ? walk(p) : [p];
});
const files = walk(skill);
const TEXT = new Set([".md", ".json", ".mjs", ".js", ".txt", ".yaml", ".yml", ".sh", ".ps1", ""]);
let total = 0;
for (const f of files) {
  const rel = relative(skill, f);
  const buf = readFileSync(f);
  total += buf.length;
  if (/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(rel)) problems.push(`OS junk file: ${rel}`);
  if (!TEXT.has(extname(f)) && !rel.endsWith("LICENSE")) problems.push(`non-text file type: ${rel}`);
  if (buf.includes(0)) problems.push(`binary content: ${rel}`);
  if (buf.length > 1024 * 1024) problems.push(`file > 1 MiB: ${rel} (${buf.length})`);
  const txt = buf.toString("utf8");
  if (/\/Users\/[a-z]|\/home\/[a-z]+\/|C:\\Users\\/i.test(txt)) problems.push(`absolute local path in ${rel}`);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk_live_[0-9a-zA-Z]{8,}|\bghp_[0-9A-Za-z]{20,}|\bAKIA[0-9A-Z]{16}\b/.test(txt)) problems.push(`secret-like string in ${rel}`);
  if ((extname(f) === ".mjs" || extname(f) === ".js") && txt.split("\n").some((l) => l.length > 2000 && !/^\s*(\/\/|\*)/.test(l) && !/"0x[0-9a-f]{1000,}"/i.test(l))) warn.push(`very long code line (minified?) in ${rel}`);
}
if (files.length > 256) problems.push(`too many files: ${files.length} > 256`);
if (total > 8 * 1024 * 1024) problems.push(`total size ${total} > 8 MiB`);

// SKILL.md frontmatter
const skillMd = join(skill, "SKILL.md");
if (!existsSync(skillMd)) problems.push("SKILL.md missing");
else {
  const s = readFileSync(skillMd, "utf8");
  const m = s.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) problems.push("SKILL.md has no YAML frontmatter");
  else {
    const fm = m[1];
    const get = (k) => {
      const r = fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"));
      if (!r) return undefined;
      let v = r[1].trim();
      if (v === ">" || v === "|" || v === ">-" || v === "|-") {
        const after = fm.slice(fm.indexOf(r[0]) + r[0].length).split("\n");
        const block = [];
        for (const l of after.slice(1)) {
          if (/^\S/.test(l)) break;
          block.push(l.trim());
        }
        v = block.join(" ").trim();
      }
      return v.replace(/^["']|["']$/g, "");
    };
    const name = get("name");
    const desc = get("description");
    const compat = get("compatibility");
    if (name !== "universal-profile") problems.push(`frontmatter name "${name}" must equal directory name "universal-profile"`);
    if (!desc || desc.length > 1024) problems.push(`description missing or > 1024 chars (${desc?.length})`);
    if (compat && compat.length > 500) problems.push(`compatibility > 500 chars (${compat.length})`);
    if (!/^license:\s*MIT-0/m.test(fm)) warn.push("license is not MIT-0");
  }
  const lines = s.split("\n").length;
  if (lines >= 500) problems.push(`SKILL.md has ${lines} lines (>= 500)`);
  // references linked from SKILL.md must exist and be one level deep
  for (const link of s.matchAll(/\]\((references\/[^)#]+)\)/g)) {
    const p = link[1];
    if (p.split("/").length > 2) problems.push(`reference not one level deep: ${p}`);
    if (!existsSync(join(skill, p))) problems.push(`broken reference link: ${p}`);
  }
}

// build manifest
const buildJson = join(skill, "scripts", "BUILD.json");
if (existsSync(buildJson)) {
  const b = JSON.parse(readFileSync(buildJson, "utf8"));
  for (const [rel, m] of Object.entries(b.files)) {
    const p = join(skill, rel);
    if (!existsSync(p)) problems.push(`BUILD.json lists missing file ${rel}`);
    else if (createHash("sha256").update(readFileSync(p)).digest("hex") !== m.sha256) problems.push(`BUILD.json hash mismatch for ${rel}`);
  }
} else problems.push("scripts/BUILD.json missing (run npm run build)");

console.log(`skill files: ${files.length}, total ${(total / 1024).toFixed(0)} KiB`);
for (const w of warn) console.log(`⚠️  ${w}`);
if (problems.length) {
  for (const p of problems) console.log(`✗ ${p}`);
  process.exit(1);
}
console.log("✓ skill package verified");
