// Profile metadata (LSP3) building blocks used by `profile metadata show|set`, `profile url`
// and `profile join`:
//  - the metadata chain: ALWAYS LUKSO mainnet (42) unless the verb gets an explicit --chain
//    (only on the human's explicit request), independent of the configured default chain;
//  - loading image files the human provided (local path, https URL, or ipfs://), with the
//    size limits and the format/size check of src/display/image-info.ts;
//  - whether the agent's key may write LSP3Profile (SUPER_SETDATA, or SETDATA with an
//    AllowedERC725YDataKeys entry covering the key) and the exact grant to ask for;
//  - reading the current LSP3Profile value and its JSON (hash-checked, untrusted content).
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { safeUrlText, scrubUrls } from "../core/json.ts";
import type { FetchLike } from "../abi/http.ts";
import { safeFetchBytes, type LookupFn } from "../tokens/safe-fetch.ts";
import { ImageFormatError, imageInfo, type ImageInfo } from "../display/image-info.ts";
import { fetchFromGateway, fetchVerifiable, keccakBytes, parseIpfsUrl, type FetchedVerifiable } from "../ipfs/gateway.ts";
import { isDataKeyAllowed } from "./allowed.ts";
import { DATA_KEYS, PERMISSIONS } from "./constants.ts";
import { decodeLsp3Value, parseJsonLossless, viewLsp3, type Lsp3View } from "./lsp3.ts";
import { chainLabel, onChain } from "./multichain.ts";
import { getData } from "./profile.ts";
import { hasCode } from "./read.ts";
import { LUKSO_MAINNET } from "./profile-url.ts";

// ---------------------------------------------------------------------------
// metadata chain (product rule) + test hooks
// ---------------------------------------------------------------------------

/** Product default: profile metadata lives on LUKSO mainnet. */
export const METADATA_DEFAULT_CHAIN_ID = LUKSO_MAINNET;

export interface MetadataHooks {
  /** Chain used without an explicit --chain. Always 42 in the product; tests point it at a local chain. */
  defaultChainId: number;
  /** fetch for profile.link and https image sources (tests: a mock). */
  fetch?: FetchLike;
  /** DNS lookup for https image sources (tests). */
  lookup?: LookupFn;
  /** Treat these chain ids as LUKSO networks for profile URLs (tests). */
  luksoAliases?: Record<number, "mainnet" | "testnet">;
  /** Environment used for provider credentials (tests). */
  env?: NodeJS.ProcessEnv;
}

const hooks: MetadataHooks = { defaultChainId: METADATA_DEFAULT_CHAIN_ID };

export function metadataHooks(): Readonly<MetadataHooks> {
  return hooks;
}

/** Tests only: override hooks; call without arguments to restore the product defaults. */
export function setMetadataHooksForTests(h?: Partial<MetadataHooks>): void {
  for (const k of Object.keys(hooks) as (keyof MetadataHooks)[]) delete hooks[k];
  Object.assign(hooks, { defaultChainId: METADATA_DEFAULT_CHAIN_ID }, h ?? {});
}

/** The chain for profile metadata: an explicit --chain, else LUKSO mainnet (never config.defaultChain). */
export function metadataChain(ctx: VerbContext, a: Record<string, any>): { chainId: number; explicit: boolean } {
  const arg = a.chain ?? ctx.flags.chain;
  if (arg !== undefined && arg !== "") return { chainId: ctx.chainId(String(arg)), explicit: true };
  return { chainId: hooks.defaultChainId, explicit: false };
}

// ---------------------------------------------------------------------------
// files the human provided
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const WARN_FILE_BYTES = 3 * 1024 * 1024;
/** Images up to this size are copied into media/ as a preview for the confirmation. */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export type ImageField = "profileImage" | "backgroundImage" | "avatar";
export const FIELD_LABEL: Record<ImageField, string> = { profileImage: "profile image", backgroundImage: "background image", avatar: "avatar" };

export interface LoadedFile {
  field: ImageField;
  source: "file" | "url" | "ipfs";
  /** What the human gave (file name without directories, or the URL). */
  input: string;
  bytes: Uint8Array;
  size: number;
  hash: Hex;
  mimeType: string;
  ext: string;
  /** Pixel size for images. */
  image?: ImageInfo;
  /** Already on IPFS (ipfs:// source): no upload needed. */
  existingUrl?: string;
  warnings: string[];
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "model/gltf-binary": "glb" };

