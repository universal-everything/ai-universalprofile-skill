// ERC-4337 v0.6 UserOperations for a Universal Profile through Extension4337:
// build (UP.execute / executeBatch / raw payload), estimate (bundler or local
// heuristics + EntryPoint simulateValidation), sign (EIP-191 personal_sign over
// the userOpHash), submit (bundler JSON-RPC or self-bundling: the controller EOA
// calls EntryPoint.handleOps itself) and decode the outcome by userOpHash.
//
// userOpHash (EntryPoint v0.6 getUserOpHash):
//   keccak256(abi.encode(keccak256(pack(op)), entryPoint, chainId)) where
//   pack(op) = abi.encode(sender, nonce, keccak(initCode), keccak(callData), callGasLimit,
//              verificationGasLimit, preVerificationGas, maxFeePerGas, maxPriorityFeePerGas, keccak(paymasterAndData))
import {
  decodeErrorResult,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  keccak256,
  type Address,
  type Hex,
  type Log,
} from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { decodeRevert, explorerTxUrl, revertData, sendTx, type DecodedRevert } from "../chain/tx.ts";
import type { ExecCall } from "../exec/transport.ts";
import { DUMMY_SIGNATURE, ENTRYPOINT_V06, KM_ABI, UP_ABI, entryPoint06Abi } from "./constants.ts";
import { depositOf, getNonce, nonceKeyFor } from "./entrypoint.ts";
import { aaUpError } from "./aa-errors.ts";
import { hexQuantity, read, tryCall } from "./rpc.ts";
import type { BundlerClient } from "./bundler.ts";

export interface UserOperationV06 {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: Hex;
  signature: Hex;
}

export type RpcUserOperationV06 = { [K in keyof UserOperationV06]: Hex };

const USEROP_FIELDS = [
  { name: "sender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "initCode", type: "bytes" },
  { name: "callData", type: "bytes" },
  { name: "callGasLimit", type: "uint256" },
  { name: "verificationGasLimit", type: "uint256" },
  { name: "preVerificationGas", type: "uint256" },
  { name: "maxFeePerGas", type: "uint256" },
  { name: "maxPriorityFeePerGas", type: "uint256" },
  { name: "paymasterAndData", type: "bytes" },
  { name: "signature", type: "bytes" },
] as const;

// ---------------------------------------------------------------------------
// Hashing / encoding
// ---------------------------------------------------------------------------

/** pack(op) as hashed by EntryPoint v0.6 UserOperationLib.hash (signature excluded, dynamic fields keccak'd). */
export function packUserOpForHash(op: UserOperationV06): Hex {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      op.sender,
      op.nonce,
      keccak256(op.initCode),
      keccak256(op.callData),
      op.callGasLimit,
      op.verificationGasLimit,
      op.preVerificationGas,
      op.maxFeePerGas,
      op.maxPriorityFeePerGas,
      keccak256(op.paymasterAndData),
    ],
  );
}

export function getUserOpHashV06(op: UserOperationV06, entryPoint: Address, chainId: number): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [keccak256(packUserOpForHash(op)), entryPoint, BigInt(chainId)]));
}

export function toRpcUserOp(op: UserOperationV06): RpcUserOperationV06 {
  return {
    sender: op.sender,
    nonce: hexQuantity(op.nonce),
    initCode: op.initCode,
    callData: op.callData,
    callGasLimit: hexQuantity(op.callGasLimit),
    verificationGasLimit: hexQuantity(op.verificationGasLimit),
    preVerificationGas: hexQuantity(op.preVerificationGas),
    maxFeePerGas: hexQuantity(op.maxFeePerGas),
    maxPriorityFeePerGas: hexQuantity(op.maxPriorityFeePerGas),
    paymasterAndData: op.paymasterAndData,
    signature: op.signature,
  };
}

export function fromRpcUserOp(o: Record<string, string>): UserOperationV06 {
  const big = (k: string) => BigInt(o[k] ?? "0x0");
  return {
    sender: getAddress(o.sender),
    nonce: big("nonce"),
    initCode: (o.initCode ?? "0x") as Hex,
    callData: (o.callData ?? "0x") as Hex,
    callGasLimit: big("callGasLimit"),
    verificationGasLimit: big("verificationGasLimit"),
    preVerificationGas: big("preVerificationGas"),
    maxFeePerGas: big("maxFeePerGas"),
    maxPriorityFeePerGas: big("maxPriorityFeePerGas"),
    paymasterAndData: (o.paymasterAndData ?? "0x") as Hex,
    signature: (o.signature ?? "0x") as Hex,
  };
}

