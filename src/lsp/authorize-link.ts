// Authorization link for a HUMAN'S existing Universal Profile, opened on the official website
// https://authorize.universalprofile.cloud/authorize. The agent only proposes: the human connects
// their own profile (Universal Profile browser extension or mobile app), reviews the request and
// approves it in their own wallet. Making a link grants nothing and signs nothing.
//
// The link contract mirrors the website's parser (lukso-network/service-up-authorize-website,
// src/lib/agent-request): controller, network, name, purpose, forProfile, permissions (LSP6 names),
// allowedCalls and allowedDataKeys (the exact LSP6 CompactBytesArray values). Both repositories
// test the same link (test/unit/lsp/authorize-link.test.ts, the website's parse.test.ts).
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { UpError } from "../core/errors.ts";
import { CALLTYPE, DATA_KEYS, PERMISSIONS, WILDCARD_ADDRESS, WILDCARD_BYTES4, type PermissionName } from "./constants.ts";
import {
  decodeAllowedCalls,
  decodeAllowedDataKeys,
  describeAllowedCall,
  encodeAllowedCalls,
  encodeAllowedDataKeys,
  normaliseAllowedCall,
  validateAllowedCall,
  type AllowedCall,
  type AllowedCallInput,
} from "./allowed.ts";
import { decodePermissions, toBytes32, TOKEN_INTERFACE_IDS } from "./permissions.ts";
import { allowedKeyFor } from "./schemas.ts";
import { lsp26Registry } from "../social/lsp26.ts";
import { AUTHORIZE_WEBSITE, CAPABILITIES, authorizeDefaultChainId, authorizeNetwork, type Capability } from "./authorize-site.ts";

const AUTHORIZE_PATH = "/authorize";

export const LINK_LIMITS = { maxNameLength: 48, maxPurposeLength: 200, maxAllowedCalls: 16, maxAllowedDataKeys: 16, maxUrlLength: 4096 } as const;

/** What each capability lets the agent do: `summary` for the agent, `human` for the person. */
export const CAPABILITY_TEXT: Record<Capability, { summary: string; human: string }> = {
  tokens: { summary: "CALL to any contract that reports an LSP7 interface id, any function (use and send every LSP7 token the profile holds)", human: "use and send your tokens" },
  nfts: { summary: "CALL to any contract that reports an LSP8 interface id, any function (use and send every NFT the profile holds)", human: "use and send your NFTs" },
  social: { summary: "CALL to the LSP26 follower registry: follow, unfollow, followBatch, unfollowBatch", human: "follow and unfollow profiles for you" },
  profile: { summary: "SETDATA on the LSP3Profile key only (name, description, pictures, links, tags)", human: "update your profile name, description and pictures" },
  pay: { summary: "TRANSFERVALUE to the listed recipients only (LSP6 limits recipients, not amounts)", human: "send LYX from your profile to the people you named (with no amount limit)" },
  sign: { summary: "SIGN: signatures by the agent's key count as the profile's (ERC-1271 logins, off-chain orders, payment approvals)", human: "sign messages as your profile, for example to log in to apps" },
};

/** Requestable bits the website preselects. */
export const LINK_STANDARD_PERMISSIONS: readonly PermissionName[] = ["CALL", "STATICCALL", "TRANSFERVALUE", "SETDATA", "SIGN", "EXECUTE_RELAY_CALL", "ENCRYPT", "DECRYPT"];
/** Requestable only when the human explicitly asked; the website shows them unticked. */
export const LINK_ELEVATED_PERMISSIONS: readonly PermissionName[] = ["SUPER_CALL", "SUPER_TRANSFERVALUE", "SUPER_STATICCALL", "SUPER_SETDATA", "DEPLOY"];
/** Never through a link (the website refuses the whole link). */
export const LINK_REFUSED_PERMISSIONS: readonly PermissionName[] = [
  "CHANGEOWNER",
  "ADDCONTROLLER",
  "EDITPERMISSIONS",
  "ADDEXTENSIONS",
  "CHANGEEXTENSIONS",
  "ADDUNIVERSALRECEIVERDELEGATE",
  "CHANGEUNIVERSALRECEIVERDELEGATE",
  "REENTRANCY",
  "DELEGATECALL",
  "SUPER_DELEGATECALL",
];

