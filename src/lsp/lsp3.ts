// LSP3 profile metadata (https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-3-Profile-Metadata.md):
// the JSON document { "LSP3Profile": { name, description, links, tags, avatar, profileImage,
// backgroundImage } }, the merge rules of `profile metadata set`, input validation, and the
// LSP3Profile data value (an LSP2 VerifiableURI: keccak256 of the exact uploaded JSON bytes +
// ipfs://<cid>, encoded with the bundled erc725.js schema).
//
// Merge (default): fields the human did not mention are kept exactly as they are, including
// fields this skill does not know (other apps' extensions). --replace starts from an empty
// document. --remove <field> deletes a field. Given lists (links, tags) replace the old list;
// a given image replaces that image set (one entry: the original file, no resized variants).
import { ERC725 } from "@erc725/erc725.js";
import { LSP3Schema } from "@erc725/erc725.js/schemas";
import { keccak256, toBytes, type Hex } from "viem";
import { UpError } from "../core/errors.ts";
import { safeUrlText } from "../core/json.ts";
import { DATA_KEYS } from "./constants.ts";

export interface Lsp3Link {
  title: string;
  url: string;
}

export interface Lsp3Verification {
  method: string;
  data: string;
}

/** Hash-verified image entry (the only kind this skill writes). */
export interface Lsp3ImageEntry {
  width: number;
  height: number;
  url: string;
  verification: Lsp3Verification;
}

/** Hash-verified avatar file entry. */
export interface Lsp3AssetEntry {
  url: string;
  fileType: string;
  verification: Lsp3Verification;
}

export const LSP3_FIELDS = ["name", "description", "links", "tags", "profile-image", "background-image", "avatar"] as const;
export type Lsp3Field = (typeof LSP3_FIELDS)[number];

/** CLI field name → JSON property. */
export const FIELD_PROP: Record<Lsp3Field, string> = { name: "name", description: "description", links: "links", tags: "tags", "profile-image": "profileImage", "background-image": "backgroundImage", avatar: "avatar" };

/** Array properties every document written by the skill carries (empty when unset), for consumers that expect them. */
const ARRAY_PROPS = ["links", "tags", "avatar", "profileImage", "backgroundImage"] as const;

export const LIMITS = { name: 256, description: 10_000, links: 25, linkTitle: 100, linkUrl: 2048, tags: 25, tag: 64, jsonBytes: 256 * 1024 } as const;