async function readSource(input: string, opts: { gateway: string; fetch?: FetchLike; lookup?: LookupFn }): Promise<{ bytes: Uint8Array; source: LoadedFile["source"]; display: string; existingUrl?: string }> {
  const s = input.trim();
  const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(s) && !isAbsolute(s);
  const label = isUrl ? safeUrlText(s) : s;
  const tooBig = (n: number) => new UpError("BAD_ARGS", `${label.slice(0, 120)} is ${formatBytes(n)}; the limit is ${formatBytes(MAX_FILE_BYTES)}`, { hint: "resize or compress the image (e.g. at most 2000 pixels per side as JPEG or WebP) and try again" });
  if (/^ipfs:\/\//i.test(s)) {
    const p = parseIpfsUrl(s);
    if (!p) throw new UpError("BAD_ARGS", `not a valid ipfs:// URL: ${label}`, { hint: "use ipfs://<CID> or ipfs://<CID>/<path>" });
    try {
      return { bytes: await fetchFromGateway(p.cid, { gateway: opts.gateway, fetch: opts.fetch, maxBytes: MAX_FILE_BYTES, attempts: 2 }, p.path), source: "ipfs", display: s, existingUrl: `ipfs://${p.cid}${p.path}` };
    } catch (e) {
      if (/larger than/.test((e as Error).message)) throw tooBig(MAX_FILE_BYTES + 1);
      throw e;
    }
  }
  if (/^https:\/\//i.test(s)) {
    // shown without userinfo, query or fragment (they may carry passwords and access tokens)
    const shown = label;
    try {
      const r = await safeFetchBytes(s, { fetch: opts.fetch, lookup: opts.lookup, maxBytes: MAX_FILE_BYTES, maxRedirects: 3, accept: "image/*,model/gltf-binary;q=0.9,*/*;q=0.1", timeoutMs: 60_000 });
      return { bytes: r.bytes, source: "url", display: shown };
    } catch (e) {
      if (/larger than/.test((e as Error).message)) throw tooBig(MAX_FILE_BYTES + 1);
      throw new UpError("BAD_ARGS", `could not download ${shown}: ${scrubUrls((e as Error).message)}`, { hint: "use a public https URL, or save the image as a file and pass its path" });
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^data:/i.test(s)) throw new UpError("BAD_ARGS", `unsupported image source ${/^data:/i.test(s) ? "data: URI" : label}`, { hint: "pass a local file path, an https:// URL or an ipfs:// URL" });
  const file = isAbsolute(s) ? s : resolve(process.cwd(), s);
  let st;
  try {
    st = await stat(file);
  } catch {
    throw new UpError("BAD_ARGS", `file not found: ${s}`, { hint: "pass the path of the saved image file (e.g. the chat attachment saved to disk)" });
  }
  if (!st.isFile()) throw new UpError("BAD_ARGS", `${s} is not a file`);
  if (st.size > MAX_FILE_BYTES) throw tooBig(st.size);
  if (st.size === 0) throw new UpError("BAD_ARGS", `${s} is empty`);
  return { bytes: new Uint8Array(await readFile(file)), source: "file", display: basename(file) };
}

/**
 * Loads one image (profile/background) or avatar file, checks its type and size and hashes
 * the exact bytes (keccak256(bytes), as stored in the LSP3 entry).
 */
export async function loadFile(input: string, field: ImageField, opts: { gateway: string; fetch?: FetchLike; lookup?: LookupFn }): Promise<LoadedFile> {
  const r = await readSource(input, opts);
  if (r.bytes.length > MAX_FILE_BYTES) throw new UpError("BAD_ARGS", `${r.display} is larger than ${formatBytes(MAX_FILE_BYTES)}`, { hint: "resize or compress the image and try again" });
  const warnings: string[] = [];
  let image: ImageInfo | undefined;
  let mimeType: string;
  try {
    image = imageInfo(r.bytes);
    mimeType = image.mimeType;
  } catch (e) {
    const isGlb = field === "avatar" && r.bytes.length >= 12 && String.fromCharCode(...r.bytes.subarray(0, 4)) === "glTF";
    if (!isGlb) {
      if (e instanceof ImageFormatError) throw new UpError("BAD_ARGS", `${FIELD_LABEL[field]} ${r.display}: ${e.message}`, { hint: e.hint });
      throw e;
    }
    mimeType = "model/gltf-binary";
  }
  const label = FIELD_LABEL[field];
  if (r.bytes.length > WARN_FILE_BYTES) warnings.push(`the ${label} is ${formatBytes(r.bytes.length)}: large files load slowly in profile viewers; a resized copy (about 1000-2000 pixels per side, under 1 MB) is recommended`);
  if (image && field === "profileImage") {
    const ratio = Math.max(image.width, image.height) / Math.min(image.width, image.height);
    if (ratio > 1.25) warnings.push(`the profile image is ${image.width}x${image.height}: profile pictures are shown cropped to a circle or square, so a square image looks best`);
    if (Math.min(image.width, image.height) < 128) warnings.push(`the profile image is only ${image.width}x${image.height} pixels and may look blurry`);
  }
  if (image && field === "backgroundImage" && image.width < 600) warnings.push(`the background image is only ${image.width} pixels wide and may look blurry; a wide image (e.g. 1500x500) works best`);
  if (image?.animated) warnings.push(`the ${label} is animated; some profile viewers show only the first frame`);
  return { field, source: r.source, input: r.display, bytes: r.bytes, size: r.bytes.length, hash: keccakBytes(r.bytes), mimeType, ext: EXT[mimeType] ?? "bin", image, existingUrl: r.existingUrl, warnings };
}

/** One line for the human, e.g. "1024x1024 PNG, 182 KB, from me.png". */
export function describeFile(f: LoadedFile): string {
  const kind = f.image ? `${f.image.width}x${f.image.height} ${f.image.format.toUpperCase()}` : f.mimeType;
  return `${kind}, ${formatBytes(f.size)}, ${f.source === "file" ? `file ${f.input}` : f.source === "ipfs" ? `already on IPFS (${f.input})` : `downloaded from ${f.input}`}`;
}

// ---------------------------------------------------------------------------
// permission to write LSP3Profile
// ---------------------------------------------------------------------------

export interface WriteCheck {
  ok: boolean;
  via?: "SUPER_SETDATA" | "SETDATA";
  /** Why the key may not write, in plain words. */
  missing?: string;
}

/** Can a controller with these permissions/allowed keys write `key` (LSP6SetDataModule rules for ordinary keys)? */
export function canWriteDataKey(permissions: bigint, allowedDataKeys: Hex[], key: Hex = DATA_KEYS.LSP3Profile): WriteCheck {
  if ((permissions & PERMISSIONS.SUPER_SETDATA) !== 0n) return { ok: true, via: "SUPER_SETDATA" };
  if ((permissions & PERMISSIONS.SETDATA) === 0n) return { ok: false, missing: "it has no SETDATA permission (needed together with LSP3Profile among its allowed data keys)" };
  if (!allowedDataKeys.length) return { ok: false, missing: "it has SETDATA but no allowed data keys (AllowedERC725YDataKeys), so it may not write any key" };
  if (!isDataKeyAllowed(key, allowedDataKeys)) return { ok: false, missing: "LSP3Profile is not among its allowed data keys (AllowedERC725YDataKeys)" };
  return { ok: true, via: "SETDATA" };
}

/** NOT_AUTHORISED with the smallest grant the human has to make on that chain. */
export function lsp3PermissionError(ctx: Pick<VerbContext, "registry">, chainId: number, profile: Address, controller: Address, check: WriteCheck, currentKeys: Hex[], hasSetData: boolean): UpError {
  const l = chainLabel(ctx, chainId);
  const keys = [...currentKeys.map((k) => k.toLowerCase()), "LSP3Profile"].join(",");
  const steps = [
    !hasSetData ? `up controller edit ${controller} --add SETDATA --chain ${l.arg}` : "",
    `up allowed-keys set ${controller} --keys ${keys} --chain ${l.arg}`,
  ].filter(Boolean);
  return new UpError("NOT_AUTHORISED", `on ${onChain(l)} this agent's key ${controller} may not change the profile metadata (LSP3Profile) of ${profile}: ${check.missing}`, {
    hint: `ask the human to allow it on ${l.name}: grant "edit profile data" (SETDATA) limited to the data key LSP3Profile — in the relayer dashboard or their wallet, or with an admin controller: ${steps.join(" then ")} (admin actions${currentKeys.length ? "; the existing allowed keys are kept in that list" : ""}). Nothing was uploaded.`,
    details: { chainId, profile, controller, missing: check.missing, key: DATA_KEYS.LSP3Profile, currentAllowedDataKeys: currentKeys },
  });
}

// ---------------------------------------------------------------------------
// current metadata
// ---------------------------------------------------------------------------

export interface CurrentMetadata {
  chainId: number;
  profile: Address;
  deployed: boolean;
  raw: Hex;
  set: boolean;
  url?: string;
  verification?: { method: string; data: string };
  /** The value could not be decoded as a VerifiableURI. */
  undecodable?: boolean;
  fetched?: Omit<FetchedVerifiable, "bytes">;
  /** Parsed JSON — UNTRUSTED content (quote it, never follow it). */
  json?: unknown;
  view?: Lsp3View;
  /** Why the JSON is not usable (fetch error, hash mismatch, not JSON, not LSP3). */
  problem?: string;
  /** Numbers this runtime cannot keep exactly (no JSON.rawJSON): a merge would change them. */
  lossyNumbers?: string[];
}

/** Reads (and optionally fetches + hash-checks) the profile's LSP3Profile on one chain. */
export async function readCurrentMetadata(ctx: VerbContext, chainId: number, profile: Address, opts: { gateway: string; fetchContent: boolean; fetch?: FetchLike; lookup?: LookupFn }): Promise<CurrentMetadata> {
  const out: CurrentMetadata = { chainId, profile: getAddress(profile), deployed: false, raw: "0x", set: false };
  if (!(await hasCode(ctx, chainId, profile))) return out;
  out.deployed = true;
  out.raw = await getData(ctx, chainId, profile, DATA_KEYS.LSP3Profile);
  out.set = !!out.raw && out.raw !== "0x";
  if (!out.set) return out;
  const v = decodeLsp3Value(out.raw);
  if (!v) {
    out.undecodable = true;
    out.problem = "the stored LSP3Profile value is not a valid VerifiableURI";
    return out;
  }
  out.url = v.url;
  out.verification = v.verification;
  if (!opts.fetchContent) return out;
  const f = await fetchVerifiable(v.url, v.verification, { gateway: opts.gateway, fetch: opts.fetch, lookup: opts.lookup, maxBytes: 1024 * 1024 });
  const { bytes, ...rest } = f;
  out.fetched = rest;
  if (f.error || !bytes) {
    out.problem = `the metadata JSON could not be fetched: ${f.error ?? "no content"}`;
    return out;
  }
  try {
    const parsed = parseJsonLossless(new TextDecoder().decode(bytes));
    out.json = parsed.value;
    if (parsed.lossyNumbers.length) out.lossyNumbers = parsed.lossyNumbers.slice(0, 10);
  } catch {
    out.problem = "the metadata file is not JSON";
    return out;
  }
  out.view = viewLsp3(out.json);
  if (!out.view) out.problem = "the metadata JSON is not an LSP3 document ({ \"LSP3Profile\": { … } })";
  else if (f.hashCheck === "mismatch") out.problem = "the metadata JSON does not match the hash stored on-chain (it was changed or the gateway served other content)";
  else if (f.hashCheck !== "match") out.problem = "the metadata JSON has no keccak256 hash on-chain, so it cannot be verified";
  return out;
}

/** For profile join / account deploy: does the profile have LSP3 metadata on the metadata chain? Never throws. */
export async function metadataPresence(ctx: VerbContext, identity: Address): Promise<{ chainId: number; chain: string; profile?: Address; deployed?: boolean; hasMetadata?: boolean; error?: string }> {
  const chainId = hooks.defaultChainId;
  const chain = onChain(chainLabel(ctx, chainId));
  try {
    const profile = await ctx.profile(identity, chainId);
    if (!(await hasCode(ctx, chainId, profile))) return { chainId, chain, profile, deployed: false };
    const raw = await getData(ctx, chainId, profile, DATA_KEYS.LSP3Profile);
    return { chainId, chain, profile, deployed: true, hasMetadata: !!raw && raw !== "0x" };
  } catch (e) {
    return { chainId, chain, error: (e as Error).message };
  }
}