/** Plain JSON view (decimal strings) for outputs. */
export function userOpJson(op: UserOperationV06): Record<string, string> {
  return Object.fromEntries(Object.entries(op).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : String(v)]));
}

/** UP-level calldata for the op: one call → execute, several → executeBatch (single LSP20 verification), or a raw payload. */
export function buildCallData(req: { calls?: ExecCall[]; payload?: Hex }): Hex {
  if (req.payload && req.calls?.length) throw new UpError("BAD_ARGS", "pass either calls or a raw payload, not both");
  if (req.payload) {
    if (req.payload.length < 10) throw new UpError("BAD_ARGS", "raw payload must contain at least a 4-byte selector");
    return req.payload;
  }
  const calls = req.calls ?? [];
  if (calls.length === 0) throw new UpError("BAD_ARGS", "nothing to execute: no calls and no payload");
  for (const c of calls) {
    if (c.operation === 4) throw new UpError("NOT_SUPPORTED", "DELEGATECALL is always rejected by the Key Manager (DelegateCallDisallowedViaKeyManager)");
  }
  if (calls.length === 1) {
    const c = calls[0];
    return encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [BigInt(c.operation), c.to, c.value, c.data] });
  }
  return encodeFunctionData({
    abi: UP_ABI,
    functionName: "executeBatch",
    args: [calls.map((c) => BigInt(c.operation)), calls.map((c) => c.to), calls.map((c) => c.value), calls.map((c) => c.data)],
  });
}

/** EIP-191 personal_sign over the 32-byte userOpHash (what Extension4337 recovers). */
export async function signUserOp(signer: Signer, op: UserOperationV06, entryPoint: Address, chainId: number): Promise<{ op: UserOperationV06; userOpHash: Hex }> {
  const unsigned = { ...op, signature: "0x" as Hex };
  const userOpHash = getUserOpHashV06(unsigned, entryPoint, chainId);
  const signature = await signer.signMessage({ raw: userOpHash });
  return { op: { ...op, signature }, userOpHash };
}

/** requiredPrefund of EntryPoint v0.6 (_getRequiredPrefund). */
export function requiredPrefund(op: UserOperationV06): bigint {
  const mul = op.paymasterAndData.length > 2 ? 3n : 1n;
  return (op.callGasLimit + op.verificationGasLimit * mul + op.preVerificationGas) * op.maxFeePerGas;
}

/** Calldata-cost based preVerificationGas (eth-infinitism reference bundler calcPreVerificationGas defaults). */
export function calcPreVerificationGas(op: UserOperationV06): bigint {
  const p = { ...op, preVerificationGas: 21000n, signature: `0x${"01".repeat(65)}` as Hex };
  const packed = hexToBytes(
    encodeAbiParameters(USEROP_FIELDS as any, [
      p.sender,
      p.nonce,
      p.initCode,
      p.callData,
      p.callGasLimit,
      p.verificationGasLimit,
      p.preVerificationGas,
      p.maxFeePerGas,
      p.maxPriorityFeePerGas,
      p.paymasterAndData,
      p.signature,
    ]),
  );
  let calldataCost = 0n;
  for (const b of packed) calldataCost += b === 0 ? 4n : 16n;
  const words = BigInt(Math.ceil(packed.length / 32));
  return calldataCost + 21000n + 18300n + 4n * words;
}

export async function chainFees(ctx: VerbContext, chainId: number): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await ctx.rpc.request<any>(chainId, "eth_getBlockByNumber", ["latest", false]);
  if (block?.baseFeePerGas) {
    const base = BigInt(block.baseFeePerGas);
    let tip = 1_000_000_000n;
    try {
      tip = BigInt(await ctx.rpc.request<Hex>(chainId, "eth_maxPriorityFeePerGas", []));
    } catch {}
    return { maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip };
  }
  const gp = (BigInt(await ctx.rpc.request<Hex>(chainId, "eth_gasPrice", [])) * 11n) / 10n;
  return { maxFeePerGas: gp, maxPriorityFeePerGas: gp };
}

// ---------------------------------------------------------------------------
// Simulation (EntryPoint v0.6 simulateValidation / simulateHandleOp always revert)
// ---------------------------------------------------------------------------

export interface ValidationReturn {
  preOpGas: bigint;
  prefund: bigint;
  sigFailed: boolean;
  validAfter: number;
  validUntil: number;
}