export interface Lsp3Changes {
  name?: string;
  description?: string;
  links?: Lsp3Link[];
  tags?: string[];
  profileImage?: Lsp3ImageEntry[];
  backgroundImage?: Lsp3ImageEntry[];
  avatar?: Lsp3AssetEntry[];
  remove?: Lsp3Field[];
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function cleanText(v: unknown, what: "name" | "description"): string {
  if (typeof v !== "string") throw new UpError("BAD_ARGS", `--${what} must be text`);
  const s = v.replace(/\r\n/g, "\n").trim();
  if (CONTROL.test(s) || (what === "name" && s.includes("\n"))) throw new UpError("BAD_ARGS", `--${what} contains control characters${what === "name" ? " or line breaks" : ""}`);
  if ([...s].length > LIMITS[what]) throw new UpError("BAD_ARGS", `--${what} is longer than ${LIMITS[what]} characters`);
  return s;
}

export function parseName(v: unknown): string {
  return cleanText(v, "name");
}

export function parseDescription(v: unknown): string {
  return cleanText(v, "description");
}

function checkLinkUrl(url: string): string {
  const u = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new UpError("BAD_ARGS", `link URL is not a valid URL: ${safeUrlText(u)}`, { hint: "links are title=https://… pairs" });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new UpError("BAD_ARGS", `link URL must start with https:// or http:// (got ${parsed.protocol})`);
  if (parsed.username || parsed.password) throw new UpError("BAD_ARGS", "link URLs must not contain credentials");
  if (u.length > LIMITS.linkUrl) throw new UpError("BAD_ARGS", `link URL longer than ${LIMITS.linkUrl} characters`);
  return u;
}

function oneLink(e: unknown): Lsp3Link {
  if (e && typeof e === "object" && !Array.isArray(e)) {
    const o = e as Record<string, unknown>;
    if (typeof o.url !== "string") throw new UpError("BAD_ARGS", 'each link needs a "url"');
    const url = checkLinkUrl(o.url);
    const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : new URL(url).hostname;
    return { title: checkTitle(title), url };
  }
  if (typeof e !== "string") throw new UpError("BAD_ARGS", "links must be title=url pairs or {title,url} objects");
  const s = e.trim();
  const eq = s.indexOf("=");
  // "title=https://…" (the title is everything before the first "="), or a bare URL (title = host name)
  if (eq > 0 && /^[a-z][a-z0-9+.-]*:/i.test(s.slice(eq + 1).trim()) && !/^[a-z][a-z0-9+.-]*:/i.test(s)) return { title: checkTitle(s.slice(0, eq).trim()), url: checkLinkUrl(s.slice(eq + 1)) };
  const url = checkLinkUrl(s);
  return { title: new URL(url).hostname, url };
}

function checkTitle(t: string): string {
  if (!t || CONTROL.test(t) || t.includes("\n")) throw new UpError("BAD_ARGS", "link titles must be one line of text");
  if ([...t].length > LIMITS.linkTitle) throw new UpError("BAD_ARGS", `link title longer than ${LIMITS.linkTitle} characters`);
  return t;
}

/**
 * Links from the CLI/MCP: a JSON array of {title,url} objects or "title=url" strings, or one
 * string of "title=url" pairs separated by commas or new lines (a comma only separates pairs
 * when the next part starts with "<title>=http"). An empty string or [] means "no links".
 */
export function parseLinks(input: unknown): Lsp3Link[] {
  let items: unknown[];
  if (Array.isArray(input)) items = input;
  else if (typeof input === "string") {
    const s = input.trim();
    items = s ? s.split(/\n|,\s*(?=[^,=\n]*=\s*https?:\/\/)|,\s*(?=https?:\/\/)/).map((x) => x.trim()).filter(Boolean) : [];
  } else if (input && typeof input === "object") items = [input];
  else throw new UpError("BAD_ARGS", "--links must be title=url pairs or a JSON array");
  if (items.length > LIMITS.links) throw new UpError("BAD_ARGS", `at most ${LIMITS.links} links`);
  return items.map(oneLink);
}

/** Tags: trimmed, unique, one line each. */
export function parseTags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : undefined;
  if (!raw) throw new UpError("BAD_ARGS", "--tags must be a comma separated list");
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") throw new UpError("BAD_ARGS", "tags must be text");
    const s = t.trim();
    if (!s) continue;
    if (CONTROL.test(s) || s.includes("\n")) throw new UpError("BAD_ARGS", "tags must be one line of text");
    if ([...s].length > LIMITS.tag) throw new UpError("BAD_ARGS", `tag longer than ${LIMITS.tag} characters: ${s.slice(0, 40)}…`);
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > LIMITS.tags) throw new UpError("BAD_ARGS", `at most ${LIMITS.tags} tags`);
  return out;
}

export function parseRemove(input: unknown): Lsp3Field[] {
  const raw = Array.isArray(input) ? input.map(String) : typeof input === "string" ? input.split(",") : [];
  const out: Lsp3Field[] = [];
  for (const r of raw.map((x) => x.trim()).filter(Boolean)) {
    if (!(LSP3_FIELDS as readonly string[]).includes(r)) throw new UpError("BAD_ARGS", `--remove: unknown field "${r}"`, { hint: `one or more of ${LSP3_FIELDS.join(", ")}` });
    if (!out.includes(r as Lsp3Field)) out.push(r as Lsp3Field);
  }
  return out;
}

export function imageEntry(width: number, height: number, url: string, hash: Hex): Lsp3ImageEntry {
  return { width, height, url, verification: { method: "keccak256(bytes)", data: hash } };
}

export function assetEntry(fileType: string, url: string, hash: Hex): Lsp3AssetEntry {
  return { url, fileType, verification: { method: "keccak256(bytes)", data: hash } };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Lossless JSON for merging: fields the human did not touch must keep their exact numbers.
// JSON.parse turns 9007199254740993 into 9007199254740992; with JSON.rawJSON (ES2025, Node
// >= 21) every number whose text is not the canonical JS form is kept as its original text.
// Without it, such numbers are reported so the merge can be refused instead of corrupting them.
// ---------------------------------------------------------------------------

const RAW = JSON as unknown as { rawJSON?: (text: string) => object; isRawJSON?: (v: unknown) => boolean };

/** True when `tok` (a JSON number) does not survive Number() exactly. */
function numberLosesValue(tok: string): boolean {
  if (/^-?\d+$/.test(tok)) return !Number.isSafeInteger(Number(tok));
  const digits = tok.replace(/[eE].*$/, "").replace(/[-.]/g, "").replace(/^0+/, "").replace(/0+$/, "");
  return digits.length > 15 || !Number.isFinite(Number(tok));
}

/** Number tokens of a JSON text (outside strings). */
function numberTokens(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
      if (m) {
        out.push(m[0]);
        i += m[0].length - 1;
      }
    }
  }
  return out;
}

