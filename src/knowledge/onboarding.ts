// Onboarding choice: the paths offered to the human before the agent gets its profile.
//   onboarding options   the choices as data + ready-to-show text (local, no network, no consent)
//
// The agent shows these choices in its own words but must keep their meaning: who pays gas,
// that the Universal Relayer is an optional external service with its own conditions, and
// which networks it covers. The step-by-step scripts are in references/onboarding.md.
import { defineVerb } from "../core/verbs.ts";
import type { VerbContext } from "../core/types.ts";
import { RECOMMENDED_CHAINS } from "../chain/recommended.ts";

/**
 * Universal Relayer website where the human creates a profile with gas on several networks
 * and then authorises this agent.
 * TODO(product): set the public URL once it is announced. Until then the agent says the link
 * is coming soon and offers the other paths.
 */
export const UNIVERSAL_RELAYER_WEBSITE: string | undefined = undefined;

/** Networks the Universal Relayer intends to cover with gas (chain ids from the bundled registry). */
export const UNIVERSAL_RELAYER_CHAINS = [42, 1, 8453, 56, 42161, 4663, 137, 43114];

export type OnboardingPathId = "self-funded" | "universal-relayer" | "existing-profile";

export interface OnboardingPath {
  id: OnboardingPathId;
  /** Short label for a button or a numbered choice. */
  title: string;
  /** One or two sentences under the title, in plain words. */
  subtitle: string;
  /** Who pays the gas on this path. */
  gas: string;
  /** Journey in references/onboarding.md. */
  journey: "J1" | "J2-relayer" | "J2";
  /** First verbs the agent runs after the human picks this path. */
  next: string[];
  url?: string;
  /** Present when something the path needs is not available yet. */
  todo?: string;
  networks?: { chainId: number; name: string }[];
}

function chainName(ctx: VerbContext, id: number): string {
  try {
    return ctx.registry.chain(id).name;
  } catch {
    return `chain ${id}`;
  }
}

/** Plain-words list: "A, B and C". */
function listWords(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function onboardingPaths(ctx: VerbContext, website: string | undefined = UNIVERSAL_RELAYER_WEBSITE): OnboardingPath[] {
  const networks = UNIVERSAL_RELAYER_CHAINS.map((chainId) => ({ chainId, name: chainName(ctx, chainId) }));
  return [
    {
      id: "self-funded",
      title: "Create my own account (you provide the gas)",
      subtitle: "I create my own account on each network you choose. You send a little gas to each network yourself. No outside service needed, but every network has to be funded separately.",
      gas: "you fund the agent's controller address on each network",
      journey: "J1",
      next: ["up chains list", "up account precompute", "up display address <controller>"],
    },
    {
      id: "universal-relayer",
      title: "Create it with the Universal Relayer (gas included)",
      subtitle: `One subscription gives gas on several networks: ${listWords(networks.map((n) => n.name))}. My account is ready on all of them right away. The relayer only pays the gas; it never controls your profile. This opens a separate website with its own terms.`,
      gas: "the Universal Relayer pays the gas (subscription)",
      journey: "J2-relayer",
      next: ["up permissions recommend", "up display address <controller>", "up profile join <profileAddress>"],
      networks,
      ...(website ? { url: website } : { todo: "The Universal Relayer website link is not published yet; say it is coming soon and offer the other options." }),
    },
    {
      id: "existing-profile",
      title: "Use a Universal Profile you already have",
      subtitle: "You give me the profile's address and allow me to act for it, with the permissions you choose. You stay in control.",
      gas: "a relayer, or you fund the agent's controller address",
      journey: "J2",
      next: ["up profile join <profileAddress>", "up permissions recommend"],
    },
  ];
}

export function onboardingText(paths: OnboardingPath[], recommended?: string[]): string {
  const lines = ["How should I get my Universal Profile? Please pick one:", ""];
  paths.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.title}`);
    lines.push(`   ${p.subtitle}`);
    if (p.url) lines.push(`   ${p.url}`);
    else if (p.todo) lines.push("   (The website link is coming soon.)");
    lines.push("");
  });
  if (recommended?.length) lines.push(`Recommended networks: ${listWords(recommended)} (LUKSO first).`);
  lines.push("You can add more networks later; on every network it stays the same profile.");
  return lines.join("\n");
}

defineVerb({
  name: "onboarding options",
  group: "setup",
  summary: "The onboarding choices to offer the human (own account with their gas, Universal Relayer with gas included, or an existing profile), as data and ready-to-show text.",
  description:
    "Run after `up init`, before creating or joining a profile. Show `text` (or the same choices in your own words, keeping who pays gas, that the Universal Relayer is an optional separate website with its own terms, and its networks). Then follow the chosen journey in references/onboarding.md. `data.paths[].todo` marks something not available yet (e.g. the Universal Relayer link).",
  risk: "local",
  params: [],
  examples: ["up onboarding options"],
  async run(ctx) {
    const paths = onboardingPaths(ctx);
    const recommended = RECOMMENDED_CHAINS.map((chainId) => ({ chainId, name: chainName(ctx, chainId) }));
    return { data: { paths, recommendedNetworks: recommended }, text: onboardingText(paths, recommended.map((n) => n.name)) };
  },
});
