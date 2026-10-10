// Builds the VerbContext handed to every verb.
import { getAddress, isAddress, type Address } from "viem";
import { readFileSync, existsSync } from "node:fs";
import type { Flags, UpConfig, VerbContext } from "./types.ts";
import { upHome, paths, readJsonStrict, writeJsonWithBackup, ensureDir, isJsonObject } from "./home.ts";
import { withLock } from "./lock.ts";
import { UpError } from "./errors.ts";
import { requireConsent } from "./policy.ts";
import { createRegistry } from "../chain/registry.ts";
import { createRpcManager } from "../chain/rpc.ts";

export const DEFAULT_CONFIG: UpConfig = { version: 1 };

/**
 * Loads older config files unchanged in meaning. Configs written before keys were made
 * permanent listed the agent's earlier keys under a legacy field name; they now load as
 * previousControllers (same keys, still listed, nothing dropped). Saved back under the new name.
 */
export function upgradeConfig<T>(raw: T): T {
  if (!raw || typeof raw !== "object") return raw;
  const { retiredControllers: legacy, ...rest } = raw as Record<string, any>;
  if (!Array.isArray(legacy)) return raw;
  const prev: any[] = Array.isArray(rest.previousControllers) ? [...rest.previousControllers] : [];
  for (const r of legacy) {
    if (!r || typeof r.address !== "string") continue;
    if (prev.some((p) => typeof p?.address === "string" && p.address.toLowerCase() === r.address.toLowerCase())) continue;
    prev.push({ address: r.address, backend: r.backend, switchedAt: r.retiredAt ?? r.switchedAt ?? "", ...(r.chainId !== undefined ? { chainId: r.chainId } : {}) });
  }
  return (prev.length ? { ...rest, previousControllers: prev } : rest) as T;
}

/** config.json as stored (upgraded), or the default when there is none. Throws on an unreadable or invalid file. */
const MISSING = Symbol("missing");

export async function readConfigFile(home: string): Promise<UpConfig> {
  const raw = await readJsonStrict<unknown>(paths.config(home), MISSING);
  if (raw === MISSING) return { ...DEFAULT_CONFIG };
  // `null`, a list, a number or a string is damage, not "no config": never treat it as empty
  if (!isJsonObject(raw)) {
    throw new UpError("INTERNAL", `${paths.config(home)} is damaged (it does not hold a config object); nothing was changed and it will not be overwritten`, { hint: `repair it or restore it (a previous copy may be at ${paths.config(home)}.bak); never delete it: it lists the agent's keys` });
  }
  return { ...DEFAULT_CONFIG, ...upgradeConfig(raw as unknown as UpConfig) };
}

type KeyRef = { address: string; backend: string; chainId?: number };

/** Every key address the config lists: the default key, per-chain keys and previous keys. */
export function configKeys(cfg: UpConfig): KeyRef[] {
  const out: KeyRef[] = [];
  if (cfg.controller?.address) out.push({ address: cfg.controller.address, backend: cfg.controller.backend });
  for (const [id, k] of Object.entries(cfg.chainControllers ?? {})) if (k?.address) out.push({ address: k.address, backend: k.backend, chainId: Number(id) });
  for (const k of cfg.previousControllers ?? []) if (k?.address) out.push({ address: k.address, backend: k.backend, ...(k.chainId !== undefined ? { chainId: k.chainId } : {}) });
  return out;
}

/**
 * Keys are permanent: whatever a writer did, every key listed in `latest` stays listed in the
 * result. A key that would disappear (from controller, chainControllers or previousControllers)
 * is appended to previousControllers.
 */
export function preserveKeyInventory(latest: UpConfig, next: UpConfig, now = new Date().toISOString()): UpConfig {
  const have = new Set(configKeys(next).map((k) => k.address.toLowerCase()));
  const missing = configKeys(latest).filter((k) => !have.has(k.address.toLowerCase()) && (have.add(k.address.toLowerCase()), true));
  if (!missing.length) return next;
  return { ...next, previousControllers: [...(next.previousControllers ?? []), ...missing.map((k) => ({ address: k.address as Address, backend: k.backend, switchedAt: now, ...(k.chainId !== undefined ? { chainId: k.chainId } : {}) }))] };
}

/** Applies only the top-level fields a writer changed relative to what it read (`base`) onto `latest`. */
export function applyChangedFields(latest: UpConfig, base: UpConfig, next: UpConfig): UpConfig {
  const out: Record<string, unknown> = { ...latest };
  const b = base as unknown as Record<string, unknown>;
  const n = next as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(b), ...Object.keys(n)])) {
    if (JSON.stringify(b[k]) === JSON.stringify(n[k])) continue;
    if (n[k] === undefined) delete out[k];
    else out[k] = n[k];
  }
  return out as unknown as UpConfig;
}

export interface ContextOptions {
  home?: string;
  flags: Flags;
  /** stderr logger (CLI) or no-op (MCP) */
  log?: (m: string) => void;
}

