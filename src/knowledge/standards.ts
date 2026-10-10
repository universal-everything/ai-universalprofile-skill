// Standards the skill covers: every LSP from LSP0 to LSP26 that exists in the
// LIPs repository, plus the Ethereum standards the account and token verbs use.
// One line each, with the canonical specification URL. Interface ids are the
// ERC-165 ids from the lsp-smart-contracts constants (pinned commit 16ab2441),
// cross-checked in the bundled function inventory (references/functions-*.md).
// LSP numbers 13, 19, 21, 22 and 24 do not exist in the LIPs repository.

export type StandardKind = "account" | "token" | "data" | "infrastructure" | "api" | "erc";

export interface StandardInfo {
  /** Short id, e.g. "LSP6" or "ERC-4337". */
  id: string;
  name: string;
  kind: StandardKind;
  /** One-line plain description of what it is and why the skill cares. */
  summary: string;
  /** Canonical specification (LIP or EIP). */
  url: string;
  /** ERC-165 interface id(s) where the standard defines one. */
  interfaceIds?: Record<string, string>;
}

const LIPS = "https://github.com/lukso-network/LIPs/blob/main/LSPs";
const EIPS = "https://eips.ethereum.org/EIPS";

export const STANDARDS: readonly StandardInfo[] = [
  { id: "LSP0", name: "ERC725Account", kind: "account", summary: "The Universal Profile account contract: ERC725X execute + ERC725Y key/value storage, LSP1 receiver, LSP14 ownership, LSP17 extensions, LSP20 call verification, ERC-1271 signatures.", url: `${LIPS}/LSP-0-ERC725Account.md`, interfaceIds: { LSP0: "0x24871b3d" } },
  { id: "LSP1", name: "UniversalReceiver", kind: "account", summary: "Notification hook (universalReceiver) called on token transfers and value receipts; a delegate (URD) keeps LSP5/LSP10 lists up to date.", url: `${LIPS}/LSP-1-UniversalReceiver.md`, interfaceIds: { LSP1: "0x6bb56a14", LSP1Delegate: "0xa245bbda" } },
  { id: "LSP2", name: "ERC725Y JSON Schema", kind: "data", summary: "How ERC725Y data keys are named, derived and encoded (Singleton, Array, Mapping, VerifiableURI).", url: `${LIPS}/LSP-2-ERC725YJSONSchema.md` },
  { id: "LSP3", name: "Profile Metadata", kind: "data", summary: "Profile name, description, links, images stored as a VerifiableURI under the LSP3Profile data key.", url: `${LIPS}/LSP-3-Profile-Metadata.md` },
  { id: "LSP4", name: "Digital Asset Metadata", kind: "data", summary: "Token name, symbol, type, metadata and creators data keys used by LSP7 and LSP8 tokens.", url: `${LIPS}/LSP-4-DigitalAsset-Metadata.md` },
  { id: "LSP5", name: "ReceivedAssets", kind: "data", summary: "Data keys listing the assets a profile has received (maintained by the URD when one is set).", url: `${LIPS}/LSP-5-ReceivedAssets.md` },
  { id: "LSP6", name: "KeyManager", kind: "account", summary: "Owner of the profile and permission gate: controller permission bits, AllowedCalls, AllowedERC725YDataKeys; also hosts LSP25 relay execution.", url: `${LIPS}/LSP-6-KeyManager.md`, interfaceIds: { LSP6: "0x23f34c62" } },
  { id: "LSP7", name: "DigitalAsset", kind: "token", summary: "Fungible (or non-divisible) token with force flag, LSP1 notifications and operator allowances.", url: `${LIPS}/LSP-7-DigitalAsset.md`, interfaceIds: { LSP7: "0xc52d6008" } },
  { id: "LSP8", name: "IdentifiableDigitalAsset", kind: "token", summary: "NFT standard with bytes32 token ids, per-token data, force flag, LSP1 notifications and operators.", url: `${LIPS}/LSP-8-IdentifiableDigitalAsset.md`, interfaceIds: { LSP8: "0x3a271706" } },
  { id: "LSP9", name: "Vault", kind: "account", summary: "Sub-account owned by a profile for separating assets; same execute/setData surface as LSP0.", url: `${LIPS}/LSP-9-Vault.md`, interfaceIds: { LSP9: "0x28af17e6" } },
  { id: "LSP10", name: "ReceivedVaults", kind: "data", summary: "Data keys listing the vaults a profile owns.", url: `${LIPS}/LSP-10-ReceivedVaults.md` },
  { id: "LSP11", name: "BasicSocialRecovery", kind: "account", summary: "Guardian-based recovery contract; not deployed with a profile by default (reachable through the generic ABI path).", url: `${LIPS}/LSP-11-BasicSocialRecovery.md`, interfaceIds: { LSP11: "0x23a45ef0" } },
  { id: "LSP12", name: "IssuedAssets", kind: "data", summary: "Data keys listing the assets a profile has issued.", url: `${LIPS}/LSP-12-IssuedAssets.md` },
  { id: "LSP14", name: "Ownable2Step", kind: "account", summary: "Two-step ownership transfer (transfer, then accept) and a two-call, time-windowed renounce.", url: `${LIPS}/LSP-14-Ownable2Step.md`, interfaceIds: { LSP14: "0x94be5999" } },
  { id: "LSP15", name: "Transaction Relay Service API", kind: "api", summary: "HTTP API of relayers: POST /execute (submit a signed LSP25 call) and POST /quota (signed quota check). The skill adds a chainId field for multichain relayers.", url: `${LIPS}/LSP-15-TransactionRelayServiceAPI.md` },
  { id: "LSP16", name: "UniversalFactory", kind: "infrastructure", summary: "Deterministic CREATE2 factory for same-address deployments across chains.", url: `${LIPS}/LSP-16-UniversalFactory.md` },
  { id: "LSP17", name: "ContractExtension", kind: "account", summary: "Adds functions to a profile by mapping a selector to an extension contract (used by ERCTokenCallbacks and Extension4337).", url: `${LIPS}/LSP-17-ContractExtension.md`, interfaceIds: { LSP17Extendable: "0xa918fa6b", LSP17Extension: "0xcee78b40" } },
  { id: "LSP18", name: "Royalties", kind: "data", summary: "Data keys describing royalty recipients and points for digital assets (knowledge only).", url: `${LIPS}/LSP-18-Royalties.md` },
  { id: "LSP20", name: "CallVerification", kind: "account", summary: "Lets a controller call the profile directly; the profile asks its owner (the Key Manager) to verify the call.", url: `${LIPS}/LSP-20-CallVerification.md`, interfaceIds: { LSP20CallVerification: "0x1a0eb6a5", LSP20CallVerifier: "0x0d6ecac7" } },
  { id: "LSP23", name: "LinkedContractsFactory", kind: "infrastructure", summary: "Deploys a profile, its Key Manager and the post-deployment setup in one transaction at a precomputable address.", url: `${LIPS}/LSP-23-LinkedContractsFactory.md` },
  { id: "LSP25", name: "ExecuteRelayCall", kind: "account", summary: "Signed meta-transactions: a controller signs, anyone (a relayer) submits; multi-channel nonces and validity windows.", url: `${LIPS}/LSP-25-ExecuteRelayCall.md`, interfaceIds: { LSP25: "0x5ac79908" } },
  { id: "LSP26", name: "FollowerSystem", kind: "infrastructure", summary: "On-chain follow/unfollow registry with follower and following counts.", url: `${LIPS}/LSP-26-FollowerSystem.md`, interfaceIds: { LSP26: "0x2b299cea" } },
  { id: "ERC-20", name: "Token Standard", kind: "erc", summary: "Fungible tokens on every EVM chain: balanceOf, transfer, approve/allowance, decimals.", url: `${EIPS}/eip-20` },
  { id: "ERC-165", name: "Standard Interface Detection", kind: "erc", summary: "supportsInterface(bytes4) — how the skill detects LSP0/LSP6/LSP7/LSP8/ERC-721/ERC-1155 contracts.", url: `${EIPS}/eip-165`, interfaceIds: { ERC165: "0x01ffc9a7" } },
  { id: "ERC-721", name: "Non-Fungible Token Standard", kind: "erc", summary: "NFTs on every EVM chain; safe transfers into a profile need the ERCTokenCallbacks extension.", url: `${EIPS}/eip-721`, interfaceIds: { ERC721: "0x80ac58cd" } },
  { id: "ERC-725", name: "General data key/value store and execution", kind: "erc", summary: "ERC725X (execute: CALL, CREATE, CREATE2, STATICCALL, DELEGATECALL) and ERC725Y (getData/setData) — the base of LSP0.", url: `${EIPS}/eip-725`, interfaceIds: { ERC725X: "0x7545acac", ERC725Y: "0x629aa694" } },
  { id: "ERC-1155", name: "Multi Token Standard", kind: "erc", summary: "Multi-token contracts; safe transfers into a profile need the ERCTokenCallbacks extension.", url: `${EIPS}/eip-1155`, interfaceIds: { ERC1155: "0xd9b67a26" } },
  { id: "ERC-1271", name: "Standard Signature Validation for Contracts", kind: "erc", summary: "isValidSignature lets a profile 'sign': a controller with the SIGN permission signs, the profile validates (CoW, x402, dApp logins).", url: `${EIPS}/eip-1271`, interfaceIds: { ERC1271: "0x1626ba7e" } },
  { id: "ERC-4337", name: "Account Abstraction (UserOperations)", kind: "erc", summary: "Opt-in path: UserOperations through EntryPoint v0.6 and the LSP17 Extension4337 (permission bit 23). Never enabled by default.", url: `${EIPS}/eip-4337` },
];

/**
 * Filter: an exact id ("lsp6", "erc4337", "ERC-4337") returns that standard;
 * a kind ("token", "erc", …) returns that group; anything else is a
 * case-insensitive substring match on name and summary.
 */
export function findStandards(filter?: string): StandardInfo[] {
  const f = filter?.trim().toLowerCase();
  if (!f) return [...STANDARDS];
  const compact = f.replace(/[\s_-]/g, "");
  const byId = STANDARDS.filter((s) => s.id.toLowerCase().replace(/-/g, "") === compact);
  if (byId.length) return byId;
  const byKind = STANDARDS.filter((s) => s.kind === f);
  if (byKind.length) return byKind;
  return STANDARDS.filter((s) => s.name.toLowerCase().includes(f) || s.summary.toLowerCase().includes(f));
}
