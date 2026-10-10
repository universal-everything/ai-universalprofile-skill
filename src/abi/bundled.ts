// Catalog of the ABIs bundled with the skill (assets/abis, pinned with
// provenance in assets/abis/PROVENANCE.json):
//   lsp/<Contract>.json          LSP/ERC725 contracts from the published packages
//   reference/<Name>.json        ERC-20/721/1155/165/1271/4626, Multicall3, EntryPoint v0.6, Permit2, …
//   deployed/ABI-<Name>[-vX-Y-Z].json  ABIs of the deployed canonical implementations
// Also the reverse indexes (selector → function/error, topic → event) used by
// the decoders and the "bundled" rung of selector lookups.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Abi, AbiEvent, AbiFunction, Address } from "viem";
import { assetJson, assetsDir } from "../core/assets.ts";
import { UpError } from "../core/errors.ts";
import { canonicalSignature, selectorOf, topicOf, type AbiError } from "./signature.ts";

export interface BundledAbiEntry {
  /** Catalog name, e.g. "LSP7DigitalAsset", "ERC20", "UniversalProfileInit@0.14.0". */
  name: string;
  /** Path relative to assets/abis. */
  file: string;
  group: "lsp" | "reference" | "deployed";
  /** Upstream package/version where recorded. */
  package?: string;
  version?: string;
}

let catalogCache: Map<string, BundledAbiEntry> | undefined;

function deployedName(file: string): { name: string; version?: string } {
  // ABI-UniversalProfileInit-v0-14-0.json → UniversalProfileInit@0.14.0
  const base = file.replace(/^ABI-/, "").replace(/\.json$/, "");
  const m = /^(.*)-v(\d+)-(\d+)-(\d+)$/.exec(base);
  if (m) return { name: `${m[1]}@${m[2]}.${m[3]}.${m[4]}`, version: `${m[2]}.${m[3]}.${m[4]}` };
  return { name: `${base}@deployed` };
}

export function bundledCatalog(): Map<string, BundledAbiEntry> {
  if (catalogCache) return catalogCache;
  const map = new Map<string, BundledAbiEntry>();
  const dir = join(assetsDir(), "abis");
  for (const group of ["lsp", "reference", "deployed"] as const) {
    const d = join(dir, group);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith(".json")).sort()) {
      if (group === "deployed") {
        const { name, version } = deployedName(f);
        map.set(name.toLowerCase(), { name, file: `${group}/${f}`, group, version });
      } else {
        const raw = assetJson<any>("abis", group, f);
        const name = typeof raw?.contractName === "string" ? raw.contractName : f.replace(/\.json$/, "");
        map.set(name.toLowerCase(), { name, file: `${group}/${f}`, group, package: raw?.package, version: raw?.packageVersion });
      }
    }
  }
  return (catalogCache = map);
}

/** Short aliases agents commonly use. */
const ALIASES: Record<string, string> = {
  lsp0: "UniversalProfile",
  up: "UniversalProfile",
  universalprofile: "UniversalProfile",
  erc725account: "LSP0ERC725Account",
  lsp6: "LSP6KeyManager",
  keymanager: "LSP6KeyManager",
  km: "LSP6KeyManager",
  lsp7: "LSP7DigitalAsset",
  lsp8: "LSP8IdentifiableDigitalAsset",
  lsp9: "LSP9Vault",
  lsp26: "LSP26FollowerSystem",
  lsp23: "LSP23LinkedContractsFactory",
  erc20: "ERC20",
  erc721: "ERC721",
  erc1155: "ERC1155",
  erc165: "ERC165",
  erc1271: "ERC1271",
  erc4626: "ERC4626",
  multicall: "Multicall3",
  entrypoint: "EntryPointV06",
  weth: "WETH9",
};

