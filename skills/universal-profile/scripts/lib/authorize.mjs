// Universal Profile skill — authorization-link verbs (loaded on demand by app.mjs)
// Universal Profile Agent Skill v0.2.0 — MIT-0 — https://github.com/universal-everything/ai-universalprofile-skill
// Built from source fingerprint 362e4d5b6525 (sha256 of the bundled src/ modules and build inputs) with `npm ci && npm run build` (esbuild, unminified). Do not edit; edit src/ instead.
import { $s2, $s4, $s5, $s8, $s9, $s11, $s12, $s13, $s14, $s16, $s17, $s18, $s19, $s23, $s25 } from "./app.mjs";
import { createRequire as __upCreateRequire } from "node:module";
const require = __upCreateRequire(import.meta.url);


// src/lsp/authorize-run.ts
const { UpError: UpError2 } = $s2;
const { releaseKeys } = $s4;
const { readProfileRecord } = $s5;
const { controllerFor, localControllers } = $s23;
const { qrMatrix, qrPng } = $s9;
const { writeMedia } = $s8;
const { describeAllowedCall: describeAllowedCall2 } = $s11;
const { decodePermissions: decodePermissions2, explainPermissions } = $s16;
const { ADMIN_PERMISSIONS } = $s14;
const { readControllerPermissions, resolveKeyManager } = $s17;
const { hasCode } = $s18;
const { authorizeRequestsFile, saveAuthorizeRequest, savedAuthorizeRequests } = $s13;
const { AUTHORIZE_WEBSITE: AUTHORIZE_WEBSITE2, authorizeDefaultChainId: authorizeDefaultChainId2 } = $s12;

