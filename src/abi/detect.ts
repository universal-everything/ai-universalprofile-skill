// Standard detection for any address:
//  - code presence (EOA / EIP-7702 delegated EOA / contract),
//  - ERC-165 (with the 0xffffffff sanity check) for LSP0/LSP6/LSP7/LSP8/LSP9/
//    LSP26/LSP1/LSP17/ERC721/ERC1155/ERC1271/ERC725X/Y (current + legacy ids),
//  - LSP4 (SupportedStandards:LSP4DigitalAsset + LSP4TokenType) via getData,
//  - ERC-20 heuristics (decimals/symbol/totalSupply/balanceOf all answer) for
//    tokens without ERC-165.
// Results are facts read from the chain right now (trust: onchain); token
// names/symbols are attacker-controlled strings and are only ever displayed.
import { type Abi, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { getCode, readMany, type ReadRequest } from "./read.ts";

/**
 * ERC-165 interface ids. The first id per entry is the current one (verified
 * against the bundled bytecode fixtures in test/chain/abi.test.ts; 0xb3c4928f
 * is erc725.js' LSP7 id for lsp-smart-contracts 0.12). Further legacy ids are
 * best-effort; LSP7/LSP8 releases with other ids are still recognised through
 * the LSP4 SupportedStandards marker (see detectStandards).
 */
export const INTERFACE_IDS = {
  ERC165: ["0x01ffc9a7"],
  ERC1271: ["0x1626ba7e"],
  ERC725X: ["0x7545acac"],
  ERC725Y: ["0x629aa694"],
  LSP0ERC725Account: ["0x24871b3d"],
  LSP1UniversalReceiver: ["0x6bb56a14"],
  LSP6KeyManager: ["0x23f34c62"],
  LSP7DigitalAsset: ["0xc52d6008", "0xb3c4928f", "0xdaa746b7", "0xda1f85e4", "0x5fcaac27"],
  LSP8IdentifiableDigitalAsset: ["0x3a271706", "0x30dc5278", "0x622e7a01", "0x49399145"],
  LSP9Vault: ["0x28af17e6"],
  LSP14Ownable2Step: ["0x94be5999"],
  LSP17Extendable: ["0xa918fa6b"],
  LSP17Extension: ["0xcee78b40"],
  LSP25ExecuteRelayCall: ["0x5ac79908"],
  LSP26FollowerSystem: ["0x2b299cea"], // spec id; the deployed LSP26 does not implement ERC-165 (identified by address + code hash, see codehashes.ts)
  ERC721: ["0x80ac58cd"],
  ERC721Metadata: ["0x5b5e139f"],
  ERC721Enumerable: ["0x780e9d63"],
  ERC1155: ["0xd9b67a26"],
  ERC1155MetadataURI: ["0x0e89341c"],
} as const satisfies Record<string, readonly Hex[]>;

export type InterfaceName = keyof typeof INTERFACE_IDS;

export type Standard = "LSP0" | "LSP6" | "LSP7" | "LSP8" | "LSP9" | "LSP26" | "ERC20" | "ERC721" | "ERC1155";

export const LSP4_KEYS = {
  SupportedStandards: "0xeafec4d89fa9619884b60000a4d96624a38f7ac2d8d9a604ecf07c12c77e480c" as Hex,
  SupportedStandardsValue: "0xa4d96624" as Hex,
  TokenName: "0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1" as Hex,
  TokenSymbol: "0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756" as Hex,
  TokenType: "0xe0261fa95db2eb3b5439bd033cda66d56b96f92f243a8228fd87550ed7bdfdb3" as Hex,
  Metadata: "0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e" as Hex,
  CreatorsArray: "0x114bd03b3a46d48759680d81ebb2b414fda7d030a7105a851867accf1c2352e7" as Hex,
  LSP8TokenIdFormat: "0xf675e9361af1c1664c1868cfa3eb97672d6b1a513aa5b81dec34c9ee330e818d" as Hex,
} as const;

export const LSP4_TOKEN_TYPES: Record<string, string> = { "0": "Token", "1": "NFT", "2": "Collection" };

export const ERC165_ABI = [
  { type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ name: "", type: "bool" }] },
] as const satisfies Abi;

