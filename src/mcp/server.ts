// Minimal, dependency-free MCP server over stdio (newline-delimited JSON-RPC 2.0),
// implementing the subset every MCP client needs: initialize, ping,
// tools/list, tools/call, resources/list, resources/read (bundled references).
// Each verb is one tool named up_<verb_words>. Tool results carry the same JSON
// payload as the CLI (structuredContent + text), plus generated media paths.
import { createInterface } from "node:readline";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { allVerbs, coerceArgs, inputSchema, mcpToolName, verbFromToolName } from "../core/verbs.ts";
import { createContext, preloadConfig } from "../core/context.ts";
import { withLock } from "../core/lock.ts";
import { asUpError, UpError } from "../core/errors.ts";
import { redact, replacer } from "../core/json.ts";
import { skillDir } from "../core/assets.ts";
import { VERSION } from "../version.ts";
import { WITHHELD_MESSAGE, containsSecret } from "../core/secret-guard.ts";
import { safeEcho } from "../core/safe-text.ts";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

// State-changing tools run strictly one at a time (shared controller nonce, LSP25 nonces,
// daily policy counter). Read-only tools may run concurrently.
let writeQueue: Promise<unknown> = Promise.resolve();
function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => undefined);
  return run;
}
/** Request ids cancelled by the client (notifications/cancelled) before their tool started. */
const cancelled = new Set<string | number>();

function send(msg: unknown) {
  const line = JSON.stringify(msg, replacer);
  // Never send key material to the client (the AI provider): replace the whole result.
  const id = (msg as { id?: unknown })?.id;
  process.stdout.write((containsSecret(line) ? JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message: WITHHELD_MESSAGE } }) : line) + "\n");
}

function referenceFiles(): { uri: string; name: string; path: string }[] {
  const dir = join(skillDir(), "references");
  if (!existsSync(dir)) return [];
  const out: { uri: string; name: string; path: string }[] = [];
  const walk = (d: string, prefix: string) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (n.isDirectory()) walk(join(d, n.name), `${prefix}${n.name}/`);
      else if (n.name.endsWith(".md")) out.push({ uri: `up://references/${prefix}${n.name}`, name: `${prefix}${n.name}`, path: join(d, n.name) });
    }
  };
  walk(dir, "");
  const skill = join(skillDir(), "SKILL.md");
  if (existsSync(skill)) out.unshift({ uri: "up://SKILL.md", name: "SKILL.md", path: skill });
  return out;
}

export async function handleMcpMessage(msg: any): Promise<unknown | undefined> {
  const { id, method, params } = msg ?? {};
  const isRequest = id !== undefined && id !== null;
  const ok = (result: unknown) => (isRequest ? { jsonrpc: "2.0", id, result } : undefined);
  const fail = (code: number, message: string, data?: unknown) => (isRequest ? { jsonrpc: "2.0", id, error: { code, message, data } } : undefined);
  try {
    switch (method) {
      case "initialize": {
        const requested = params?.protocolVersion;
        const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
        return ok({
          protocolVersion,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: "universal-profile", title: "Universal Profile (LUKSO) agent skill", version: VERSION },
          instructions:
            "Gives this agent its own Universal Profile (ERC725 smart account + LSP6 Key Manager) on LUKSO and any EVM chain. Start with up_doctor, then up_init. Read up://SKILL.md for the workflow and safety rules. Never ask for or reveal private keys.",
        });
      }
      case "notifications/initialized":
        return undefined;
      case "notifications/cancelled":
        if (params?.requestId !== undefined) cancelled.add(params.requestId);
        return undefined;
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: allVerbs().map((v) => ({
            name: mcpToolName(v.name),
            title: v.name,
            description: `${v.summary}${v.description ? "\n\n" + v.description : ""}\n\nrisk: ${v.risk}`,
            inputSchema: inputSchema(v),
            annotations: { readOnlyHint: v.risk === "local" || v.risk === "read", destructiveHint: v.risk === "admin" || v.risk === "secret", openWorldHint: v.risk !== "local" },
          })),
        });
      case "tools/call": {
        const v = verbFromToolName(params?.name);
        if (!v) return fail(-32602, `unknown tool ${safeEcho(params?.name)}`);
        try {
          const args = coerceArgs(v, params?.arguments ?? {});
          const execute = async () => {
            if (cancelled.delete(id)) throw new UpError("BAD_ARGS", "request cancelled by the client before it started; nothing was signed or sent");
            const ctx = createContext({ flags: { json: true, dryRun: args["dry-run"] === true, yes: args.yes === true, approval: args.approval, chain: args.chain, profile: args.profile } });
            await preloadConfig(ctx);
            return v.risk === "local" || v.risk === "read" ? v.run(ctx, args) : withLock(ctx.home, "write", async () => {
              // re-read the config inside the lock: another command may have switched keys meanwhile
              await ctx.refreshConfig?.();
              return v.run(ctx, args);
            });
          };
          const r = v.risk === "local" || v.risk === "read" ? await execute() : await serialised(execute);
          const payload = redact({ ok: true, verb: v.name, data: r.data, media: r.media, warnings: r.warnings });
          const content: any[] = [{ type: "text", text: (r.text ? r.text + "\n\n" : "") + JSON.stringify(payload, replacer, 2) }];
          for (const m of r.media ?? []) {
            if (m.mimeType.startsWith("image/") && existsSync(m.path)) content.push({ type: "image", data: readFileSync(m.path).toString("base64"), mimeType: m.mimeType });
          }
          return ok({ content, structuredContent: JSON.parse(JSON.stringify(payload, replacer)), isError: false });
        } catch (e) {
          const err = asUpError(e);
          const payload = redact({ ok: false, verb: v.name, error: err.toJSON() });
          return ok({ content: [{ type: "text", text: JSON.stringify(payload, replacer, 2) }], structuredContent: JSON.parse(JSON.stringify(payload, replacer)), isError: true });
        }
      }
      case "resources/list":
        return ok({ resources: referenceFiles().map((r) => ({ uri: r.uri, name: r.name, mimeType: "text/markdown" })) });
      case "resources/read": {
        const r = referenceFiles().find((x) => x.uri === params?.uri);
        if (!r) return fail(-32602, `unknown resource ${safeEcho(params?.uri)}`);
        return ok({ contents: [{ uri: r.uri, mimeType: "text/markdown", text: readFileSync(r.path, "utf8") }] });
      }
      default:
        return fail(-32601, `method not found: ${safeEcho(method)}`);
    }
  } catch (e) {
    return fail(-32603, safeEcho((e as Error).message, 300));
  }
}

export async function runMcpServer(): Promise<void> {
  process.env.UP_MCP_SERVER = "1"; // standard input carries the protocol: verbs must not read it (backup --password-stdin)
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    const p = (async () => {
      const batch = Array.isArray(msg) ? msg : [msg];
      for (const m of batch) {
        const res = await handleMcpMessage(m);
        if (res) send(res);
      }
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  await new Promise<void>((resolve) => rl.on("close", resolve));
  await Promise.allSettled([...pending]);
}
