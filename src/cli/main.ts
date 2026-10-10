// CLI: `up <verb words> [positionals] [--options]`.
import { parseArgv } from "../core/args.ts";
import { allVerbs, coerceArgs, GLOBAL_PARAMS, matchVerb } from "../core/verbs.ts";
import { createContext, preloadConfig } from "../core/context.ts";
import { withLock } from "../core/lock.ts";
import { renderError, renderResult } from "../core/output.ts";
import { UpError, asUpError } from "../core/errors.ts";
import type { VerbDef } from "../core/types.ts";
import { VERSION } from "../version.ts";

function helpFor(v: VerbDef): string {
  const pos = v.params.filter((p) => p.positional !== undefined).sort((a, b) => a.positional! - b.positional!);
  const usage = `up ${v.name}${pos.map((p) => (p.required ? ` <${p.name}>` : ` [${p.name}]`)).join("")} [options]`;
  const lines = [usage, "", v.summary];
  if (v.description) lines.push("", v.description);
  lines.push("", `risk: ${v.risk}`, "", "options:");
  for (const p of [...v.params, ...GLOBAL_PARAMS]) {
    lines.push(`  --${p.name}${p.type === "boolean" ? "" : ` <${p.type}>`}${p.required ? " (required)" : ""}  ${p.description}${p.default !== undefined ? ` [default: ${JSON.stringify(p.default)}]` : ""}${p.enum ? ` {${p.enum.join("|")}}` : ""}`);
  }
  if (v.examples?.length) lines.push("", "examples:", ...v.examples.map((e) => `  ${e}`));
  return lines.join("\n");
}

function overview(): string {
  const groups = new Map<string, VerbDef[]>();
  for (const v of allVerbs()) (groups.get(v.group) ?? groups.set(v.group, []).get(v.group)!).push(v);
  const lines = [`up ${VERSION} — Universal Profile agent skill (ERC725 account + LSP6 Key Manager on any EVM chain)`, "", "usage: up <verb> [args] [--options]   (up <verb> --help for details)", ""];
  for (const [g, vs] of [...groups.entries()].sort()) {
    lines.push(`${g}:`);
    for (const v of vs) lines.push(`  ${v.name.padEnd(28)} ${v.summary}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function runCli(argv: string[]): Promise<number> {
  const { words, options } = parseArgv(argv);
  const json = options.json === true || (!process.stdout.isTTY && options.json !== false);
  if (words.length === 0 || words[0] === "help") {
    if (words[1]) {
      const m = matchVerb(words.slice(1));
      process.stdout.write((m ? helpFor(m.verb) : overview()) + "\n");
    } else process.stdout.write(overview() + "\n");
    return 0;
  }
  if (words[0] === "version" || options.version === true) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const m = matchVerb(words);
  if (!m) {
    process.stdout.write(renderError(words.join(" "), new UpError("UNKNOWN_VERB", `unknown verb "${words.join(" ")}"`, { hint: "run: up help" }), json) + "\n");
    return 2;
  }
  const { verb, rest } = m;
  if (options.help === true) {
    process.stdout.write(helpFor(verb) + "\n");
    return 0;
  }
  try {
    const raw: Record<string, unknown> = { ...options };
    delete raw.help;
    const pos = verb.params.filter((p) => p.positional !== undefined).sort((a, b) => a.positional! - b.positional!);
    if (rest.length > pos.length && !pos.some((p) => p.type === "string[]")) {
      throw new UpError("BAD_ARGS", `too many positional arguments for "${verb.name}"`, { hint: `run: up ${verb.name} --help` });
    }
    pos.forEach((p, i) => {
      if (p.type === "string[]") raw[p.name] = rest.slice(i);
      else if (rest[i] !== undefined) raw[p.name] = rest[i];
    });
    const args = coerceArgs(verb, raw);
    const ctx = createContext({
      flags: { json, dryRun: args["dry-run"] === true, yes: args.yes === true, approval: args.approval, chain: args.chain, profile: args.profile },
      log: (msg) => process.stderr.write(`· ${msg}\n`),
    });
    await preloadConfig(ctx);
    const result = verb.risk === "local" || verb.risk === "read" ? await verb.run(ctx, args) : await withLock(ctx.home, "write", async () => {
          // re-read the config inside the lock: another command may have switched keys meanwhile
          await ctx.refreshConfig?.();
          return verb.run(ctx, args);
        });
    process.stdout.write(renderResult(verb.name, result, json) + "\n");
    return 0;
  } catch (e) {
    const err = asUpError(e);
    process.stdout.write(renderError(verb.name, err, json) + "\n");
    return err.code === "BAD_ARGS" ? 2 : 1;
  }
}
