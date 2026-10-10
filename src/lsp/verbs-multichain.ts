// One profile across many chains: profile status (cross-chain overview) and profile link
// (a chain where the same profile lives at a different address).
import { getAddress, type Address } from "viem";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import type { VerbContext } from "../core/types.ts";
import { chainAddressesOf, readProfileRecord, updateProfileRecord } from "../core/profile-record.ts";
import { chainControllerList, controllerFor } from "../signer/select.ts";
import { INTERFACE_IDS } from "./constants.ts";
import { loadManifest } from "./lsp23.ts";
import { chainLabel, formatProfileStatus, onChain, readChainStatus, saveStatusSnapshot } from "./multichain.ts";
import { readControllerPermissions, resolveKeyManager, supportsInterface } from "./profile.ts";
import { hasCode } from "./read.ts";
import { addressArg } from "./verbs-account.ts";

/** --chains, else an explicit --chain, else the configured chains plus every chain the profile is known on (linked, deployed by this agent, found deployed by profile join). */
async function chainsToCheck(ctx: VerbContext, a: Record<string, any>, identity: Address): Promise<number[]> {
  if (a.chains?.length) return [...new Set((a.chains as string[]).map((c) => ctx.registry.chain(c).chainId))];
  if (a.chain !== undefined && a.chain !== "") return [ctx.chainId(a.chain)];
  const cfg = await ctx.config();
  const record = await readProfileRecord(ctx.home, identity);
  const known = [
    ...(cfg.chains?.length ? cfg.chains : cfg.defaultChain ? [cfg.defaultChain] : []),
    ...Object.keys(chainAddressesOf(record)).map(Number),
    ...((record.deployment?.chains as number[] | undefined) ?? []),
    // chains where `profile join` found the profile deployed
    ...(Array.isArray(record.joined?.chains) ? (record.joined.chains as { chainId?: unknown; deployed?: unknown }[]).filter((c) => c?.deployed === true).map((c) => Number(c.chainId)) : []),
  ].filter((c) => Number.isInteger(c) && c > 0);
  return [...new Set(known)];
}

defineVerb({
  name: "profile status",
  group: "account",
  summary: "Cross-chain overview of ONE Universal Profile: per chain whether it is deployed, which agent key applies and whether it is a controller with which permissions, balances, relayer, and the next step.",
  description:
    "Read-only; the chains are checked in parallel and one unreachable chain never hides the others. Per chain: the profile's address there (linked or the same), deployed (code + LSP0), owner/Key Manager, the agent's key for that chain and its decoded permissions (and whether AllowedCalls/AllowedERC725YDataKeys limit it), native balance of the profile and of the key (gas), relayer coverage, and the concrete next step (deploy there with the manifest, ask the human to authorise the key there, fund gas). Stores a snapshot in the local profile record.",
  risk: "read",
  params: [{ name: "chains", type: "string[]", description: "Chains to check (default: configured chains plus chains where the profile is known to exist; --chain checks one)." }],
  examples: ["up profile status", "up profile status --chains lukso,base"],
  async run(ctx, a) {
    const cfg = await ctx.config();
    const identity = await ctx.identity(a.profile);
    const chainIds = await chainsToCheck(ctx, a, identity);
    if (!chainIds.length) throw new UpError("BAD_ARGS", "no chain selected", { hint: "pass --chains 42,8453 or set: up config set chains 42,8453" });
    const manifest = !!(await loadManifest(ctx.home, identity));
    const statuses = await Promise.all(chainIds.map((c) => readChainStatus(ctx, identity, c, { manifest, cfg })));
    await saveStatusSnapshot(ctx.home, identity, statuses);
    let defaultKey: Address | undefined;
    try {
      defaultKey = controllerFor(cfg)?.address;
    } catch {}
    const unreachable = statuses.filter((s) => s.error);
    return {
      data: {
        profile: identity,
        defaultController: defaultKey ?? null,
        chainControllers: chainControllerList(cfg).map((c) => ({ chainId: c.chainId, address: c.address, backend: c.backend })),
        manifest,
        chains: statuses,
        ready: statuses.filter((s) => s.ready).map((s) => s.chainId),
        checkedAt: new Date().toISOString(),
      },
      text: formatProfileStatus(identity, statuses, defaultKey),
      warnings: unreachable.length ? unreachable.map((s) => `${onChain({ name: s.chain, chainId: s.chainId })} could not be checked: ${s.error}`) : undefined,
    };
  },
});

