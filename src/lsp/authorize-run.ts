// The code behind the authorization-link verbs (declared in verbs-authorize.ts; loaded when one of them runs).
import type { Address } from "viem";
import { UpError } from "../core/errors.ts";
import { releaseKeys } from "../core/json.ts";
import type { MediaFile, UpConfig, VerbContext, VerbResult } from "../core/types.ts";
import { readProfileRecord } from "../core/profile-record.ts";
import { controllerFor, localControllers } from "../signer/select.ts";
import { qrMatrix, qrPng } from "../display/qr.ts";
import { writeMedia } from "../display/media.ts";
import { describeAllowedCall, type AllowedCall } from "./allowed.ts";
import { decodePermissions, explainPermissions } from "./permissions.ts";
import { ADMIN_PERMISSIONS } from "./constants.ts";
import { readControllerPermissions, resolveKeyManager } from "./profile.ts";
import { hasCode } from "./read.ts";
import { authorizeRequestsFile, saveAuthorizeRequest, savedAuthorizeRequests } from "./authorize-store.ts";
import { AUTHORIZE_WEBSITE, authorizeDefaultChainId } from "./authorize-site.ts";
import {
  CAPABILITY_TEXT,
  LINK_LIMITS,
  LINK_REFUSED_PERMISSIONS,
  assertAuthorizeNetwork,
  authorizeBaseUrl,
  buildAuthorizeRequest,
  linkText,
  parseAuthorizeUrl,
  type AuthorizeRequest,
} from "./authorize-link.ts";

/** "own" when this agent created the profile (deployment manifest), "joined" when it was authorised on it. */
async function profileRole(ctx: VerbContext, profile: Address): Promise<"own" | "joined" | "unknown"> {
  const record = await readProfileRecord(ctx.home, profile);
  if (record.deployment) return "own";
  if (record.joined) return "joined";
  return "unknown";
}

