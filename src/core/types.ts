// Shared type contracts. Every module in src/ depends only on these and on the
// helpers in src/core and src/chain. Changing a type here is an API change for
// every verb module — keep it stable.
import type { Address, Hex, PublicClient, TransactionSerializable, TypedDataDefinition, LocalAccount } from "viem";

export type { Address, Hex };

/** Trust label attached to every externally sourced fact (ABI, RPC, address, metadata). */
export type TrustLabel =
  | "bundled" // shipped with the skill, pinned + provenance
  | "onchain" // verified against chain state (code hash, eth_call)
  | "exact" // source-verified exact match (Sourcify exact / Blockscout fully verified)
  | "partial" // source-verified partial match / explorer ABI
  | "proxy" // resolved through a proxy implementation
  | "remote-unpinned" // fetched from a remote list, not pinned
  | "remote-discovered" // discovered + health-checked at runtime
  | "user" // provided by the user/agent explicitly
  | "guessed"; // selector database guess — never enough to sign value-moving calls

// ---------------------------------------------------------------------------
// Verbs (CLI commands == MCP tools)
// ---------------------------------------------------------------------------

export type ParamType = "string" | "number" | "integer" | "boolean" | "string[]" | "json";

export interface ParamDef {
  name: string; // kebab-case CLI flag name, e.g. "allowed-calls"; MCP property name is the same
  type: ParamType;
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: readonly string[];
  /** Positional index for the CLI (0-based). MCP always uses named properties. */
  positional?: number;
}

/**
 * Risk class of a verb. It drives the consent model (see src/core/policy.ts):
 * - local: no chain writes, no secrets leave the machine (doctor, encode, qr …)
 * - read: chain/HTTP reads only
 * - write: sends a transaction/relay call/userop on behalf of the profile
 * - admin: changes who controls the profile or what controllers may do
 *          (permissions, controllers, ownership, extensions, 4337 enable, deployments of infra)
 * - secret: touches key material lifecycle (init, rotate, backup)
 */
export type RiskClass = "local" | "read" | "write" | "admin" | "secret";

export interface VerbDef {
  /** Space separated CLI path, e.g. "exec send", "account precompute". MCP tool name = "up_" + words joined by "_". */
  name: string;
  group: string;
  summary: string;
  description?: string;
  risk: RiskClass;
  params: ParamDef[];
  examples?: string[];
  run(ctx: VerbContext, args: Record<string, any>): Promise<VerbResult>;
}

export interface MediaFile {
  path: string; // absolute path of a generated file (PNG/SVG) the host can attach
  mimeType: string;
  description: string;
}