// src/lsp/authorize-link.ts
import { getAddress, isAddress } from "./vendor-viem.mjs";
const { UpError } = $s2;
const { CALLTYPE, DATA_KEYS, PERMISSIONS, WILDCARD_ADDRESS, WILDCARD_BYTES4 } = $s14;
const {
  decodeAllowedCalls,
  decodeAllowedDataKeys,
  describeAllowedCall,
  encodeAllowedCalls,
  encodeAllowedDataKeys,
  normaliseAllowedCall,
  validateAllowedCall
} = $s11;
const { decodePermissions, toBytes32, TOKEN_INTERFACE_IDS } = $s16;
const { allowedKeyFor } = $s19;
const { lsp26Registry } = $s25;
const { AUTHORIZE_WEBSITE, CAPABILITIES, authorizeDefaultChainId, authorizeNetwork } = $s12;
var AUTHORIZE_PATH = "/authorize";
var LINK_LIMITS = { maxNameLength: 48, maxPurposeLength: 200, maxAllowedCalls: 16, maxAllowedDataKeys: 16, maxUrlLength: 4096 };
var CAPABILITY_TEXT = {
  tokens: { summary: "CALL to any contract that reports an LSP7 interface id, any function (use and send every LSP7 token the profile holds)", human: "use and send your tokens" },
  nfts: { summary: "CALL to any contract that reports an LSP8 interface id, any function (use and send every NFT the profile holds)", human: "use and send your NFTs" },
  social: { summary: "CALL to the LSP26 follower registry: follow, unfollow, followBatch, unfollowBatch", human: "follow and unfollow profiles for you" },
  profile: { summary: "SETDATA on the LSP3Profile key only (name, description, pictures, links, tags)", human: "update your profile name, description and pictures" },
  pay: { summary: "TRANSFERVALUE to the listed recipients only (LSP6 limits recipients, not amounts)", human: "send LYX from your profile to the people you named (with no amount limit)" },
  sign: { summary: "SIGN: signatures by the agent's key count as the profile's (ERC-1271 logins, off-chain orders, payment approvals)", human: "sign messages as your profile, for example to log in to apps" }
};
var LINK_STANDARD_PERMISSIONS = ["CALL", "STATICCALL", "TRANSFERVALUE", "SETDATA", "SIGN", "EXECUTE_RELAY_CALL", "ENCRYPT", "DECRYPT"];
var LINK_ELEVATED_PERMISSIONS = ["SUPER_CALL", "SUPER_TRANSFERVALUE", "SUPER_STATICCALL", "SUPER_SETDATA", "DEPLOY"];
var LINK_REFUSED_PERMISSIONS = [
  "CHANGEOWNER",
  "ADDCONTROLLER",
  "EDITPERMISSIONS",
  "ADDEXTENSIONS",
  "CHANGEEXTENSIONS",
  "ADDUNIVERSALRECEIVERDELEGATE",
  "CHANGEUNIVERSALRECEIVERDELEGATE",
  "REENTRANCY",
  "DELEGATECALL",
  "SUPER_DELEGATECALL"
];
var LSP26_FUNCTIONS = [
  { signature: "follow(address)", selector: "0x4dbf27cc" },
  { signature: "unfollow(address)", selector: "0x015a4ead" },
  { signature: "followBatch(address[])", selector: "0xcf8711c8" },
  { signature: "unfollowBatch(address[])", selector: "0x8dd1e47e" }
];
var PROTECTED_PREFIXES = [
  { prefix: "0x4b80742de2bf", name: "controller permissions (AddressPermissions:…)" },
  { prefix: "0xdf30dba06db6a30e65354d9a64c60986", name: "the controller list (AddressPermissions[])" },
  { prefix: "0x0cfc51aec37c55a4d0b1", name: "Universal Receiver Delegates (LSP1)" },
  { prefix: "0xcee78b4094da86011096", name: "profile extensions (LSP17)" }
];
var INVISIBLE_RANGES = [
  [0, 31],
  [127, 159],
  [173, 173],
  [1564, 1564],
  [6158, 6158],
  [8203, 8207],
  [8232, 8238],
  [8288, 8292],
  [8294, 8303],
  [65279, 65279],
  [65529, 65531],
  [917504, 917631]
];
var SECRET_RUN = /[0-9a-fA-F]{64}/;
var LINK_TEXT = /[a-z][a-z0-9+.-]*:\/\/|\bwww\./i;
var KNOWN_PARAMS = ["controller", "network", "name", "purpose", "forProfile", "permissions", "allowedCalls", "allowedDataKeys"];
var WRITE_BITS = PERMISSIONS.CALL | PERMISSIONS.TRANSFERVALUE | PERMISSIONS.SETDATA | PERMISSIONS.SUPER_CALL | PERMISSIONS.SUPER_TRANSFERVALUE | PERMISSIONS.SUPER_SETDATA | PERMISSIONS.DEPLOY;
function bad(message, hint) {
  return new UpError("BAD_ARGS", message, hint ? { hint } : void 0);
}
function hasInvisible(s) {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (INVISIBLE_RANGES.some(([a, b]) => cp >= a && cp <= b)) return true;
  }
  return false;
}
function linkText(value, what, max) {
  if (value === void 0) return void 0;
  const t = value.trim();
  if (!t) throw bad(`${what} is empty`);
  if (hasInvisible(t)) throw bad(`${what} contains invisible, control or direction-changing characters`);
  if (LINK_TEXT.test(t)) throw bad(`${what} must not contain a web link`);
  if (SECRET_RUN.test(t)) throw bad(`${what} contains a 64-character hex value; a link never carries keys or hashes`);
  if ([...t].length > max) throw bad(`${what} is longer than ${max} characters`);
  return t;
}
function address(value, what) {
  const s = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s) || !isAddress(s, { strict: false })) throw bad(`${what} is not an address: ${s.slice(0, 50)}`);
  const body = s.slice(2);
  const checksummed = getAddress(s);
  if (/[a-f]/.test(body) && /[A-F]/.test(body) && s !== checksummed) throw bad(`${what} has a wrong EIP-55 checksum (mistyped or altered?)`);
  if (/^0{40}$/.test(body)) throw bad(`${what} is the zero address`);
  if (/^f{40}$/i.test(body)) throw bad(`${what} is the wildcard address`);
  return checksummed;
}
function protectedNamespace(key) {
  const k = key.toLowerCase();
  return PROTECTED_PREFIXES.find(({ prefix }) => k.startsWith(prefix) || prefix.startsWith(k))?.name;
}
function capabilityList(raw) {
  const out = /* @__PURE__ */ new Set();
  for (const c of raw ?? []) {
    const name = c.trim().toLowerCase();
    if (!name) continue;
    if (!CAPABILITIES.includes(name)) throw bad(`unknown capability "${c}"`, `choose from: ${CAPABILITIES.join(", ")}`);
    out.add(name);
  }
  return CAPABILITIES.filter((c) => out.has(c));
}
function elevatedList(raw) {
  const out = [];
  for (const r of raw ?? []) {
    const name = r.trim().toUpperCase();
    if (!name) continue;
    if (LINK_REFUSED_PERMISSIONS.includes(name)) {
      throw bad(`${name} is never granted through an authorization link: it would give control over the profile's owners, controllers, permissions or code`);
    }
    if (!LINK_ELEVATED_PERMISSIONS.includes(name)) throw bad(`--elevated accepts only ${LINK_ELEVATED_PERMISSIONS.join(", ")} (got ${name.slice(0, 40)})`);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
function authorizeBaseUrl(env = process.env) {
  const raw = env.UP_AUTHORIZE_URL;
  if (raw === void 0 || raw.trim() === "") return AUTHORIZE_WEBSITE;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad(`UP_AUTHORIZE_URL is not a URL; authorization links use ${AUTHORIZE_WEBSITE}`);
  }
  const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (!local || u.username || u.password || u.pathname !== "/" && u.pathname !== "" || u.search || u.hash) {
    throw bad(`UP_AUTHORIZE_URL may only point to a local development copy of the website (http://localhost:<port> or http://127.0.0.1:<port>); authorization links otherwise always use ${AUTHORIZE_WEBSITE}`);
  }
  return `${u.protocol}//${u.host}`;
}
function encodeText(v) {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function assemble(parts) {
  const net = authorizeNetwork(parts.chainId);
  const names = decodePermissions(parts.bits).names;
  const callsHex = parts.calls.length ? encodeAllowedCalls(parts.calls) : null;
  const keysHex = parts.keys.length ? encodeAllowedDataKeys(parts.keys) : null;
  const query = [`controller=${parts.controller}`, `network=${net.param}`];
  if (parts.name) query.push(`name=${encodeText(parts.name)}`);
  if (parts.purpose) query.push(`purpose=${encodeText(parts.purpose)}`);
  if (parts.profile) query.push(`forProfile=${parts.profile}`);
  query.push(`permissions=${names.join(",")}`);
  if (callsHex) query.push(`allowedCalls=${callsHex}`);
  if (keysHex) query.push(`allowedDataKeys=${keysHex}`);
  const url = `${parts.baseUrl}${AUTHORIZE_PATH}?${query.join("&")}`;
  if (url.length > LINK_LIMITS.maxUrlLength) throw bad(`the link would be ${url.length} characters long (at most ${LINK_LIMITS.maxUrlLength}); ask for fewer targets or data keys`);
  return {
    url,
    baseUrl: parts.baseUrl,
    chainId: parts.chainId,
    network: net.param,
    networkName: net.name,
    controller: parts.controller,
    ...parts.profile ? { profile: parts.profile } : {},
    ...parts.name ? { name: parts.name } : {},
    ...parts.purpose ? { purpose: parts.purpose } : {},
    capabilities: parts.capabilities,
    permissions: { names, hex: toBytes32(parts.bits) },
    elevated: parts.elevated,
    allowedCalls: { encoded: callsHex, entries: parts.calls, described: parts.calls.map(describeAllowedCall) },
    allowedDataKeys: { encoded: keysHex, keys: parts.keys }
  };
}
var sameCall = (a, b) => a.callTypes === b.callTypes && a.address.toLowerCase() === b.address.toLowerCase() && a.standard.toLowerCase() === b.standard.toLowerCase() && a.selector.toLowerCase() === b.selector.toLowerCase();
function checkedCall(input) {
  let c;
  try {
    c = normaliseAllowedCall(input);
  } catch (e) {
    throw bad(e.message);
  }
  if (c.callTypes & CALLTYPE.DELEGATECALL) throw bad("DELEGATECALL is never requested through an authorization link");
  if (c.callTypes & ~(CALLTYPE.VALUE | CALLTYPE.CALL | CALLTYPE.STATICCALL)) throw bad("an allowed call uses an unknown call type");
  const v = validateAllowedCall(c);
  if (v.errors.length) throw bad(v.errors.join("; "));
  if (/^0x0{40}$/i.test(c.address)) throw bad("an allowed call targets the zero address");
  return c;
}
function assertAuthorizeNetwork(chainId) {
  if (!authorizeNetwork(chainId)) {
    throw new UpError("NOT_SUPPORTED", `the authorization website works on LUKSO mainnet (chain 42) only; there is no authorization link for chain ${chainId}`, {
      hint: `on that network give the human the permissions to add in their own app: up permissions recommend --chain ${chainId}`
    });
  }
}
function buildAuthorizeRequest(input) {
  assertAuthorizeNetwork(input.chainId);
  const controller = address(input.controller, "the agent's controller address");
  const capabilities = capabilityList(input.capabilities);
  const payTo = (input.payTo ?? []).filter((a) => a.trim() !== "").map((a) => address(a, "--pay-to"));
  if (capabilities.includes("pay") && payTo.length === 0) throw bad("the pay capability needs the recipients: --pay-to <address,...> (LSP6 limits who can receive LYX, not how much)");
  if (payTo.length && !capabilities.includes("pay")) capabilities.splice(CAPABILITIES.indexOf("pay"), 0, "pay");
  const caps = CAPABILITIES.filter((c) => capabilities.includes(c));
  const elevated = elevatedList(input.elevated);
  if (!caps.length && !input.allowTargets?.length && !input.allowedKeys?.length && !elevated.length) {
    throw bad("choose what the agent may do on the human's profile (there is no default)", `--for with any of: tokens, nfts, social, profile, pay (with --pay-to), sign; or --allow-targets / --allowed-keys for something specific. Ask the human what you should do for them and request only that.`);
  }
  const calls = [];
  const add = (c) => {
    const checked = checkedCall(c);
    if (!calls.some((x) => sameCall(x, checked))) calls.push(checked);
  };
  if (caps.includes("tokens")) for (const standard of TOKEN_INTERFACE_IDS.lsp7) add({ callTypes: CALLTYPE.CALL, address: WILDCARD_ADDRESS, standard, selector: WILDCARD_BYTES4 });
  if (caps.includes("nfts")) for (const standard of TOKEN_INTERFACE_IDS.lsp8) add({ callTypes: CALLTYPE.CALL, address: WILDCARD_ADDRESS, standard, selector: WILDCARD_BYTES4 });
  if (caps.includes("social")) {
    const registry = lsp26Registry().address;
    for (const f of LSP26_FUNCTIONS) add({ callTypes: CALLTYPE.CALL, address: registry, standard: WILDCARD_BYTES4, selector: f.selector });
  }
  for (const to of payTo) add({ callTypes: CALLTYPE.VALUE, address: to, standard: WILDCARD_BYTES4, selector: WILDCARD_BYTES4 });
  for (const t of input.allowTargets ?? []) add(t);
  if (calls.length > LINK_LIMITS.maxAllowedCalls) throw bad(`at most ${LINK_LIMITS.maxAllowedCalls} allowed calls fit in one authorization link (got ${calls.length})`);
  const keys = [];
  const addKey = (k) => {
    const where = protectedNamespace(k);
    if (where) throw bad(`an agent may never ask to write ${where} (${k})`);
    if (!keys.includes(k)) keys.push(k);
  };
  if (caps.includes("profile")) addKey(DATA_KEYS.LSP3Profile.toLowerCase());
  for (const raw of input.allowedKeys ?? []) {
    if (!raw.trim()) continue;
    let k;
    try {
      k = allowedKeyFor(raw).toLowerCase();
    } catch (e) {
      throw bad(e.message);
    }
    addKey(k);
  }
  if (keys.length > LINK_LIMITS.maxAllowedDataKeys) throw bad(`at most ${LINK_LIMITS.maxAllowedDataKeys} data keys fit in one authorization link (got ${keys.length})`);
  let bits = 0n;
  for (const c of calls) {
    if (c.callTypes & CALLTYPE.CALL) bits |= PERMISSIONS.CALL;
    if (c.callTypes & CALLTYPE.STATICCALL) bits |= PERMISSIONS.STATICCALL;
    if (c.callTypes & CALLTYPE.VALUE) bits |= PERMISSIONS.TRANSFERVALUE;
  }
  if (keys.length) bits |= PERMISSIONS.SETDATA;
  if (caps.includes("sign")) bits |= PERMISSIONS.SIGN;
  for (const e of elevated) bits |= PERMISSIONS[e];
  if (input.relay !== false && (bits & WRITE_BITS) !== 0n) bits |= PERMISSIONS.EXECUTE_RELAY_CALL;
  const profile = input.profile !== void 0 ? address(input.profile, "the profile address") : void 0;
  if (profile && profile === controller) throw bad("the profile address is the agent's controller itself; a profile cannot be its own controller");
  return assemble({
    baseUrl: input.baseUrl ?? AUTHORIZE_WEBSITE,
    chainId: input.chainId,
    controller,
    profile,
    name: linkText(input.name, "the agent name", LINK_LIMITS.maxNameLength),
    purpose: linkText(input.purpose, "the purpose", LINK_LIMITS.maxPurposeLength),
    capabilities: caps,
    bits,
    elevated,
    calls,
    keys
  });
}
function parseAuthorizeUrl(raw, env = process.env) {
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad("--request is not a URL");
  }
  const origin = `${u.protocol}//${u.host}`;
  const local = authorizeBaseUrl(env);
  if (origin !== AUTHORIZE_WEBSITE && origin !== local || u.pathname !== AUTHORIZE_PATH) throw bad(`not an authorization link of ${AUTHORIZE_WEBSITE}/authorize`);
  if (u.hash) throw bad("an authorization link has no #fragment");
  const values = /* @__PURE__ */ new Map();
  for (const [k, v] of u.searchParams) {
    if (!KNOWN_PARAMS.includes(k)) throw bad(`the link has an unknown parameter "${/^[A-Za-z0-9_]{1,40}$/.test(k) ? k : "?"}"`);
    if (values.has(k)) throw bad(`the link repeats the parameter "${k}"`);
    values.set(k, v);
  }
  const controllerRaw = values.get("controller");
  if (!controllerRaw) throw bad("the link has no controller");
  const network = values.get("network");
  if (network !== "mainnet") throw bad(`the link's network "${(network ?? "").slice(0, 20)}" is not supported (mainnet)`);
  const chainId = authorizeDefaultChainId();
  const permissionsRaw = values.get("permissions");
  if (!permissionsRaw) throw bad("the link lists no permissions");
  let bits = 0n;
  const elevated = [];
  for (const name of permissionsRaw.split(",")) {
    if (LINK_REFUSED_PERMISSIONS.includes(name)) throw bad(`the link asks for ${name}, which is never granted through an authorization link`);
    const known = LINK_STANDARD_PERMISSIONS.includes(name) || LINK_ELEVATED_PERMISSIONS.includes(name);
    if (!known) throw bad(`the link asks for an unknown permission "${/^[A-Z0-9_]{1,40}$/.test(name) ? name : "?"}"`);
    const bit = PERMISSIONS[name];
    if ((bits & bit) !== 0n) throw bad(`the link repeats the permission ${name}`);
    bits |= bit;
    if (LINK_ELEVATED_PERMISSIONS.includes(name)) elevated.push(name);
  }
  let calls = [];
  const callsRaw = values.get("allowedCalls");
  if (callsRaw !== void 0) {
    try {
      calls = decodeAllowedCalls(callsRaw);
    } catch (e) {
      throw bad(`the link's allowed calls are malformed: ${e.message}`);
    }
    if (!calls.length || calls.length > LINK_LIMITS.maxAllowedCalls) throw bad(`the link must have 1 to ${LINK_LIMITS.maxAllowedCalls} allowed calls`);
    calls = calls.map((c) => checkedCall(c));
    if (calls.some((c, i) => calls.findIndex((x) => sameCall(x, c)) !== i)) throw bad("the link repeats an allowed call");
  }
  let keys = [];
  const keysRaw = values.get("allowedDataKeys");
  if (keysRaw !== void 0) {
    try {
      keys = decodeAllowedDataKeys(keysRaw).map((k) => k.toLowerCase());
    } catch (e) {
      throw bad(`the link's allowed data keys are malformed: ${e.message}`);
    }
    if (!keys.length || keys.length > LINK_LIMITS.maxAllowedDataKeys) throw bad(`the link must have 1 to ${LINK_LIMITS.maxAllowedDataKeys} allowed data keys`);
    for (const k of keys) {
      const where = protectedNamespace(k);
      if (where) throw bad(`the link asks to write ${where}, which an agent may never do`);
    }
    if (new Set(keys).size !== keys.length) throw bad("the link repeats a data key");
  }
  const controller = address(controllerRaw, "the link's controller");
  const profile = values.has("forProfile") ? address(values.get("forProfile"), "the link's profile") : void 0;
  if (profile && profile === controller) throw bad("the link's controller is the profile itself");
  return assemble({
    baseUrl: origin,
    chainId,
    controller,
    profile,
    name: linkText(values.get("name"), "the link's name", LINK_LIMITS.maxNameLength),
    purpose: linkText(values.get("purpose"), "the link's purpose", LINK_LIMITS.maxPurposeLength),
    capabilities: [],
    bits,
    elevated,
    calls,
    keys
  });
}

// src/lsp/authorize-run.ts
async function profileRole(ctx, profile) {
  const record = await readProfileRecord(ctx.home, profile);
  if (record.deployment) return "own";
  if (record.joined) return "joined";
  return "unknown";
}
function listWords(items) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function humanAsks(req) {
  const asks = req.capabilities.map((c) => CAPABILITY_TEXT[c].human);
  const fromCapabilities = new Set(req.capabilities.filter((c) => c !== "sign" && c !== "profile"));
  const customCalls = req.allowedCalls.entries.length > 0 && fromCapabilities.size === 0;
  if (customCalls) asks.push("call the specific contracts listed on the page");
  const customKeys = req.allowedDataKeys.keys.length > (req.capabilities.includes("profile") ? 1 : 0);
  if (customKeys) asks.push("change the profile data listed on the page");
  if (req.elevated.length) asks.push("have unrestricted access you would have to tick yourself on the page");
  return asks;
}
var NOT_GRANTED = [...LINK_REFUSED_PERMISSIONS];
async function runAuthorizeLink(ctx, a) {
  const cfg = await ctx.config();
  const chainId = a.chain !== void 0 ? ctx.chainId(a.chain) : authorizeDefaultChainId2();
  assertAuthorizeNetwork(chainId);
  const key = controllerFor(cfg, chainId);
  if (!key) {
    throw new UpError2("NO_SIGNER", "this agent has no key yet, so there is no address for the human to authorise", {
      hint: "set up the agent's own key first with the normal setup (up start; inside a cloud agent VM: up start --host dots|muse|vm), then make the link. Never use the human's key or seed phrase."
    });
  }
  const warnings = [];
  let profile;
  if (a.profile !== void 0) {
    profile = await ctx.resolveAddress(a.profile);
    if (await profileRole(ctx, profile) === "own") {
      throw new UpError2("BAD_ARGS", `${profile} is my own profile (I created it); the link is for the human's own profile`, { hint: "ask the human for their profile address, or leave --profile out: the page then uses the profile they connect" });
    }
  }
  let name = a["bot-name"];
  if (name === void 0 && process.env.UP_AGENT_NAME?.trim()) {
    try {
      name = linkText(process.env.UP_AGENT_NAME, "UP_AGENT_NAME", LINK_LIMITS.maxNameLength);
    } catch {
      warnings.push("UP_AGENT_NAME is not a safe display name for the page; the link has no name (pass --bot-name)");
    }
  }
  if (a["allow-targets"] !== void 0 && !Array.isArray(a["allow-targets"])) throw new UpError2("BAD_ARGS", "--allow-targets must be a JSON array");
  const baseUrl = authorizeBaseUrl();
  if (baseUrl !== AUTHORIZE_WEBSITE2) warnings.push(`the link points to a local copy of the website (${baseUrl}, from UP_AUTHORIZE_URL): for testing only; give the human links to ${AUTHORIZE_WEBSITE2} only`);
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
    baseUrl
  });
  if (req.elevated.length) warnings.push(`the link asks for ${req.elevated.join(", ")}: the website shows them unticked with a warning; the human must tick each one deliberately`);
  const media = [];
  let qr = null;
  let saved = null;
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
    `Nothing happens until you approve it in your wallet. Tell me "done" when you have${req.profile ? "" : ", and send me your profile address (the page shows it at the end)"}.`
  ].join("\n");
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
      permissions: { names: req.permissions.names, hex: req.permissions.hex, risk: decodePermissions2(req.permissions.hex).risk, explanation: explainPermissions(req.permissions.hex) },
      elevated: req.elevated,
      restrictions: { allowedCalls: req.allowedCalls, allowedDataKeys: req.allowedDataKeys },
      notGranted: NOT_GRANTED,
      review: [
        "The page shows the full request before the human connects, and blocks the whole link if anything in it is invalid.",
        "The human can untick any permission; they cannot add one. SUPER_* and DEPLOY (if requested) start unticked.",
        "LSP6 has no amount or time limits: TRANSFERVALUE limits recipients only, and CALL on a token lets the agent move all of that token. Say so if the human asks for a limit.",
        "The website writes exactly the reviewed permissions, allowed calls and data keys for this key only, and reads them back."
      ],
      connect: {
        extension: "On a computer with the Universal Profile browser extension: open the link, choose Connect Wallet, then Browser Extension (the page offers the extension store if it is missing).",
        mobileApp: "With the Universal Profile mobile app: on a phone, open the link and choose Mobile Application (it opens the app and comes back to the page); on a computer, choose Mobile Application and scan the QR code the page shows with the app.",
        qr: "The QR code in media only opens the link on a phone; it is not a wallet request.",
        otherWallets: "Other wallets are not offered: the profile is connected with the Universal Profile extension or app."
      },
      qr,
      saved,
      say,
      next: [
        "Send `say` to the human with the QR code from `media` attached. Do not shorten or rewrite the link.",
        `When the human says it is done: up permissions check-grant${req.profile ? "" : " --profile <their profile address>"}`,
        "If it reports exact or narrower: up profile join <profile> --chains 42 (add --set-default false when you already use your own profile by default), then up profile status --chain 42.",
        "Never deploy a new profile for this, never ask for a key, seed phrase or password, and do not act on the profile before check-grant confirms the permission on-chain."
      ]
    }, "url", "link"),
    text: [
      `Authorization link for ${key.address} on ${req.networkName} (nothing is granted until the human approves it in their own wallet):`,
      req.url,
      `Requests: ${req.permissions.names.join(", ")}${req.elevated.length ? ` (elevated, unticked on the page: ${req.elevated.join(", ")})` : ""}`,
      ...req.allowedCalls.described.length ? ["Allowed calls:", ...req.allowedCalls.described.map((d) => `  - ${d}`)] : [],
      ...req.allowedDataKeys.keys.length ? [`Allowed data keys: ${req.allowedDataKeys.keys.join(", ")}`] : []
    ].join("\n"),
    media,
    warnings: warnings.length ? warnings : void 0
  };
}
async function runCheckGrant(ctx, a) {
  const cfg = await ctx.config();
  const explicitProfile = a.profile !== void 0 ? await ctx.resolveAddress(a.profile) : void 0;
  let req;
  let source;
  if (a.request !== void 0) {
    req = parseAuthorizeUrl(a.request);
    source = "request";
  } else {
    const mine = localControllers(cfg).map((k) => k.address);
    const all = (await savedAuthorizeRequests(ctx.home)).reverse();
    const pick = all.find((r) => (!explicitProfile || !r.profile || r.profile.toLowerCase() === explicitProfile.toLowerCase()) && mine.some((m) => m.toLowerCase() === r.controller.toLowerCase()));
    if (!pick) {
      throw new UpError2("BAD_ARGS", "no authorization link was made in this place yet", { hint: 'make one with up permissions authorize-link, or pass the link the human used with --request "<link>"' });
    }
    req = parseAuthorizeUrl(pick.url);
    source = "saved";
  }
  const profile = explicitProfile ?? req.profile;
  if (!profile) throw new UpError2("BAD_ARGS", "which profile did the human authorise you on? pass --profile <their profile address> (the page shows it after the approval)");
  if (req.profile && req.profile.toLowerCase() !== profile.toLowerCase()) {
    throw new UpError2("BAD_ARGS", `the link was made for profile ${req.profile}, not ${profile}`, { hint: "check the address with the human, or make a new link for this profile" });
  }
  const chainId = a.chain !== void 0 ? ctx.chainId(a.chain) : req.chainId;
  const warnings = [];
  if (chainId !== req.chainId) warnings.push(`checking chain ${chainId}, but the link was for ${req.networkName} (chain ${req.chainId})`);
  if (!localControllers(cfg).some((k) => k.address.toLowerCase() === req.controller.toLowerCase())) warnings.push(`the link authorises ${req.controller}, which is not one of this agent's keys`);
  const request = releaseKeys({ url: req.url, permissions: req.permissions.names, allowedCalls: req.allowedCalls.described, allowedDataKeys: req.allowedDataKeys.keys }, "url");
  const base = { chainId, profile, controller: req.controller, source, request };
  if (!await hasCode(ctx, chainId, profile)) {
    return {
      data: { ...base, status: "not-deployed", authorised: false, say: "There's no Universal Profile at that address on this network. Could you check the address on the authorization page?" },
      text: `no contract at ${profile} on chain ${chainId}`,
      warnings: warnings.length ? warnings : void 0
    };
  }
  const km = await resolveKeyManager(ctx, chainId, profile);
  const info = await readControllerPermissions(ctx, chainId, profile, req.controller);
  const granted = km.keyManager ? info.permissions.value : 0n;
  if (!km.keyManager) warnings.push(`${profile} is not owned by an LSP6 Key Manager (owner ${km.owner}, ${km.ownerKind}), so controller permissions do not apply`);
  if (info.problems?.length) warnings.push(...info.problems.map((p) => `stored ${p}`));
  const requested = BigInt(req.permissions.hex);
  const missing = decodePermissions2(requested & ~granted).names;
  const extra = decodePermissions2(granted & ~requested);
  const keyOf = (c) => `${c.callTypes}:${c.address.toLowerCase()}:${c.standard.toLowerCase()}:${c.selector.toLowerCase()}`;
  const reqCalls = new Map(req.allowedCalls.entries.map((c) => [keyOf(c), c]));
  const gotCalls = new Map(info.allowedCalls.map((c) => [keyOf(c), c]));
  const missingCalls = [...reqCalls].filter(([k]) => !gotCalls.has(k)).map(([, c]) => describeAllowedCall2(c));
  const extraCalls = [...gotCalls].filter(([k]) => !reqCalls.has(k)).map(([, c]) => describeAllowedCall2(c));
  const reqKeys = req.allowedDataKeys.keys.map((k) => k.toLowerCase());
  const gotKeys = info.allowedDataKeys.map((k) => k.toLowerCase());
  const missingKeys = reqKeys.filter((k) => !gotKeys.includes(k));
  const extraKeys = gotKeys.filter((k) => !reqKeys.includes(k));
  let status;
  if (granted === 0n) status = "not-authorised";
  else if (extra.names.length || extra.unknownBits.length || extraCalls.length || extraKeys.length || info.problems?.length) status = "broader";
  else if (missing.length || missingCalls.length || missingKeys.length) status = "narrower";
  else status = "exact";
  if ((granted & ~requested & ADMIN_PERMISSIONS) !== 0n) warnings.push(`the profile gives this key control over owners, controllers or permissions (${extra.names.filter((n) => ["CHANGEOWNER", "ADDCONTROLLER", "EDITPERMISSIONS"].includes(n)).join(", ")}), which the link never asked for: tell the human and recommend removing it`);
  if (extra.names.some((n) => n.startsWith("SUPER_"))) warnings.push(`the profile gives this key unrestricted ${extra.names.filter((n) => n.startsWith("SUPER_")).join(", ")}, which the link did not ask for`);
  const ownDefault = cfg.defaultProfile && cfg.defaultProfile.toLowerCase() !== profile.toLowerCase() && await profileRole(ctx, cfg.defaultProfile) === "own";
  const join = `up profile join ${profile} --chains ${chainId}${ownDefault ? " --set-default false" : ""}`;
  const say = {
    exact: `Done: your profile now lets me do exactly what you approved. I can't change owners, controllers or permissions.`,
    narrower: `Done: your profile lets me do part of what I asked${missing.length ? ` (not: ${missing.join(", ")})` : ""}. That's fine; I'll only do what you allowed.`,
    broader: `Your profile gives me more than I asked for${extra.names.length ? `: ${extra.names.join(", ")}` : ""}. I recommend removing that extra access in your Universal Profile app or extension; I'll only use what I asked for.`,
    "not-authorised": "I can't see the permission on your profile yet. If you approved it just now, wait a few seconds and tell me again; otherwise please open the link once more."
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
      next: status === "not-authorised" ? ["Wait for the human, then run this check again. Do not act on the profile and do not make a new link unless the human asks for different permissions."] : [`${join}`, `up profile status --chain ${chainId}`, "This profile belongs to the human: never deploy a new one for it, and keep it apart from your own profile."]
    },
    text: `${status}: ${req.controller} on ${profile} (chain ${chainId}) has ${info.permissions.names.join(", ") || "no permissions"}${missing.length ? `; not granted: ${missing.join(", ")}` : ""}${extra.names.length ? `; more than requested: ${extra.names.join(", ")}` : ""}`,
    warnings: warnings.length ? warnings : void 0
  };
}
export {
  runAuthorizeLink,
  runCheckGrant
};
