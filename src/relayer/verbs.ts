// Relayer verbs: relayer add / list / remove / quota / execute (LSP15 + chainId extension).
import { getAddress } from "viem";
import "../exec/index.ts";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import type { UpConfig } from "../core/types.ts";
import { executeAsProfile } from "../exec/transport.ts";
import { buildCall } from "../exec/inputs.ts";
import { outcomeText, type ExecRequestExt } from "../exec/common.ts";
import { CALL_PARAMS, PATH_PARAMS, chainAndProfile, execOptions } from "../exec/verbs.ts";
import { RelayerClient, quotaPositive, type RelayerProfile } from "./client.ts";
import { getCapabilities, listRelayers, selectRelayer } from "./registry.ts";

const LUKSO_LIVE_HOSTS = ["relayer.mainnet.lukso.network", "relayer.testnet.lukso.network"];

defineVerb({
  name: "relayer add",
  group: "relayer",
  summary: "Register an LSP15 relayer (base URL) for one or more chains; negotiates capabilities (/.well-known/lsp15.json). No credentials are ever needed.",
  description: "lsp15 relayers authorise /execute with the LSP25 signature and /quota with the LSP15 signed message — no JWT, no API key. LUKSO's public relayer (relayer.mainnet/testnet.lukso.network) is detected as the lukso-live profile.",
  risk: "read",
  params: [
    { name: "url", type: "string", description: "Relayer base URL (the part before /execute), e.g. https://relayer.example/api", positional: 0, required: true },
    { name: "name", type: "string", description: "Short name (default: host name)." },
    { name: "chains", type: "string[]", description: "Chain ids/names this relayer serves (default: capability document, else the default chain)." },
    { name: "relayer-profile", type: "string", description: "API profile (default: auto-detect).", enum: ["lsp15", "lukso-live"] },
  ],
  async run(ctx, a) {
    const cfg: UpConfig = { ...(await ctx.config()) };
    let url: URL;
    try {
      url = new URL(String(a.url));
    } catch {
      throw new UpError("BAD_ARGS", `not a URL: ${a.url}`);
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new UpError("BAD_ARGS", "relayer URLs must be https (http only for localhost)");
    const profile: RelayerProfile = a["relayer-profile"] ?? (LUKSO_LIVE_HOSTS.includes(url.hostname) ? "lukso-live" : "lsp15");
    const name = String(a.name ?? url.hostname + (url.port ? `-${url.port}` : ""));
    const baseUrl = String(a.url).replace(/\/+$/, "");
    const draft = { name, baseUrl, chainIds: [] as number[], profile };
    const caps = await getCapabilities(ctx, { ...draft, chainIds: [0] }, { refresh: true });
    let chainIds: number[];
    if (a.chains?.length) chainIds = (a.chains as string[]).map((c) => (/^\d+$/.test(c) ? Number(c) : ctx.registry.chain(c).chainId));
    else if (caps.supportedChainIds?.length) chainIds = caps.supportedChainIds;
    else if (cfg.defaultChain) chainIds = [cfg.defaultChain];
    else throw new UpError("BAD_ARGS", "pass --chains: the relayer publishes no capability document");
    const warnings: string[] = [];
    if (caps.supportedChainIds) {
      const unsupported = chainIds.filter((c) => !caps.supportedChainIds!.includes(c));
      if (unsupported.length) throw new UpError("BAD_ARGS", `relayer capabilities do not list chain(s) ${unsupported.join(", ")} (supported: ${caps.supportedChainIds.join(", ")})`);
    }
    if (caps.legacy && chainIds.length > 1) warnings.push("legacy relayer (no capability document): one base URL normally serves exactly one chain");
    if (profile === "lukso-live") warnings.push("LUKSO's live relayer only serves registered profiles; quota checks need a LUKSO account (JWT), which this skill does not use");
    const entry = { name, baseUrl, chainIds, profile };
    cfg.relayers = [...(cfg.relayers ?? []).filter((r) => r.name !== name), entry];
    await ctx.saveConfig(cfg);
    return { data: { relayer: entry, capabilities: caps }, text: `relayer ${name} (${profile}${caps.legacy ? ", legacy single-chain" : `, LSP15 ${caps.lsp15Version ?? "?"}`}) saved for chain(s) ${chainIds.join(", ")}`, warnings };
  },
});

defineVerb({
  name: "relayer list",
  group: "relayer",
  summary: "List configured relayers and relayers known from the registry, per chain, with cached capabilities.",
  risk: "local",
  params: [{ name: "chain", type: "string", description: "Only relayers serving this chain.", positional: 0 }],
  async run(ctx, a) {
    await ctx.config();
    const chainId = a.chain ? ctx.registry.chain(a.chain).chainId : undefined;
    const list = await listRelayers(ctx, chainId);
    return { data: { relayers: list }, text: list.length ? list.map((r) => `${r.name.padEnd(24)} ${r.profile.padEnd(10)} chains ${r.chainIds.join(",")}  ${r.baseUrl}  (${r.source})`).join("\n") : "no relayers configured (add one: up relayer add <url> --chains <id>)" };
  },
});

defineVerb({
  name: "relayer remove",
  group: "relayer",
  summary: "Remove a configured relayer.",
  risk: "local",
  params: [{ name: "name", type: "string", description: "Relayer name.", positional: 0, required: true }],
  async run(ctx, a) {
    const cfg: UpConfig = { ...(await ctx.config()) };
    const before = cfg.relayers?.length ?? 0;
    cfg.relayers = (cfg.relayers ?? []).filter((r) => r.name !== a.name);
    if (cfg.relayers.length === before) throw new UpError("BAD_ARGS", `no configured relayer named ${a.name}`);
    await ctx.saveConfig(cfg);
    return { data: { removed: a.name }, text: `removed relayer ${a.name}` };
  },
});

defineVerb({
  name: "relayer quota",
  group: "relayer",
  summary: "Check the relayer quota for this agent's controller on a chain (LSP15 /quota with the signed timestamp; chainId included).",
  description: "Signs keccak256(abi.encodePacked(address, timestamp[, chainId])) with the controller key (EIP-191 personal_sign) — an authentication for reading the quota only, valid ±300 s. Units are per chain and never summed across chains.",
  risk: "read",
  params: [{ name: "relayer", type: "string", description: "Relayer name or URL (default: first one for the chain)." }],
  async run(ctx, a) {
    await ctx.config();
    const chainId = ctx.chainId(a.chain);
    const r = await selectRelayer(ctx, chainId, a.relayer);
    if (!r) throw new UpError("RELAYER_ERROR", `no relayer configured for chain ${chainId}`, { hint: `up relayer add <url> --chains ${chainId}` });
    const caps = await getCapabilities(ctx, r);
    const client = new RelayerClient(r);
    client.assertServes(chainId, caps);
    if (ctx.flags.dryRun) return { data: { relayer: r.name, chainId, dryRun: true, note: "quota not requested: no signatures in dry-run" } };
    let profile;
    try {
      profile = await ctx.profile(a.profile, chainId);
    } catch {
      profile = undefined;
    }
    // the quota login is signed by the agent's key for THIS chain (quota is per chain and per key)
    const q = await client.quota(await ctx.signer(chainId), { chainId, profile, caps });
    return {
      data: { relayer: r.name, chainId, ...q, hasQuota: quotaPositive(q) },
      text: q.available ? `relayer ${r.name}, chain ${chainId}: ${q.quota} ${q.unit ?? ""} left of ${q.totalQuota ?? "?"} (scope ${q.scope}; resets ${q.resetDate ?? "n/a"})` : `relayer ${r.name}: ${q.reason}`,
    };
  },
});

defineVerb({
  name: "relayer execute",
  group: "relayer",
  summary: "Send a call or a raw UP payload (e.g. setData calldata) through an LSP15 relayer as an LSP25 relay call.",
  risk: "write",
  params: [
    { name: "payload", type: "string", description: "Raw calldata for the Universal Profile (execute/setData/…); alternative to --to/--data/--fn." },
    ...CALL_PARAMS,
    ...PATH_PARAMS.filter((p) => !["via", "fund-from-controller"].includes(p.name)),
  ],
  async run(ctx, a) {
    const { chainId, profile } = await chainAndProfile(ctx, a);
    let req: ExecRequestExt;
    if (a.payload) {
      if (a.to || a.data || a.fn) throw new UpError("BAD_ARGS", "pass either --payload or --to/--data/--fn");
      req = { chainId, profile: getAddress(profile), payload: a.payload, verb: "relayer execute" };
    } else {
      const b = buildCall({ to: a.to, value: a.value, data: a.data, fn: a.fn, args: a.args, abi: a.abi, operation: a.operation });
      req = { chainId, profile, calls: [b.call], abi: b.abi, verb: "relayer execute" };
    }
    const out = await executeAsProfile(ctx, req, { ...execOptions(a, "relay"), via: "relay" } as any);
    return { data: out, text: outcomeText(out), warnings: out.warnings };
  },
});
