// Relayer selection (config first, then registry data per chain) and a small
// capability cache ($UP_HOME/cache/relayers/<name>.json, 1 h TTL).
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { paths, readJson, writeJson } from "../core/home.ts";
import { RelayerClient, type Capabilities, type FetchLike, type RelayerEntry } from "./client.ts";

export interface KnownRelayer extends RelayerEntry {
  source: "config" | "registry";
}

const CAPS_TTL_MS = 60 * 60 * 1000;

export async function listRelayers(ctx: VerbContext, chainId?: number): Promise<KnownRelayer[]> {
  const cfg = await ctx.config();
  const out: KnownRelayer[] = (cfg.relayers ?? []).map((r) => ({ ...r, source: "config" as const }));
  for (const c of ctx.registry.chains()) {
    for (const r of c.relayers ?? []) {
      const existing = out.find((x) => x.baseUrl.replace(/\/+$/, "") === r.baseUrl.replace(/\/+$/, ""));
      if (existing) continue;
      out.push({ name: r.name, baseUrl: r.baseUrl, chainIds: [c.chainId], profile: r.profile, source: "registry" });
    }
  }
  return chainId === undefined ? out : out.filter((r) => r.chainIds.includes(chainId));
}

/** Picks a relayer for a chain: by name/URL if given, else the first configured, else registry data. */
export async function selectRelayer(ctx: VerbContext, chainId: number, nameOrUrl?: string): Promise<KnownRelayer | undefined> {
  const all = await listRelayers(ctx);
  if (nameOrUrl) {
    const r = all.find((x) => x.name === nameOrUrl || x.baseUrl.replace(/\/+$/, "") === nameOrUrl.replace(/\/+$/, ""));
    if (!r) throw new UpError("BAD_ARGS", `unknown relayer "${nameOrUrl}"`, { hint: "list relayers with: up relayer list (add one with: up relayer add <url> --chains <id>)" });
    if (!r.chainIds.includes(chainId)) throw new UpError("RELAYER_ERROR", `relayer ${r.name} is not configured for chain ${chainId}`, { hint: `add the chain: up relayer add ${r.baseUrl} --name ${r.name} --chains ${[...r.chainIds, chainId].join(",")}` });
    return r;
  }
  return all.find((x) => x.chainIds.includes(chainId) && x.source === "config") ?? all.find((x) => x.chainIds.includes(chainId));
}

function capsFile(ctx: VerbContext, entry: RelayerEntry): string {
  return paths.cache(ctx.home, "relayers", `${entry.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

export async function getCapabilities(ctx: VerbContext, entry: RelayerEntry, opts: { refresh?: boolean; fetch?: FetchLike } = {}): Promise<Capabilities> {
  const file = capsFile(ctx, entry);
  const cached = await readJson<{ baseUrl: string; caps: Capabilities } | undefined>(file, undefined);
  if (!opts.refresh && cached && cached.baseUrl === entry.baseUrl && Date.now() - Date.parse(cached.caps.fetchedAt) < CAPS_TTL_MS) return cached.caps;
  const caps = await new RelayerClient(entry, { fetch: opts.fetch }).capabilities();
  await writeJson(file, { baseUrl: entry.baseUrl, caps }).catch(() => {});
  return caps;
}

export function clientFor(entry: RelayerEntry, fetchImpl?: FetchLike): RelayerClient {
  return new RelayerClient(entry, { fetch: fetchImpl });
}
