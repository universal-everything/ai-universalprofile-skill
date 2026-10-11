// LSP23 deterministic Universal Profile deployment (ERC-1167 proxies).
//
// Canonical encoding (lsp23-contracts/tests/LSP23LinkedContractsDeployment.test.ts,
// "should deploy proxies for Universal Profile and Key Manager"):
//   primary   = { salt, fundingAmount: 0, implementationContract: UniversalProfileInit,
//                 initializationCalldata: initialize(<UniversalProfileInitPostDeploymentModule>) }
//   secondary = { fundingAmount: 0, implementationContract: LSP6KeyManagerInit,
//                 initializationCalldata: 0xc4d66de8 (initialize selector),
//                 addPrimaryContractAddress: true, extraInitializationParams: 0x }
//   postDeploymentModule = UniversalProfileInitPostDeploymentModule
//   postDeploymentModuleCalldata = abi.encode(bytes32[] dataKeys, bytes[] dataValues)
// The module delegatecalls setDataAndTransferOwnership(keys, values, keyManager) inside the
// UP, so the profile is configured and owned by its Key Manager in ONE transaction.
//
// Address derivation (LSP23LinkedContractsFactory.computeERC1167Addresses):
//   generatedSalt = keccak256(abi.encode(salt, kmImpl, kmInitCalldata, true, extra, module, moduleCalldata))
//   UP = CREATE2(factory, generatedSalt, ERC1167(upImpl)); KM = CREATE2(factory, keccak256(UP), ERC1167(kmImpl))
// No chainId enters the derivation: identical inputs give identical addresses on every chain
// where the factory/implementations live at their canonical (Nick-factory) addresses.
import { concat, encodeAbiParameters, encodeFunctionData, encodePacked, formatEther, getAddress, getContractAddress, keccak256, type Address, type Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { readProfileRecord, updateProfileRecord, writeProfileRecord } from "../core/profile-record.ts";
import { LSP } from "../chain/registry.ts";
import { gasCheck, sendTx, simulate } from "../chain/tx.ts";
import { KM_INIT_ABI, LSP23_ABI, UP_INIT_ABI } from "./abis.ts";
import { DATA_KEYS, INTERFACE_IDS, URD_PERMISSIONS, permissionsArrayIndexKey, permissionsKey, uint128Hex } from "./constants.ts";
import { decodePermissions, toBytes32 } from "./permissions.ts";
import { hasCode, read } from "./read.ts";
import { readControllerPermissions, resolveKeyManager, supportsInterface, getData } from "./profile.ts";

export const DEFAULT_IMPL_VERSION = "0.14.0";

export interface Lsp23Inputs {
  salt: Hex;
  controller: Address;
  /** bytes32 permission value for the controller */
  permissions: Hex;
  preset?: string;
  /** Additional controllers set at deployment (e.g. a human admin). Order is part of the address derivation. */
  extraControllers?: { address: Address; permissions: Hex }[];
  /** Encoded LSP3Profile VerifiableURI value (optional; part of the derivation). */
  lsp3?: Hex;
  implementationVersion?: string;
  factory?: Address;
  postDeploymentModule?: Address;
  upInit?: Address;
  kmInit?: Address;
  urd?: Address;
}

export interface Lsp23Plan {
  factory: Address;
  postDeploymentModule: Address;
  implementations: { universalProfileInit: { version: string; address: Address }; keyManagerInit: { version: string; address: Address }; universalReceiverDelegate: { version: string; address: Address } };
  dataKeys: Hex[];
  dataValues: Hex[];
  primaryContractDeploymentInit: { salt: Hex; fundingAmount: string; implementationContract: Address; initializationCalldata: Hex };
  secondaryContractDeploymentInit: { fundingAmount: string; implementationContract: Address; initializationCalldata: Hex; addPrimaryContractAddress: boolean; extraInitializationParams: Hex };
  postDeploymentModuleCalldata: Hex;
  generatedSalt: Hex;
  profile: Address;
  keyManager: Address;
  deployCalldata: Hex;
}

/** EIP-1167 minimal proxy creation code (OpenZeppelin Clones as used by the factory). */
export function erc1167InitCode(implementation: Address): Hex {
  return concat(["0x3d602d80600a3d3981f3363d3d373d3d3d363d73", getAddress(implementation), "0x5af43d82803e903d91602b57fd5bf3"]);
}

export function resolveImplementations(inputs: Pick<Lsp23Inputs, "implementationVersion" | "factory" | "postDeploymentModule" | "upInit" | "kmInit" | "urd">) {
  const v = inputs.implementationVersion ?? DEFAULT_IMPL_VERSION;
  const upInit = inputs.upInit ?? LSP.UP_INIT[v];
  const kmInit = inputs.kmInit ?? LSP.KM_INIT[v];
  const urd = inputs.urd ?? LSP.URD[v];
  if (!upInit || !kmInit || !urd) throw new UpError("BAD_ARGS", `no canonical UP/KM/URD implementation for version ${v}`, { hint: `known versions: ${Object.keys(LSP.UP_INIT).join(", ")}` });
  return {
    version: v,
    factory: getAddress(inputs.factory ?? LSP.LSP23_FACTORY),
    postDeploymentModule: getAddress(inputs.postDeploymentModule ?? LSP.UP_INIT_POST_DEPLOYMENT_MODULE),
    upInit: getAddress(upInit),
    kmInit: getAddress(kmInit),
    urd: getAddress(urd),
  };
}

/** The ERC725Y keys/values the post-deployment module writes (order is frozen: it is part of the address). */
export function buildInitialData(controller: Address, permissions: Hex, urd: Address, opts: { lsp3?: Hex; extraControllers?: { address: Address; permissions: Hex }[] } = {}): { dataKeys: Hex[]; dataValues: Hex[] } {
  const controllers = [{ address: getAddress(controller), permissions }, ...(opts.extraControllers ?? []).map((c) => ({ address: getAddress(c.address), permissions: c.permissions }))];
  const seen = new Set<string>();
  for (const c of controllers) {
    if (seen.has(c.address)) throw new UpError("BAD_ARGS", `controller ${c.address} listed twice`);
    if (c.address === getAddress(urd)) throw new UpError("BAD_ARGS", "a controller cannot be the Universal Receiver Delegate");
    if (!/^0x[0-9a-fA-F]{64}$/.test(c.permissions) || BigInt(c.permissions) === 0n) throw new UpError("BAD_ARGS", `controller ${c.address} needs a non-zero bytes32 permission value`);
    seen.add(c.address);
  }
  const dataKeys: Hex[] = [DATA_KEYS["SupportedStandards:LSP3Profile"]];
  const dataValues: Hex[] = [DATA_KEYS.SupportedStandardsLSP3Value];
  if (opts.lsp3 && opts.lsp3 !== "0x") {
    dataKeys.push(DATA_KEYS.LSP3Profile);
    dataValues.push(opts.lsp3);
  }
  dataKeys.push(DATA_KEYS.LSP1UniversalReceiverDelegate, permissionsKey(urd));
  dataValues.push(getAddress(urd).toLowerCase() as Hex, toBytes32(URD_PERMISSIONS));
  for (const c of controllers) {
    dataKeys.push(permissionsKey(c.address));
    dataValues.push(c.permissions.toLowerCase() as Hex);
  }
  const listed = [...controllers.map((c) => c.address), getAddress(urd)];
  dataKeys.push(DATA_KEYS["AddressPermissions[]"]);
  dataValues.push(uint128Hex(listed.length));
  listed.forEach((a, i) => {
    dataKeys.push(permissionsArrayIndexKey(i));
    dataValues.push(a.toLowerCase() as Hex);
  });
  return { dataKeys, dataValues };
}

export function planDeployment(inputs: Lsp23Inputs): Lsp23Plan {
  if (!/^0x[0-9a-fA-F]{64}$/.test(inputs.salt)) throw new UpError("BAD_ARGS", "salt must be 32 bytes hex");
  const impl = resolveImplementations(inputs);
  const { dataKeys, dataValues } = buildInitialData(inputs.controller, inputs.permissions, impl.urd, { lsp3: inputs.lsp3, extraControllers: inputs.extraControllers });
  const postDeploymentModuleCalldata = encodeAbiParameters([{ type: "bytes32[]" }, { type: "bytes[]" }], [dataKeys, dataValues]);
  const primary = {
    salt: inputs.salt.toLowerCase() as Hex,
    fundingAmount: 0n,
    implementationContract: impl.upInit,
    initializationCalldata: encodeFunctionData({ abi: UP_INIT_ABI, functionName: "initialize", args: [impl.postDeploymentModule] }),
  };
  const secondary = {
    fundingAmount: 0n,
    implementationContract: impl.kmInit,
    initializationCalldata: encodeFunctionData({ abi: KM_INIT_ABI, functionName: "initialize", args: ["0x0000000000000000000000000000000000000000"] }).slice(0, 10) as Hex,
    addPrimaryContractAddress: true,
    extraInitializationParams: "0x" as Hex,
  };
  const { profile, keyManager, generatedSalt } = computeERC1167Addresses(impl.factory, primary, secondary, impl.postDeploymentModule, postDeploymentModuleCalldata);
  const deployCalldata = encodeFunctionData({ abi: LSP23_ABI, functionName: "deployERC1167Proxies", args: [primary, secondary, impl.postDeploymentModule, postDeploymentModuleCalldata] });
  return {
    factory: impl.factory,
    postDeploymentModule: impl.postDeploymentModule,
    implementations: {
      universalProfileInit: { version: impl.version, address: impl.upInit },
      keyManagerInit: { version: impl.version, address: impl.kmInit },
      universalReceiverDelegate: { version: impl.version, address: impl.urd },
    },
    dataKeys,
    dataValues,
    primaryContractDeploymentInit: { ...primary, fundingAmount: "0" },
    secondaryContractDeploymentInit: { ...secondary, fundingAmount: "0" },
    postDeploymentModuleCalldata,
    generatedSalt,
    profile,
    keyManager,
    deployCalldata,
  };
}

/** Local re-implementation of LSP23LinkedContractsFactory.computeERC1167Addresses. */
export function computeERC1167Addresses(
  factory: Address,
  primary: { salt: Hex; implementationContract: Address },
  secondary: { implementationContract: Address; initializationCalldata: Hex; addPrimaryContractAddress: boolean; extraInitializationParams: Hex },
  postDeploymentModule: Address,
  postDeploymentModuleCalldata: Hex,
): { profile: Address; keyManager: Address; generatedSalt: Hex } {
  const generatedSalt = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "bytes" }, { type: "bool" }, { type: "bytes" }, { type: "address" }, { type: "bytes" }],
      [primary.salt, secondary.implementationContract, secondary.initializationCalldata, secondary.addPrimaryContractAddress, secondary.extraInitializationParams, postDeploymentModule, postDeploymentModuleCalldata],
    ),
  );
  const profile = getContractAddress({ opcode: "CREATE2", from: factory, salt: generatedSalt, bytecodeHash: keccak256(erc1167InitCode(primary.implementationContract)) });
  const keyManager = getContractAddress({ opcode: "CREATE2", from: factory, salt: keccak256(encodePacked(["address"], [profile])), bytecodeHash: keccak256(erc1167InitCode(secondary.implementationContract)) });
  return { profile, keyManager, generatedSalt };
}

