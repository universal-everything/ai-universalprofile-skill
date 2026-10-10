// Asset model shared by the token verbs: standard resolution (detection or an
// explicit override that is cross-checked), ABIs per standard, token-id
// parsing/formatting and amount conversion.
import { bytesToString, getAddress, hexToBytes, isHex, pad, parseAbi, stringToHex, type Abi, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { bundledAbi } from "../abi/bundled.ts";
import { detectStandards, LSP4_KEYS, ERC725Y_GETDATA_ABI, type Detection } from "../abi/detect.ts";
import { fromBaseUnits, parseInteger, toBaseUnits } from "../abi/codec.ts";
import { readMany } from "../abi/read.ts";

export type AssetStandard = "LSP7" | "LSP8" | "ERC20" | "ERC721" | "ERC1155";
export const ASSET_STANDARDS: readonly AssetStandard[] = ["LSP7", "LSP8", "ERC20", "ERC721", "ERC1155"];

let lsp7: Abi | undefined;
let lsp8: Abi | undefined;
export const LSP7_ABI = (): Abi => (lsp7 ??= bundledAbi("LSP7DigitalAsset"));
export const LSP8_ABI = (): Abi => (lsp8 ??= bundledAbi("LSP8IdentifiableDigitalAsset"));

/** Minimal, exact ERC ABIs (the reference files carry a few non-standard extras). */
export const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
export const ERC721_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
]);
export const ERC1155_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function uri(uint256 id) view returns (string)",
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)",
]);

export function abiFor(std: AssetStandard): Abi {
  switch (std) {
    case "LSP7":
      return LSP7_ABI();
    case "LSP8":
      return LSP8_ABI();
    case "ERC20":
      return ERC20_ABI as Abi;
    case "ERC721":
      return ERC721_ABI as Abi;
    case "ERC1155":
      return ERC1155_ABI as Abi;
  }
}

export interface AssetInfo {
  chainId: number;
  address: Address;
  standard: AssetStandard;
  detection: Detection;
  /**
   * Fungible decimals (LSP7/ERC20) as read from decimals(); 0 for NFTs.
   * undefined = could not be read: human-unit amounts are refused (use --raw), never assumed.
   */
  decimals: number | undefined;
  /** Token-reported strings — UNTRUSTED display data. */
  name?: string;
  symbol?: string;
  /** LSP8TokenIdFormat (LSP8 only). */
  tokenIdFormat?: number;
  /** LSP4TokenType (LSP7/LSP8). */
  tokenType?: number;
  warnings: string[];
}

