// start: the one command an agent runs when the human wants to set up (or use) a Universal Profile.
//
// It does the technical first-run work silently (environment check, the agent's own signing key)
// and returns `data.say`: a short, plain-language message to tell the human, with no commands,
// file names or jargon. `data.next` carries the agent-only instructions for the following step.
// Nothing here touches a chain or spends anything; creating the agent's key is local and needs
// no approval (the private key never leaves the key store).
import { defineVerb, getVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import type { VerbContext } from "../core/types.ts";
import { onboardingPaths } from "../knowledge/onboarding.ts";
import { RECOMMENDED_CHAINS } from "../chain/recommended.ts";

const HOSTS = ["dots", "muse", "vm"] as const;

function chainName(ctx: VerbContext, id: number): string {
  try {
    return ctx.registry.chain(id).name;
  } catch {
    return `chain ${id}`;
  }
}

function listWords(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The opening message for a human without a profile yet: three plain choices, LUKSO recommended first. */
export function welcomeMessage(ctx: VerbContext): string {
  const [own, relayer, existing] = onboardingPaths(ctx);
  const others = listWords(RECOMMENDED_CHAINS.filter((id) => id !== 42).map((id) => chainName(ctx, id)));
  return [
    "I'm ready to set up my own Universal Profile: a smart account that I can act with, while you stay in control of what I'm allowed to do.",
    "",
    "How would you like to do it?",
    `1. ${own.title}: ${own.subtitle}`,
    `2. ${relayer.title}: ${relayer.subtitle}${relayer.url ? ` ${relayer.url}` : relayer.todo ? " (The website link is coming soon.)" : ""}`,
    `3. ${existing.title}: ${existing.subtitle}`,
    "",
    `If you're not sure, I recommend option 1, starting on LUKSO. I can also add ${others} at any time.`,
  ].join("\n");
}

defineVerb({
  name: "start",
  group: "setup",
  summary: "First thing to run: checks this machine, creates the agent's own signing key if needed (local, no approval), and returns `say`, a plain-language message for the human, plus the agent's next steps.",
  description:
    "Run it as soon as the skill is installed, when the human asks about a Universal Profile or the agent's account, or when you are unsure what state setup is in. " +
    "Idempotent: an existing key and configuration are kept. Inside a cloud agent VM (OpenAI dots, Meta Muse, other isolated VMs) pass --host dots|muse|vm so the key is kept in a protected file there. " +
    "Tell the human `data.say` in your own voice (it contains no commands or jargon) and follow `data.next` yourself; never read `data.next` or this command to the human.",
  risk: "local",
  params: [{ name: "host", type: "string", description: "Cloud agent VM type when running inside one.", enum: [...HOSTS] }],
  examples: ["up start", "up start --host dots"],
  async run(ctx, a) {
    if (a.host) process.env.UP_AGENT_HOST = String(a.host);

    // 1) Environment, quietly. Only blocking problems reach the human, in plain words.
    const doctor: any = await getVerb("doctor")!.run(ctx, { offline: true });
    const failed = (doctor.data.checks as { name: string; ok: boolean; detail: string; remedy?: string }[]).filter((c) => !c.ok && c.name !== "controller");
    if (failed.length) {
      return {
        data: {
          stage: "environment",
          ready: false,
          problems: failed,
          say: "Before I can set up my account I need to fix something on this computer first. I'll take care of it and come back to you.",
          next: [
            "Fix each problem in data.problems using its remedy (agent-side; ask the human only if a fix needs their permission, e.g. installing software).",
            "Then run `up start` again.",
          ],
        },
        text: `environment not ready: ${failed.map((c) => `${c.name} (${c.remedy ?? c.detail})`).join("; ")}`,
      };
    }

    // 2) The agent's own key: created once, locally. No approval needed; nothing is spent.
    let key: any;
    try {
      key = await getVerb("init")!.run(ctx, { backend: "auto", force: false });
    } catch (e) {
      if (e instanceof UpError && e.code === "SIGNER_BACKEND_UNAVAILABLE") {
        return {
          data: {
            stage: "key-store",
            ready: false,
            say: "To act on my own I need a signing key on this computer. The usual protected key store isn't available here. Is it okay if I keep my key in a private, protected file on this computer instead? Only public addresses are ever shown.",
            next: [
              "If the human agrees: run `up init --backend protected-file` (or `--backend vm-protected-file` inside a cloud agent VM), then `up start` again.",
              "If they decline: explain that setup cannot continue on this machine and stop.",
            ],
            reason: e.message,
          },
          text: `no protected key store available: ${e.message}`,
        };
      }
      throw e;
    }
    const keyData = key.data as { address: string; created?: boolean; custodyWarnings?: string[] };

    // 3) What next: no profile yet → the onboarding choice; a profile already set → offer to help.
    const cfg = await ctx.config();
    if (cfg.defaultProfile) {
      const chains = (cfg.chains ?? []).map((id) => chainName(ctx, id));
      return {
        data: {
          stage: "ready",
          ready: true,
          keyCreated: !!keyData.created,
          controller: keyData.address,
          profile: cfg.defaultProfile,
          chains: cfg.chains ?? [],
          say: `My Universal Profile is set up${chains.length ? ` on ${listWords(chains)}` : ""}. What would you like me to do?`,
          next: ["For a full picture per network, run `up profile status` and summarise it in plain words.", "Act on requests per SKILL.md (\"Acting on a chain\")."],
        },
        text: `ready: profile ${cfg.defaultProfile}, controller ${keyData.address}`,
      };
    }
    const custody = keyData.custodyWarnings ?? [];
    return {
      data: {
        stage: "choose-path",
        ready: true,
        keyCreated: !!keyData.created,
        controller: keyData.address,
        say: welcomeMessage(ctx),
        next: [
          "Show `say` and wait for the human's choice. Ask one question at a time; never mention commands, scripts, files or key stores.",
          "Choice 1 → references/onboarding.md J1 (suggest LUKSO first). Choice 2 → J2-relayer. Choice 3 → J2.",
          ...(custody.length ? ["Custody notes for later (mention only when recommending the human as a second controller): " + custody.join(" | ")] : []),
        ],
      },
      text: `ready to onboard; controller ${keyData.address}${keyData.created ? " (new)" : ""}`,
    };
  },
});
