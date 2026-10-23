// One-click hand-over for a HUMAN'S existing Universal Profile (journey J2 on LUKSO):
//   permissions authorize-link  the link to https://authorize.universalprofile.cloud/authorize (local:
//                               reads only the agent's public address from config; grants nothing)
//   permissions check-grant     reads what the profile now allows this agent's key and compares it
//                               with the link the human approved (read)
// After check-grant the existing safe flow takes over: `profile join` (never a new deployment).
//
// This file only declares the verbs (name, parameters, help); the code behind them is in
// authorize-run.ts and is loaded when one of them runs, so the shipped bundle loads it as a separate chunk.
import { defineVerb } from "../core/verbs.ts";
import { CAPABILITIES } from "./authorize-site.ts";

defineVerb({
  name: "permissions authorize-link",
  group: "permissions",
  summary:
    "Link for the human to add this agent to THEIR existing Universal Profile on LUKSO (https://authorize.universalprofile.cloud): prefilled agent address and the least permissions for what you will do. Grants nothing by itself.",
  description:
    "Local and offline: reads only the agent's public controller address from config (the key store is never opened; no key is created; without a key it stops with NO_SIGNER). " +
    "Choose what the agent may do with --for (tokens, nfts, social, profile, pay with --pay-to, sign) and/or --allow-targets / --allowed-keys; there is no default. Only bits the lists use are requested (plus EXECUTE_RELAY_CALL for writes unless --no-relay); " +
    "SUPER_* and DEPLOY only with --elevated when the human explicitly asked (shown unticked on the website); ownership, controller, permission, extension, delegate and DELEGATECALL powers are never requested. " +
    "Send `data.say` with the QR from `media`. The human connects their profile with the UP browser extension or the UP mobile app, reviews and approves in their own wallet; then run `permissions check-grant` and `profile join`. " +
    "LUKSO mainnet only (other chains: `permissions recommend --chain <id>`). --profile is included only when passed. --dry-run writes no QR and saves nothing. UP_AUTHORIZE_URL may point to a local development copy of the website (http://localhost only).",
  risk: "local",
  params: [
    { name: "for", type: "string[]", description: `What the agent may do: ${CAPABILITIES.join(", ")} (comma separated).` },
    { name: "pay-to", type: "string[]", description: "Recipients the agent may send LYX to (pay capability; LSP6 limits recipients, not amounts)." },
    { name: "allow-targets", type: "json", description: 'Extra AllowedCalls entries: [{"address":"0x…","callTypes":["CALL"],"selector":"0x…","standard":"*"}] (VALUE, CALL, STATICCALL).' },
    { name: "allowed-keys", type: "string[]", description: "Extra data keys the agent may write (names like LSP3Profile or hex keys/prefixes)." },
    { name: "elevated", type: "string[]", description: "SUPER_CALL, SUPER_TRANSFERVALUE, SUPER_STATICCALL, SUPER_SETDATA or DEPLOY, only when the human explicitly asked for them." },
    { name: "relay", type: "boolean", description: "Add EXECUTE_RELAY_CALL to write permissions so the agent can act gaslessly (--no-relay to leave it out).", default: true },
    { name: "bot-name", type: "string", description: "Your own display name as the human knows it (shown on the page as unverified); default UP_AGENT_NAME." },
    { name: "purpose", type: "string", description: "One short sentence on what you will do for the human (shown on the page as unverified, max 200 characters)." },
    { name: "qr", type: "boolean", description: "Also write a QR code PNG of the link (to open it on a phone).", default: true },
  ],
  examples: [
    'up permissions authorize-link --for social,profile --bot-name "Nova" --purpose "Follow artists for you and keep your profile picture fresh"',
    "up permissions authorize-link --for tokens,sign --profile 0x… ",
    "up permissions authorize-link --for pay --pay-to 0xFriend… --dry-run",
  ],
  run: (ctx, a) => import("./authorize-run.ts").then((m) => m.runAuthorizeLink(ctx, a)),
});

defineVerb({
  name: "permissions check-grant",
  group: "permissions",
  summary:
    "After the human approved an authorization link: reads what their profile now allows this agent's key on-chain and compares it with the link (exact, narrower, broader, not-authorised). Read-only.",
  description:
    "Uses the newest saved link of `permissions authorize-link` (or --request <link>) and --profile (the human's profile; the page shows it after the approval). " +
    "exact = everything requested and nothing more; narrower = the human unticked something (fine: never ask for more without a new need); broader = the profile allows more than requested (tell the human, recommend removing it); not-authorised = nothing granted yet. " +
    "Then join with the existing flow: `profile join <profile> --chains 42` (never deploy a new profile). Without --chain it checks the link's network (LUKSO).",
  risk: "read",
  params: [{ name: "request", type: "string", description: "The authorization link to compare with (default: the newest link this agent made for this profile)." }],
  examples: ["up permissions check-grant --profile 0x…", "up permissions check-grant --profile 0x… --request \"https://authorize.universalprofile.cloud/authorize?…\""],
  run: (ctx, a) => import("./authorize-run.ts").then((m) => m.runCheckGrant(ctx, a)),
});