/** LSP26 functions the skill calls (`up follow`, `up unfollow`, `up follow batch`); selectors checked in the tests. */
export const LSP26_FUNCTIONS = [
  { signature: "follow(address)", selector: "0x4dbf27cc" },
  { signature: "unfollow(address)", selector: "0x015a4ead" },
  { signature: "followBatch(address[])", selector: "0xcf8711c8" },
  { signature: "unfollowBatch(address[])", selector: "0x8dd1e47e" },
] as const;

/** ERC725Y namespaces an agent may never ask to write (controllers, delegates, extensions). */
const PROTECTED_PREFIXES: readonly { prefix: string; name: string }[] = [
  { prefix: "0x4b80742de2bf", name: "controller permissions (AddressPermissions:…)" },
  { prefix: "0xdf30dba06db6a30e65354d9a64c60986", name: "the controller list (AddressPermissions[])" },
  { prefix: "0x0cfc51aec37c55a4d0b1", name: "Universal Receiver Delegates (LSP1)" },
  { prefix: "0xcee78b4094da86011096", name: "profile extensions (LSP17)" },
];

/** Code point ranges that are invisible or change text direction (never allowed in names shown to the human). */
const INVISIBLE_RANGES: readonly [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];
const SECRET_RUN = /[0-9a-fA-F]{64}/;
const LINK_TEXT = /[a-z][a-z0-9+.-]*:\/\/|\bwww\./i;
// `forProfile`, not `profile`: an older authorize page reads `profile` + `controller` as its device-import link
// (and preselects broad permissions there); an agent link must never look like one.
const KNOWN_PARAMS = ["controller", "network", "name", "purpose", "forProfile", "permissions", "allowedCalls", "allowedDataKeys"];
/** Any on-chain write power: with one of these the agent also gets EXECUTE_RELAY_CALL (gasless path) unless --no-relay. */
const WRITE_BITS = PERMISSIONS.CALL | PERMISSIONS.TRANSFERVALUE | PERMISSIONS.SETDATA | PERMISSIONS.SUPER_CALL | PERMISSIONS.SUPER_TRANSFERVALUE | PERMISSIONS.SUPER_SETDATA | PERMISSIONS.DEPLOY;

export interface AllowTargetInput extends AllowedCallInput {}

export interface AuthorizeRequestInput {
  /** The agent's own controller address (public). */
  controller: string;
  chainId: number;
  capabilities?: string[];
  payTo?: string[];
  allowTargets?: AllowTargetInput[];
  allowedKeys?: string[];
  /** SUPER_* / DEPLOY, only when the human explicitly asked for them. */
  elevated?: string[];
  /** Add EXECUTE_RELAY_CALL to write permissions (default true). */
  relay?: boolean;
  /** The human's profile, when known. */
  profile?: string;
  name?: string;
  purpose?: string;
  baseUrl?: string;
}

export interface AuthorizeRequest {
  /** The link to give the human. */
  url: string;
  baseUrl: string;
  chainId: number;
  network: "mainnet";
  networkName: string;
  controller: Address;
  profile?: Address;
  name?: string;
  purpose?: string;
  /** Capabilities the request was made from (empty for a parsed link). */
  capabilities: Capability[];
  permissions: { names: PermissionName[]; hex: Hex };
  /** Elevated bits included (shown unticked on the website). */
  elevated: PermissionName[];
  allowedCalls: { encoded: Hex | null; entries: AllowedCall[]; described: string[] };
  allowedDataKeys: { encoded: Hex | null; keys: Hex[] };
}

function bad(message: string, hint?: string): UpError {
  return new UpError("BAD_ARGS", message, hint ? { hint } : undefined);
}

function hasInvisible(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (INVISIBLE_RANGES.some(([a, b]) => cp >= a && cp <= b)) return true;
  }
  return false;
}