export const ERC725Y_GETDATA_ABI = [
  { type: "function", name: "getData", stateMutability: "view", inputs: [{ name: "dataKey", type: "bytes32" }], outputs: [{ name: "dataValue", type: "bytes" }] },
  { type: "function", name: "getDataBatch", stateMutability: "view", inputs: [{ name: "dataKeys", type: "bytes32[]" }], outputs: [{ name: "dataValues", type: "bytes[]" }] },
] as const satisfies Abi;

export const ERC20_PROBE_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const satisfies Abi;

export interface Detection {
  address: Address;
  chainId: number;
  kind: "eoa" | "eoa-7702" | "contract";
  codeSize: number;
  erc165: boolean;
  /** Interfaces confirmed via ERC-165 (name → matched id). */
  interfaces: Partial<Record<InterfaceName, Hex>>;
  /** Token/account standards in priority order; first = primary. */
  standards: Standard[];
  primary?: Standard;
  /** Interface id matched for the primary LSP7/LSP8 standard was a legacy id. */
  legacyInterface?: boolean;
  lsp4?: { supported: boolean; tokenType?: number; tokenTypeName?: string };
  erc20?: { decimals: number; symbol?: string; name?: string; totalSupply?: string; heuristic: true };
  /** EIP-7702 delegate when kind = eoa-7702 */
  delegate?: Address;
  notes: string[];
}

const TOKEN_ORDER: [InterfaceName, Standard][] = [
  ["LSP7DigitalAsset", "LSP7"],
  ["LSP8IdentifiableDigitalAsset", "LSP8"],
  ["ERC1155", "ERC1155"],
  ["ERC721", "ERC721"],
  ["LSP0ERC725Account", "LSP0"],
  ["LSP9Vault", "LSP9"],
  ["LSP6KeyManager", "LSP6"],
  ["LSP26FollowerSystem", "LSP26"],
];

