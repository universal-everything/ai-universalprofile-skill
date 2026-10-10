// Builds the VerbContext handed to every verb.
import { getAddress, isAddress, type Address } from "viem";
import { readFileSync, existsSync } from "node:fs";
import type { Flags, UpConfig, VerbContext } from "./types.ts";
import { upHome, paths, readJson, writeJson, ensureDir } from "./home.ts";
import { UpError } from "./errors.ts";
import { requireConsent } from "./policy.ts";
import { createRegistry } from "../chain/registry.ts";
import { createRpcManager } from "../chain/rpc.ts";

export const DEFAULT_CONFIG: UpConfig = { version: 1 };

export interface ContextOptions {
  home?: string;
  flags: Flags;
  /** stderr logger (CLI) or no-op (MCP) */
  log?: (m: string) => void;
}

export function createContext(opts: ContextOptions): VerbContext {
  const home = opts.home ?? upHome();
  let cfgCache: UpConfig | undefined;
  const config = async () => (cfgCache ??= { ...DEFAULT_CONFIG, ...(await readJson<UpConfig>(paths.config(home), DEFAULT_CONFIG)) });
  const registry = createRegistry(home);
  const rpc = createRpcManager(home, registry, config);

  const ctx: VerbContext = {
    home,
    flags: opts.flags,
    registry,
    rpc,
    config,
    async saveConfig(cfg) {
      await ensureDir(home);
      cfgCache = cfg;
      await writeJson(paths.config(home), cfg);
    },
    async signer() {
      const { loadSignerFromConfig } = await import("../signer/index.ts");
      return loadSignerFromConfig(await config());
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
          cfgCache = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(paths.config(home), "utf8")) };
        } catch {}
      }
      if (cfgCache?.defaultChain) return cfgCache.defaultChain;
      throw new UpError("BAD_ARGS", "no chain given", { hint: "pass --chain <id|name> or set a default: up config set default-chain 42" });
    },
    async profile(arg) {
      const v = arg ?? opts.flags.profile;
      const cfg = await config();
      if (v) {
        if (isAddress(v, { strict: false })) return getAddress(v);
        const a = cfg.aliases?.[v];
        if (a) return getAddress(a);
        throw new UpError("BAD_ARGS", `"${v}" is neither an address nor a known alias`, { hint: "list aliases with: up config get aliases" });
      }
      if (cfg.defaultProfile) return getAddress(cfg.defaultProfile);
      throw new UpError("BAD_ARGS", "no profile given", { hint: "pass --profile <address> or set one: up config set default-profile <address>" });
    },
    log: opts.log ?? (() => {}),
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
