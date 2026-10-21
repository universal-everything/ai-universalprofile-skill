// Verb registry: one definition serves the CLI and the MCP server.
import type { ParamDef, VerbDef } from "./types.ts";
import { UpError } from "./errors.ts";

const verbs = new Map<string, VerbDef>();

export function defineVerb(def: VerbDef): VerbDef {
  if (verbs.has(def.name)) throw new Error(`verb "${def.name}" registered twice`);
  for (const p of def.params) {
    if (!/^[a-z][a-z0-9-]*$/.test(p.name)) throw new Error(`verb "${def.name}": bad param name "${p.name}"`);
  }
  verbs.set(def.name, def);
  return def;
}

export function allVerbs(): VerbDef[] {
  return [...verbs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getVerb(name: string): VerbDef | undefined {
  return verbs.get(name);
}

/** Longest-prefix match of CLI words against registered verb names. */
export function matchVerb(words: string[]): { verb: VerbDef; rest: string[] } | undefined {
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const name = words.slice(0, n).join(" ");
    const v = verbs.get(name);
    if (v) return { verb: v, rest: words.slice(n) };
  }
  return undefined;
}

export function mcpToolName(verbName: string): string {
  return "up_" + verbName.replace(/[ -]/g, "_");
}

export function verbFromToolName(tool: string): VerbDef | undefined {
  for (const v of verbs.values()) if (mcpToolName(v.name) === tool) return v;
  return undefined;
}

/** Global flags accepted by every verb (CLI: --flag; MCP: same property names). */
export const GLOBAL_PARAMS: ParamDef[] = [
  { name: "chain", type: "string", description: "Chain id or slug/name from the registry (e.g. 42, lukso, base). Defaults to config.defaultChain." },
  { name: "profile", type: "string", description: "Universal Profile address or alias. Defaults to config.defaultProfile." },
  { name: "dry-run", type: "boolean", description: "Build, simulate and show everything but never sign or send." },
  { name: "yes", type: "boolean", description: "Agent confirms the action is within the delegated policy (policy.json). Not sufficient for admin actions without policy.allowAdmin." },
  { name: "approval", type: "string", description: "Verbatim human approval text for this exact action (recorded in the local audit log). Required for admin actions and anything outside the delegated policy." },
  { name: "json", type: "boolean", description: "Force JSON output (default when stdout is not a TTY)." },
];

function jsonSchemaFor(p: ParamDef): Record<string, unknown> {
  const base: Record<string, unknown> = { description: p.description };
  switch (p.type) {
    case "string":
      base.type = "string";
      break;
    case "number":
      base.type = "number";
      break;
    case "integer":
      base.type = "integer";
      break;
    case "boolean":
      base.type = "boolean";
      break;
    case "string[]":
      base.type = "array";
      base.items = { type: "string" };
      break;
    case "json":
      break; // any JSON value
  }
  if (p.enum) base.enum = [...p.enum];
  if (p.default !== undefined) base.default = p.default;
  return base;
}

export function inputSchema(v: VerbDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of [...v.params, ...GLOBAL_PARAMS.filter((g) => !v.params.some((p) => p.name === g.name))]) {
    properties[p.name] = jsonSchemaFor(p);
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * A JSON number above 2^53 - 1 has already lost precision when the JSON was parsed (an MCP client
 * sending a channel, nonce or wei amount as a number): refuse it instead of passing on a rounded value.
 */
function assertExactNumber(name: string, val: unknown): void {
  if (typeof val === "number" && Number.isInteger(val) && !Number.isSafeInteger(val)) {
    throw new UpError("BAD_ARGS", `--${name}: a JSON number above 2^53 - 1 is not exact (it was rounded when the JSON was parsed); pass large integers as a decimal or 0x string`);
  }
}

/** Coerces and validates raw arguments (strings from the CLI, JSON from MCP) against the verb's params. */
export function coerceArgs(v: VerbDef, raw: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = {};
  const defs = [...v.params, ...GLOBAL_PARAMS.filter((g) => !v.params.some((p) => p.name === g.name))];
  const known = new Set(defs.map((d) => d.name));
  for (const k of Object.keys(raw)) {
    if (!known.has(k)) throw new UpError("BAD_ARGS", `unknown option --${k} for "${v.name}"`, { hint: `run: up ${v.name} --help` });
  }
  for (const d of defs) {
    let val = raw[d.name];
    if (val === undefined) {
      if (d.default !== undefined) out[d.name] = d.default;
      else if (d.required) throw new UpError("BAD_ARGS", `missing required option --${d.name} for "${v.name}"`, { hint: `run: up ${v.name} --help` });
      continue;
    }
    switch (d.type) {
      case "boolean":
        if (typeof val === "string") val = !["false", "0", "no", "off"].includes(val.toLowerCase());
        break;
      case "number":
      case "integer": {
        const n = typeof val === "number" ? val : Number(val);
        if (!Number.isFinite(n) || (d.type === "integer" && !Number.isInteger(n))) throw new UpError("BAD_ARGS", `--${d.name} must be a ${d.type}`);
        if (d.type === "integer" && !Number.isSafeInteger(n)) throw new UpError("BAD_ARGS", `--${d.name} is too large to be exact (above 2^53 - 1)`);
        val = n;
        break;
      }
      case "string[]":
        if (typeof val === "string") val = val.split(",").map((s) => s.trim()).filter(Boolean);
        else if (!Array.isArray(val)) {
          assertExactNumber(d.name, val);
          val = [String(val)];
        } else {
          for (const x of val) assertExactNumber(d.name, x);
          val = val.map(String);
        }
        break;
      case "json":
        if (typeof val === "string") {
          try {
            val = JSON.parse(val);
          } catch {
            /* keep string: many json params also accept plain strings */
          }
        }
        break;
      case "string":
        assertExactNumber(d.name, val); // before String(): precision cannot be recovered afterwards
        val = String(val);
        break;
    }
    if (d.enum && !d.enum.includes(String(val))) throw new UpError("BAD_ARGS", `--${d.name} must be one of ${d.enum.join(", ")}`);
    out[d.name] = val;
  }
  return out;
}