export type SimulationOutcome =
  | { kind: "validation"; returnInfo: ValidationReturn }
  | { kind: "execution"; preOpGas: bigint; paid: bigint; targetSuccess: boolean; targetResult: Hex }
  | { kind: "failed-op"; reason: string }
  | { kind: "revert"; revert: DecodedRevert };

function decodeSimulation(data: Hex | undefined): SimulationOutcome {
  if (data && data.length >= 10) {
    try {
      const d = decodeErrorResult({ abi: entryPoint06Abi, data });
      const args = d.args as readonly any[];
      if (d.errorName === "ValidationResult" || d.errorName === "ValidationResultWithAggregation") {
        const r = args[0];
        return { kind: "validation", returnInfo: { preOpGas: r.preOpGas, prefund: r.prefund, sigFailed: r.sigFailed, validAfter: Number(r.validAfter), validUntil: Number(r.validUntil) } };
      }
      if (d.errorName === "ExecutionResult") return { kind: "execution", preOpGas: args[0], paid: args[1], targetSuccess: args[4], targetResult: args[5] };
      if (d.errorName === "FailedOp") return { kind: "failed-op", reason: String(args[1]) };
    } catch {}
  }
  return { kind: "revert", revert: decodeRevert(data) };
}

export async function simulateValidation(ctx: VerbContext, chainId: number, entryPoint: Address, op: UserOperationV06): Promise<SimulationOutcome> {
  const data = encodeFunctionData({ abi: entryPoint06Abi, functionName: "simulateValidation", args: [op] });
  const r = await tryCall(ctx, chainId, { to: entryPoint, data });
  if (r.ok) return { kind: "revert", revert: { message: "simulateValidation returned without reverting (not an EntryPoint v0.6?)" } };
  return decodeSimulation(r.raw);
}

export async function simulateHandleOp(ctx: VerbContext, chainId: number, entryPoint: Address, op: UserOperationV06, target: Address = "0x0000000000000000000000000000000000000000", targetCallData: Hex = "0x"): Promise<SimulationOutcome> {
  const data = encodeFunctionData({ abi: entryPoint06Abi, functionName: "simulateHandleOp", args: [op, target, targetCallData] });
  const r = await tryCall(ctx, chainId, { to: entryPoint, data });
  if (r.ok) return { kind: "revert", revert: { message: "simulateHandleOp returned without reverting" } };
  return decodeSimulation(r.raw);
}

// ---------------------------------------------------------------------------
// Preflight (client-side, before any signature or bundler call)
// ---------------------------------------------------------------------------

export interface PreflightResult {
  signer: { ok: boolean; revert?: DecodedRevert };
  entryPoint: { ok: boolean; revert?: DecodedRevert };
}

/**
 * (1) validation frame: KM.lsp20VerifyCall(requestor=EntryPoint, target=UP, caller=signer, 0, callData) — read-only branch;
 * (2) execution frame: eth_call {from: EntryPoint, to: UP, data: callData} — the KM checks the EntryPoint's permissions,
 *     and the call itself runs (reverts of the target surface here too).
 */
export async function preflight(ctx: VerbContext, chainId: number, p: { entryPoint: Address; profile: Address; keyManager: Address; signer: Address; callData: Hex }): Promise<PreflightResult> {
  const v = await tryCall(ctx, chainId, {
    from: p.signer,
    to: p.keyManager,
    data: encodeFunctionData({ abi: KM_ABI, functionName: "lsp20VerifyCall", args: [p.entryPoint, p.profile, p.signer, 0n, p.callData] }),
  });
  const x = await tryCall(ctx, chainId, { from: p.entryPoint, to: p.profile, data: p.callData });
  return { signer: v.ok ? { ok: true } : { ok: false, revert: v.revert }, entryPoint: x.ok ? { ok: true } : { ok: false, revert: x.revert } };
}

export function preflightError(r: PreflightResult, p: { entryPoint: Address; signer: Address; chainId: number }): UpError | undefined {
  if (!r.signer.ok) {
    return new UpError("NOT_AUTHORISED", `the signing controller ${p.signer} may not run this payload on the profile: ${r.signer.revert!.message}`, {
      hint: "UserOperation validation checks the signer's own LSP6 permissions (value counted as 0); ask the human to grant the missing permission or AllowedCalls entry",
      details: { stage: "validation", revert: r.signer.revert },
    });
  }
  if (!r.entryPoint.ok) {
    const rv = r.entryPoint.revert!;
    const lsp6 = ["NotAuthorised", "NoPermissionsSet", "NotAllowedCall", "NoCallsAllowed", "NotAllowedERC725YDataKey", "NoERC725YDataKeysAllowed"].includes(rv.errorName ?? "");
    const aboutEp = lsp6 && Array.isArray(rv.args) && rv.args.some((a) => typeof a === "string" && a.toLowerCase() === p.entryPoint.toLowerCase());
    if (aboutEp || lsp6) {
      return new UpError("NOT_AUTHORISED", `the EntryPoint controller ${p.entryPoint} may not execute this payload on the profile: ${rv.message}`, {
        hint: `during execution the EntryPoint is msg.sender, so its own LSP6 permissions apply; widen its scope (admin) with: up account 4337 enable --chain ${p.chainId} --ep-scope custom|super`,
        details: { stage: "execution", revert: rv },
      });
    }
    return new UpError("SIMULATION_REVERTED", `the payload reverts when executed by the profile: ${rv.message}`, { details: { stage: "execution", revert: rv } });
  }
  return undefined;
}