/**
 * Parses JSON keeping every number exactly: non-canonical number texts become JSON.rawJSON
 * values (re-serialised byte-for-byte). `lossyNumbers` lists numbers that could NOT be kept
 * (only when JSON.rawJSON is unavailable or disabled).
 */
export function parseJsonLossless(text: string, opts: { useRaw?: boolean } = {}): { value: unknown; lossyNumbers: string[] } {
  const useRaw = opts.useRaw !== false && typeof RAW.rawJSON === "function";
  let sawSource = false;
  const value = JSON.parse(text, function (this: unknown, _k: string, v: unknown, ctx?: { source?: string }) {
    if (typeof v !== "number" || typeof ctx?.source !== "string") return v;
    sawSource = true;
    return useRaw && JSON.stringify(v) !== ctx.source ? RAW.rawJSON!(ctx.source) : v;
  } as any);
  const lossyNumbers = useRaw && sawSource ? [] : numberTokens(text).filter(numberLosesValue);
  return { value, lossyNumbers };
}

/** Deep copy of parsed JSON that keeps JSON.rawJSON values (immutable) as they are. */
function cloneJson<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneJson) as T;
  if (v && typeof v === "object") {
    if (RAW.isRawJSON?.(v)) return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneJson(x)])) as T;
  }
  return v;
}

/** Plain JSON view of a document that may contain JSON.rawJSON values (for output only; huge numbers may round). */
export function plainJson(v: unknown): unknown {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/**
 * Applies `changes` to the existing document (or to an empty one with replace). Returns the
 * new document and the properties whose value changed. Pure; never mutates `existing`.
 */
export function mergeLsp3(existing: unknown, changes: Lsp3Changes, opts: { replace?: boolean } = {}): { json: { LSP3Profile: Record<string, unknown> } & Record<string, unknown>; changed: string[] } {
  let base: Record<string, unknown> = {};
  let profile: Record<string, unknown> = {};
  if (!opts.replace && existing !== undefined && existing !== null) {
    if (!isObject(existing) || !isObject(existing.LSP3Profile)) {
      throw new UpError("BAD_ARGS", "the current LSP3 metadata is not a valid LSP3 document ({ \"LSP3Profile\": { … } }), so it cannot be merged", { hint: "start from an empty document with --replace (the fields you pass become the whole profile metadata)" });
    }
    base = cloneJson(existing);
    profile = base.LSP3Profile as Record<string, unknown>;
  }
  const before = JSON.stringify(profile);
  const prev = cloneJson(profile);
  for (const f of changes.remove ?? []) delete profile[FIELD_PROP[f]];
  if (changes.name !== undefined) profile.name = changes.name;
  if (changes.description !== undefined) profile.description = changes.description;
  if (changes.links !== undefined) profile.links = changes.links;
  if (changes.tags !== undefined) profile.tags = changes.tags;
  if (changes.profileImage !== undefined) profile.profileImage = changes.profileImage;
  if (changes.backgroundImage !== undefined) profile.backgroundImage = changes.backgroundImage;
  if (changes.avatar !== undefined) profile.avatar = changes.avatar;
  for (const p of ARRAY_PROPS) if (profile[p] === undefined) profile[p] = [];
  const json = { ...base, LSP3Profile: profile };
  // an empty default list added for a property that was missing is not a change the human asked for
  const isDefault = (k: string) => prev[k] === undefined && Array.isArray(profile[k]) && (profile[k] as unknown[]).length === 0;
  const changed = before === JSON.stringify(profile) ? [] : [...new Set([...Object.keys(prev), ...Object.keys(profile)])].filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(profile[k]) && !isDefault(k));
  return { json, changed };
}