/** A display text for the website (agent name, purpose): trimmed, or BAD_ARGS naming the problem. */
export function linkText(value: string | undefined, what: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  if (!t) throw bad(`${what} is empty`);
  if (hasInvisible(t)) throw bad(`${what} contains invisible, control or direction-changing characters`);
  if (LINK_TEXT.test(t)) throw bad(`${what} must not contain a web link`);
  if (SECRET_RUN.test(t)) throw bad(`${what} contains a 64-character hex value; a link never carries keys or hashes`);
  if ([...t].length > max) throw bad(`${what} is longer than ${max} characters`);
  return t;
}

function address(value: string, what: string): Address {
  const s = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s) || !isAddress(s, { strict: false })) throw bad(`${what} is not an address: ${s.slice(0, 50)}`);
  const body = s.slice(2);
  const checksummed = getAddress(s);
  if (/[a-f]/.test(body) && /[A-F]/.test(body) && s !== checksummed) throw bad(`${what} has a wrong EIP-55 checksum (mistyped or altered?)`);
  if (/^0{40}$/.test(body)) throw bad(`${what} is the zero address`);
  if (/^f{40}$/i.test(body)) throw bad(`${what} is the wildcard address`);
  return checksummed;
}

function protectedNamespace(key: string): string | undefined {
  const k = key.toLowerCase();
  return PROTECTED_PREFIXES.find(({ prefix }) => k.startsWith(prefix) || prefix.startsWith(k))?.name;
}

function capabilityList(raw: string[] | undefined): Capability[] {
  const out = new Set<Capability>();
  for (const c of raw ?? []) {
    const name = c.trim().toLowerCase();
    if (!name) continue;
    if (!(CAPABILITIES as readonly string[]).includes(name)) throw bad(`unknown capability "${c}"`, `choose from: ${CAPABILITIES.join(", ")}`);
    out.add(name as Capability);
  }
  return CAPABILITIES.filter((c) => out.has(c));
}

function elevatedList(raw: string[] | undefined): PermissionName[] {
  const out: PermissionName[] = [];
  for (const r of raw ?? []) {
    const name = r.trim().toUpperCase();
    if (!name) continue;
    if ((LINK_REFUSED_PERMISSIONS as readonly string[]).includes(name)) {
      throw bad(`${name} is never granted through an authorization link: it would give control over the profile's owners, controllers, permissions or code`);
    }
    if (!(LINK_ELEVATED_PERMISSIONS as readonly string[]).includes(name)) throw bad(`--elevated accepts only ${LINK_ELEVATED_PERMISSIONS.join(", ")} (got ${name.slice(0, 40)})`);
    if (!out.includes(name as PermissionName)) out.push(name as PermissionName);
  }
  return out;
}

/** The official website, or a local development server set in UP_AUTHORIZE_URL (testing only). */
export function authorizeBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.UP_AUTHORIZE_URL;
  if (raw === undefined || raw.trim() === "") return AUTHORIZE_WEBSITE;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad(`UP_AUTHORIZE_URL is not a URL; authorization links use ${AUTHORIZE_WEBSITE}`);
  }
  const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (!local || u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) {
    throw bad(`UP_AUTHORIZE_URL may only point to a local development copy of the website (http://localhost:<port> or http://127.0.0.1:<port>); authorization links otherwise always use ${AUTHORIZE_WEBSITE}`);
  }
  return `${u.protocol}//${u.host}`;
}