function decodeUtf8(v: unknown): string | undefined {
  if (typeof v !== "string" || v === "0x" || !isHex(v)) return undefined;
  try {
    return bytesToString(hexToBytes(v as Hex)).replace(/\u0000+$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Resolves an asset's standard and display facts. `override` ("auto" or a
 * standard) lets the caller force a standard; it is cross-checked against
 * detection and contradictions are reported.
 */
export async function resolveAsset(ctx: Pick<VerbContext, "rpc">, chainId: number, address: Address, override: string = "auto"): Promise<AssetInfo> {
  const det = await detectStandards(ctx, chainId, address);
  const warnings: string[] = [];
  if (det.kind !== "contract") throw new UpError("BAD_ARGS", `${address} has no contract code on chain ${chainId} — not a token here`, { hint: "check the address and --chain" });
  const detected = det.standards.find((s): s is AssetStandard => (ASSET_STANDARDS as readonly string[]).includes(s));
  let standard: AssetStandard;
  if (override && override !== "auto") {
    const o = override.toUpperCase() as AssetStandard;
    if (!ASSET_STANDARDS.includes(o)) throw new UpError("BAD_ARGS", `unknown standard ${override}`, { hint: `one of: auto, ${ASSET_STANDARDS.join(", ")}` });
    standard = o;
    if (detected && detected !== o) warnings.push(`--standard ${o} overrides the detected standard ${detected}`);
    if (!detected) warnings.push(`standard ${o} could not be confirmed on-chain; using it because it was requested`);
  } else {
    if (!detected) {
      throw new UpError("NOT_SUPPORTED", `${address} is not a recognised token (detected: ${det.standards.join(", ") || "none"})`, {
        hint: "pass --standard if you know it, or use the generic path: up contract call",
        details: { notes: det.notes },
      });
    }
    standard = detected;
  }
  if (det.legacyInterface) warnings.push("token reports an older/unrecognised LSP interface id; behaviour may differ from the current standard");

  const info: AssetInfo = { chainId, address, standard, detection: det, decimals: 0, warnings, tokenType: det.lsp4?.tokenType };
  if (standard === "LSP7" || standard === "LSP8") {
    const reqs = [
      { address, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [LSP4_KEYS.TokenName] },
      { address, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [LSP4_KEYS.TokenSymbol] },
      { address, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [LSP4_KEYS.LSP8TokenIdFormat] },
      ...(standard === "LSP7" ? [{ address, abi: LSP7_ABI(), functionName: "decimals" }] : []),
    ];
    const [n, s, f, d] = await readMany(ctx, chainId, reqs);
    info.name = n.ok ? decodeUtf8(n.value) : undefined;
    info.symbol = s.ok ? decodeUtf8(s.value) : undefined;
    if (standard === "LSP8" && f.ok && typeof f.value === "string" && f.value !== "0x") info.tokenIdFormat = Number(BigInt(f.value as string));
    if (standard === "LSP7") {
      info.decimals = d?.ok ? Number(d.value) : undefined;
      if (info.decimals === undefined) warnings.push(`decimals() of ${address} could not be read: amounts must be given in base units (--raw)`);
    }
  } else if (standard === "ERC20") {
    info.decimals = det.erc20?.decimals;
    info.name = det.erc20?.name;
    info.symbol = det.erc20?.symbol;
    if (info.decimals === undefined) {
      // e.g. --standard ERC20 forced on a contract the probes did not recognise
      const [d, s, n] = await readMany(ctx, chainId, [
        { address, abi: ERC20_ABI as Abi, functionName: "decimals" },
        { address, abi: ERC20_ABI as Abi, functionName: "symbol" },
        { address, abi: ERC20_ABI as Abi, functionName: "name" },
      ]);
      info.decimals = d.ok ? Number(d.value) : undefined;
      info.symbol ??= s.ok ? String(s.value) : undefined;
      info.name ??= n.ok ? String(n.value) : undefined;
      if (info.decimals === undefined) warnings.push(`decimals() of ${address} could not be read: amounts must be given in base units (--raw)`);
    }
  } else if (standard === "ERC721") {
    const [n, s] = await readMany(ctx, chainId, [
      { address, abi: ERC721_ABI, functionName: "name" },
      { address, abi: ERC721_ABI, functionName: "symbol" },
    ]);
    info.name = n.ok ? String(n.value) : undefined;
    info.symbol = s.ok ? String(s.value) : undefined;
  }
  return info;
}

export function isFungible(std: AssetStandard): boolean {
  return std === "LSP7" || std === "ERC20";
}

/** "TOKEN" label for display, quoting the untrusted symbol. */
export function assetLabel(a: Pick<AssetInfo, "symbol" | "standard" | "address">): string {
  return a.symbol ? `"${a.symbol.slice(0, 32)}" (${a.standard} ${a.address})` : `${a.standard} ${a.address}`;
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/**
 * Human units → base units (exact; never rounds). `raw` = already base units.
 * With unknown decimals (decimals() unreadable) human units are refused instead of guessed.
 */
export function parseAmount(amount: unknown, decimals: number | undefined, raw = false): bigint {
  if (amount === undefined || amount === null || amount === "") throw new UpError("BAD_ARGS", "--amount is required for fungible assets");
  if (!raw && decimals === undefined) {
    throw new UpError("BAD_ARGS", "the token's decimals() could not be read, so a human-unit amount cannot be converted safely", {
      hint: "pass the amount in the token's smallest units with --raw (check the decimals on an explorer first)",
    });
  }
  const v = raw ? parseInteger(amount, "--amount") : toBaseUnits(String(amount), decimals!, "--amount");
  if (v < 0n) throw new UpError("BAD_ARGS", "--amount must not be negative");
  return v;
}

/** Base units → human units; with unknown decimals the raw integer is shown, labelled as base units. */
export function formatAmount(v: bigint, decimals: number | undefined): string {
  return decimals === undefined ? `${v} base units` : fromBaseUnits(v, decimals);
}

// ---------------------------------------------------------------------------
// Token ids
// ---------------------------------------------------------------------------

/** LSP8TokenIdFormat values (LSP8 spec); 100+ = mixed formats with the same base. */
export const LSP8_FORMATS: Record<number, string> = { 0: "Number", 1: "String", 2: "Address", 3: "Unique ID (bytes32)", 4: "Hash (bytes32)" };

/**
 * LSP8 token id → bytes32. Accepts the full 0x-bytes32, a decimal number
 * (Number format), an address (Address format) or text (String format).
 */
export function parseLsp8TokenId(input: unknown, format?: number): Hex {
  if (input === undefined || input === null || input === "") throw new UpError("BAD_ARGS", "--token-id is required for LSP8 assets");
  const s = String(input).trim();
  const base = format !== undefined && format >= 100 ? format - 100 : format;
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase() as Hex;
  if (/^0x[0-9a-fA-F]{40}$/.test(s) && (base === undefined || base === 2)) return pad(getAddress(s), { size: 32 }).toLowerCase() as Hex;
  if (/^\d+$/.test(s) && base !== 1) {
    const n = BigInt(s);
    if (n >= 1n << 256n) throw new UpError("BAD_ARGS", "--token-id does not fit in 32 bytes");
    return pad(`0x${n.toString(16)}`, { size: 32 }) as Hex;
  }
  if (base === 1) {
    const h = stringToHex(s);
    if ((h.length - 2) / 2 > 32) throw new UpError("BAD_ARGS", "--token-id string is longer than 32 bytes");
    return pad(h, { size: 32, dir: "right" }) as Hex;
  }
  throw new UpError("BAD_ARGS", `cannot interpret token id "${s}" for LSP8TokenIdFormat ${format === undefined ? "(unknown)" : `${format} (${LSP8_FORMATS[base!] ?? "?"})`}`, {
    hint: "pass the full 0x-prefixed bytes32 token id",
  });
}

/** bytes32 token id → readable form for its format. */
export function formatLsp8TokenId(id: Hex, format?: number): string {
  const base = format !== undefined && format >= 100 ? format - 100 : format;
  try {
    if (base === 0) return BigInt(id).toString();
    if (base === 1) return decodeUtf8(id) ?? id;
    if (base === 2) return getAddress(`0x${id.slice(26)}`);
  } catch {}
  return id;
}

export function parseUintTokenId(input: unknown): bigint {
  if (input === undefined || input === null || input === "") throw new UpError("BAD_ARGS", "--token-id is required");
  const v = parseInteger(input, "--token-id");
  if (v < 0n || v >= 1n << 256n) throw new UpError("BAD_ARGS", "--token-id must be a uint256");
  return v;
}
