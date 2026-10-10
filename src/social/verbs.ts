// Social verbs (LSP26 Follower System):
//   follow <address> | unfollow <address> | follow batch <addresses…> [--unfollow]
//   is-following <address> [--follower] | followers [address] [--kind] [--start] [--limit]
import type { Address } from "viem";
import type { VerbContext, VerbResult } from "../core/types.ts";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import { chainOf } from "../abi/verbs.ts";
import { EXEC_PARAMS, runAsProfile } from "../abi/contract.ts";
import { readMany } from "../abi/read.ts";
import { counts, encodeFollow, isFollowing, locateLsp26, LSP26_ABI, page } from "./lsp26.ts";

async function single(ctx: VerbContext, a: Record<string, any>, kind: "follow" | "unfollow"): Promise<VerbResult> {
  const chainId = await chainOf(ctx, a);
  const profile = await ctx.profile(a.profile, chainId);
  const target = await ctx.resolveAddress(String(a.address));
  if (target.toLowerCase() === profile.toLowerCase()) throw new UpError("BAD_ARGS", `a profile cannot ${kind} itself`);
  const loc = await locateLsp26(ctx, chainId);
  const already = await isFollowing(ctx, chainId, loc.address, profile, target);
  if ((kind === "follow" && already) || (kind === "unfollow" && !already)) {
    return {
      data: { action: kind, chainId, profile, target, followSystem: loc.address, changed: false, isFollowing: already },
      text: `nothing to do: ${profile} ${already ? "already follows" : "does not follow"} ${target} on chain ${chainId}`,
      warnings: loc.warnings.length ? loc.warnings : undefined,
    };
  }
  const data = encodeFollow(kind, target);
  const description = `${kind} ${target} as ${profile} (LSP26 ${loc.address}.${kind}(${target}))`;
  const outcome = await runAsProfile(ctx, { chainId, profile, calls: [{ operation: 0, to: loc.address, value: 0n, data }], description }, a);
  const warnings = [...loc.warnings, ...(outcome.warnings ?? [])];
  return {
    data: { action: kind, chainId, profile, target, followSystem: loc.address, changed: outcome.status !== "dry-run", calldata: data, outcome },
    text: `${outcome.status}: ${description}${outcome.txHash ? `\ntx ${outcome.txHash}` : ""}`,
    warnings: warnings.length ? warnings : undefined,
  };
}

defineVerb({
  name: "follow",
  group: "social",
  summary: "Follow an address with the profile (LSP26 Follower System; skips if already following).",
  risk: "write",
  params: [{ name: "address", type: "string", description: "Address or alias to follow.", positional: 0, required: true }, ...EXEC_PARAMS],
  run: (ctx, a) => single(ctx, a, "follow"),
});

defineVerb({
  name: "unfollow",
  group: "social",
  summary: "Unfollow an address (LSP26; skips if not following).",
  risk: "write",
  params: [{ name: "address", type: "string", description: "Address or alias to unfollow.", positional: 0, required: true }, ...EXEC_PARAMS],
  run: (ctx, a) => single(ctx, a, "unfollow"),
});