defineVerb({
  name: "profile link",
  group: "account",
  summary: "Link the address your profile has on one chain when it differs from its usual address (different factory or salt), or remove that link (--unlink). Human approval required.",
  description:
    "Normally a profile has the same address on every chain and needs no link. A link makes every verb act as (and show) the linked address on that chain only; all other chains keep the profile's address. The linked contract must be a deployed Universal Profile (LSP0) owned by an LSP6 Key Manager on that chain. Because a wrong link would send the human's assets to someone else's contract on that chain, linking and unlinking always need the human's --approval.",
  risk: "admin",
  params: [
    { name: "address", type: "string", description: "The profile's address on --chain (omit with --unlink).", positional: 0 },
    { name: "unlink", type: "boolean", description: "Remove the link for --chain (the chain then uses the profile's usual address again)." },
  ],
  examples: ['up profile link 0xAddressOnBase --chain base --approval "<human\'s words>"', 'up profile link --unlink --chain base --approval "<human\'s words>"'],
  async run(ctx, a) {
    await ctx.config();
    if (a.chain === undefined || a.chain === "") throw new UpError("BAD_ARGS", "pass the chain the address belongs to: --chain <id|name>", { hint: "a link applies to exactly one chain" });
    const chainId = ctx.chainId(a.chain);
    const l = chainLabel(ctx, chainId);
    const where = onChain(l);
    const identity = await ctx.identity(a.profile);
    const record = await readProfileRecord(ctx.home, identity);
    const links = chainAddressesOf(record);
    const previous = links[String(chainId)];
    const warnings: string[] = [];

    if (a.unlink) {
      if (a.address !== undefined) throw new UpError("BAD_ARGS", "--unlink takes no address");
      if (!previous) return { data: { profile: identity, chainId, linked: null, changed: false }, text: `Your profile ${identity} has no linked address on ${where}; it uses ${identity} there.` };
      await ctx.consent({ verb: "profile link", risk: "admin", chainId, summary: { effect: `stop using ${previous} as your profile on ${where}; use ${identity} there again`, profile: identity, chain: where, removedLink: previous } });
      if (ctx.flags.dryRun) return { data: { dryRun: true, profile: identity, chainId, removedLink: previous }, text: `DRY RUN: the link ${previous} on ${where} would be removed.` };
      // only this chain's entry changes, against the latest record (a concurrent link elsewhere is kept)
      await updateProfileRecord(ctx.home, identity, (latest) => {
        const next = { ...chainAddressesOf(latest) };
        delete next[String(chainId)];
        return { chainAddresses: next };
      });
      return { data: { profile: identity, chainId, linked: null, removedLink: previous, changed: true }, text: `On ${where} your profile is ${identity} again (link to ${previous} removed).` };
    }

    if (a.address === undefined) throw new UpError("BAD_ARGS", "pass the profile's address on that chain (or --unlink)");
    const address = addressArg(a.address, "address");
    if (address === getAddress(identity)) throw new UpError("BAD_ARGS", `${address} is the profile's usual address; nothing to link`, { hint: previous ? `to use it on ${where} again: up profile link --unlink --chain ${l.arg}` : "a profile with the same address on every chain needs no link" });
    if (previous === address) return { data: { profile: identity, chainId, linked: address, changed: false }, text: `On ${where} your profile is already linked to ${address}.` };
    // The linked contract must really be a Universal Profile controlled through a Key Manager there.
    if (!(await hasCode(ctx, chainId, address))) throw new UpError("NOT_DEPLOYED", `${address} has no code on ${where}`, { hint: `check the address and the chain; nothing was linked` });
    if (!(await supportsInterface(ctx, chainId, address, INTERFACE_IDS.LSP0ERC725Account))) throw new UpError("BAD_ARGS", `${address} on ${where} is not a Universal Profile (no LSP0 interface)`, { hint: "nothing was linked" });
    const km = await resolveKeyManager(ctx, chainId, address);
    if (!km.keyManager) throw new UpError("NOT_SUPPORTED", `${address} on ${where} is not owned by an LSP6 Key Manager (owner ${km.owner}, ${km.ownerKind})`, { hint: "only Key-Manager-owned profiles can be controlled by the agent; nothing was linked" });
    if (await hasCode(ctx, chainId, identity)) warnings.push(`your profile's usual address ${identity} also has code on ${where}; after linking, the agent acts as ${address} there, not as ${identity}`);
    let agentKey: Address | undefined;
    let agentIsController: boolean | undefined;
    try {
      agentKey = controllerFor(await ctx.config(), chainId)?.address;
      if (agentKey) agentIsController = (await readControllerPermissions(ctx, chainId, address, agentKey)).permissions.value !== 0n;
    } catch {}
    if (agentKey && agentIsController === false) warnings.push(`the agent's key ${agentKey} is not a controller of ${address} on ${l.name} yet; ask the human to authorise it there (up permissions recommend --chain ${l.arg})`);
    const summary = {
      effect: `use ${address} as your Universal Profile on ${where}; every other chain keeps ${identity}`,
      profile: identity,
      chain: where,
      linkedAddress: address,
      previousLink: previous ?? null,
      checks: { deployed: true, lsp0: true, keyManager: km.keyManager, agentKey: agentKey ?? null, agentIsController: agentIsController ?? null },
      note: "assets sent to your profile on this chain must go to the linked address; a wrong link would point the human to someone else's contract",
    };
    await ctx.consent({ verb: "profile link", risk: "admin", chainId, summary, target: address });
    if (ctx.flags.dryRun) return { data: { dryRun: true, ...summary }, text: `DRY RUN: on ${where} your profile would be ${address}.`, warnings };
    await updateProfileRecord(ctx.home, identity, (latest) => ({ chainAddresses: { ...chainAddressesOf(latest), [String(chainId)]: address } }));
    return {
      data: { profile: identity, chainId, linked: address, previousLink: previous ?? null, keyManager: km.keyManager, agentKey: agentKey ?? null, agentIsController: agentIsController ?? null, changed: true },
      text: `On ${where} your Universal Profile ${identity} is now the contract ${address} (Key Manager ${km.keyManager}). The agent acts as ${address} there; every other chain keeps ${identity}.`,
      warnings,
    };
  },
});
