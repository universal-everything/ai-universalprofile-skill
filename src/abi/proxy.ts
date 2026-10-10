// Proxy resolution (trust-ladder rung 4) and LSP17 extension discovery.
//  - EIP-1967: implementation slot, beacon slot (→ IBeacon.implementation()), admin slot
//  - ERC-1167 minimal proxies (incl. PUSHn variants for vanity implementation addresses);
//    every LSP23-deployed UP and Key Manager is such a clone of a canonical implementation
//  - ERC-1822 (UUPS "PROXIABLE" slot)
//  - explorer hints (Blockscout implementations[], Sourcify proxyResolution) are merged by discovery.ts
//  - LSP17: an ERC725Y account forwards unknown selectors to the extension stored under
//    LSP17Extension:<bytes4 selector>; those functions are callable on the account itself.
// Proxies are re-resolved on every discovery (upgradeable proxies change).
import { getAddress, type Abi, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { getCode, getStorageAt, readMany, tryRead } from "./read.ts";
import { ERC725Y_GETDATA_ABI } from "./detect.ts";

export const EIP1967_SLOTS = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex,
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as Hex,
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as Hex,
};
/** keccak256("PROXIABLE") — ERC-1822 UUPS. */
export const ERC1822_SLOT = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7" as Hex;

export type ProxyKind = "eip1967" | "eip1967-beacon" | "erc1167" | "erc1822" | "explorer";

export interface ProxyInfo {
  isProxy: boolean;
  kind?: ProxyKind;
  implementation?: Address;
  beacon?: Address;
  admin?: Address;
  evidence: string[];
}

/** Address stored in a 32-byte word (upper 12 bytes must be zero; zero address → undefined). */
export function slotAddress(word: Hex | undefined): Address | undefined {
  if (!word || word === "0x") return undefined;
  const h = word.slice(2).padStart(64, "0");
  if (h.length !== 64 || !/^0{24}/.test(h)) return undefined;
  const a = h.slice(24);
  if (/^0{40}$/.test(a)) return undefined;
  return getAddress(`0x${a}`);
}

const ERC1167_PREFIX = "363d3d373d3d3d363d";
const ERC1167_SUFFIX = "5af43d82803e903d91";
const ERC1167_TAIL = "57fd5bf3";

/**
 * Parses ERC-1167 minimal proxy runtime code. Standard form uses PUSH20 (0x73);
 * vanity implementations with leading zero bytes use a shorter PUSHn (0x60..0x72).
 */
export function parseErc1167(code: Hex): Address | undefined {
  const c = code.slice(2).toLowerCase();
  if (!c.startsWith(ERC1167_PREFIX)) return undefined;
  const op = parseInt(c.slice(18, 20), 16);
  if (op < 0x60 || op > 0x73) return undefined;
  const n = op - 0x5f; // PUSHn byte count
  const addrHex = c.slice(20, 20 + 2 * n);
  const rest = c.slice(20 + 2 * n);
  if (!rest.startsWith(ERC1167_SUFFIX)) return undefined;
  // jump destination byte (PUSH1 0x2b for PUSH20, smaller for shorter pushes) then JUMPI + revert/return tail
  if (!/^60[0-9a-f]{2}/.test(rest.slice(ERC1167_SUFFIX.length)) || !rest.slice(ERC1167_SUFFIX.length + 4).startsWith(ERC1167_TAIL)) return undefined;
  return getAddress(`0x${addrHex.padStart(40, "0")}`);
}

const BEACON_ABI = [{ type: "function", name: "implementation", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] }] as const satisfies Abi;

export async function resolveProxy(ctx: Pick<VerbContext, "rpc">, chainId: number, address: Address, code?: Hex): Promise<ProxyInfo> {
  const c = code ?? (await getCode(ctx, chainId, address));
  const info: ProxyInfo = { isProxy: false, evidence: [] };
  if (c === "0x") return info;
  const clone = parseErc1167(c);
  if (clone) {
    return { isProxy: true, kind: "erc1167", implementation: clone, evidence: ["runtime code is an ERC-1167 minimal proxy"] };
  }
  const [impl, beacon, admin, uups] = await Promise.all([
    getStorageAt(ctx, chainId, address, EIP1967_SLOTS.implementation).catch(() => undefined),
    getStorageAt(ctx, chainId, address, EIP1967_SLOTS.beacon).catch(() => undefined),
    getStorageAt(ctx, chainId, address, EIP1967_SLOTS.admin).catch(() => undefined),
    getStorageAt(ctx, chainId, address, ERC1822_SLOT).catch(() => undefined),
  ]);
  const implAddr = slotAddress(impl);
  const beaconAddr = slotAddress(beacon);
  info.admin = slotAddress(admin);
  if (implAddr) {
    info.isProxy = true;
    info.kind = "eip1967";
    info.implementation = implAddr;
    info.evidence.push("EIP-1967 implementation slot is set");
  } else if (beaconAddr) {
    info.isProxy = true;
    info.kind = "eip1967-beacon";
    info.beacon = beaconAddr;
    info.evidence.push("EIP-1967 beacon slot is set");
    const r = await tryRead<Address>(ctx, chainId, { address: beaconAddr, abi: BEACON_ABI, functionName: "implementation" });
    if (r.ok) info.implementation = getAddress(r.value);
    else info.evidence.push(`beacon.implementation() failed: ${r.error}`);
  } else if (slotAddress(uups)) {
    info.isProxy = true;
    info.kind = "erc1822";
    info.implementation = slotAddress(uups);
    info.evidence.push("ERC-1822 PROXIABLE slot is set");
  }
  if (info.admin) info.evidence.push(`EIP-1967 admin: ${info.admin}`);
  return info;
}