export function createContext(opts: ContextOptions): VerbContext {
  const home = opts.home ?? upHome();
  let cfgCache: UpConfig | undefined;
  // What this context last read or wrote, untouched by callers that mutate the returned config:
  // saveConfig() writes only the fields that differ from it.
  let loaded: UpConfig | undefined;
  const config = async () => {
    if (!cfgCache) {
      const c = await readConfigFile(home);
      cfgCache ??= c;
      loaded ??= structuredClone(c);
    }
    return cfgCache;
  };
  const registry = createRegistry(home);
  const rpc = createRpcManager(home, registry, config);

  const ctx: VerbContext = {
    home,
    flags: opts.flags,
    registry,
    rpc,
    config,
    async saveConfig(cfg) {
      const base = loaded ?? { ...DEFAULT_CONFIG };
      await ctx.updateConfig((latest) => applyChangedFields(latest, base, cfg));
    },
    async updateConfig(fn) {
      await ensureDir(home);
      // One shared lock for every config write; the latest file is re-read inside it, so no
      // writer ever puts back a stale copy, and key inventory fields are never dropped.
      return withLock(home, "config", async () => {
        const latest = await readConfigFile(home);
        const draft = structuredClone(latest);
        const next = preserveKeyInventory(latest, (await fn(draft)) ?? draft);
        await writeJsonWithBackup(paths.config(home), next, isJsonObject);
        cfgCache = next;
        loaded = structuredClone(next);
        return next;
      });
    },
    async refreshConfig() {
      cfgCache = undefined;
      loaded = undefined;
      return config();
    },
    async signer(chainId) {
      const { loadSignerFromConfig } = await import("../signer/index.ts");
      const cfg = await config();
      return loadSignerFromConfig(cfg, chainId ?? verbChain());
    },
    async consent(req) {
      // Autonomous writes (--yes, no human approval) must not touch token contracts outside the
      // delegation, whatever function or wrapper is used (allowlist; see token-guard.ts).
      if (req.risk === "write" && !opts.flags.dryRun && !(opts.flags.approval && opts.flags.approval.trim().length >= 3)) {
        const { loadPolicy } = await import("./policy.ts");
        const { guardTokenMoves } = await import("./token-guard.ts");
        await guardTokenMoves(ctx, await loadPolicy(home), req);
      }
      return requireConsent(home, opts.flags, req);
    },
    chainId(arg) {
      const v = arg ?? opts.flags.chain;
      if (v !== undefined && v !== "") return registry.chain(v).chainId;
      if (!cfgCache && existsSync(paths.config(home))) {
        try {
          const raw: unknown = JSON.parse(readFileSync(paths.config(home), "utf8"));
          // a damaged file (not an object) is never cached as an empty config; config() reports it
          if (isJsonObject(raw)) {
            const c = { ...DEFAULT_CONFIG, ...upgradeConfig(raw as unknown as UpConfig) };
            cfgCache = c;
            loaded ??= structuredClone(c);
          }
        } catch {}
      }
      if (cfgCache?.defaultChain) return cfgCache.defaultChain;
      throw new UpError("BAD_ARGS", "no chain given", { hint: "pass --chain <id|name> or set a default: up config set default-chain 42" });
    },
    async identity(arg) {
      const v = arg ?? opts.flags.profile;
      const cfg = await config();
      if (v) return ctx.resolveAddress(v);
      if (cfg.defaultProfile) return getAddress(cfg.defaultProfile);
      throw new UpError("BAD_ARGS", "no profile given", { hint: "pass --profile <address> or set one: up config set default-profile <address>" });
    },
    async profile(arg, chainId) {
      const id = await ctx.identity(arg);
      const c = chainId ?? verbChain();
      if (c === undefined) return id;
      const { profileAddressOn } = await import("./profile-record.ts");
      return profileAddressOn(home, id, c);
    },
    async resolveAddress(v) {
      if (isAddress(v, { strict: false })) return getAddress(v);
      const a = (await config()).aliases?.[v];
      if (a) return getAddress(a);
      throw new UpError("BAD_ARGS", `"${v}" is neither an address nor a known alias`, { hint: "list aliases with: up config get aliases" });
    },
    log: opts.log ?? (() => {}),
  };
  /** The chain the verb acts on (--chain or the default chain), if any. Never throws. */
  const verbChain = (): number | undefined => {
    try {
      return ctx.chainId();
    } catch {
      return undefined;
    }
  };
  // Pre-load config so chainId() can see the default synchronously after the first await in verbs.
  void config().catch(() => {});
  return ctx;
}

export async function preloadConfig(ctx: VerbContext): Promise<UpConfig> {
  return ctx.config();
}

export function checksum(a: string): Address {
  if (!isAddress(a, { strict: false })) throw new UpError("BAD_ARGS", `invalid address: ${a}`);
  return getAddress(a);
}