export interface VerbResult {
  /** Machine-readable payload (always JSON-serialisable; bigint is serialised as decimal string). */
  data: unknown;
  /** Optional human summary printed in TTY mode and returned as MCP text content. */
  text?: string;
  media?: MediaFile[];
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Chains / registry
// ---------------------------------------------------------------------------

export type ExplorerFamily = "blockscout" | "etherscan" | "routescan" | "other";

export interface Explorer {
  url: string;
  family: ExplorerFamily;
  /** API base for ABI discovery, e.g. https://explorer.execution.mainnet.lukso.network/api (blockscout) */
  apiBase?: string;
}

export interface RpcEndpoint {
  url: string;
  source: "user" | "lsp-repo" | "chainlist" | "chainid.network" | "discovered";
  tracking?: "none" | "limited" | "yes" | "unspecified";
  trust: TrustLabel;
}

export interface ChainInfo {
  chainId: number;
  name: string;
  slug: string;
  nativeSymbol: string;
  testnet: boolean;
  rpcs: RpcEndpoint[];
  explorers: Explorer[];
  bridges?: string[];
  /** LSP base contract deployment status from the lsp-smart-contracts registry. */
  lsp: {
    deployed: boolean;
    /** e.g. { "UniversalProfileInit": ["0.14.0","0.12.1"], ... } as listed upstream */
    versions: Record<string, string[]>;
    notes?: string[];
  };
  /** LSP15 relayers known for this chain (data, not a promise). */
  relayers?: { name: string; baseUrl: string; profile: "lsp15" | "lukso-live" }[];
  sourcify?: boolean;
  /** Seconds after which a head block is considered stale for health checks. */
  staleAfterSec?: number;
  /** Recommended confirmations before reporting success. */
  confirmations?: number;
}

// ---------------------------------------------------------------------------
// Signer (implemented by src/signer/*)
// ---------------------------------------------------------------------------

export type ProtectionLevel =
  | "os-keychain" // macOS login keychain / Windows DPAPI / Linux systemd-creds (encrypted at rest, OS-bound)
  | "os-keyring" // Linux Secret Service (desktop session)
  | "vm-protected-file" // 0600 file inside an isolated agent VM (dots/Muse) — owner-approved
  | "protected-file" // 0600 file on a normal machine (explicit opt-in)
  | "remote-signer" // key lives in a remote policy signer
  | "ephemeral"; // in-memory test key (tests only)

export interface ProtectionInfo {
  backend: string;
  level: ProtectionLevel;
  unattended: boolean;
  encryptedAtRest: boolean;
  notes: string[];
}

export interface Signer {
  readonly address: Address;
  readonly protection: ProtectionInfo;
  /** EIP-191 personal_sign over raw bytes or a utf8 string. */
  signMessage(message: { raw: Hex } | string): Promise<Hex>;
  /** EIP-191 version 0x00 ("intended validator") — LSP25 relay signatures. */
  signIntendedValidator(validator: Address, data: Hex): Promise<Hex>;
  signTypedData(td: TypedDataDefinition): Promise<Hex>;
  signTransaction(tx: TransactionSerializable): Promise<Hex>;
  /** viem LocalAccount view of this signer (for wallet clients). Never exposes the private key. */
  toAccount(): LocalAccount;
}

export interface BackendProbe {
  id: string;
  available: boolean;
  unattended: boolean;
  level: ProtectionLevel;
  reason: string;
}

export interface SignerBackend {
  readonly id: string;
  readonly label: string;
  probe(): Promise<BackendProbe>;
  /** Generate a new secp256k1 key inside the backend; returns the public address only. */
  create(): Promise<Address>;
  /** Import an existing private key (tests / rotation tooling). */
  importKey?(privateKey: Hex): Promise<Address>;
  load(address: Address): Promise<Signer>;
  remove(address: Address): Promise<void>;
  has(address: Address): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Context handed to every verb
// ---------------------------------------------------------------------------

export interface Registry {
  chains(): ChainInfo[];
  chain(idOrName: string | number): ChainInfo; // throws UpError CHAIN_UNKNOWN
  contracts(): Record<string, unknown>;
  protocols(): Record<string, unknown>;
  canonical(name: string, version?: string): Address | undefined;
}

export interface RpcManager {
  publicClient(chainId: number): PublicClient;
  request<T = unknown>(chainId: number, method: string, params?: unknown[]): Promise<T>;
  ranked(chainId: number): RpcEndpoint[];
  verify(chainId: number): Promise<RpcHealth[]>;
}

export interface RpcHealth {
  url: string;
  ok: boolean;
  chainIdMatches?: boolean;
  blockNumber?: string;
  blockAgeSec?: number;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

export interface ConsentRequest {
  verb: string;
  risk: RiskClass;
  chainId?: number;
  summary: Record<string, unknown>; // the confirmation block (actor, target, value, decoded call, gas payer, path)
  value?: bigint;
  target?: Address;
  selector?: Hex;
  /** Every call of a batch (target + inner selector), so guards can check all of them. */
  calls?: { target: Address; selector?: Hex; value?: bigint }[];
}

export interface Flags {
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  approval?: string;
  chain?: string;
  profile?: string;
}

export interface VerbContext {
  readonly home: string;
  readonly flags: Flags;
  readonly registry: Registry;
  readonly rpc: RpcManager;
  config(): Promise<UpConfig>;
  saveConfig(cfg: UpConfig): Promise<void>;
  /**
   * Loads the controller signer for `chainId`: the chain's own key (config.chainControllers)
   * or the default key (config.controller). Without `chainId` the verb's chain (--chain or the
   * default chain) is used; with no chain at all, the default key. Throws NO_SIGNER if none.
   */
  signer(chainId?: number): Promise<Signer>;
  /** Throws CONSENT_REQUIRED (with the confirmation block) unless policy/flags allow the action. */
  consent(req: ConsentRequest): Promise<void>;
  /** Resolve chain from args/flags/config default. */
  chainId(arg?: string | number): number;
  /**
   * The profile this verb acts as/for on `chainId` (default: the verb's chain): its identity
   * (`identity()`), mapped to the chain-specific address when one is linked for that chain
   * (`up profile link`). Use for the acting profile only — counterparties use resolveAddress().
   */
  profile(arg?: string, chainId?: number): Promise<Address>;
  /** The profile identity from args/flags/alias/config default, without any per-chain mapping. */
  identity(arg?: string): Promise<Address>;
  /** Any address or alias (recipients, operators, targets) — never mapped per chain. */
  resolveAddress(arg: string): Promise<Address>;
  log(message: string): void;
}

export interface UpConfig {
  version: 1;
  /** Active (default) controller key (public address) and its backend id. Used on every chain without its own key. */
  controller?: { address: Address; backend: string; createdAt: string };
  /**
   * Optional chain-specific controller keys: chainId → key. The profile is one account on
   * many chains; a chain listed here signs with its own key (set with up key activate
   * <address> --chain <id>). Absent = the default key everywhere.
   */
  chainControllers?: Record<string, { address: Address; backend: string; createdAt: string }>;
  /** Retired controller keys kept for rotation audit (public data only). chainId set for retired chain-specific keys. */
  retiredControllers?: { address: Address; backend: string; retiredAt: string; chainId?: number }[];
  defaultChain?: number;
  defaultProfile?: Address;
  aliases?: Record<string, Address>;
  chains?: number[]; // chains the user selected
  rpcOverrides?: Record<string, string[]>; // chainId -> urls (user first)
  relayers?: { name: string; baseUrl: string; chainIds: number[]; profile: "lsp15" | "lukso-live" }[];
  bundlers?: Record<string, string>; // chainId -> bundler RPC url
  explorerKeys?: Record<string, string>; // e.g. { etherscan: "<key>" } — optional, user-provided
}
