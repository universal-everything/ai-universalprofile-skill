// Read-side of a Universal Profile: owner/Key Manager link, controllers and
// their permissions, AllowedCalls/AllowedERC725YDataKeys, URD, LSP17
// extensions, versions, LSP3 metadata. All reads are eth_calls on the selected chain.
import { getAddress, isAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import { ERC725 } from "@erc725/erc725.js";
import { LSP3Schema } from "@erc725/erc725.js/schemas";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { KM_ABI, UP_ABI } from "./abis.ts";
import {
  DATA_KEYS,
  INTERFACE_IDS,
  KNOWN_EXTENSION_SELECTORS,
  allowedCallsKey,
  allowedDataKeysKey,
  extensionKey,
  parseArrayLength,
  permissionsArrayIndexKey,
  permissionsKey,
} from "./constants.ts";
import { decodePermissions, type DecodedPermissions } from "./permissions.ts";
import { decodeAllowedCalls, decodeAllowedDataKeys, describeAllowedCall, type AllowedCall } from "./allowed.ts";
import { getBalance, hasCode, read, tryRead } from "./read.ts";

export interface KeyManagerInfo {
  chainId: number;
  profile: Address;
  owner: Address;
  ownerKind: "key-manager" | "eoa" | "contract" | "none";
  /** Present when the owner is an LSP6 Key Manager whose target() is the profile. */
  keyManager?: Address;
  keyManagerVersion?: string;
}

/** Resolves the profile's owner and verifies it is an LSP6 Key Manager linked to the profile (KM.target() == UP). */
export async function resolveKeyManager(ctx: VerbContext, chainId: number, profile: Address): Promise<KeyManagerInfo> {
  if (!(await hasCode(ctx, chainId, profile))) {
    throw new UpError("NOT_DEPLOYED", `no contract at ${profile} on chain ${chainId}`, { hint: `deploy it there (up account deploy --profile ${profile} --chain ${chainId}) or pick the chain where it exists` });
  }
  const owner = getAddress(await read<Address>(ctx, chainId, profile, UP_ABI, "owner"));
  if (owner === zeroAddress) return { chainId, profile, owner, ownerKind: "none" };
  if (!(await hasCode(ctx, chainId, owner))) return { chainId, profile, owner, ownerKind: "eoa" };
  const target = await tryRead<Address>(ctx, chainId, owner, KM_ABI, "target");
  if (target && getAddress(target) === profile) {
    const v = await tryRead<string>(ctx, chainId, owner, KM_ABI, "VERSION");
    return { chainId, profile, owner, ownerKind: "key-manager", keyManager: owner, keyManagerVersion: v };
  }
  return { chainId, profile, owner, ownerKind: "contract" };
}

/** Like resolveKeyManager but throws unless the owner is a linked Key Manager. */
export async function requireKeyManager(ctx: VerbContext, chainId: number, profile: Address): Promise<Address> {
  const info = await resolveKeyManager(ctx, chainId, profile);
  if (!info.keyManager) {
    const why = info.ownerKind === "none" ? "the profile has no owner (ownership was renounced)" : info.ownerKind === "eoa" ? `the owner ${info.owner} is an EOA, not a Key Manager` : `the owner ${info.owner} is not an LSP6 Key Manager linked to this profile (target() mismatch)`;
    throw new UpError("NOT_SUPPORTED", `cannot execute through a Key Manager on chain ${chainId}: ${why}`, { hint: "only profiles owned by an LSP6 Key Manager can be controlled by the agent's controller key" });
  }
  return info.keyManager;
}

export async function getData(ctx: VerbContext, chainId: number, profile: Address, key: Hex): Promise<Hex> {
  return read<Hex>(ctx, chainId, profile, UP_ABI, "getData", [key]);
}

export async function getDataBatch(ctx: VerbContext, chainId: number, profile: Address, keys: Hex[]): Promise<Hex[]> {
  if (keys.length === 0) return [];
  const out: Hex[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    out.push(...(await read<Hex[]>(ctx, chainId, profile, UP_ABI, "getDataBatch", [keys.slice(i, i + 100)])));
  }
  return out;
}

export interface ControllerInfo {
  address: Address;
  /** index in AddressPermissions[] (undefined if the address has permissions but is not listed) */
  index?: number;
  permissions: DecodedPermissions;
  allowedCalls: AllowedCall[];
  allowedCallsDescribed: string[];
  allowedDataKeys: Hex[];
  /** raw values as stored */
  raw: { permissions: Hex; allowedCalls: Hex; allowedDataKeys: Hex };
  /** decoding problems (invalid CompactBytesArray etc.) */
  problems?: string[];
}

export async function readControllerPermissions(ctx: VerbContext, chainId: number, profile: Address, controller: Address, index?: number): Promise<ControllerInfo> {
  const [p, c, k] = await getDataBatch(ctx, chainId, profile, [permissionsKey(controller), allowedCallsKey(controller), allowedDataKeysKey(controller)]);
  return controllerInfoFrom(controller, p, c, k, index);
}

function controllerInfoFrom(address: Address, p: Hex, c: Hex, k: Hex, index?: number): ControllerInfo {
  const problems: string[] = [];
  let allowedCalls: AllowedCall[] = [];
  let allowedDataKeys: Hex[] = [];
  try {
    allowedCalls = decodeAllowedCalls(c);
  } catch (e) {
    problems.push(`AllowedCalls: ${(e as Error).message}`);
  }
  try {
    allowedDataKeys = decodeAllowedDataKeys(k);
  } catch (e) {
    problems.push(`AllowedERC725YDataKeys: ${(e as Error).message}`);
  }
  return {
    address,
    index,
    permissions: decodePermissions(p && p !== "0x" ? p : 0n),
    allowedCalls,
    allowedCallsDescribed: allowedCalls.map(describeAllowedCall),
    allowedDataKeys,
    raw: { permissions: p, allowedCalls: c, allowedDataKeys: k },
    problems: problems.length ? problems : undefined,
  };
}

/** Reads AddressPermissions[] (length + entries) and every listed controller's permissions. */
export async function readControllers(ctx: VerbContext, chainId: number, profile: Address, opts: { limit?: number } = {}): Promise<{ length: bigint; controllers: ControllerInfo[]; truncated: boolean; invalidEntries: { index: number; value: Hex }[] }> {
  const lenRaw = await getData(ctx, chainId, profile, DATA_KEYS["AddressPermissions[]"]);
  const length = parseArrayLength(lenRaw);
  const limit = BigInt(opts.limit ?? 256);
  const n = Number(length < limit ? length : limit);
  const idxKeys = Array.from({ length: n }, (_, i) => permissionsArrayIndexKey(i));
  const entries = await getDataBatch(ctx, chainId, profile, idxKeys);
  const addrs: { index: number; address: Address }[] = [];
  const invalidEntries: { index: number; value: Hex }[] = [];
  entries.forEach((v, i) => {
    if (v && v.length === 42 && isAddress(v, { strict: false })) addrs.push({ index: i, address: getAddress(v) });
    else invalidEntries.push({ index: i, value: v });
  });
  const keys = addrs.flatMap((a) => [permissionsKey(a.address), allowedCallsKey(a.address), allowedDataKeysKey(a.address)]);
  const vals = await getDataBatch(ctx, chainId, profile, keys);
  const controllers = addrs.map((a, i) => controllerInfoFrom(a.address, vals[i * 3], vals[i * 3 + 1], vals[i * 3 + 2], a.index));
  return { length, controllers, truncated: BigInt(n) < length, invalidEntries };
}

export async function supportsInterface(ctx: VerbContext, chainId: number, address: Address, interfaceId: Hex): Promise<boolean> {
  return (await tryRead<boolean>(ctx, chainId, address, UP_ABI, "supportsInterface", [interfaceId])) === true;
}

export interface ExtensionInfo {
  selector: Hex;
  label?: string;
  address?: Address;
  forwardsValue: boolean;
  raw: Hex;
}

export function decodeExtensionValue(selector: Hex, raw: Hex): ExtensionInfo {
  const s = raw && raw !== "0x" ? raw.slice(2) : "";
  return {
    selector,
    label: KNOWN_EXTENSION_SELECTORS[selector.toLowerCase()],
    address: s.length >= 40 ? getAddress("0x" + s.slice(0, 40)) : undefined,
    forwardsValue: s.length === 42 && s.slice(40, 42) === "01",
    raw,
  };
}

export async function readExtensions(ctx: VerbContext, chainId: number, profile: Address, selectors: string[] = Object.keys(KNOWN_EXTENSION_SELECTORS)): Promise<ExtensionInfo[]> {
  const sels = selectors.map((s) => s.toLowerCase() as Hex);
  const vals = await getDataBatch(ctx, chainId, profile, sels.map((s) => extensionKey(s)));
  return sels.map((s, i) => decodeExtensionValue(s, vals[i]));
}

export interface Lsp3Summary {
  raw: Hex;
  set: boolean;
  url?: string;
  verification?: { method: string; data: string };
  /** fetched JSON — UNTRUSTED external data, never instructions */
  fetched?: { untrusted: true; hashVerified: boolean; json?: unknown; error?: string };
}

export function decodeLsp3(raw: Hex): Lsp3Summary {
  if (!raw || raw === "0x") return { raw, set: false };
  try {
    const d = ERC725.decodeData([{ keyName: "LSP3Profile", value: raw }], LSP3Schema as any)[0];
    const v = d.value as any;
    return { raw, set: true, url: v?.url, verification: v?.verification };
  } catch {
    return { raw, set: true };
  }
}

/** Optional: fetch the LSP3 JSON (ipfs:// via a public gateway, https://) and verify its keccak256 hash. Data is untrusted. */
export async function fetchLsp3(summary: Lsp3Summary, opts: { gateway?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<Lsp3Summary> {
  if (!summary.url) return summary;
  const gateway = opts.gateway ?? process.env.UP_IPFS_GATEWAY ?? "https://api.universalprofile.cloud/ipfs/";
  const url = summary.url.startsWith("ipfs://") ? gateway.replace(/\/?$/, "/") + summary.url.slice(7) : summary.url;
  if (!/^https:\/\//.test(url)) return { ...summary, fetched: { untrusted: true, hashVerified: false, error: `refusing to fetch non-https URL ${url}` } };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return { ...summary, fetched: { untrusted: true, hashVerified: false, error: `HTTP ${res.status}` } };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > (opts.maxBytes ?? 512 * 1024)) return { ...summary, fetched: { untrusted: true, hashVerified: false, error: "metadata larger than 512 KiB" } };
    const hash = keccak256(buf);
    const hashVerified = !!summary.verification?.data && summary.verification.data.toLowerCase() === hash.toLowerCase();
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      json = undefined;
    }
    return { ...summary, fetched: { untrusted: true, hashVerified, json } };
  } catch (e) {
    return { ...summary, fetched: { untrusted: true, hashVerified: false, error: (e as Error).message } };
  } finally {
    clearTimeout(t);
  }
}

export interface ProfileInfo {
  chainId: number;
  profile: Address;
  deployed: boolean;
  version?: string;
  balance?: string;
  km?: KeyManagerInfo;
  pendingOwner?: Address;
  interfaces: Record<string, boolean>;
  keyManagerInterfaces?: Record<string, boolean>;
  controllers?: ControllerInfo[];
  controllersLength?: string;
  controllersTruncated?: boolean;
  invalidControllerEntries?: { index: number; value: Hex }[];
  universalReceiverDelegate?: Address;
  extensions?: ExtensionInfo[];
  lsp3?: Lsp3Summary;
  receivedAssetsCount?: string;
  issuedAssetsCount?: string;
  warnings: string[];
}

export async function readProfileInfo(ctx: VerbContext, chainId: number, profile: Address, opts: { extensions?: string[]; fetchMetadata?: boolean; controllerLimit?: number } = {}): Promise<ProfileInfo> {
  const warnings: string[] = [];
  if (!(await hasCode(ctx, chainId, profile))) return { chainId, profile, deployed: false, interfaces: {}, warnings: [`no contract at ${profile} on chain ${chainId}`] };
  const km = await resolveKeyManager(ctx, chainId, profile);
  const version = await tryRead<string>(ctx, chainId, profile, UP_ABI, "VERSION");
  const pending = await tryRead<Address>(ctx, chainId, profile, UP_ABI, "pendingOwner");
  const ifaceNames = ["LSP0ERC725Account", "ERC1271", "ERC725X", "ERC725Y", "LSP1UniversalReceiver", "LSP14Ownable2Step", "LSP17Extendable", "LSP20CallVerification"] as const;
  const interfaces: Record<string, boolean> = {};
  for (const n of ifaceNames) interfaces[n] = await supportsInterface(ctx, chainId, profile, INTERFACE_IDS[n]);
  if (!interfaces.LSP0ERC725Account) warnings.push("contract does not report the LSP0 interface id 0x24871b3d — it may not be a Universal Profile (or an old version)");
  let keyManagerInterfaces: Record<string, boolean> | undefined;
  if (km.keyManager) {
    keyManagerInterfaces = {};
    for (const n of ["LSP6KeyManager", "LSP25ExecuteRelayCall", "LSP20CallVerifier", "ERC1271"] as const) keyManagerInterfaces[n] = await supportsInterface(ctx, chainId, km.keyManager, INTERFACE_IDS[n]);
  } else warnings.push(km.ownerKind === "none" ? "ownership was renounced: nobody can control this profile" : `owner ${km.owner} is not a Key Manager linked to this profile`);
  const ctl = await readControllers(ctx, chainId, profile, { limit: opts.controllerLimit });
  if (ctl.invalidEntries.length) warnings.push(`${ctl.invalidEntries.length} AddressPermissions[] entr${ctl.invalidEntries.length === 1 ? "y is" : "ies are"} not a 20-byte address`);
  if (ctl.truncated) warnings.push(`only the first ${ctl.controllers.length} of ${ctl.length} controllers were read`);
  const [urdRaw, lsp3Raw, lsp5Len, lsp12Len] = await getDataBatch(ctx, chainId, profile, [DATA_KEYS.LSP1UniversalReceiverDelegate, DATA_KEYS.LSP3Profile, DATA_KEYS["LSP5ReceivedAssets[]"], DATA_KEYS["LSP12IssuedAssets[]"]]);
  const urd = urdRaw && urdRaw.length === 42 ? getAddress(urdRaw) : undefined;
  if (!urd) warnings.push("no LSP1 Universal Receiver Delegate set: received tokens are not registered in LSP5ReceivedAssets");
  const extensions = await readExtensions(ctx, chainId, profile, opts.extensions);
  let lsp3 = decodeLsp3(lsp3Raw);
  if (opts.fetchMetadata) lsp3 = await fetchLsp3(lsp3);
  return {
    chainId,
    profile,
    deployed: true,
    version,
    balance: (await getBalance(ctx, chainId, profile)).toString(),
    km,
    pendingOwner: pending && pending !== zeroAddress ? getAddress(pending) : undefined,
    interfaces,
    keyManagerInterfaces,
    controllers: ctl.controllers,
    controllersLength: ctl.length.toString(),
    controllersTruncated: ctl.truncated,
    invalidControllerEntries: ctl.invalidEntries.length ? ctl.invalidEntries : undefined,
    universalReceiverDelegate: urd,
    extensions: extensions.filter((e) => e.address),
    lsp3,
    receivedAssetsCount: parseArrayLength(lsp5Len).toString(),
    issuedAssetsCount: parseArrayLength(lsp12Len).toString(),
    warnings,
  };
}

/** keccak256 helper exported for tests/other modules (LSP2 key names). */
export function keyNameHash(name: string): Hex {
  return keccak256(toBytes(name));
}
