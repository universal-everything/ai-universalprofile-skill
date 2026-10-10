// Setup verbs: doctor, config, chains, chains rpc.
import { getAddress, isAddress } from "viem";
import { existsSync, accessSync, constants } from "node:fs";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import { ensureDir } from "../core/home.ts";
import { loadPolicy, savePolicy, DEFAULT_POLICY } from "../core/policy.ts";
import { VERSION, SOURCE } from "../version.ts";
import { addChain, findRpcs, refreshRegistry } from "../chain/discovery.ts";
import { LSP } from "../chain/registry.ts";
import { isRecommended, recommendationRank } from "../chain/recommended.ts";
import type { UpConfig } from "../core/types.ts";
import { SECRET_CONTAINER } from "../core/json.ts";
import { IPFS_PROVIDERS, normaliseKuboUrl } from "../ipfs/providers.ts";
import { normaliseGateway } from "../ipfs/gateway.ts";

defineVerb({
  name: "doctor",
  group: "setup",
  summary: "Check runtime, state dir, signer backends, configured chains/RPCs and relayers; prints exact remedies.",
  risk: "read",
  params: [{ name: "offline", type: "boolean", description: "Skip network checks." }],
  async run(ctx, a) {
    const checks: { name: string; ok: boolean; detail: string; remedy?: string }[] = [];
    const major = Number(process.versions.node.split(".")[0]);
    checks.push({ name: "node", ok: major >= 22, detail: `Node ${process.versions.node}`, remedy: major >= 22 ? undefined : "install Node >= 22 in user space (no admin): https://nodejs.org/en/download (tarball) or nvm/fnm/Volta" });
    try {
      await ensureDir(ctx.home);
      accessSync(ctx.home, constants.W_OK);
      checks.push({ name: "state-dir", ok: true, detail: ctx.home });
    } catch (e) {
      checks.push({ name: "state-dir", ok: false, detail: `${ctx.home}: ${(e as Error).message}`, remedy: "set UP_HOME to a writable directory" });
    }
    const cfg = await ctx.config();
    let backends: unknown = [];
    try {
      const { probeAll } = await import("../signer/index.ts");
      backends = await probeAll();
    } catch (e) {
      backends = [{ error: (e as Error).message }];
    }
    const custodyWarnings: string[] = [];
    if (cfg.controller) {
      checks.push({ name: "controller", ok: true, detail: `${cfg.controller.address} (${cfg.controller.backend})` });
      try {
        const { controllerCustodyWarnings } = await import("../signer/index.ts");
        custodyWarnings.push(...(await controllerCustodyWarnings(cfg, ctx.home)));
      } catch {}
    }
    else checks.push({ name: "controller", ok: false, detail: "no controller key yet", remedy: "run: up init" });
    // chains where the agent signs with its own key instead of the default one
    for (const [id, k] of Object.entries(cfg.chainControllers ?? {})) {
      if (k?.address) checks.push({ name: `controller:${id}`, ok: true, detail: `${k.address} (${k.backend}), the agent's own key on chain ${id}` });
    }
    const chainReports: unknown[] = [];
    if (!a.offline) {
      for (const id of cfg.chains ?? (cfg.defaultChain ? [cfg.defaultChain] : [])) {
        const health = await ctx.rpc.verify(id);
        const ok = health.some((h) => h.ok);
        chainReports.push({ chainId: id, ok, healthy: health.filter((h) => h.ok).map((h) => h.url), failing: health.filter((h) => !h.ok).length });
        checks.push({ name: `rpc:${id}`, ok, detail: ok ? `${health.filter((h) => h.ok).length} healthy endpoint(s)` : "no healthy endpoint", remedy: ok ? undefined : `run: up chains rpc find ${id}` });
      }
    }
    const allOk = checks.every((c) => c.ok);
    return {
      data: { version: VERSION, source: SOURCE, platform: `${process.platform}-${process.arch}`, home: ctx.home, checks, custodyWarnings, signerBackends: backends, chains: chainReports, ok: allOk },
      warnings: custodyWarnings,
      text: [`up ${VERSION} doctor — ${allOk ? "✅ all good" : "⚠️ action needed"}`, ...checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.name}: ${c.detail}${c.remedy ? `\n   → ${c.remedy}` : ""}`)].join("\n"),
    };
  },
});

const CONFIG_KEYS = ["default-chain", "default-profile", "chains", "alias", "etherscan-key", "ipfs-provider", "ipfs-gateway", "ipfs-upload-key", "pinata-jwt", "kubo-url", "kubo-auth"] as const;

/** The config as shown to anyone: every credential container's values replaced by "[redacted]" (only whether one is set is visible). */
export function publicConfig(cfg: UpConfig): UpConfig {
  const out: Record<string, unknown> = { ...cfg };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (SECRET_CONTAINER.test(k) && v && typeof v === "object") out[k] = Object.fromEntries(Object.entries(v).map(([n, s]) => [n, typeof s === "string" && s ? "[redacted]" : s]));
  }
  return out as unknown as UpConfig;
}

defineVerb({
  name: "config get",
  group: "setup",
  summary: "Show the local configuration (public data only; credentials such as etherscan-key and IPFS upload keys show as [redacted]).",
  risk: "local",
  params: [{ name: "key", type: "string", description: "Optional top-level key, e.g. aliases, chains, relayers, ipfs.", positional: 0 }],
  async run(ctx, a) {
    const cfg = publicConfig(await ctx.config());
    const data = a.key ? (cfg as any)[a.key] ?? (cfg as any)[String(a.key).replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())] : cfg;
    return { data };
  },
});

defineVerb({
  name: "config set",
  group: "setup",
  summary: "Set default-chain, default-profile, chains (comma list), alias <name>=<address>, etherscan-key, or the IPFS upload settings for profile metadata (ipfs-provider, ipfs-gateway, ipfs-upload-key, pinata-jwt, kubo-url, kubo-auth).",
  description:
    "IPFS: ipfs-provider is universalprofile (default), pinata or kubo; ipfs-gateway is used to read and verify IPFS content (default https://api.universalprofile.cloud/ipfs/). Credentials (ipfs-upload-key, pinata-jwt, kubo-auth) are stored in config.json (0600) and never shown again; the environment variables UP_IPFS_UPLOAD_KEY, UP_PINATA_JWT and UP_KUBO_AUTH take precedence and keep them out of shell history. An empty value removes an IPFS setting.",
  risk: "local",
  params: [
    { name: "key", type: "string", description: `one of ${CONFIG_KEYS.join(", ")}`, positional: 0, required: true, enum: CONFIG_KEYS },
    { name: "value", type: "string", description: "value", positional: 1, required: true },
  ],
  async run(ctx, a) {
    const cfg: UpConfig = { ...(await ctx.config()) };
    const v = String(a.value).trim();
    const setIpfs = (k: "provider" | "gateway" | "kuboUrl", val: string | undefined) => {
      const next: Record<string, unknown> = { ...(cfg.ipfs ?? {}), [k]: val };
      if (val === undefined) delete next[k];
      cfg.ipfs = next as UpConfig["ipfs"];
    };
    const setKey = (k: "universalprofile" | "pinata" | "kuboAuth", val: string | undefined) => {
      const next: Record<string, string> = { ...(cfg.ipfsKeys ?? {}) };
      if (val) next[k] = val;
      else delete next[k];
      cfg.ipfsKeys = next;
    };
    switch (a.key) {
      case "default-chain":
        cfg.defaultChain = ctx.registry.chain(a.value).chainId;
        break;
      case "default-profile":
        if (!isAddress(a.value, { strict: false })) throw new UpError("BAD_ARGS", "default-profile must be an address");
        cfg.defaultProfile = getAddress(a.value);
        break;
      case "chains":
        cfg.chains = String(a.value).split(",").map((s) => ctx.registry.chain(s.trim()).chainId);
        break;
      case "alias": {
        const [name, addr] = String(a.value).split("=");
        if (!name || !addr || !isAddress(addr, { strict: false })) throw new UpError("BAD_ARGS", "alias value must be <name>=<address>");
        if (isAddress(name, { strict: false })) throw new UpError("BAD_ARGS", "alias names must not look like addresses");
        cfg.aliases = { ...(cfg.aliases ?? {}), [name]: getAddress(addr) };
        break;
      }
      case "etherscan-key":
        cfg.explorerKeys = { ...(cfg.explorerKeys ?? {}), etherscan: a.value };
        break;
      case "ipfs-provider":
        if (v && !(IPFS_PROVIDERS as readonly string[]).includes(v)) throw new UpError("BAD_ARGS", `ipfs-provider must be one of ${IPFS_PROVIDERS.join(", ")}`);
        setIpfs("provider", v || undefined);
        break;
      case "ipfs-gateway":
        setIpfs("gateway", v ? normaliseGateway(v) : undefined);
        break;
      case "kubo-url":
        setIpfs("kuboUrl", v ? normaliseKuboUrl(v) : undefined);
        break;
      case "ipfs-upload-key":
        setKey("universalprofile", v || undefined);
        break;
      case "pinata-jwt":
        setKey("pinata", v || undefined);
        break;
      case "kubo-auth":
        setKey("kuboAuth", v || undefined);
        break;
    }
    await ctx.saveConfig(cfg);
    // never echo values: credentials must not come back into the conversation
    const secret = a.key === "ipfs-upload-key" || a.key === "pinata-jwt" || a.key === "kubo-auth" || a.key === "etherscan-key";
    return { data: { saved: a.key, ...(secret ? { stored: v ? "[redacted]" : "removed" } : {}) }, text: secret && !v ? `removed ${a.key}` : `saved ${a.key}` };
  },
});

defineVerb({
  name: "policy show",
  group: "setup",
  summary: "Show the delegated-autonomy policy (skill-side limits; on-chain limits are the LSP6 permissions).",
  risk: "local",
  params: [],
  async run(ctx) {
    return { data: await loadPolicy(ctx.home) };
  },
});

defineVerb({
  name: "policy set",
  group: "setup",
  summary: "Replace the delegated-autonomy policy with a JSON document (human approval required).",
  description: "Fields: chains (ids or \"*\"), targets, selectors, maxValuePerTx {chainId|\"*\": wei}, maxTxPerDay, allowAdmin. The policy limits what the agent may do with --yes; anything else needs --approval.",
  risk: "admin",
  params: [{ name: "policy", type: "json", description: "Full policy JSON.", positional: 0, required: true }],
  async run(ctx, a) {
    const p = { ...DEFAULT_POLICY, ...(typeof a.policy === "object" ? a.policy : {}) };
    await ctx.consent({ verb: "policy set", risk: "admin", summary: { newPolicy: p } });
    if (ctx.flags.dryRun) return { data: { dryRun: true, policy: p } };
    await savePolicy(ctx.home, p);
    return { data: p, text: "policy saved" };
  },
});

defineVerb({
  name: "chains list",
  group: "chains",
  summary: "List the registry networks (LSP status, explorers, RPC counts): recommended ones first (LUKSO, then the top mainnets), mainnets only unless --testnets or --all.",
  description:
    "Without flags: mainnets, the recommended networks first and marked (LUKSO first). Testnets are only for humans who explicitly ask for them: --testnets lists only testnets, --all lists both. A filter searches mainnets and testnets.",
  risk: "local",
  params: [
    { name: "filter", type: "string", description: "Substring filter on name/slug/id (searches mainnets and testnets).", positional: 0 },
    { name: "testnets", type: "boolean", description: "Only testnets (only when the human asked for a testnet)." },
    { name: "all", type: "boolean", description: "Mainnets and testnets." },
  ],
  async run(ctx, a) {
    const f = a.filter ? String(a.filter).toLowerCase() : undefined;
    const rows = ctx.registry
      .chains()
      .filter((c) => (a.testnets ? c.testnet : a.all || f ? true : !c.testnet))
      .filter((c) => !f || c.name.toLowerCase().includes(f) || c.slug.includes(f) || String(c.chainId) === f)
      .map((c) => ({ chainId: c.chainId, name: c.name, slug: c.slug, symbol: c.nativeSymbol, testnet: c.testnet, recommended: isRecommended(c.chainId), lspDeployed: c.lsp.deployed, upVersions: c.lsp.versions.UniversalProfileInit ?? [], explorer: c.explorers[0]?.url, explorerFamily: c.explorers[0]?.family, rpcs: c.rpcs.length, relayers: (c.relayers ?? []).map((r) => r.name) }))
      .map((r, i) => ({ r, i }))
      .sort((x, y) => recommendationRank(x.r.chainId) - recommendationRank(y.r.chainId) || x.i - y.i)
      .map(({ r }) => r);
    const line = (r: (typeof rows)[number]) => `${r.recommended ? "★" : " "} ${String(r.chainId).padEnd(10)} ${r.slug.padEnd(22)} ${r.symbol.padEnd(8)} ${r.lspDeployed ? "LSP✅" : "LSP❌"} ${r.explorer ?? ""}`;
    const rec = rows.filter((r) => r.recommended);
    const head = rec.length ? [`★ recommended: ${rec.map((r) => r.name).join(", ")} (LUKSO first)${a.testnets || a.all ? "" : "; testnets only on request (--testnets)"}`] : [];
    return { data: { count: rows.length, recommended: rec.map((r) => r.chainId), chains: rows }, text: [...head, ...rows.map(line)].join("\n") };
  },
});

defineVerb({
  name: "chains verify",
  group: "chains",
  summary: "Check RPC health and that the canonical LSP contracts (factory, implementations, modules) have code on a chain.",
  risk: "read",
  params: [{ name: "chain", type: "string", description: "Chain id or slug.", positional: 0 }],
  async run(ctx, a) {
    const chainId = ctx.chainId(a.chain);
    const health = await ctx.rpc.verify(chainId);
    const targets: Record<string, string> = {
      LSP23LinkedContractsFactory: LSP.LSP23_FACTORY,
      UniversalProfileInitPostDeploymentModule: LSP.UP_INIT_POST_DEPLOYMENT_MODULE,
      "UniversalProfileInit v0.14.0": LSP.UP_INIT["0.14.0"],
      "LSP6KeyManagerInit v0.14.0": LSP.KM_INIT["0.14.0"],
      "LSP1UniversalReceiverDelegateUP v0.14.0": LSP.URD["0.14.0"],
      ERCTokenCallbacks: LSP.ERC_TOKEN_CALLBACKS,
      NickFactory: LSP.NICK_FACTORY,
      Multicall3: LSP.MULTICALL3,
      "EntryPoint v0.6": LSP.ENTRYPOINT_V06,
      LSP26FollowerSystem: LSP.LSP26,
    };
    const code: Record<string, boolean> = {};
    if (health.some((h) => h.ok)) {
      for (const [name, addr] of Object.entries(targets)) {
        const c = await ctx.rpc.request<string>(chainId, "eth_getCode", [addr, "latest"]);
        code[name] = typeof c === "string" && c.length > 2;
      }
    }
    return { data: { chainId, rpc: health, code }, text: [`chain ${chainId}`, ...health.map((h) => `${h.ok ? "✅" : "❌"} ${h.url} ${h.ok ? `block ${h.blockNumber} (${h.blockAgeSec}s old, ${h.latencyMs}ms)` : h.error}`), ...Object.entries(code).map(([n, ok]) => `${ok ? "✅" : "—"} ${n}`)].join("\n") };
  },
});

defineVerb({
  name: "chains add",
  group: "chains",
  summary: "Add a chain that is not in the LUKSO registry: metadata + working RPCs from chainlist.org (stored locally).",
  risk: "read",
  params: [{ name: "chain-id", type: "integer", description: "EVM chain id.", positional: 0, required: true }],
  async run(ctx, a) {
    try {
      const existing = ctx.registry.chain(a["chain-id"]);
      return { data: existing, text: `${existing.name} (${existing.chainId}) is already in the registry` };
    } catch {}
    const info = await addChain(ctx.home, a["chain-id"]);
    return { data: info, text: `added ${info.name} (${info.chainId}) with ${info.rpcs.length} working RPC(s); LSP contracts are not registered there — check with: up chains verify ${info.chainId}` };
  },
});

defineVerb({
  name: "chains refresh",
  group: "chains",
  summary: "Fetch the live lsp-smart-contracts deployments list (GitHub main), diff it against the bundled mirror, store an overlay.",
  risk: "read",
  params: [],
  async run(ctx) {
    const diff = await refreshRegistry(ctx.home);
    return { data: diff, text: `remote: ${diff.newChains.length} new chain(s), ${diff.removed.length} removed, ${diff.changedRpc.length} RPC change(s), ${diff.changedExplorers.length} explorer change(s) (stored as overlay, labelled remote-unpinned)` };
  },
});

defineVerb({
  name: "chains rpc list",
  group: "chains",
  summary: "Show the ranked RPC endpoints for a chain (user overrides, discovered, bundled) with cached health.",
  risk: "local",
  params: [{ name: "chain", type: "string", description: "Chain id or slug.", positional: 0 }],
  async run(ctx, a) {
    const chainId = ctx.chainId(a.chain);
    const cfg = await ctx.config();
    return { data: { chainId, user: cfg.rpcOverrides?.[String(chainId)] ?? [], bundled: ctx.rpc.ranked(chainId) } };
  },
});

defineVerb({
  name: "chains rpc verify",
  group: "chains",
  summary: "Health-check every known RPC endpoint of a chain (eth_chainId match, head freshness, latency).",
  risk: "read",
  params: [{ name: "chain", type: "string", description: "Chain id or slug.", positional: 0 }],
  async run(ctx, a) {
    const chainId = ctx.chainId(a.chain);
    const health = await ctx.rpc.verify(chainId);
    return { data: { chainId, health }, text: health.map((h) => `${h.ok ? "✅" : "❌"} ${h.url} ${h.ok ? `${h.latencyMs}ms, head ${h.blockAgeSec}s old` : h.error}`).join("\n") };
  },
});

defineVerb({
  name: "chains rpc find",
  group: "chains",
  summary: "Discover working public RPCs for a chain from chainlist.org / chainid.network, probe them and store the healthy ones locally.",
  description: "Run this automatically when all known endpoints fail (RPC_UNAVAILABLE) or a chain is missing. Discovered endpoints are labelled remote-discovered; eth_chainId is always verified.",
  risk: "read",
  params: [{ name: "chain-id", type: "integer", description: "EVM chain id.", positional: 0, required: true }],
  async run(ctx, a) {
    const r = await findRpcs(ctx.home, a["chain-id"]);
    return { data: { chainId: a["chain-id"], working: r.working, checked: r.checked.length, sources: r.sources }, text: r.working.length ? `stored ${r.working.length} working RPC(s) for chain ${a["chain-id"]}:\n${r.working.map((w) => `  ${w.url} (tracking: ${w.tracking})`).join("\n")}` : `no working public RPC found for chain ${a["chain-id"]} (${r.checked.length} checked)` };
  },
});

defineVerb({
  name: "chains rpc set",
  group: "chains",
  summary: "Pin your own RPC URL(s) for a chain (highest priority, e.g. a private provider).",
  risk: "local",
  params: [
    { name: "chain", type: "string", description: "Chain id or slug.", positional: 0, required: true },
    { name: "urls", type: "string[]", description: "One or more https URLs (comma separated); empty to clear.", positional: 1 },
  ],
  async run(ctx, a) {
    const chainId = /^\d+$/.test(String(a.chain)) ? Number(a.chain) : ctx.registry.chain(a.chain).chainId;
    const urls: string[] = a.urls ?? [];
    for (const u of urls) if (!/^https?:\/\//.test(u)) throw new UpError("BAD_ARGS", `not a URL: ${u}`);
    const cfg: UpConfig = { ...(await ctx.config()) };
    cfg.rpcOverrides = { ...(cfg.rpcOverrides ?? {}), [String(chainId)]: urls };
    if (urls.length === 0) delete cfg.rpcOverrides[String(chainId)];
    await ctx.saveConfig(cfg);
    return { data: { chainId, urls }, text: urls.length ? `pinned ${urls.length} RPC(s) for chain ${chainId}` : `cleared RPC overrides for chain ${chainId}` };
  },
});

export const SETUP_LOADED = existsSync !== undefined;
