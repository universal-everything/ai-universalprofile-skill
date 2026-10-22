// profile identity: what this machine's saved state already knows about the agent's Universal
// Profile(s), from the public files under UP_HOME only. Read-only and offline: no network call, no key
// store access, nothing written, no key created. Run it at the start of every chat (before `up start`)
// and whenever the human asks which profile or address the agent has: a new chat that shares the same
// UP_HOME finds the same answer; a chat in a different or fresh environment does not, and says so.
import { getAddress, isAddress, type Address } from "viem";
import { readdir } from "node:fs/promises";
import { defineVerb } from "../core/verbs.ts";
import { paths } from "../core/home.ts";
import { chainAddressesOf, readProfileRecord } from "../core/profile-record.ts";
import { safeFileText } from "../core/safe-text.ts";
import type { UpConfig, VerbContext } from "../core/types.ts";
import { chainControllerList } from "../signer/select.ts";
import { chainLabel, onChain } from "../lsp/multichain.ts";
import { luksoNetwork, universalEverythingUrl } from "../lsp/profile-url.ts";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function listWords(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function controllerText(cfg: UpConfig): { default: { address: Address; backend: string } | null; perChain: { chainId: number; address: Address; backend: string }[] } {
  let perChain: { chainId: number; address: Address; backend: string }[] = [];
  try {
    perChain = chainControllerList(cfg).map((c) => ({ chainId: c.chainId, address: c.address, backend: c.backend }));
  } catch {
    /* a damaged entry is reported by `up key address`; the lookup stays readable */
  }
  const def = cfg.controller?.address && isAddress(cfg.controller.address, { strict: false }) ? { address: getAddress(cfg.controller.address), backend: cfg.controller.backend } : null;
  return { default: def, perChain };
}

defineVerb({
  name: "profile identity",
  group: "account",
  summary: "Read-only, offline: the Universal Profile(s) this machine already knows (default profile, address and recorded controllers per network) and the agent's own signing-key address(es), from the saved public state. Run it first in every new chat and whenever asked for the agent's profile address.",
  description:
    "Reads only the public files under UP_HOME (config.json and profiles/*.json): no network call, no key store access, nothing written, no key or profile created. " +
    "Every chat that shares the same UP_HOME (same user, same machine or mounted persistent storage) gets the same answer; do not rely on chat memory, and never say you have no profile, forgot it, or start `up start` / create a new key or profile while `data.found` is true. " +
    "`profiles[]` separates the profile (the account that holds assets) from `agentControllers` (the agent's own key addresses, which are NOT the profile) and from each network's `recordedControllers` (who was recorded as a controller when it was saved; not a current permission). " +
    "Nothing here is fresh: whether a profile is deployed on a network and what the agent may do there is only known after `up profile status` (it reads the chains). A public address alone is not access and recovers no key. " +
    "If `data.found` is false, this storage knows no profile: that is not proof none exists (another device, another environment or an isolated VM that was reset). Ask the human before creating a new one; a backup (`up backup import`) or an existing profile (onboarding choice 3) is the way back. " +
    "Several people sharing one agent need separate UP_HOME folders (one per person); this verb shows everything in the one it is given.",
  risk: "local",
  params: [],
  examples: ["up profile identity"],
  async run(ctx: VerbContext) {
    const cfg = await ctx.config();
    const { collectProfiles } = await import("../backup/build.ts");
    const warnings: string[] = [];
    const states = await collectProfiles(ctx, cfg, warnings, { damaged: "warn" });

    const names = (await readdir(paths.profiles(ctx.home)).catch(() => [] as string[])).filter((n) => /^0x[0-9a-fA-F]{40}\.json$/.test(n));
    const identities = new Map<string, Address>();
    for (const n of names) identities.set(n.slice(0, 42).toLowerCase(), getAddress(n.slice(0, 42)));
    if (cfg.defaultProfile && isAddress(cfg.defaultProfile, { strict: false })) identities.set(cfg.defaultProfile.toLowerCase(), getAddress(cfg.defaultProfile));
    const defaultProfile = cfg.defaultProfile && isAddress(cfg.defaultProfile, { strict: false }) ? getAddress(cfg.defaultProfile) : null;

    const aliasOf = (a: Address) => Object.entries(cfg.aliases ?? {}).find(([, v]) => typeof v === "string" && same(v, a))?.[0];
    const ordered = [...identities.values()].sort((a, b) => (defaultProfile && same(a, defaultProfile) ? -1 : defaultProfile && same(b, defaultProfile) ? 1 : a.localeCompare(b)));

    interface Entry {
      address: Address;
      alias?: string;
      isDefault: boolean;
      networks: Record<string, any>[];
      recordDamaged?: true;
    }
    const profiles: Entry[] = [];
    for (const id of ordered) {
      // a damaged record: the address is still listed, without its saved networks (collectProfiles warned; nothing is written)
      let record: Record<string, any> = {};
      let damaged = false;
      try {
        record = await readProfileRecord(ctx.home, id);
      } catch {
        damaged = true;
      }
      const linked = chainAddressesOf(record);
      const own = states.find((s) => same(s.address, id));
      const networks: Record<string, any>[] = [];
      const add = (state: (typeof states)[number], chainId: number, address: Address, isLinked: boolean) => {
        const l = chainLabel(ctx, chainId);
        const net = luksoNetwork(chainId);
        networks.push({
          chainId,
          network: l.name,
          address,
          linkedAddress: isLinked,
          // saved evidence only: an imported backup's network was not seen on a network from here
          source: state.unverifiedChains.includes(chainId) ? "imported-backup-not-confirmed" : "recorded-here",
          recordedControllers: (state.controllers[chainId] ?? []).map((c) => ({ address: c.address, recordedFrom: c.source })),
          lastCheckedAt: typeof record.status?.chains?.[String(chainId)]?.checkedAt === "string" ? record.status.chains[String(chainId)].checkedAt : null,
          ...(net ? { link: universalEverythingUrl(address, net) } : {}),
        });
      };
      for (const c of own?.chainIds ?? []) add(own!, c, linked[String(c)] ?? id, false);
      for (const [chain, address] of Object.entries(linked)) {
        const state = states.find((s) => same(s.address, address) && s.chainIds.includes(Number(chain)));
        if (state) add(state, Number(chain), address, true);
      }
      networks.sort((a, b) => a.chainId - b.chainId);
      const alias = aliasOf(id);
      profiles.push({ address: id, ...(alias ? { alias: safeFileText(alias, 40) } : {}), isDefault: !!defaultProfile && same(id, defaultProfile), networks, ...(damaged ? { recordDamaged: true as const } : {}) });
    }

    const agentControllers = controllerText(cfg);
    const configuredChains = (cfg.chains ?? []).map((c) => ({ chainId: c, network: chainLabel(ctx, c).name }));
    const found = profiles.length > 0;
    const hasKeys = !!agentControllers.default || agentControllers.perChain.length > 0;

    const lines = (p: Entry): string => {
      const nets = p.networks.map((n) => `${n.network}${n.linkedAddress ? ` (as ${n.address})` : ""}`);
      return `${p.address}${p.alias ? ` ("${p.alias}")` : ""}${nets.length ? ` on ${listWords(nets)}` : p.recordDamaged ? " (its saved details are damaged and need a repair)" : " (no network recorded yet)"}`;
    };
    const say = found
      ? profiles.length === 1
        ? `My Universal Profile is ${lines(profiles[0])}.`
        : `I know these Universal Profiles: ${profiles.map((p) => `${lines(p)}${p.isDefault ? " (the one I use by default)" : ""}`).join("; ")}.`
      : "I don't have a Universal Profile saved in this place yet. That doesn't mean none exists: if you already have one, or a backup of mine, tell me and I'll connect it.";
    const shown = warnings.filter((w) => !/nothing to back up/.test(w));
    const profileText = profiles.map((p) => `${p.isDefault ? "* " : "  "}${lines(p)}`);

    return {
      data: {
        found,
        source: "saved public state under UP_HOME (offline, not verified on any network)",
        defaultProfile,
        profiles,
        agentControllers: { ...agentControllers, note: "the agent's own signing-key addresses; they are not the profile and hold no assets by themselves" },
        configuredChains,
        keyPresent: hasKeys,
        fresh: false,
        say,
        next: found
          ? [
              "Answer from `profiles` (full address, network names, link): this is saved state shared by every chat using this UP_HOME. Never tell the human you have no profile or forgot it, and do not create a key or profile.",
              "Saved is not current: run `up profile status` for what is deployed and permitted on each network right now before acting or answering about permissions or balances; never quote old permissions or call a network deployed from the address alone.",
              "Tell the human the address, network names and link in plain words, not file names or commands. Keep the profile (the account), the agent's key address and a controller's recorded address apart.",
              ...(hasKeys ? [] : ["No agent key address is saved here: if signing is needed, `up doctor` says why; never regenerate a key to replace a missing one."]),
              ...(profiles.some((p) => p.recordDamaged)
                ? ["A saved profile record is damaged (see warnings): tell the human and ask them to repair the file; never delete it and never create a new profile, key or relay channel because of it. Commands that use or change that record stop until it is repaired."]
                : []),
            ]
          : [
              "Nothing is saved here. Tell the human plainly, without claiming that no profile exists anywhere, and ask whether they already have a Universal Profile or a backup file before offering a new one.",
              "A fresh or isolated environment (a reset cloud VM, a new machine, a different user) does not see another environment's files. Persistent storage mounted at the same UP_HOME, an encrypted backup (`up backup import`) or the human's own authorised wallet is the way back; an address alone is not access.",
              "Only if they want a new profile, continue with `up start` (it creates the agent's own key locally).",
            ],
      },
      text: found ? [`Saved profiles (offline; run \`up profile status\` for the current state):`, ...profileText].join("\n") : "No Universal Profile saved on this machine.",
      warnings: shown.length ? shown : undefined,
    };
  },
});
