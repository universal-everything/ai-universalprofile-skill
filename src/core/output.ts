// Output rendering for the CLI. JSON (default when stdout is not a TTY or --json)
// is a single object: { ok, verb, data, text?, media?, warnings? } or
// { ok:false, error:{code,message,hint,details} }. Human mode prints text + media paths.
import type { VerbResult } from "./types.ts";
import { toJson, redact } from "./json.ts";
import type { UpError } from "./errors.ts";

export function renderResult(verb: string, r: VerbResult, json: boolean): string {
  if (json) return toJson(redact({ ok: true, verb, data: r.data, text: r.text, media: r.media, warnings: r.warnings }));
  const lines: string[] = [];
  if (r.text) lines.push(r.text);
  else lines.push(toJson(redact(r.data)));
  for (const m of r.media ?? []) lines.push(`🖼  ${m.description}: ${m.path}`);
  for (const w of r.warnings ?? []) lines.push(`⚠️  ${w}`);
  return lines.join("\n");
}

export function renderError(verb: string | undefined, e: UpError, json: boolean): string {
  if (json) return toJson(redact({ ok: false, verb, error: e.toJSON() }));
  const lines = [`✗ ${e.code}: ${e.message}`];
  if (e.hint) lines.push(`→ ${e.hint}`);
  if (e.details !== undefined) lines.push(toJson(redact(e.details)));
  return lines.join("\n");
}