// ---------------------------------------------------------------------------
// LSP17 extensions
// ---------------------------------------------------------------------------

/** Selectors commonly served by LSP17 extensions on Universal Profiles. */
export const WELL_KNOWN_EXTENSION_SELECTORS: { selector: Hex; signature: string }[] = [
  { selector: "0x150b7a02", signature: "onERC721Received(address,address,uint256,bytes)" },
  { selector: "0xf23a6e61", signature: "onERC1155Received(address,address,uint256,uint256,bytes)" },
  { selector: "0xbc197c81", signature: "onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)" },
  { selector: "0x0023de29", signature: "tokensReceived(address,address,address,uint256,bytes,bytes)" },
  { selector: "0x3a871cdd", signature: "validateUserOp((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes),bytes32,uint256)" },
  { selector: "0x01ffc9a7", signature: "supportsInterface(bytes4)" },
];

/** LSP2 Mapping key LSP17Extension:<bytes4> = bytes10(keccak256("LSP17Extension")) ++ 0x0000 ++ selector ++ 16 zero bytes. */
export function lsp17ExtensionKey(selector: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{8}$/.test(selector)) throw new Error(`invalid selector ${selector}`);
  return `0xcee78b4094da860110960000${selector.slice(2).toLowerCase()}${"00".repeat(16)}` as Hex;
}

export interface Lsp17Extension {
  selector: Hex;
  extension: Address;
  /** LSP17 value suffix 0x01: msg.value is forwarded to the extension */
  forwardsValue: boolean;
}

/** Reads LSP17Extension:<selector> for each selector on an ERC725Y account. */
export async function lsp17Extensions(ctx: Pick<VerbContext, "rpc">, chainId: number, account: Address, selectors: Hex[]): Promise<Lsp17Extension[]> {
  const uniq = [...new Set(selectors.map((s) => s.toLowerCase() as Hex))];
  if (uniq.length === 0) return [];
  const res = await readMany(ctx, chainId, uniq.map((s) => ({ address: account, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [lsp17ExtensionKey(s)] })));
  const out: Lsp17Extension[] = [];
  uniq.forEach((selector, i) => {
    const r = res[i];
    if (!r.ok || typeof r.value !== "string") return;
    const v = (r.value as string).slice(2);
    if (v.length !== 40 && v.length !== 42) return;
    const addr = `0x${v.slice(0, 40)}`;
    if (/^0x0{40}$/.test(addr)) return;
    out.push({ selector, extension: getAddress(addr), forwardsValue: v.length === 42 && v.slice(40) === "01" });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Dispatcher selectors from bytecode (input to rung-5 guesses)
// ---------------------------------------------------------------------------

/**
 * Extracts function selectors compared in the solc/vyper dispatcher: PUSH4 <sel>
 * followed by EQ (directly or after one DUPn). Push data is skipped while
 * scanning so constants inside PUSH32 etc. are not misread.
 */
export function dispatcherSelectors(code: Hex, limit = 300): Hex[] {
  const b = Buffer.from(code.slice(2), "hex");
  const out: Hex[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < b.length; i++) {
    const op = b[i];
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      if (op === 0x63 && i + 5 < b.length) {
        const next = b[i + 5];
        const next2 = b[i + 6];
        if (next === 0x14 || (next >= 0x80 && next <= 0x8f && next2 === 0x14)) {
          const sel = `0x${b.subarray(i + 1, i + 5).toString("hex")}`;
          if (!seen.has(sel) && sel !== "0x00000000" && sel !== "0xffffffff") {
            seen.add(sel);
            out.push(sel as Hex);
            if (out.length >= limit) break;
          }
        }
      }
      i += n;
    }
  }
  return out;
}