/**
 * Deterministic candidate salts: salt_i = keccak256(abi.encodePacked(bytes32 seed, uint256 i)).
 * Given the seed, anyone can reproduce the candidate list.
 */
export function candidateSalts(seed: Hex, count: number, offset = 0): Hex[] {
  if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) throw new UpError("BAD_ARGS", "seed must be 32 bytes hex");
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new UpError("BAD_ARGS", "count must be 1..100");
  return Array.from({ length: count }, (_, i) => keccak256(encodePacked(["bytes32", "uint256"], [seed, BigInt(offset + i)])));
}

/** Asks the on-chain factory for the addresses (cross-check of the local computation). */
export async function computeOnChain(ctx: VerbContext, chainId: number, plan: Pick<Lsp23Plan, "primaryContractDeploymentInit" | "secondaryContractDeploymentInit" | "factory" | "postDeploymentModule" | "postDeploymentModuleCalldata">): Promise<{ profile: Address; keyManager: Address }> {
  const p = { ...plan.primaryContractDeploymentInit, fundingAmount: 0n };
  const s = { ...plan.secondaryContractDeploymentInit, fundingAmount: 0n };
  const [profile, keyManager] = await read<[Address, Address]>(ctx, chainId, plan.factory, LSP23_ABI, "computeERC1167Addresses", [p, s, plan.postDeploymentModule, plan.postDeploymentModuleCalldata]);
  return { profile: getAddress(profile), keyManager: getAddress(keyManager) };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface DeploymentRecord {
  chainId: number;
  status: "deployed" | "already-deployed";
  txHash?: Hex;
  blockNumber?: string;
  deployedAt: string;
  deployer?: Address;
  verified: Record<string, boolean>;
}

export interface DeploymentManifest {
  version: 1;
  kind: "lsp23-erc1167-up";
  profile: Address;
  keyManager: Address;
  controller: Address;
  preset?: string;
  permissions: Hex;
  permissionNames: string[];
  extraControllers?: { address: Address; permissions: Hex }[];
  lsp3?: Hex;
  salt: Hex;
  seed?: Hex;
  candidateIndex?: number;
  plan: Omit<Lsp23Plan, "deployCalldata">;
  deployCalldata: Hex;
  chains: number[];
  deployments: Record<string, DeploymentRecord>;
  createdAt: string;
  note: string;
}

export function manifestFromPlan(inputs: Lsp23Inputs, plan: Lsp23Plan, extra: { seed?: Hex; candidateIndex?: number } = {}): DeploymentManifest {
  const { deployCalldata, ...rest } = plan;
  return {
    version: 1,
    kind: "lsp23-erc1167-up",
    profile: plan.profile,
    keyManager: plan.keyManager,
    controller: getAddress(inputs.controller),
    preset: inputs.preset,
    permissions: inputs.permissions,
    permissionNames: decodePermissions(inputs.permissions).names,
    extraControllers: inputs.extraControllers,
    lsp3: inputs.lsp3,
    salt: plan.primaryContractDeploymentInit.salt,
    seed: extra.seed,
    candidateIndex: extra.candidateIndex,
    plan: rest,
    deployCalldata,
    chains: [],
    deployments: {},
    createdAt: new Date().toISOString(),
    note: "Replaying deployCalldata through the LSP23 factory on another chain yields the same profile and Key Manager addresses. Changing ANY input (controller, permissions, salt, versions, LSP3 value) changes the address.",
  };
}

/** Profile records live at paths.profile(home, address); other modules may store other keys there, so writes merge. */
export { readProfileRecord, writeProfileRecord };

export async function loadManifest(home: string, profile: Address): Promise<DeploymentManifest | undefined> {
  const r = await readProfileRecord(home, profile);
  return r.deployment as DeploymentManifest | undefined;
}

/** Saves the manifest; deployments recorded meanwhile on other chains (another process) are kept. */
export async function saveManifest(home: string, m: DeploymentManifest): Promise<void> {
  await updateProfileRecord(home, m.profile, (latest) => {
    const cur = latest.deployment as DeploymentManifest | undefined;
    if (!cur || cur.profile !== m.profile || cur.deployCalldata !== m.deployCalldata) return { deployment: m };
    return { deployment: { ...m, chains: [...new Set([...(cur.chains ?? []), ...m.chains])], deployments: { ...(cur.deployments ?? {}), ...m.deployments } } };
  });
}

/** Re-derives the addresses from the manifest's stored calldata (tamper/consistency check before replay). */
export function verifyManifest(m: DeploymentManifest): { ok: boolean; profile: Address; keyManager: Address } {
  const p = m.plan;
  const c = computeERC1167Addresses(p.factory, p.primaryContractDeploymentInit, p.secondaryContractDeploymentInit, p.postDeploymentModule, p.postDeploymentModuleCalldata);
  const deploy = encodeFunctionData({
    abi: LSP23_ABI,
    functionName: "deployERC1167Proxies",
    args: [{ ...p.primaryContractDeploymentInit, fundingAmount: 0n }, { ...p.secondaryContractDeploymentInit, fundingAmount: 0n }, p.postDeploymentModule, p.postDeploymentModuleCalldata],
  });
  const ok = c.profile === getAddress(m.profile) && c.keyManager === getAddress(m.keyManager) && deploy.toLowerCase() === m.deployCalldata.toLowerCase();
  return { ok, profile: c.profile, keyManager: c.keyManager };
}

// ---------------------------------------------------------------------------
// Deploy + verify
// ---------------------------------------------------------------------------

export async function checkPrerequisites(ctx: VerbContext, chainId: number, plan: Pick<Lsp23Plan, "factory" | "postDeploymentModule" | "implementations">): Promise<Record<string, boolean>> {
  const req: Record<string, Address> = {
    LSP23LinkedContractsFactory: plan.factory,
    UniversalProfileInitPostDeploymentModule: plan.postDeploymentModule,
    UniversalProfileInit: plan.implementations.universalProfileInit.address,
    LSP6KeyManagerInit: plan.implementations.keyManagerInit.address,
    LSP1UniversalReceiverDelegateUP: plan.implementations.universalReceiverDelegate.address,
  };
  const out: Record<string, boolean> = {};
  for (const [n, a] of Object.entries(req)) out[n] = await hasCode(ctx, chainId, a);
  return out;
}

/** Smoke reads after deployment: owner/KM link, interfaces, controller permissions, URD. */
export async function verifyDeployment(ctx: VerbContext, chainId: number, m: Pick<DeploymentManifest, "profile" | "keyManager" | "controller" | "permissions" | "plan">): Promise<Record<string, boolean>> {
  const km = await resolveKeyManager(ctx, chainId, m.profile);
  const ctl = await readControllerPermissions(ctx, chainId, m.profile, m.controller);
  const urd = await getData(ctx, chainId, m.profile, DATA_KEYS.LSP1UniversalReceiverDelegate);
  return {
    profileHasCode: await hasCode(ctx, chainId, m.profile),
    keyManagerHasCode: await hasCode(ctx, chainId, m.keyManager),
    ownerIsKeyManager: km.owner === getAddress(m.keyManager),
    keyManagerTargetIsProfile: km.keyManager === getAddress(m.keyManager),
    supportsLSP0: await supportsInterface(ctx, chainId, m.profile, INTERFACE_IDS.LSP0ERC725Account),
    keyManagerSupportsLSP6: await supportsInterface(ctx, chainId, m.keyManager, INTERFACE_IDS.LSP6KeyManager),
    controllerPermissionsMatch: ctl.permissions.hex.toLowerCase() === m.permissions.toLowerCase(),
    universalReceiverDelegateSet: urd.toLowerCase() === m.plan.implementations.universalReceiverDelegate.address.toLowerCase(),
  };
}

export interface DeployOutcome {
  chainId: number;
  profile: Address;
  keyManager: Address;
  /** Gas the agent's key needs for the deployment, its balance and what is missing (dry-run and errors). */
  gas?: { payer: Address; symbol: string; maxCost: string; balance: string; enough: boolean; missing?: string; suggestedFunding?: string };
  status: "dry-run" | "deployed" | "already-deployed";
  txHash?: Hex;
  blockNumber?: string;
  gasUsed?: string;
  explorerUrl?: string;
  verified?: Record<string, boolean>;
  onChainCompute?: { profile: Address; keyManager: Address; matches: boolean };
  prerequisites: Record<string, boolean>;
  confirmation: Record<string, unknown>;
}

/**
 * Deploys (or verifies an existing deployment of) the manifest on `chainId`.
 * Sequence: prerequisites → on-chain address cross-check → simulate → consent → send → verify.
 */
export async function deployFromManifest(ctx: VerbContext, signer: Signer, m: DeploymentManifest, chainId: number, verb = "account deploy"): Promise<DeployOutcome> {
  const v = verifyManifest(m);
  if (!v.ok) throw new UpError("INTERNAL", "deployment manifest is inconsistent (stored addresses/calldata do not re-derive)", { hint: "do not edit manifests by hand; re-run up account precompute", details: v });
  const prerequisites = await checkPrerequisites(ctx, chainId, m.plan);
  const missing = Object.entries(prerequisites).filter(([, ok]) => !ok).map(([n]) => n);
  if (missing.length) {
    throw new UpError("NOT_DEPLOYED", `the canonical LSP contracts are missing on chain ${chainId}: ${missing.join(", ")}`, {
      hint: "these are deployed through Nick's factory with fixed salts; check: up chains verify " + chainId,
      details: prerequisites,
    });
  }
  const onchain = await computeOnChain(ctx, chainId, m.plan);
  const onChainCompute = { ...onchain, matches: onchain.profile === getAddress(m.profile) && onchain.keyManager === getAddress(m.keyManager) };
  if (!onChainCompute.matches) {
    throw new UpError("INTERNAL", `factory on chain ${chainId} computes ${onchain.profile}/${onchain.keyManager}, manifest says ${m.profile}/${m.keyManager}`, { hint: "the factory at the canonical address behaves differently on this chain; do not deploy", details: onChainCompute });
  }
  const confirmation = {
    action: "deploy Universal Profile via LSP23",
    chainId,
    profile: m.profile,
    keyManager: m.keyManager,
    factory: m.plan.factory,
    gasPayer: `controller EOA ${signer.address}`,
    initialController: m.controller,
    controllerPermissions: { hex: m.permissions, names: m.permissionNames, preset: m.preset },
    universalReceiverDelegate: m.plan.implementations.universalReceiverDelegate.address,
    implementations: m.plan.implementations,
    salt: m.salt,
    value: "0",
    calldata: m.deployCalldata,
  };
  if (await hasCode(ctx, chainId, m.profile)) {
    const verified = await verifyDeployment(ctx, chainId, m);
    const rec: DeploymentRecord = { chainId, status: "already-deployed", deployedAt: new Date().toISOString(), verified };
    m.deployments[String(chainId)] = { ...(m.deployments[String(chainId)] ?? {}), ...rec };
    if (!m.chains.includes(chainId)) m.chains.push(chainId);
    if (!ctx.flags.dryRun) await saveManifest(ctx.home, m);
    return { chainId, profile: m.profile, keyManager: m.keyManager, status: "already-deployed", verified, onChainCompute, prerequisites, confirmation };
  }
  await simulate(ctx, { chainId, from: signer.address, to: m.plan.factory, data: m.deployCalldata });
  // Gas the agent's key needs, and what it holds: the dry-run answers "how much must the human send?"
  // so nobody tries a real deployment just to find out.
  const g = await gasCheck(ctx, signer.address, { chainId, to: m.plan.factory, data: m.deployCalldata });
  const symbol = await (async () => { try { const { displaySymbol } = await import("../chain/funding.ts"); return displaySymbol(ctx.registry.chain(chainId).nativeSymbol); } catch { return "native"; } })();
  const gasInfo = { payer: signer.address, symbol, maxCost: formatEther(g.maxCostWei), balance: formatEther(g.balanceWei), enough: g.enough, ...(g.enough ? {} : { missing: formatEther(g.shortfallWei), suggestedFunding: formatEther(g.suggestedFundingWei) }) };
  (confirmation as Record<string, unknown>).gas = gasInfo;
  if (!g.enough && !ctx.flags.dryRun) {
    throw new UpError("TX_FAILED", `the agent's key ${signer.address} needs gas on chain ${chainId}: it has ${gasInfo.balance} ${symbol}, the deployment may cost up to ${gasInfo.maxCost} ${symbol}`, {
      hint: `ask the human to send about ${gasInfo.suggestedFunding} ${symbol} to ${signer.address} (show it as a QR: up display address ${signer.address} --chain ${chainId}); then deploy. The human only sends gas; never ask them to sign, connect a wallet or pay the deployment`,
      details: { reason: "needs-gas", gas: gasInfo },
    });
  }
  await ctx.consent({ verb, risk: "write", chainId, summary: confirmation, value: 0n, target: m.plan.factory, selector: m.deployCalldata.slice(0, 10) as Hex });
  if (ctx.flags.dryRun) return { chainId, profile: m.profile, keyManager: m.keyManager, status: "dry-run", onChainCompute, prerequisites, confirmation, gas: gasInfo };
  const tx = await sendTx(ctx, signer, { chainId, to: m.plan.factory, data: m.deployCalldata });
  const verified = await verifyDeployment(ctx, chainId, m);
  const allOk = Object.values(verified).every(Boolean);
  m.deployments[String(chainId)] = { chainId, status: "deployed", txHash: tx.hash, blockNumber: tx.blockNumber, deployedAt: new Date().toISOString(), deployer: signer.address, verified };
  if (!m.chains.includes(chainId)) m.chains.push(chainId);
  await saveManifest(ctx.home, m);
  if (!allOk) {
    throw new UpError("TX_FAILED", `deployment transaction ${tx.hash} succeeded but post-deployment checks failed`, { details: verified });
  }
  return { chainId, profile: m.profile, keyManager: m.keyManager, status: "deployed", txHash: tx.hash, blockNumber: tx.blockNumber, gasUsed: tx.gasUsed, explorerUrl: tx.explorerUrl, verified, onChainCompute, prerequisites, confirmation };
}
