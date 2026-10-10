// Knowledge verbs: the bundled reference documents and the standards table.
//   docs [topic]     list references/*.md, or print one of them
//   standards list   LSP0–LSP26 + the ERC standards the skill uses, with spec URLs
// Both are local (no network, no consent). `protocols list|verify` live with
// the registry/protocol code, not here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import { skillDir } from "../core/assets.ts";
import { findStandards } from "./standards.ts";

export interface DocTopic {
  topic: string;
  file: string; // path relative to the skill directory, e.g. references/security.md
  title: string;
  summary: string;
  lines: number;
}

function referencesDir(): string {
  return join(skillDir(), "references");
}

/** First "# " heading and the first prose line after it. */
function describe(text: string): { title: string; summary: string } {
  const lines = text.split(/\r?\n/);
  const h = lines.findIndex((l) => /^#\s+/.test(l));
  const title = h >= 0 ? lines[h].replace(/^#\s+/, "").trim() : "";
  let summary = "";
  for (let i = h + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith("#") || l.startsWith("|") || l.startsWith("```") || l.startsWith("---")) continue;
    summary = l.replace(/^>\s*/, "").replace(/\*\*/g, "");
    break;
  }
  if (summary.length > 200) summary = summary.slice(0, 197) + "...";
  return { title, summary };
}

export function listDocTopics(): DocTopic[] {
  const dir = referencesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => {
      const text = readFileSync(join(dir, d.name), "utf8");
      return { topic: d.name.slice(0, -3), file: `references/${d.name}`, ...describe(text), lines: text.split(/\r?\n/).length };
    })
    .sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Normalises "Security", "security.md", "references/security.md" to "security"; rejects anything path-like. */
export function normaliseTopic(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/^references\//, "").replace(/\.md$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) {
    throw new UpError("BAD_ARGS", `invalid topic "${raw.slice(0, 64)}"`, { hint: "run: up docs   (lists the topics)" });
  }
  return t;
}

export function readDoc(rawTopic: string): { doc: DocTopic; content: string } {
  const topic = normaliseTopic(rawTopic);
  const topics = listDocTopics();
  const doc = topics.find((d) => d.topic === topic);
  if (!doc) {
    throw new UpError("BAD_ARGS", `no reference named "${topic}"`, {
      hint: "run: up docs   (lists the topics)",
      details: { topics: topics.map((d) => d.topic) },
    });
  }
  return { doc, content: readFileSync(join(skillDir(), doc.file), "utf8") };
}

defineVerb({
  name: "docs",
  group: "knowledge",
  summary: "List the bundled reference documents, or print one (e.g. up docs permissions).",
  description:
    "Without a topic: every references/*.md file with its title and one-line summary. With a topic: the full document in `text` (data carries the file name and size). Topics are file names without .md.",
  risk: "local",
  params: [{ name: "topic", type: "string", description: "Reference name, e.g. security, permissions, execution-paths, errors.", positional: 0 }],
  examples: ["up docs", "up docs onboarding", "up docs errors"],
  async run(_ctx, a) {
    if (a.topic === undefined || String(a.topic).trim() === "") {
      const topics = listDocTopics();
      return {
        data: { count: topics.length, topics },
        text: topics.length
          ? ["Reference documents (read one with: up docs <topic>)", ...topics.map((t) => `  ${t.topic.padEnd(22)} ${t.title}${t.summary ? ` — ${t.summary}` : ""}`)].join("\n")
          : "no reference documents found next to this skill",
      };
    }
    const { doc, content } = readDoc(String(a.topic));
    return { data: { topic: doc.topic, file: doc.file, title: doc.title, lines: doc.lines, bytes: Buffer.byteLength(content, "utf8") }, text: content };
  },
});

defineVerb({
  name: "standards list",
  group: "knowledge",
  summary: "List the LSP and ERC standards the skill covers, with one-line descriptions, interface ids and specification URLs.",
  description: "Filter by exact id (lsp6, erc-4337), by kind (account, token, data, infrastructure, api, erc) or by any word in the name/summary.",
  risk: "local",
  params: [{ name: "filter", type: "string", description: "Optional id, kind or search word.", positional: 0 }],
  examples: ["up standards list", "up standards list token", "up standards list lsp25"],
  async run(_ctx, a) {
    const rows = findStandards(a.filter === undefined ? undefined : String(a.filter));
    return {
      data: { count: rows.length, standards: rows },
      text: rows.length
        ? rows.map((s) => `${s.id.padEnd(9)} ${s.name} — ${s.summary}\n          ${s.url}`).join("\n")
        : `no standard matches "${a.filter}"`,
    };
  },
});