function encodeText(v: string): string {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function assemble(parts: {
  baseUrl: string;
  chainId: number;
  controller: Address;
  profile?: Address;
  name?: string;
  purpose?: string;
  capabilities: Capability[];
  bits: bigint;
  elevated: PermissionName[];
  calls: AllowedCall[];
  keys: Hex[];
}): AuthorizeRequest {
  const net = authorizeNetwork(parts.chainId)!;
  const names = decodePermissions(parts.bits).names;
  const callsHex = parts.calls.length ? encodeAllowedCalls(parts.calls) : null;
  const keysHex = parts.keys.length ? encodeAllowedDataKeys(parts.keys) : null;
  // order: the link always ends with permission names or hex, so chat apps cannot cut off a trailing character
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
    ...(parts.profile ? { profile: parts.profile } : {}),
    ...(parts.name ? { name: parts.name } : {}),
    ...(parts.purpose ? { purpose: parts.purpose } : {}),
    capabilities: parts.capabilities,
    permissions: { names, hex: toBytes32(parts.bits) },
    elevated: parts.elevated,
    allowedCalls: { encoded: callsHex, entries: parts.calls, described: parts.calls.map(describeAllowedCall) },
    allowedDataKeys: { encoded: keysHex, keys: parts.keys },
  };
}

const sameCall = (a: AllowedCall, b: AllowedCall) =>
  a.callTypes === b.callTypes && a.address.toLowerCase() === b.address.toLowerCase() && a.standard.toLowerCase() === b.standard.toLowerCase() && a.selector.toLowerCase() === b.selector.toLowerCase();

function checkedCall(input: AllowedCallInput | AllowedCall): AllowedCall {
  let c: AllowedCall;
  try {
    c = normaliseAllowedCall(input);
  } catch (e) {
    throw bad((e as Error).message);
  }
  if (c.callTypes & CALLTYPE.DELEGATECALL) throw bad("DELEGATECALL is never requested through an authorization link");
  if (c.callTypes & ~(CALLTYPE.VALUE | CALLTYPE.CALL | CALLTYPE.STATICCALL)) throw bad("an allowed call uses an unknown call type");
  const v = validateAllowedCall(c);
  if (v.errors.length) throw bad(v.errors.join("; "));
  if (/^0x0{40}$/i.test(c.address)) throw bad("an allowed call targets the zero address");
  return c;
}

/** NOT_SUPPORTED for chains the website cannot authorize on, with the manual hand-over as the next step. */
export function assertAuthorizeNetwork(chainId: number): void {
  if (!authorizeNetwork(chainId)) {
    throw new UpError("NOT_SUPPORTED", `the authorization website works on LUKSO mainnet (chain 42) only; there is no authorization link for chain ${chainId}`, {
      hint: `on that network give the human the permissions to add in their own app: up permissions recommend --chain ${chainId}`,
    });
  }
}

