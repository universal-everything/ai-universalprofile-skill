// Execution transports: the one place where "do X as the profile" becomes a
// transaction. All four paths take the same request and report the same outcome:
//   km     — controller EOA → KeyManager.execute(payload) / executeBatch    (gas: controller EOA)
//   lsp0   — controller EOA → UP.execute(...) verified by the KM via LSP20 (gas: controller EOA)
//   relay  — controller signs LSP25, relayer submits KM.executeRelayCall   (gas: relayer quota)
//   userop — ERC-4337 UserOperation via EntryPoint v0.6 + Extension4337    (gas: UP deposit/paymaster) — opt-in only
// Token, social, swap or any generic contract call builds ExecCall[] and hands
// it to executeAsProfile(); no module sends profile actions any other way.
import type { Address, Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";

/** ERC725X operation types. */
export const OPERATION = { CALL: 0, CREATE: 1, CREATE2: 2, STATICCALL: 3, DELEGATECALL: 4 } as const;
export type OperationType = (typeof OPERATION)[keyof typeof OPERATION];

export interface ExecCall {
  operation: OperationType;
  to: Address; // for CREATE/CREATE2 use the zero address
  value: bigint;
  data: Hex;
}

/** A profile action: either ERC725X calls, or a raw payload already encoded for the UP (e.g. setData). */
export interface ExecRequest {
  chainId: number;
  profile: Address;
  /** One or more ERC725X calls executed by the profile. */
  calls?: ExecCall[];
  /** Alternative: raw UP calldata (e.g. setData/setDataBatch/transferOwnership) executed via the KM. */
  payload?: Hex;
  /** Human-readable description for the confirmation block (decoded function + args). */
  description?: string;
  /** Verb name and risk class used for the consent request (defaults: "exec send", "write"). */
  verb?: string;
  risk?: "write" | "admin";
  /** Optional ABI used to decode the call in the confirmation block. */
  abi?: unknown;
  /** Extra fields merged into the confirmation block. */
  summaryExtra?: Record<string, unknown>;
}

export type ExecPath = "km" | "lsp0" | "relay" | "userop";

export interface ExecOptions {
  /** "auto" (accepted by executeAsProfile): relay when a relayer covers the chain, the controller has EXECUTE_RELAY_CALL and quota > 0; else km. Never userop. */
  via: ExecPath | "auto";
  /** direct paths: the controller EOA sends the value instead of the profile paying from its balance */
  fundFromController?: boolean;
  /** relay: explicit validity window (unix seconds) */
  validFrom?: number | bigint;
  validUntil?: number | bigint;
  /** relay: skip the /quota pre-check */
  skipQuota?: boolean;
  /** relay only */
  relayer?: string;
  /** LSP25 nonce channel (relay) */
  channel?: bigint;
  /** LSP25 validity window in seconds from now (relay); 0 = unlimited */
  validitySeconds?: number;
  /** internal: the chain preflight already ran for this request (executeAuto) */
  chainChecked?: boolean;
  /** userop only (opt-in ERC-4337 module) */
  userop?: { bundlerUrl?: string | null; selfBundle?: boolean; paymasterAndData?: Hex; gas?: object; nonceKey?: bigint; skipPreflight?: boolean };
}

export interface ExecOutcome {
  path: ExecPath;
  chainId: number;
  profile: Address;
  keyManager?: Address;
  gasPayer: string;
  status: "dry-run" | "submitted" | "success" | "reverted";
  txHash?: Hex;
  userOpHash?: Hex;
  relayTaskId?: string;
  blockNumber?: string;
  gasUsed?: string;
  explorerUrl?: string;
  /** The exact calldata sent to the entry contract (KM, UP, relayer abi, or EntryPoint). */
  entryCalldata?: Hex;
  confirmation: Record<string, unknown>;
  warnings?: string[];
}

export interface ExecTransport {
  readonly path: ExecPath;
  execute(ctx: VerbContext, signer: Signer, req: ExecRequest, opts: ExecOptions): Promise<ExecOutcome>;
}

const transports = new Map<ExecPath, ExecTransport>();

export function registerTransport(t: ExecTransport): void {
  transports.set(t.path, t);
}

export function getTransport(path: ExecPath): ExecTransport {
  const t = transports.get(path);
  if (!t) throw new UpError("NOT_SUPPORTED", `execution path "${path}" is not available`, { hint: path === "userop" ? "ERC-4337 is opt-in: enable it first with up account 4337 enable" : undefined });
  return t;
}

export function availablePaths(): ExecPath[] {
  return [...transports.keys()];
}

/**
 * Single entry point for every profile action. Resolves the agent's key for the request's
 * chain, runs the chain preflight (profile deployed there, owned by a Key Manager, this key a
 * controller there — failures name the chain and the fix), then the transport asks for consent
 * (it supplies the confirmation block via ctx.consent) and executes. Permission and gas
 * errors from the chain are returned with the per-chain fix in their hint.
 */
export async function executeAsProfile(ctx: VerbContext, req: ExecRequest, opts: ExecOptions): Promise<ExecOutcome> {
  if (opts.via === "auto") {
    const { executeAuto } = await import("./auto.ts");
    return executeAuto(ctx, req, opts as any);
  }
  const transport = getTransport(opts.via);
  const signer = await ctx.signer(req.chainId);
  const { preflightProfileOnChain, withChainContext } = await import("../lsp/multichain.ts");
  if (!opts.chainChecked) await preflightProfileOnChain(ctx, req.chainId, req.profile, signer.address);
  try {
    return await transport.execute(ctx, signer, req, opts);
  } catch (e) {
    throw withChainContext(ctx, e, req.chainId, req.profile, signer.address);
  }
}