export function findBundled(name: string): BundledAbiEntry | undefined {
  const cat = bundledCatalog();
  const key = name.trim().replace(/\.json$/i, "").replace(/^(lsp|reference|deployed)\//i, "").toLowerCase();
  return cat.get(key) ?? cat.get((ALIASES[key] ?? "").toLowerCase());
}

/** Loads a bundled ABI by catalog name or alias; throws ABI_NOT_FOUND with suggestions otherwise. */
export function bundledAbi(name: string): Abi {
  const e = findBundled(name);
  if (!e) {
    const q = name.toLowerCase();
    const near = [...bundledCatalog().values()].map((x) => x.name).filter((n) => n.toLowerCase().includes(q.slice(0, 5))).slice(0, 8);
    throw new UpError("ABI_NOT_FOUND", `no bundled ABI named "${name}"`, { hint: near.length ? `did you mean: ${near.join(", ")}` : "list bundled ABIs with: up abi bundled" });
  }
  return loadEntry(e);
}

export function loadEntry(e: BundledAbiEntry): Abi {
  const raw = assetJson<any>("abis", ...e.file.split("/"));
  return (Array.isArray(raw) ? raw : raw.abi) as Abi;
}

// ---------------------------------------------------------------------------
// Reverse indexes over every bundled ABI (+ assets/abis/selectors.json, errors.json)
// ---------------------------------------------------------------------------

export interface IndexedItem<T> {
  signature: string;
  item: T;
  /** Bundled contracts that declare this item. */
  contracts: string[];
}

interface Indexes {
  functions: Map<string, IndexedItem<AbiFunction>[]>;
  errors: Map<string, IndexedItem<AbiError>[]>;
  events: Map<string, IndexedItem<AbiEvent>[]>;
}

let indexCache: Indexes | undefined;

/** Events with the same signature can differ in which inputs are indexed (ERC-20 vs ERC-721 Transfer). */
function variantKey(item: AbiFunction | AbiError | AbiEvent): string {
  const sig = canonicalSignature(item);
  return item.type === "event" ? `${sig}|${item.inputs.map((i) => ((i as { indexed?: boolean }).indexed ? "1" : "0")).join("")}` : sig;
}

function add<T extends AbiFunction | AbiError | AbiEvent>(map: Map<string, IndexedItem<T>[]>, key: string, item: T, contract: string) {
  const sig = canonicalSignature(item);
  const list = map.get(key) ?? [];
  const existing = list.find((x) => variantKey(x.item) === variantKey(item));
  if (existing) {
    if (!existing.contracts.includes(contract)) existing.contracts.push(contract);
    // prefer the variant with parameter names
    if (!hasNames(existing.item) && hasNames(item)) existing.item = item;
  } else list.push({ signature: sig, item, contracts: [contract] });
  map.set(key, list);
}

function hasNames(item: AbiFunction | AbiError | AbiEvent): boolean {
  return item.inputs.every((i) => !!i.name);
}

export function bundledIndexes(): Indexes {
  if (indexCache) return indexCache;
  const idx: Indexes = { functions: new Map(), errors: new Map(), events: new Map() };
  for (const e of bundledCatalog().values()) {
    for (const item of loadEntry(e)) {
      if (item.type === "function") add(idx.functions, selectorOf(item), item, e.name);
      else if (item.type === "error") add(idx.errors, selectorOf(item), item, e.name);
      else if (item.type === "event") add(idx.events, topicOf(item), item, e.name);
    }
  }
  const errs = assetJson<Abi>("abis", "errors.json");
  for (const item of errs) if (item.type === "error") add(idx.errors, selectorOf(item), item, "errors.json");
  return (indexCache = idx);
}

/** All bundled error definitions (deduplicated) — for revert decoding. */
export function bundledErrorAbi(): Abi {
  const out: AbiError[] = [];
  for (const list of bundledIndexes().errors.values()) for (const x of list) out.push(x.item);
  return out;
}

// ---------------------------------------------------------------------------
// Canonical deployments from the registry → bundled ABI
// ---------------------------------------------------------------------------

export interface CanonicalContract {
  address: Address;
  /** registry name, e.g. "UniversalProfileInit" or protocol key "multicall3" */
  name: string;
  version?: string;
  abiName?: string;
  origin: "contracts.json" | "protocols.json";
  /** protocols.json: chains where code was confirmed (undefined = no per-chain record) */
  chains?: number[];
}

let canonicalCache: Map<string, CanonicalContract> | undefined;

const PROTOCOL_ABIS: Record<string, string> = {
  multicall3: "Multicall3",
  permit2: "Permit2",
  lsp26FollowerSystem: "LSP26FollowerSystem",
  entryPointV06: "EntryPointV06",
  "cowProtocol.settlement": "CoWSettlement",
  "hyperlane.warpRoutes.LYX.router": "HyperlaneTokenRouter",
  "hyperlane.warpRoutes.USDC.router": "HyperlaneTokenRouter",
  "hyperlane.warpRoutes.USDC.ethereumCollateral": "ERC20",
};

/** Map of lower-case address → canonical contract (LSP base contracts + well-known protocols). */
export function canonicalContracts(): Map<string, CanonicalContract> {
  if (canonicalCache) return canonicalCache;
  const map = new Map<string, CanonicalContract>();
  const contracts = assetJson<any>("registry", "contracts.json").contracts as Record<string, { versions: Record<string, { address: Address }> }>;
  for (const [name, c] of Object.entries(contracts)) {
    for (const [version, v] of Object.entries(c.versions ?? {})) {
      if (!v?.address) continue;
      const deployed = version !== "singleton" ? findBundled(`${name}@${version}`) : findBundled(`${name}@deployed`);
      const abiName = deployed?.name ?? findBundled(name)?.name;
      map.set(v.address.toLowerCase(), { address: v.address, name, version: version === "singleton" ? undefined : version, abiName, origin: "contracts.json" });
    }
  }
  const protocols = assetJson<any>("registry", "protocols.json").protocols as Record<string, any>;
  const walk = (obj: any, path: string) => {
    if (typeof obj === "string" && /^0x[0-9a-fA-F]{40}$/.test(obj)) {
      const key = obj.toLowerCase();
      if (!map.has(key)) {
        const top = path.split(".")[0];
        const abiName = PROTOCOL_ABIS[path] ?? (path.endsWith(".address") ? PROTOCOL_ABIS[top] : undefined);
        const chains = Array.isArray(protocols[top]?.chains) ? (protocols[top].chains as number[]) : undefined;
        map.set(key, { address: obj as Address, name: path.replace(/\.address$/, ""), abiName, origin: "protocols.json", chains });
      }
      return;
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(protocols, "");
  return (canonicalCache = map);
}