function listWords(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function humanAsks(req: AuthorizeRequest): string[] {
  const asks: string[] = req.capabilities.map((c) => CAPABILITY_TEXT[c].human);
  const fromCapabilities = new Set(req.capabilities.filter((c) => c !== "sign" && c !== "profile"));
  const customCalls = req.allowedCalls.entries.length > 0 && fromCapabilities.size === 0;
  if (customCalls) asks.push("call the specific contracts listed on the page");
  const customKeys = req.allowedDataKeys.keys.length > (req.capabilities.includes("profile") ? 1 : 0);
  if (customKeys) asks.push("change the profile data listed on the page");
  if (req.elevated.length) asks.push("have unrestricted access you would have to tick yourself on the page");
  return asks;
}

const NOT_GRANTED = [...LINK_REFUSED_PERMISSIONS];

/** permissions authorize-link */
export async function runAuthorizeLink(ctx: VerbContext, a: Record<string, any>): Promise<VerbResult> {
  const cfg = await ctx.config();
  const chainId = a.chain !== undefined ? ctx.chainId(a.chain) : authorizeDefaultChainId();
  assertAuthorizeNetwork(chainId);
  const key = controllerFor(cfg, chainId);
  if (!key) {
    throw new UpError("NO_SIGNER", "this agent has no key yet, so there is no address for the human to authorise", {
      hint: "set up the agent's own key first with the normal setup (up start; inside a cloud agent VM: up start --host dots|muse|vm), then make the link. Never use the human's key or seed phrase.",
    });
  }
  const warnings: string[] = [];
  let profile: Address | undefined;
  if (a.profile !== undefined) {
    profile = await ctx.resolveAddress(a.profile);
    if ((await profileRole(ctx, profile)) === "own") {
      throw new UpError("BAD_ARGS", `${profile} is my own profile (I created it); the link is for the human's own profile`, { hint: "ask the human for their profile address, or leave --profile out: the page then uses the profile they connect" });
    }
  }
  let name: string | undefined = a["bot-name"];
  if (name === undefined && process.env.UP_AGENT_NAME?.trim()) {
    try {
      name = linkText(process.env.UP_AGENT_NAME, "UP_AGENT_NAME", LINK_LIMITS.maxNameLength);
    } catch {
      warnings.push("UP_AGENT_NAME is not a safe display name for the page; the link has no name (pass --bot-name)");
    }
  }
  if (a["allow-targets"] !== undefined && !Array.isArray(a["allow-targets"])) throw new UpError("BAD_ARGS", "--allow-targets must be a JSON array");
  const baseUrl = authorizeBaseUrl();
  if (baseUrl !== AUTHORIZE_WEBSITE) warnings.push(`the link points to a local copy of the website (${baseUrl}, from UP_AUTHORIZE_URL): for testing only; give the human links to ${AUTHORIZE_WEBSITE} only`);

  const req = buildAuthorizeRequest({
    controller: key.address,
    chainId,
    capabilities: a.for,
    payTo: a["pay-to"],
    allowTargets: a["allow-targets"],
    allowedKeys: a["allowed-keys"],
    elevated: a.elevated,
    relay: a.relay,
    profile,
    name,
    purpose: a.purpose,
    baseUrl,
  });
  if (req.elevated.length) warnings.push(`the link asks for ${req.elevated.join(", ")}: the website shows them unticked with a warning; the human must tick each one deliberately`);

  const media: MediaFile[] = [];
  let qr: { version: number; size: number } | null = null;
  let saved: { id: string; path: string } | null = null;
  if (!ctx.flags.dryRun) {
    if (a.qr) {
      try {
        const m = qrMatrix(req.url, "L");
        media.push(await writeMedia(ctx.home, "authorize-link", qrPng(m, { scale: 4 }), `QR code that opens the authorization link for ${key.address} on ${req.networkName} (scan with a phone; it is not a wallet request)`));
        qr = { version: m.version, size: m.size };
      } catch {
        warnings.push("the link is too long for a QR code; send it as text only");
      }
    }
    const entry = await saveAuthorizeRequest(ctx.home, req);
    saved = { id: entry.id, path: authorizeRequestsFile(ctx.home) };
  }

  const last4 = key.address.slice(-4);
  const asks = humanAsks(req);
  const say = [
    "To let me act for your Universal Profile, please open this link and connect your profile:",
    req.url,
    `It opens the official Universal Profile authorization page. Connect with the Universal Profile browser extension, or on your phone with the Universal Profile app${qr ? " (on a computer you can also scan the attached QR code with your phone)" : ""}.`,
    `Check that my address on the page ends in ${last4}. I'm asking to ${listWords(asks)}. I can't change owners, controllers or permissions, and you can untick anything before you approve.`,
    `Nothing happens until you approve it in your wallet. Tell me "done" when you have${req.profile ? "" : ", and send me your profile address (the page shows it at the end)"}.`,
  ].join("\n");

  // the link is built from checked public data; released so the output's URL mask (allowedDataKeys) leaves it whole
  return {
    data: releaseKeys({
      status: "link-ready",
      granted: false,
      url: req.url,
      link: req.url,
      chainId: req.chainId,
      network: req.networkName,
      controller: { address: key.address, source: key.scope === "chain" ? `key for ${req.networkName}` : "default key" },
      profile: req.profile ?? null,
      name: req.name ?? null,
      purpose: req.purpose ?? null,
      capabilities: req.capabilities,
      permissions: { names: req.permissions.names, hex: req.permissions.hex, risk: decodePermissions(req.permissions.hex).risk, explanation: explainPermissions(req.permissions.hex) },
      elevated: req.elevated,
      restrictions: { allowedCalls: req.allowedCalls, allowedDataKeys: req.allowedDataKeys },
      notGranted: NOT_GRANTED,
      review: [
        "The page shows the full request before the human connects, and blocks the whole link if anything in it is invalid.",
        "The human can untick any permission; they cannot add one. SUPER_* and DEPLOY (if requested) start unticked.",
        "LSP6 has no amount or time limits: TRANSFERVALUE limits recipients only, and CALL on a token lets the agent move all of that token. Say so if the human asks for a limit.",
        "The website writes exactly the reviewed permissions, allowed calls and data keys for this key only, and reads them back.",
      ],
      connect: {
        extension: "On a computer with the Universal Profile browser extension: open the link, choose Connect Wallet, then Browser Extension (the page offers the extension store if it is missing).",
        mobileApp: "With the Universal Profile mobile app: on a phone, open the link and choose Mobile Application (it opens the app and comes back to the page); on a computer, choose Mobile Application and scan the QR code the page shows with the app.",
        qr: "The QR code in media only opens the link on a phone; it is not a wallet request.",
        otherWallets: "Other wallets are not offered: the profile is connected with the Universal Profile extension or app.",
      },
      qr,
      saved,
      say,
      next: [
        "Send `say` to the human with the QR code from `media` attached. Do not shorten or rewrite the link.",
        `When the human says it is done: up permissions check-grant${req.profile ? "" : " --profile <their profile address>"}`,
        "If it reports exact or narrower: up profile join <profile> --chains 42 (add --set-default false when you already use your own profile by default), then up profile status --chain 42.",
        "Never deploy a new profile for this, never ask for a key, seed phrase or password, and do not act on the profile before check-grant confirms the permission on-chain.",
      ],
    }, "url", "link"),
    text: [
      `Authorization link for ${key.address} on ${req.networkName} (nothing is granted until the human approves it in their own wallet):`,
      req.url,
      `Requests: ${req.permissions.names.join(", ")}${req.elevated.length ? ` (elevated, unticked on the page: ${req.elevated.join(", ")})` : ""}`,
      ...(req.allowedCalls.described.length ? ["Allowed calls:", ...req.allowedCalls.described.map((d) => `  - ${d}`)] : []),
      ...(req.allowedDataKeys.keys.length ? [`Allowed data keys: ${req.allowedDataKeys.keys.join(", ")}`] : []),
    ].join("\n"),
    media,
    warnings: warnings.length ? warnings : undefined,
  };
}

/** permissions check-grant */
export async function runCheckGrant(ctx: VerbContext, a: Record<string, any>): Promise<VerbResult> {
  const cfg: UpConfig = await ctx.config();
  const explicitProfile: Address | undefined = a.profile !== undefined ? await ctx.resolveAddress(a.profile) : undefined;
  let req: AuthorizeRequest;
  let source: "request" | "saved";
  if (a.request !== undefined) {
    req = parseAuthorizeUrl(a.request);
    source = "request";
  } else {
    const mine = localControllers(cfg).map((k) => k.address);
    const all = (await savedAuthorizeRequests(ctx.home)).reverse();
    const pick = all.find((r) => (!explicitProfile || !r.profile || r.profile.toLowerCase() === explicitProfile.toLowerCase()) && mine.some((m) => m.toLowerCase() === r.controller.toLowerCase()));
    if (!pick) {
      throw new UpError("BAD_ARGS", "no authorization link was made in this place yet", { hint: "make one with up permissions authorize-link, or pass the link the human used with --request \"<link>\"" });
    }
    req = parseAuthorizeUrl(pick.url);
    source = "saved";
  }
  const profile = explicitProfile ?? req.profile;
  if (!profile) throw new UpError("BAD_ARGS", "which profile did the human authorise you on? pass --profile <their profile address> (the page shows it after the approval)");
  if (req.profile && req.profile.toLowerCase() !== profile.toLowerCase()) {
    throw new UpError("BAD_ARGS", `the link was made for profile ${req.profile}, not ${profile}`, { hint: "check the address with the human, or make a new link for this profile" });
  }
  const chainId = a.chain !== undefined ? ctx.chainId(a.chain) : req.chainId;
  const warnings: string[] = [];
  if (chainId !== req.chainId) warnings.push(`checking chain ${chainId}, but the link was for ${req.networkName} (chain ${req.chainId})`);
  if (!localControllers(cfg).some((k) => k.address.toLowerCase() === req.controller.toLowerCase())) warnings.push(`the link authorises ${req.controller}, which is not one of this agent's keys`);

  // req.url is the link re-assembled from its checked parts; released like authorize-link's
  const request = releaseKeys({ url: req.url, permissions: req.permissions.names, allowedCalls: req.allowedCalls.described, allowedDataKeys: req.allowedDataKeys.keys }, "url");
  const base = { chainId, profile, controller: req.controller, source, request };
  if (!(await hasCode(ctx, chainId, profile))) {
    return {
      data: { ...base, status: "not-deployed", authorised: false, say: "There's no Universal Profile at that address on this network. Could you check the address on the authorization page?" },
      text: `no contract at ${profile} on chain ${chainId}`,
      warnings: warnings.length ? warnings : undefined,
    };
  }
  const km = await resolveKeyManager(ctx, chainId, profile);
  const info = await readControllerPermissions(ctx, chainId, profile, req.controller);
  const granted = km.keyManager ? info.permissions.value : 0n;
  if (!km.keyManager) warnings.push(`${profile} is not owned by an LSP6 Key Manager (owner ${km.owner}, ${km.ownerKind}), so controller permissions do not apply`);
  if (info.problems?.length) warnings.push(...info.problems.map((p) => `stored ${p}`));

  const requested = BigInt(req.permissions.hex);
  const missing = decodePermissions(requested & ~granted).names;
  const extra = decodePermissions(granted & ~requested);
  const keyOf = (c: AllowedCall) => `${c.callTypes}:${c.address.toLowerCase()}:${c.standard.toLowerCase()}:${c.selector.toLowerCase()}`;
  const reqCalls = new Map(req.allowedCalls.entries.map((c) => [keyOf(c), c]));
  const gotCalls = new Map(info.allowedCalls.map((c) => [keyOf(c), c]));
  const missingCalls = [...reqCalls].filter(([k]) => !gotCalls.has(k)).map(([, c]) => describeAllowedCall(c));
  const extraCalls = [...gotCalls].filter(([k]) => !reqCalls.has(k)).map(([, c]) => describeAllowedCall(c));
  const reqKeys = req.allowedDataKeys.keys.map((k) => k.toLowerCase());
  const gotKeys = info.allowedDataKeys.map((k) => k.toLowerCase());
  const missingKeys = reqKeys.filter((k) => !gotKeys.includes(k));
  const extraKeys = gotKeys.filter((k) => !reqKeys.includes(k));

  let status: "not-authorised" | "broader" | "narrower" | "exact";
  if (granted === 0n) status = "not-authorised";
  else if (extra.names.length || extra.unknownBits.length || extraCalls.length || extraKeys.length || info.problems?.length) status = "broader";
  else if (missing.length || missingCalls.length || missingKeys.length) status = "narrower";
  else status = "exact";
  if ((granted & ~requested & ADMIN_PERMISSIONS) !== 0n) warnings.push(`the profile gives this key control over owners, controllers or permissions (${extra.names.filter((n) => ["CHANGEOWNER", "ADDCONTROLLER", "EDITPERMISSIONS"].includes(n)).join(", ")}), which the link never asked for: tell the human and recommend removing it`);
  if (extra.names.some((n) => n.startsWith("SUPER_"))) warnings.push(`the profile gives this key unrestricted ${extra.names.filter((n) => n.startsWith("SUPER_")).join(", ")}, which the link did not ask for`);

  const ownDefault = cfg.defaultProfile && cfg.defaultProfile.toLowerCase() !== profile.toLowerCase() && (await profileRole(ctx, cfg.defaultProfile as Address)) === "own";
  const join = `up profile join ${profile} --chains ${chainId}${ownDefault ? " --set-default false" : ""}`;
  const say = {
    exact: `Done: your profile now lets me do exactly what you approved. I can't change owners, controllers or permissions.`,
    narrower: `Done: your profile lets me do part of what I asked${missing.length ? ` (not: ${missing.join(", ")})` : ""}. That's fine; I'll only do what you allowed.`,
    broader: `Your profile gives me more than I asked for${extra.names.length ? `: ${extra.names.join(", ")}` : ""}. I recommend removing that extra access in your Universal Profile app or extension; I'll only use what I asked for.`,
    "not-authorised": "I can't see the permission on your profile yet. If you approved it just now, wait a few seconds and tell me again; otherwise please open the link once more.",
  }[status];

  return {
    data: {
      ...base,
      status,
      authorised: granted !== 0n,
      withinRequest: status === "exact" || status === "narrower",
      keyManager: km.keyManager ?? null,
      granted: { permissions: info.permissions.names, hex: info.permissions.hex, allowedCalls: info.allowedCallsDescribed, allowedDataKeys: info.allowedDataKeys },
      differences: { missingPermissions: missing, extraPermissions: extra.names, unknownBits: extra.unknownBits, missingAllowedCalls: missingCalls, extraAllowedCalls: extraCalls, missingDataKeys: missingKeys, extraDataKeys: extraKeys },
      say,
      next:
        status === "not-authorised"
          ? ["Wait for the human, then run this check again. Do not act on the profile and do not make a new link unless the human asks for different permissions."]
          : [`${join}`, `up profile status --chain ${chainId}`, "This profile belongs to the human: never deploy a new one for it, and keep it apart from your own profile."],
    },
    text: `${status}: ${req.controller} on ${profile} (chain ${chainId}) has ${info.permissions.names.join(", ") || "no permissions"}${missing.length ? `; not granted: ${missing.join(", ")}` : ""}${extra.names.length ? `; more than requested: ${extra.names.join(", ")}` : ""}`,
    warnings: warnings.length ? warnings : undefined,
  };
}