/** Builds the authorization request and its link. Throws UpError BAD_ARGS / NOT_SUPPORTED; reads no key. */
export function buildAuthorizeRequest(input: AuthorizeRequestInput): AuthorizeRequest {
  assertAuthorizeNetwork(input.chainId);
  const controller = address(input.controller, "the agent's controller address");
  const capabilities = capabilityList(input.capabilities);
  const payTo = (input.payTo ?? []).filter((a) => a.trim() !== "").map((a) => address(a, "--pay-to"));
  if (capabilities.includes("pay") && payTo.length === 0) throw bad("the pay capability needs the recipients: --pay-to <address,...> (LSP6 limits who can receive LYX, not how much)");
  if (payTo.length && !capabilities.includes("pay")) capabilities.splice(CAPABILITIES.indexOf("pay"), 0, "pay");
  const caps = CAPABILITIES.filter((c) => capabilities.includes(c));
  const elevated = elevatedList(input.elevated);

  if (!caps.length && !(input.allowTargets?.length) && !(input.allowedKeys?.length) && !elevated.length) {
    throw bad("choose what the agent may do on the human's profile (there is no default)", `--for with any of: tokens, nfts, social, profile, pay (with --pay-to), sign; or --allow-targets / --allowed-keys for something specific. Ask the human what you should do for them and request only that.`);
  }

  const calls: AllowedCall[] = [];
  const add = (c: AllowedCallInput | AllowedCall) => {
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

  const keys: Hex[] = [];
  const addKey = (k: Hex) => {
    const where = protectedNamespace(k);
    if (where) throw bad(`an agent may never ask to write ${where} (${k})`);
    if (!keys.includes(k)) keys.push(k);
  };
  if (caps.includes("profile")) addKey(DATA_KEYS.LSP3Profile.toLowerCase() as Hex);
  for (const raw of input.allowedKeys ?? []) {
    if (!raw.trim()) continue;
    let k: Hex;
    try {
      k = allowedKeyFor(raw).toLowerCase() as Hex;
    } catch (e) {
      throw bad((e as Error).message);
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

  const profile = input.profile !== undefined ? address(input.profile, "the profile address") : undefined;
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
    keys,
  });
}

/**
 * Parses and validates an authorization link (one this agent made, or one handed back to it).
 * Only links to the official website (or the local override in UP_AUTHORIZE_URL) are accepted,
 * with the same rules the website applies. Throws BAD_ARGS naming the problem.
 */
export function parseAuthorizeUrl(raw: string, env: Record<string, string | undefined> = process.env): AuthorizeRequest {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad("--request is not a URL");
  }
  const origin = `${u.protocol}//${u.host}`;
  const local = authorizeBaseUrl(env);
  if ((origin !== AUTHORIZE_WEBSITE && origin !== local) || u.pathname !== AUTHORIZE_PATH) throw bad(`not an authorization link of ${AUTHORIZE_WEBSITE}/authorize`);
  if (u.hash) throw bad("an authorization link has no #fragment");

  const values = new Map<string, string>();
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
  const elevated: PermissionName[] = [];
  for (const name of permissionsRaw.split(",")) {
    if ((LINK_REFUSED_PERMISSIONS as readonly string[]).includes(name)) throw bad(`the link asks for ${name}, which is never granted through an authorization link`);
    const known = (LINK_STANDARD_PERMISSIONS as readonly string[]).includes(name) || (LINK_ELEVATED_PERMISSIONS as readonly string[]).includes(name);
    if (!known) throw bad(`the link asks for an unknown permission "${/^[A-Z0-9_]{1,40}$/.test(name) ? name : "?"}"`);
    const bit = PERMISSIONS[name as PermissionName];
    if ((bits & bit) !== 0n) throw bad(`the link repeats the permission ${name}`);
    bits |= bit;
    if ((LINK_ELEVATED_PERMISSIONS as readonly string[]).includes(name)) elevated.push(name as PermissionName);
  }

  let calls: AllowedCall[] = [];
  const callsRaw = values.get("allowedCalls");
  if (callsRaw !== undefined) {
    try {
      calls = decodeAllowedCalls(callsRaw as Hex);
    } catch (e) {
      throw bad(`the link's allowed calls are malformed: ${(e as Error).message}`);
    }
    if (!calls.length || calls.length > LINK_LIMITS.maxAllowedCalls) throw bad(`the link must have 1 to ${LINK_LIMITS.maxAllowedCalls} allowed calls`);
    calls = calls.map((c) => checkedCall(c));
    if (calls.some((c, i) => calls.findIndex((x) => sameCall(x, c)) !== i)) throw bad("the link repeats an allowed call");
  }
  let keys: Hex[] = [];
  const keysRaw = values.get("allowedDataKeys");
  if (keysRaw !== undefined) {
    try {
      keys = decodeAllowedDataKeys(keysRaw as Hex).map((k) => k.toLowerCase() as Hex);
    } catch (e) {
      throw bad(`the link's allowed data keys are malformed: ${(e as Error).message}`);
    }
    if (!keys.length || keys.length > LINK_LIMITS.maxAllowedDataKeys) throw bad(`the link must have 1 to ${LINK_LIMITS.maxAllowedDataKeys} allowed data keys`);
    for (const k of keys) {
      const where = protectedNamespace(k);
      if (where) throw bad(`the link asks to write ${where}, which an agent may never do`);
    }
    if (new Set(keys).size !== keys.length) throw bad("the link repeats a data key");
  }

  const controller = address(controllerRaw, "the link's controller");
  const profile = values.has("forProfile") ? address(values.get("forProfile")!, "the link's profile") : undefined;
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
    keys,
  });
}