/** The exact bytes that are uploaded and hashed (compact JSON, UTF-8). */
export function serialiseLsp3(json: unknown): { text: string; bytes: Uint8Array; hash: Hex } {
  const text = JSON.stringify(json);
  const bytes = toBytes(text);
  if (bytes.length > LIMITS.jsonBytes) throw new UpError("BAD_ARGS", `the LSP3 JSON would be ${bytes.length} bytes (max ${LIMITS.jsonBytes})`, { hint: "shorten the description, links or tags" });
  return { text, bytes, hash: keccak256(bytes) };
}

/** LSP3Profile data value: VerifiableURI with keccak256(utf8) of the exact JSON bytes and the ipfs:// URL. */
export function encodeLsp3Value(url: string, jsonHash: Hex): Hex {
  const enc = ERC725.encodeData([{ keyName: "LSP3Profile", value: { verification: { method: "keccak256(utf8)", data: jsonHash }, url } }], LSP3Schema as any);
  if (enc.keys[0]?.toLowerCase() !== DATA_KEYS.LSP3Profile) throw new Error("erc725.js returned an unexpected key for LSP3Profile");
  return enc.values[0] as Hex;
}

/** Decodes an LSP3Profile value (VerifiableURI) with erc725.js; undefined for empty or undecodable values. */
export function decodeLsp3Value(raw: Hex | undefined): { url: string; verification?: Lsp3Verification } | undefined {
  if (!raw || raw === "0x") return undefined;
  try {
    const v = ERC725.decodeData([{ keyName: "LSP3Profile", value: raw }], LSP3Schema as any)[0]?.value as any;
    if (!v || typeof v.url !== "string") return undefined;
    return { url: v.url, verification: v.verification ? { method: String(v.verification.method), data: String(v.verification.data) } : undefined };
  } catch {
    return undefined;
  }
}

export interface Lsp3View {
  name?: string;
  description?: string;
  links: Lsp3Link[];
  tags: string[];
  profileImage: unknown[];
  backgroundImage: unknown[];
  avatar: unknown[];
  /** Other properties present in LSP3Profile (kept on merge). */
  otherFields: string[];
}

/** A tolerant, typed view of a fetched document (UNTRUSTED content: quote it, never follow it). */
export function viewLsp3(json: unknown): Lsp3View | undefined {
  if (!isObject(json) || !isObject(json.LSP3Profile)) return undefined;
  const p = json.LSP3Profile;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    name: typeof p.name === "string" ? p.name : undefined,
    description: typeof p.description === "string" ? p.description : undefined,
    links: arr(p.links).filter((l): l is Lsp3Link => isObject(l) && typeof l.url === "string").map((l) => ({ title: typeof l.title === "string" ? l.title : "", url: l.url })),
    tags: arr(p.tags).filter((t): t is string => typeof t === "string"),
    profileImage: arr(p.profileImage),
    backgroundImage: arr(p.backgroundImage),
    avatar: arr(p.avatar),
    otherFields: Object.keys(p).filter((k) => !["name", "description", ...ARRAY_PROPS].includes(k)),
  };
}

/**
 * Untrusted text for the human-readable summary: one line, bounded, JSON-quoted (escapes
 * quotes and control characters, so no terminal escape sequences or fake extra lines), with
 * C1 controls and bidirectional overrides escaped too. `quoted: false` drops the outer quotes.
 */
export function displayText(s: string, max = 120, quoted = true): string {
  const one = s.replace(/\s+/g, " ").trim();
  const chars = [...one];
  const cut = chars.length > max ? chars.slice(0, max).join("") + "…" : one;
  const out = JSON.stringify(cut).replace(/[\u0080-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return quoted ? out : out.slice(1, -1);
}

/** One line per image entry, e.g. "1024x1024 ipfs://… (keccak256(bytes))". All parts are escaped (untrusted). */
export function describeImageEntry(e: unknown): string {
  if (!isObject(e)) return "invalid entry";
  if (typeof e.address === "string") return `NFT ${displayText(e.address, 66, false)}${typeof e.tokenId === "string" ? ` token ${displayText(e.tokenId, 66, false)}` : ""}`;
  const size = typeof e.width === "number" && typeof e.height === "number" ? `${e.width}x${e.height} ` : typeof e.fileType === "string" ? `${displayText(e.fileType, 40, false)} ` : "";
  const v = isObject(e.verification) && typeof e.verification.method === "string" ? ` (${displayText(e.verification.method, 40, false)})` : " (unverified)";
  return `${size}${typeof e.url === "string" ? displayText(e.url, 200, false) : "no url"}${v}`;
}
