// EntryPoint v0.6: detection (code present AND runtime hash equals the canonical
// one), deterministic deployment through Nick's CREATE2 factory with the
// canonical salt (lands on 0x5FF137D4…2789 on every EVM chain with the factory),
// and deposit/withdraw/nonce helpers.
import { concat, encodeFunctionData, getAddress, keccak256, size, slice, type Address, type Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { sendTx, type TxOutcome } from "../chain/tx.ts";
import { ENTRYPOINT_V06, NICK_FACTORY, NICK_FACTORY_RUNTIME, entryPoint06Abi } from "./constants.ts";
import { entryPointAsset, create2Address } from "./bytecode.ts";
import { getCode, read, tryCall } from "./rpc.ts";

export interface FactoryStatus {
  address: Address;
  present: boolean;
  /** runtime equals Arachnid's deterministic-deployment-proxy */
  matches: boolean;
}

export async function nickFactoryStatus(ctx: VerbContext, chainId: number): Promise<FactoryStatus> {
  const code = await getCode(ctx, chainId, NICK_FACTORY);
  return { address: NICK_FACTORY, present: code !== "0x", matches: code.toLowerCase() === NICK_FACTORY_RUNTIME.toLowerCase() };
}

export function nickFactoryGap(chainId: number, f: FactoryStatus): UpError {
  return new UpError(
    "NOT_SUPPORTED",
    f.present
      ? `the code at Nick's factory address ${NICK_FACTORY} on chain ${chainId} is not the deterministic-deployment-proxy; deterministic deployment is not possible there`
      : `Nick's deterministic CREATE2 factory ${NICK_FACTORY} is not deployed on chain ${chainId}, so the canonical EntryPoint v0.6 address (and the deterministic Extension4337 address) cannot be reproduced there`,
    {
      hint: "the factory must first be installed with its pre-signed keyless transaction (https://github.com/Arachnid/deterministic-deployment-proxy); this needs a chain that accepts pre-EIP-155 transactions. The skill does not improvise another deployment path",
      details: { chainId, factory: NICK_FACTORY, present: f.present },
    },
  );
}

export interface EntryPointStatus {
  address: Address;
  deployed: boolean;
  codeHash?: Hex;
  expectedCodeHash: Hex;
  /** deployed AND runtime hash equals the canonical v0.6 runtime */
  canonical: boolean;
}

export async function entryPointStatus(ctx: VerbContext, chainId: number, address: Address = ENTRYPOINT_V06): Promise<EntryPointStatus> {
  const asset = entryPointAsset();
  const code = await getCode(ctx, chainId, address);
  const deployed = code !== "0x";
  const codeHash = deployed ? keccak256(code) : undefined;
  return { address: getAddress(address), deployed, codeHash, expectedCodeHash: asset.runtimeCodeHash, canonical: deployed && codeHash === asset.runtimeCodeHash };
}

/** Throws a precise error unless a canonical EntryPoint v0.6 runs at `address`. */
export async function requireEntryPoint(ctx: VerbContext, chainId: number, address: Address = ENTRYPOINT_V06): Promise<EntryPointStatus> {
  const s = await entryPointStatus(ctx, chainId, address);
  if (!s.deployed) {
    throw new UpError("NOT_DEPLOYED", `EntryPoint v0.6 is not deployed at ${address} on chain ${chainId}`, {
      hint: `deploy it deterministically (admin, controller pays ~5M gas): up account 4337 deploy-entrypoint --chain ${chainId}`,
      details: s,
    });
  }
  if (!s.canonical && address.toLowerCase() === ENTRYPOINT_V06.toLowerCase()) {
    throw new UpError("NOT_SUPPORTED", `the code at ${address} on chain ${chainId} is not the canonical EntryPoint v0.6 (code hash ${s.codeHash}, expected ${s.expectedCodeHash})`, { details: s });
  }
  return s;
}

export interface DeployResult {
  name: string;
  chainId: number;
  address: Address;
  status: "already-deployed" | "deployed" | "dry-run";
  salt: Hex;
  factory: Address;
  txHash?: Hex;
  gasUsed?: string;
  codeHash?: Hex;
  explorerUrl?: string;
}

/**
 * Deploys `initCode` through Nick's factory (tx data = salt ++ initCode) from the
 * controller EOA. Pre-checks the factory and existing code; post-checks the code hash.
 * Consent is the caller's job. In --dry-run the deployment is simulated only.
 */
export async function deployViaNick(
  ctx: VerbContext,
  signer: Signer,
  p: { chainId: number; name: string; salt: Hex; initCode: Hex; expectedRuntimeHash?: Hex },
): Promise<DeployResult> {
  const expected = create2Address(NICK_FACTORY, p.salt, p.initCode);
  const base = { name: p.name, chainId: p.chainId, address: expected, salt: p.salt, factory: NICK_FACTORY };
  const existing = await getCode(ctx, p.chainId, expected);
  if (existing !== "0x") {
    const codeHash = keccak256(existing);
    if (p.expectedRuntimeHash && codeHash !== p.expectedRuntimeHash) {
      throw new UpError("NOT_SUPPORTED", `${p.name}: ${expected} on chain ${p.chainId} holds code with hash ${codeHash}, expected ${p.expectedRuntimeHash}`, { details: base });
    }
    return { ...base, status: "already-deployed", codeHash };
  }
  const f = await nickFactoryStatus(ctx, p.chainId);
  if (!f.matches) throw nickFactoryGap(p.chainId, f);

  const data = concat([p.salt, p.initCode]);
  // Simulate first and check the factory would return the expected address.
  const sim = await tryCall(ctx, p.chainId, { from: signer.address, to: NICK_FACTORY, data });
  if (!sim.ok) {
    throw new UpError("SIMULATION_REVERTED", `${p.name}: deployment through Nick's factory would revert on chain ${p.chainId} (${sim.revert.message})`, {
      hint: "the creation code may exceed the chain's contract size or gas limits; check the chain's EIP-170 limit and block gas limit",
      details: sim.revert,
    });
  }
  if (size(sim.data) >= 20 && getAddress(slice(sim.data, size(sim.data) - 20)) !== expected) {
    throw new UpError("INTERNAL", `${p.name}: factory simulation returned ${sim.data}, expected ${expected}`);
  }
  const tx: TxOutcome = await sendTx(ctx, signer, { chainId: p.chainId, to: NICK_FACTORY, data });
  if (tx.status === "dry-run") return { ...base, status: "dry-run" };
  const code = await getCode(ctx, p.chainId, expected);
  if (code === "0x") throw new UpError("TX_FAILED", `${p.name}: transaction ${tx.hash} succeeded but no code exists at ${expected}`, { details: tx });
  const codeHash = keccak256(code);
  if (p.expectedRuntimeHash && codeHash !== p.expectedRuntimeHash) {
    throw new UpError("TX_FAILED", `${p.name}: deployed code hash ${codeHash} differs from the expected ${p.expectedRuntimeHash}`, { details: { ...base, txHash: tx.hash } });
  }
  return { ...base, status: "deployed", txHash: tx.hash, gasUsed: tx.gasUsed, codeHash, explorerUrl: tx.explorerUrl };
}

/** Deploys the canonical EntryPoint v0.6 (bundled @account-abstraction/contracts 0.6.0 creation code, salt 0). */
export async function deployEntryPoint(ctx: VerbContext, signer: Signer, chainId: number): Promise<DeployResult> {
  const a = entryPointAsset();
  const r = await deployViaNick(ctx, signer, { chainId, name: "EntryPoint v0.6", salt: a.deployment.salt, initCode: a.creationCode, expectedRuntimeHash: a.runtimeCodeHash });
  if (r.address !== getAddress(a.deployment.address)) throw new UpError("INTERNAL", `EntryPoint deployed at ${r.address}, expected ${a.deployment.address}`);
  return r;
}

// ---------------------------------------------------------------------------
// Deposit / nonce helpers
// ---------------------------------------------------------------------------

export const depositToCalldata = (account: Address): Hex => encodeFunctionData({ abi: entryPoint06Abi, functionName: "depositTo", args: [account] });
export const withdrawToCalldata = (to: Address, amount: bigint): Hex => encodeFunctionData({ abi: entryPoint06Abi, functionName: "withdrawTo", args: [to, amount] });

export async function depositOf(ctx: VerbContext, chainId: number, account: Address, entryPoint: Address = ENTRYPOINT_V06): Promise<bigint> {
  return read<bigint>(ctx, chainId, entryPoint, entryPoint06Abi, "balanceOf", [account]);
}

/** 2-D nonce: key = uint192(controller address) → one sequence per controller. */
export function nonceKeyFor(controller: Address): bigint {
  return BigInt(controller);
}

export async function getNonce(ctx: VerbContext, chainId: number, sender: Address, key: bigint, entryPoint: Address = ENTRYPOINT_V06): Promise<bigint> {
  return read<bigint>(ctx, chainId, entryPoint, entryPoint06Abi, "getNonce", [sender, key]);
}