/** Detects standards; `code` may be passed when already fetched. */
export async function detectStandards(ctx: Pick<VerbContext, "rpc">, chainId: number, address: Address, code?: Hex): Promise<Detection> {
  const c = code ?? (await getCode(ctx, chainId, address));
  const det: Detection = { address, chainId, kind: "contract", codeSize: (c.length - 2) / 2, erc165: false, interfaces: {}, standards: [], notes: [] };
  if (c === "0x") {
    det.kind = "eoa";
    det.notes.push("no contract code at this address on this chain (an EOA, or not deployed here)");
    return det;
  }
  if (/^0xef0100[0-9a-fA-F]{40}$/.test(c)) {
    det.kind = "eoa-7702";
    det.delegate = `0x${c.slice(8)}` as Address;
    det.notes.push(`EIP-7702 delegated EOA (delegate ${det.delegate}); treat as an EOA for token receiver hooks`);
    return det;
  }
  // ERC-165 sanity: must answer true for 0x01ffc9a7 and false for 0xffffffff
  const all = Object.entries(INTERFACE_IDS).flatMap(([name, ids]) => ids.map((id) => ({ name: name as InterfaceName, id: id as Hex })));
  const probes: ReadRequest[] = [
    { address, abi: ERC165_ABI, functionName: "supportsInterface", args: ["0x01ffc9a7"] },
    { address, abi: ERC165_ABI, functionName: "supportsInterface", args: ["0xffffffff"] },
    ...all.map((x) => ({ address, abi: ERC165_ABI, functionName: "supportsInterface", args: [x.id] })),
  ];
  const res = await readMany(ctx, chainId, probes);
  det.erc165 = res[0].ok && res[0].value === true && res[1].ok && res[1].value === false;
  if (det.erc165) {
    all.forEach((x, i) => {
      const r = res[i + 2];
      if (r.ok && r.value === true && !det.interfaces[x.name]) det.interfaces[x.name] = x.id;
    });
  }
  for (const [iface, std] of TOKEN_ORDER) {
    if (det.interfaces[iface]) {
      det.standards.push(std);
      if ((std === "LSP7" || std === "LSP8") && det.interfaces[iface] !== INTERFACE_IDS[iface][0]) det.legacyInterface = true;
    }
  }

  // LSP4 metadata (ERC725Y) + ERC-20 probes in one batch
  const isY = !!det.interfaces.ERC725Y || det.standards.some((s) => s === "LSP7" || s === "LSP8");
  const batch: ReadRequest[] = [
    ...(isY
      ? [
          { address, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [LSP4_KEYS.SupportedStandards] },
          { address, abi: ERC725Y_GETDATA_ABI, functionName: "getData", args: [LSP4_KEYS.TokenType] },
        ]
      : []),
    { address, abi: ERC20_PROBE_ABI, functionName: "decimals" },
    { address, abi: ERC20_PROBE_ABI, functionName: "symbol" },
    { address, abi: ERC20_PROBE_ABI, functionName: "name" },
    { address, abi: ERC20_PROBE_ABI, functionName: "totalSupply" },
    { address, abi: ERC20_PROBE_ABI, functionName: "balanceOf", args: ["0x0000000000000000000000000000000000000001"] },
  ];
  const b = await readMany(ctx, chainId, batch);
  let k = 0;
  if (isY) {
    const ss = b[k++];
    const tt = b[k++];
    const supported = ss.ok && typeof ss.value === "string" && ss.value.toLowerCase() === LSP4_KEYS.SupportedStandardsValue;
    det.lsp4 = { supported };
    if (tt.ok && typeof tt.value === "string" && tt.value !== "0x") {
      try {
        const n = Number(BigInt(tt.value as string));
        det.lsp4.tokenType = n;
        det.lsp4.tokenTypeName = LSP4_TOKEN_TYPES[String(n)] ?? `unknown (${n})`;
      } catch {}
    }
  }
  const [dec, sym, nam, ts, bal] = b.slice(k);
  // LSP7/LSP8 with an ERC-165 id we do not know (other release): LSP4 marker + decimals() probe
  if (det.standards.length === 0 && det.lsp4?.supported) {
    det.standards.push(dec.ok ? "LSP7" : "LSP8");
    det.legacyInterface = true;
    det.notes.push("LSP4 digital asset with an unrecognised ERC-165 id (other LSP7/LSP8 release) — standard inferred from decimals()");
  }
  if (det.standards.length === 0 && dec.ok && ts.ok && bal.ok) {
    det.standards.push("ERC20");
    det.notes.push("ERC-20 detected heuristically (decimals/totalSupply/balanceOf answer; ERC-20 has no ERC-165 id)");
  }
  if (dec.ok && (det.standards[0] === "ERC20" || det.standards[0] === "LSP7")) {
    // LSP7 also has decimals(); keep the values for amount formatting
    det.erc20 = { decimals: Number(dec.value), symbol: sym.ok ? String(sym.value) : undefined, name: nam.ok ? String(nam.value) : undefined, totalSupply: ts.ok ? String(ts.value) : undefined, heuristic: true };
  }
  det.primary = det.standards[0];
  if (!det.primary) det.notes.push(det.erc165 ? "contract supports ERC-165 but none of the known token/account interfaces" : "contract does not implement ERC-165 and does not look like an ERC-20");
  return det;
}

/** True when the address can receive LSP7/LSP8 with force=false (contract implementing LSP1). */
export function supportsLsp1(d: Detection): boolean {
  return d.kind === "contract" && !!d.interfaces.LSP1UniversalReceiver;
}