/** Explains "AA23 reverted (or OOG)" by asking the Key Manager directly why the signer is refused. */
export async function diagnoseValidation(ctx: VerbContext, chainId: number, p: { entryPoint: Address; profile: Address; signer: Address; callData: Hex }): Promise<DecodedRevert | undefined> {
  try {
    const km = await read<Address>(ctx, chainId, p.profile, UP_ABI, "owner");
    const v = await tryCall(ctx, chainId, {
      from: p.signer,
      to: km,
      data: encodeFunctionData({ abi: KM_ABI, functionName: "lsp20VerifyCall", args: [p.entryPoint, p.profile, p.signer, 0n, p.callData] }),
    });
    return v.ok ? undefined : v.revert;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Prepare (nonce, fees, gas, signature)
// ---------------------------------------------------------------------------

export interface GasOverrides {
  callGasLimit?: bigint;
  verificationGasLimit?: bigint;
  preVerificationGas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface PrepareParams {
  chainId: number;
  profile: Address;
  callData: Hex;
  /** controller that will sign after consent: nonce key and Key Manager permission measurement */
  signer: Address;
  entryPoint?: Address;
  bundler?: BundlerClient;
  paymasterAndData?: Hex;
  /** default: uint192(signer address) */
  nonceKey?: bigint;
  /** explicit nonce (tests / replays); default EntryPoint.getNonce(profile, nonceKey) */
  nonce?: bigint;
  gas?: GasOverrides;
}

/** An UNSIGNED UserOperation (op.signature = "0x") with its gas, hash and funding facts. */
export interface PreparedUserOp {
  chainId: number;
  entryPoint: Address;
  op: UserOperationV06;
  userOpHash: Hex;
  signer: Address;
  requiredPrefund: bigint;
  deposit: bigint;
  gasSource: { call: string; verification: string; preVerification: string; fees: string };
  /** simulateValidation result of the dummy-signature op (sigFailed is expected to be true) */
  validation?: ValidationReturn;
  warnings: string[];
  signed: false;
}

export interface SignedUserOp extends Omit<PreparedUserOp, "signed"> {
  signed: true;
}

const DEFAULT_VERIFICATION_GAS = 1_500_000n;
const MIN_VERIFICATION_GAS = 150_000n;
const FALLBACK_CALL_GAS = 1_000_000n;
const FALLBACK_KM_GAS = 200_000n;

async function estimateCallGas(ctx: VerbContext, chainId: number, entryPoint: Address, profile: Address, callData: Hex, warnings: string[]): Promise<bigint> {
  try {
    const est = BigInt(await ctx.rpc.request<Hex>(chainId, "eth_estimateGas", [{ from: entryPoint, to: profile, data: callData }]));
    // The estimate includes the 21000 intrinsic + calldata cost the inner call does not need; +20% covers 63/64 forwarding.
    return (est * 12n) / 10n;
  } catch (e) {
    const raw = revertData(e);
    if (raw) {
      const d = decodeRevert(raw);
      throw new UpError("SIMULATION_REVERTED", `estimating the profile call from the EntryPoint reverted: ${d.message}`, { details: d, cause: e });
    }
    warnings.push(`could not estimate callGasLimit from the EntryPoint frame (${(e as Error).message}); using ${FALLBACK_CALL_GAS}`);
    return FALLBACK_CALL_GAS;
  }
}

/**
 * Gas of the part of Extension4337.validateUserOp that a dummy signature skips: the Key Manager's
 * lsp20VerifyCall(EntryPoint, profile, signer, 0, callData) (read-only branch). Reverts mean the signer
 * may not run the payload.
 */
async function estimateKeyManagerGas(ctx: VerbContext, chainId: number, p: { entryPoint: Address; profile: Address; signer: Address; callData: Hex }, warnings: string[]): Promise<bigint> {
  const km = await read<Address>(ctx, chainId, p.profile, UP_ABI, "owner");
  const data = encodeFunctionData({ abi: KM_ABI, functionName: "lsp20VerifyCall", args: [p.entryPoint, p.profile, p.signer, 0n, p.callData] });
  try {
    return BigInt(await ctx.rpc.request<Hex>(chainId, "eth_estimateGas", [{ from: p.signer, to: km, data }]));
  } catch (e) {
    const raw = revertData(e);
    if (raw) {
      const d = decodeRevert(raw);
      throw new UpError("NOT_AUTHORISED", `the signing controller ${p.signer} may not run this payload on the profile: ${d.message}`, {
        hint: "UserOperation validation checks the signer's own LSP6 permissions (value counted as 0); ask the human to grant the missing permission or AllowedCalls entry",
        details: { stage: "validation", revert: d },
        cause: e,
      });
    }
    warnings.push(`could not estimate the Key Manager validation gas (${(e as Error).message}); using ${FALLBACK_KM_GAS}`);
    return FALLBACK_KM_GAS;
  }
}

/**
 * Builds an UNSIGNED v0.6 UserOperation for the profile — nothing is signed here. Gas: overrides > bundler estimate
 * (max with the local measurement) > local measurement. Every estimation/simulation (including the bundler's
 * eth_estimateUserOperationGas) carries DUMMY_SIGNATURE: validation is measured as simulateValidation(dummy op)
 * plus the Key Manager lsp20VerifyCall that the dummy path skips. Sign with signPreparedUserOp only after consent.
 */
export async function prepareUserOperation(ctx: VerbContext, p: PrepareParams): Promise<PreparedUserOp> {
  const entryPoint = getAddress(p.entryPoint ?? ENTRYPOINT_V06);
  const warnings: string[] = [];
  const g = p.gas ?? {};
  const nonce = p.nonce ?? (await getNonce(ctx, p.chainId, p.profile, p.nonceKey ?? nonceKeyFor(p.signer), entryPoint));
  const fees = g.maxFeePerGas !== undefined ? { maxFeePerGas: g.maxFeePerGas, maxPriorityFeePerGas: g.maxPriorityFeePerGas ?? g.maxFeePerGas } : await chainFees(ctx, p.chainId);
  if (g.maxFeePerGas === undefined && g.maxPriorityFeePerGas !== undefined) {
    fees.maxPriorityFeePerGas = g.maxPriorityFeePerGas;
    if (fees.maxFeePerGas < fees.maxPriorityFeePerGas) fees.maxFeePerGas = fees.maxPriorityFeePerGas;
  }
  if (fees.maxPriorityFeePerGas > fees.maxFeePerGas) throw new UpError("BAD_ARGS", `maxPriorityFeePerGas (${fees.maxPriorityFeePerGas}) exceeds maxFeePerGas (${fees.maxFeePerGas})`);
  const gasSource = { call: "override", verification: "override", preVerification: "override", fees: g.maxFeePerGas !== undefined ? "override" : "chain" };

  const op: UserOperationV06 = {
    sender: getAddress(p.profile),
    nonce,
    initCode: "0x",
    callData: p.callData,
    callGasLimit: g.callGasLimit ?? 0n,
    verificationGasLimit: g.verificationGasLimit ?? DEFAULT_VERIFICATION_GAS,
    preVerificationGas: g.preVerificationGas ?? 0n,
    ...fees,
    paymasterAndData: p.paymasterAndData ?? "0x",
    signature: "0x",
  };
  const dummy = (o: UserOperationV06): UserOperationV06 => ({ ...o, signature: DUMMY_SIGNATURE });

  if (g.callGasLimit === undefined) {
    op.callGasLimit = await estimateCallGas(ctx, p.chainId, entryPoint, op.sender, op.callData, warnings);
    gasSource.call = "local:eth_estimateGas(from EntryPoint)";
  }
  if (g.preVerificationGas === undefined) {
    op.preVerificationGas = calcPreVerificationGas(op);
    gasSource.preVerification = "local:calldata-cost";
  }

  let validation: ValidationReturn | undefined;
  if (g.verificationGasLimit === undefined) {
    // Fees 0 → prefund 0, so the deposit does not mask the measurement.
    const sim = await simulateValidation(ctx, p.chainId, entryPoint, dummy({ ...op, verificationGasLimit: DEFAULT_VERIFICATION_GAS, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }));
    validation = await requireValidation(ctx, sim, { chainId: p.chainId, entryPoint, profile: op.sender, signer: p.signer, callData: op.callData }, { dummySignature: true });
    const used = validation.preOpGas > op.preVerificationGas ? validation.preOpGas - op.preVerificationGas : validation.preOpGas;
    const kmGas = await estimateKeyManagerGas(ctx, p.chainId, { entryPoint, profile: op.sender, signer: p.signer, callData: op.callData }, warnings);
    op.verificationGasLimit = maxBig(MIN_VERIFICATION_GAS, ((used + kmGas + 10_000n) * 13n) / 10n + 25_000n);
    gasSource.verification = "local:simulateValidation(dummy signature)+lsp20VerifyCall";
  }

  if (p.bundler) {
    // Dummy signature: a bundler never sees a valid signature before consent. Bundler validation gas would miss the
    // Key Manager part, hence max(bundler, local).
    const b = await p.bundler.estimateUserOperationGas(dummy(op), entryPoint);
    if (g.callGasLimit === undefined) {
      op.callGasLimit = maxBig(op.callGasLimit, b.callGasLimit);
      gasSource.call = "max(bundler, local)";
    }
    if (g.verificationGasLimit === undefined) {
      op.verificationGasLimit = maxBig(op.verificationGasLimit, b.verificationGasLimit);
      gasSource.verification = "max(bundler, local)";
    }
    if (g.preVerificationGas === undefined) {
      op.preVerificationGas = b.preVerificationGas;
      gasSource.preVerification = "bundler";
    }
  }

  const deposit = await depositOf(ctx, p.chainId, op.sender, entryPoint);
  const prefund = requiredPrefund(op);
  if (op.paymasterAndData === "0x" && deposit < prefund) {
    warnings.push(`EntryPoint deposit of the profile (${deposit} wei) is below the required prefund (${prefund} wei); Extension4337 never pays prefund, so the op would fail with AA21 — top up with: up account 4337 deposit --chain ${p.chainId} --amount <wei>`);
  }
  return { chainId: p.chainId, entryPoint, op, userOpHash: getUserOpHashV06(op, entryPoint, p.chainId), signer: getAddress(p.signer), requiredPrefund: prefund, deposit, gasSource, validation, warnings, signed: false };
}

/**
 * The ONLY place a real userOpHash is signed. Call exactly once, after ctx.consent passed and never in --dry-run:
 * Extension4337 ops carry no expiry, so a signed op is a bearer instrument until its nonce is used.
 */
export async function signPreparedUserOp(ctx: VerbContext, signer: Signer, prep: PreparedUserOp): Promise<SignedUserOp> {
  if (ctx.flags.dryRun) throw new UpError("INTERNAL", "refusing to sign a UserOperation in --dry-run");
  if (getAddress(signer.address) !== prep.signer) throw new UpError("INTERNAL", `UserOperation was prepared for ${prep.signer}, not ${signer.address}`);
  const { op, userOpHash } = await signUserOp(signer, prep.op, prep.entryPoint, prep.chainId);
  if (userOpHash !== prep.userOpHash) throw new UpError("INTERNAL", "userOpHash changed between preparation and signing");
  return { ...prep, op, signed: true };
}

function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

async function requireValidation(
  ctx: VerbContext,
  sim: SimulationOutcome,
  p: { chainId: number; entryPoint: Address; profile: Address; signer: Address; callData: Hex; userOpHash?: Hex },
  o: { dummySignature?: boolean } = {},
): Promise<ValidationReturn> {
  if (sim.kind === "validation") {
    if (sim.returnInfo.sigFailed && !o.dummySignature) {
      throw aaUpError("AA24 signature error", "simulateValidation", { stage: "validation", signer: p.signer, userOpHash: p.userOpHash }, `the signer ${p.signer} lacks the 4337 permission (bit 23) or the Key Manager refused it; grant it with: up account 4337 enable --chain ${p.chainId}`);
    }
    return sim.returnInfo;
  }
  if (sim.kind === "failed-op") {
    let extra: string | undefined;
    if (/AA23 reverted \(or OOG\)/.test(sim.reason)) {
      const d = await diagnoseValidation(ctx, p.chainId, p);
      if (d) extra = `Key Manager: ${d.message}`;
    }
    throw aaUpError(sim.reason + (extra ? ` [${extra}]` : ""), "simulateValidation", { stage: "validation", userOpHash: p.userOpHash });
  }
  if (sim.kind === "revert") throw new UpError("SIMULATION_REVERTED", `simulateValidation failed: ${sim.revert.message}`, { details: sim.revert });
  throw new UpError("INTERNAL", "unexpected simulation outcome");
}

/** Final pre-submission check of a signed op (real signature, prefund included). */
export async function validatePrepared(ctx: VerbContext, prep: SignedUserOp): Promise<ValidationReturn> {
  requireSigned(prep.op);
  const sim = await simulateValidation(ctx, prep.chainId, prep.entryPoint, prep.op);
  return requireValidation(ctx, sim, { chainId: prep.chainId, entryPoint: prep.entryPoint, profile: prep.op.sender, signer: prep.signer, callData: prep.op.callData, userOpHash: prep.userOpHash });
}

function requireSigned(op: UserOperationV06): void {
  if (op.signature === "0x" || op.signature.toLowerCase() === DUMMY_SIGNATURE.toLowerCase()) throw new UpError("INTERNAL", "UserOperation is not signed (sign it with signPreparedUserOp after consent)");
}

// ---------------------------------------------------------------------------
// Outcome decoding
// ---------------------------------------------------------------------------

export interface UserOpEventInfo {
  userOpHash: Hex;
  sender: Address;
  paymaster: Address;
  nonce: bigint;
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
}

export interface DecodedUserOpLogs {
  event?: UserOpEventInfo;
  revertReason?: DecodedRevert;
}

export function decodeUserOpLogs(logs: readonly Pick<Log, "address" | "data" | "topics">[], userOpHash: Hex, entryPoint: Address): DecodedUserOpLogs {
  const out: DecodedUserOpLogs = {};
  for (const l of logs) {
    if (l.address.toLowerCase() !== entryPoint.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: entryPoint06Abi, data: l.data, topics: l.topics as any });
      const a = ev.args as any;
      if (ev.eventName === "UserOperationEvent" && a.userOpHash.toLowerCase() === userOpHash.toLowerCase()) {
        out.event = { userOpHash: a.userOpHash, sender: a.sender, paymaster: a.paymaster, nonce: a.nonce, success: a.success, actualGasCost: a.actualGasCost, actualGasUsed: a.actualGasUsed };
      } else if (ev.eventName === "UserOperationRevertReason" && a.userOpHash.toLowerCase() === userOpHash.toLowerCase()) {
        out.revertReason = decodeRevert(a.revertReason as Hex);
      }
    } catch {}
  }
  return out;
}

export interface UserOpResult {
  mode: "bundler" | "self-bundle";
  chainId: number;
  entryPoint: Address;
  userOpHash: Hex;
  success: boolean;
  txHash?: Hex;
  blockNumber?: string;
  actualGasCost?: bigint;
  actualGasUsed?: bigint;
  revert?: DecodedRevert;
  explorerUrl?: string;
  /** who fronted the gas of the bundle transaction */
  gasPayer: string;
}

/**
 * Self-bundling: the controller EOA sends EntryPoint.handleOps([op], beneficiary = controller). Not gasless: the
 * controller fronts the transaction gas and the EntryPoint refunds it from the profile's deposit.
 */
export async function selfBundle(ctx: VerbContext, signer: Signer, prep: Pick<PreparedUserOp, "chainId" | "entryPoint" | "op" | "userOpHash">): Promise<UserOpResult> {
  const { chainId, entryPoint, op, userOpHash } = prep;
  requireSigned(op);
  const data = encodeFunctionData({ abi: entryPoint06Abi, functionName: "handleOps", args: [[op], signer.address] });
  let est: bigint;
  try {
    est = BigInt(await ctx.rpc.request<Hex>(chainId, "eth_estimateGas", [{ from: signer.address, to: entryPoint, data }]));
  } catch (e) {
    throw await handleOpsError(ctx, e, prep, signer.address);
  }
  const floor = op.verificationGasLimit + op.callGasLimit + 150_000n;
  const gas = maxBig((est * 12n) / 10n, floor);
  let tx;
  try {
    tx = await sendTx(ctx, signer, { chainId, to: entryPoint, data, gas });
  } catch (e) {
    if (e instanceof UpError && e.code === "SIMULATION_REVERTED") throw await handleOpsError(ctx, e, prep, signer.address);
    throw e;
  }
  const gasPayer = `controller EOA ${signer.address} (self-bundled, not gasless; refunded from the profile's EntryPoint deposit)`;
  if (tx.status === "dry-run") return { mode: "self-bundle", chainId, entryPoint, userOpHash, success: true, gasPayer };
  const logs = decodeUserOpLogs(tx.receipt?.logs ?? [], userOpHash, entryPoint);
  if (!logs.event) throw new UpError("TX_FAILED", `handleOps transaction ${tx.hash} contains no UserOperationEvent for ${userOpHash}`, { details: { txHash: tx.hash } });
  return {
    mode: "self-bundle",
    chainId,
    entryPoint,
    userOpHash,
    success: logs.event.success,
    txHash: tx.hash,
    blockNumber: tx.blockNumber,
    actualGasCost: logs.event.actualGasCost,
    actualGasUsed: logs.event.actualGasUsed,
    revert: logs.event.success ? undefined : (logs.revertReason ?? { message: "execution failed without a revert reason (out of gas?)" }),
    explorerUrl: tx.explorerUrl,
    gasPayer,
  };
}

async function handleOpsError(ctx: VerbContext, e: unknown, prep: Pick<PreparedUserOp, "chainId" | "entryPoint" | "op" | "userOpHash">, signer: Address): Promise<UpError> {
  const raw = revertData(e) ?? ((e as any)?.details?.raw as Hex | undefined);
  const d = decodeRevert(raw);
  if (d.errorName === "FailedOp") {
    const reason = String((d.args as unknown[])[1]);
    let extra = "";
    if (/AA23 reverted \(or OOG\)/.test(reason)) {
      const k = await diagnoseValidation(ctx, prep.chainId, { entryPoint: prep.entryPoint, profile: prep.op.sender, signer, callData: prep.op.callData });
      if (k) extra = ` [Key Manager: ${k.message}]`;
    }
    return aaUpError(reason + extra, "EntryPoint.handleOps rejected the UserOperation", { userOpHash: prep.userOpHash, failedOp: d });
  }
  if (e instanceof UpError) return e;
  return new UpError("SIMULATION_REVERTED", `EntryPoint.handleOps would revert: ${d.message}`, { details: d, cause: e });
}

/** Bundler submission + receipt polling; the on-chain receipt is decoded for the revert reason. */
export async function submitToBundler(ctx: VerbContext, bundler: BundlerClient, prep: SignedUserOp): Promise<UserOpResult> {
  const { chainId, entryPoint, op, userOpHash } = prep;
  requireSigned(op);
  const returned = await bundler.sendUserOperation(op, entryPoint);
  if (returned.toLowerCase() !== userOpHash.toLowerCase()) {
    throw new UpError("BUNDLER_ERROR", `bundler returned userOpHash ${returned}, expected ${userOpHash} (different EntryPoint/chain?)`, { details: { returned, userOpHash } });
  }
  const r = await bundler.waitForUserOperationReceipt(userOpHash);
  const txHash = (r.receipt?.transactionHash ?? r.transactionHash) as Hex | undefined;
  let decoded: DecodedUserOpLogs = {};
  let blockNumber: string | undefined;
  if (txHash) {
    const chainReceipt = await ctx.rpc.request<any>(chainId, "eth_getTransactionReceipt", [txHash]);
    if (chainReceipt) {
      decoded = decodeUserOpLogs(chainReceipt.logs ?? [], userOpHash, entryPoint);
      blockNumber = BigInt(chainReceipt.blockNumber).toString();
    }
  }
  if (!decoded.event && Array.isArray(r.logs)) decoded = decodeUserOpLogs(r.logs, userOpHash, entryPoint);
  const success = decoded.event?.success ?? Boolean(r.success);
  return {
    mode: "bundler",
    chainId,
    entryPoint,
    userOpHash,
    success,
    txHash,
    blockNumber,
    actualGasCost: decoded.event?.actualGasCost ?? (r.actualGasCost !== undefined ? BigInt(r.actualGasCost) : undefined),
    actualGasUsed: decoded.event?.actualGasUsed ?? (r.actualGasUsed !== undefined ? BigInt(r.actualGasUsed) : undefined),
    revert: success ? undefined : (decoded.revertReason ?? (r.reason ? decodeRevert(r.reason as Hex) : { message: "execution failed without a revert reason" })),
    explorerUrl: txHash ? explorerTxUrl(ctx, chainId, txHash) : undefined,
    gasPayer: `bundler ${bundler.label} (fronted), charged to the profile's EntryPoint deposit${op.paymasterAndData !== "0x" ? " / paymaster" : ""}`,
  };
}

/** On-chain v0.6 getUserOpHash (used by tests and as a self-check). */
export async function onchainUserOpHash(ctx: VerbContext, chainId: number, entryPoint: Address, op: UserOperationV06): Promise<Hex> {
  return read<Hex>(ctx, chainId, entryPoint, entryPoint06Abi, "getUserOpHash", [op]);
}