defineVerb({
  name: "follow batch",
  group: "social",
  summary: "Follow (or with --unfollow, unfollow) many addresses in one transaction (LSP26 followBatch/unfollowBatch); no-ops are filtered out first.",
  risk: "write",
  params: [
    { name: "addresses", type: "string[]", description: "Addresses or aliases (positional or comma-separated).", positional: 0, required: true },
    { name: "unfollow", type: "boolean", description: "Unfollow instead of follow." },
    ...EXEC_PARAMS,
  ],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const profile = await ctx.profile(a.profile, chainId);
    const kind = a.unfollow ? "unfollow" : "follow";
    const raw = (a.addresses as string[]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    if (raw.length === 0) throw new UpError("BAD_ARGS", "no addresses given");
    if (raw.length > 200) throw new UpError("BAD_ARGS", `${raw.length} addresses: split into batches of at most 200 to stay within block gas limits`);
    const resolved: Address[] = [];
    for (const r of raw) resolved.push(await ctx.resolveAddress(r));
    const seen = new Set<string>();
    const uniq: Address[] = [];
    const duplicates: Address[] = [];
    for (const x of resolved) {
      if (seen.has(x.toLowerCase())) duplicates.push(x);
      else {
        seen.add(x.toLowerCase());
        uniq.push(x);
      }
    }
    const loc = await locateLsp26(ctx, chainId);
    const states = await readMany(ctx, chainId, uniq.map((t) => ({ address: loc.address, abi: LSP26_ABI(), functionName: "isFollowing", args: [profile, t] })));
    const skipped: { address: Address; reason: string }[] = [];
    const todo: Address[] = [];
    uniq.forEach((t, i) => {
      if (t.toLowerCase() === profile.toLowerCase()) return skipped.push({ address: t, reason: "self" });
      const s = states[i];
      if (!s.ok) throw new UpError("SIMULATION_REVERTED", `isFollowing(${profile}, ${t}) failed: ${s.error}`);
      if (kind === "follow" && s.value === true) return skipped.push({ address: t, reason: "already following" });
      if (kind === "unfollow" && s.value === false) return skipped.push({ address: t, reason: "not following" });
      todo.push(t);
    });
    skipped.push(...duplicates.map((x) => ({ address: x, reason: "duplicate" })));
    if (todo.length === 0) return { data: { action: `${kind}Batch`, chainId, profile, followSystem: loc.address, changed: false, skipped }, text: `nothing to do (${skipped.length} skipped)` };
    const data = encodeFollow(kind === "follow" ? "followBatch" : "unfollowBatch", todo);
    const description = `${kind} ${todo.length} address(es) as ${profile} (LSP26 ${loc.address}.${kind}Batch)`;
    const outcome = await runAsProfile(ctx, { chainId, profile, calls: [{ operation: 0, to: loc.address, value: 0n, data }], description: `${description}: ${todo.join(", ")}` }, a);
    const warnings = [...loc.warnings, ...(outcome.warnings ?? [])];
    return {
      data: { action: `${kind}Batch`, chainId, profile, followSystem: loc.address, addresses: todo, skipped, calldata: data, outcome },
      text: `${outcome.status}: ${description}${skipped.length ? ` (${skipped.length} skipped)` : ""}${outcome.txHash ? `\ntx ${outcome.txHash}` : ""}`,
      warnings: warnings.length ? warnings : undefined,
    };
  },
});

defineVerb({
  name: "is-following",
  group: "social",
  summary: "Does --follower (default: the profile) follow <address>? (LSP26)",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Followed address or alias.", positional: 0, required: true },
    { name: "follower", type: "string", description: "Follower address or alias (default: the active profile)." },
  ],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const follower = a.follower ? await ctx.resolveAddress(String(a.follower)) : await ctx.profile(a.profile, chainId);
    const target = await ctx.resolveAddress(String(a.address));
    const loc = await locateLsp26(ctx, chainId);
    const v = await isFollowing(ctx, chainId, loc.address, follower, target);
    return { data: { chainId, follower, address: target, isFollowing: v, followSystem: loc.address }, text: `${follower} ${v ? "follows" : "does not follow"} ${target} (chain ${chainId})`, warnings: loc.warnings.length ? loc.warnings : undefined };
  },
});

defineVerb({
  name: "followers",
  group: "social",
  summary: "Follower/following counts and paged lists for an address (default: the profile) from the LSP26 Follower System.",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Address or alias (default: the active profile).", positional: 0 },
    { name: "kind", type: "string", description: "Which list to return.", enum: ["followers", "following", "both", "counts"], default: "both" },
    { name: "start", type: "integer", description: "Start index.", default: 0 },
    { name: "limit", type: "integer", description: "Page size (max 500).", default: 50 },
  ],
  async run(ctx, a) {
    const chainId = await chainOf(ctx, a);
    const addr = a.address ? await ctx.resolveAddress(String(a.address)) : await ctx.profile(a.profile, chainId);
    if (a.start < 0) throw new UpError("BAD_ARGS", "--start must be >= 0");
    if (a.limit < 1 || a.limit > 500) throw new UpError("BAD_ARGS", "--limit must be between 1 and 500");
    const loc = await locateLsp26(ctx, chainId);
    const c = await counts(ctx, chainId, loc.address, addr);
    const out: Record<string, unknown> = { chainId, address: addr, followSystem: loc.address, followerCount: c.followers.toString(), followingCount: c.following.toString(), start: a.start, limit: a.limit };
    const lines = [`${addr} on chain ${chainId}: ${c.followers} follower(s), follows ${c.following}`];
    if (a.kind === "followers" || a.kind === "both") {
      const l = await page(ctx, chainId, loc.address, addr, "followers", c.followers, a.start, a.limit);
      out.followers = l;
      if (l.length) lines.push(`followers [${a.start}..${a.start + l.length}): ${l.join(", ")}`);
    }
    if (a.kind === "following" || a.kind === "both") {
      const l = await page(ctx, chainId, loc.address, addr, "following", c.following, a.start, a.limit);
      out.following = l;
      if (l.length) lines.push(`following [${a.start}..${a.start + l.length}): ${l.join(", ")}`);
    }
    return { data: out, text: lines.join("\n"), warnings: loc.warnings.length ? loc.warnings : undefined };
  },
});
