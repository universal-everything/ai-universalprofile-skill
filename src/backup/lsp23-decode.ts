// Reads the LSP23 deployment data of a backup file: decodes the `deployERC1167Proxies` calldata,
// re-derives the profile address from it (the app's anti-impersonation proof), lists the initial
// controllers with their permissions as they are encoded in the calldata, and rebuilds a local
// DeploymentManifest from it.
//
// The calldata is the truth. The file's `initialControllers` array and `salt` are hints and are
// never used to build anything. Only `deployERC1167Proxies` can be verified (Q12); other calldata
// (`deployContracts`) is reported as unsupported and never turned into a manifest.
import { decodeAbiParameters, decodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { LSP } from "../chain/registry.ts";
import { LSP23_ABI } from "../lsp/abis.ts";
import { DATA_KEYS } from "../lsp/constants.ts";
import { computeERC1167Addresses, manifestFromPlan, verifyManifest, type DeploymentManifest, type Lsp23Plan } from "../lsp/lsp23.ts";
import { decodePermissions } from "../lsp/permissions.ts";
import type { BackupInitialController, BackupLsp23Item } from "./lsp30-format.ts";

const DEPLOY_ERC1167_PROXIES = "0x6a66a753";
const DEPLOY_CONTRACTS = "0x17ad46a8";

export interface DecodedInitialController {
  address: Address;
  /** The bytes32 permission value; all zero when the calldata's value is not a valid one (`permissionsValid` false). */
  permissions: Hex;
  /** A 32-byte value that is a plain permission set (no bit above the lowest 32). */
  permissionsValid: boolean;
  /** Valid and not zero: the controller can actually do something. Only such a controller proves anything. */
  hasPermissions: boolean;
  allowedCalls: Hex;
  allowedERC725YDataKeys: Hex;
  /** The Universal Receiver Delegate set at deployment (a contract, never a key). */
  isUrd: boolean;
}

export interface DecodedDeployment {
  /** False when the calldata is not a decodable `deployERC1167Proxies` call; `reason` says why. */
  supported: boolean;
  reason?: string;
  /** The profile address the calldata derives to with the stated factory. */
  derivedProfile?: Address;
  derivedKeyManager?: Address;
  /** True when the derived profile equals the stated one: the calldata really creates this profile. */
  rederives: boolean;
  canonicalFactory: boolean;
  initialControllers: DecodedInitialController[];
  urd?: Address;
  lsp3?: Hex;
  plan?: Omit<Lsp23Plan, "deployCalldata">;
}

const unsupported = (reason: string): DecodedDeployment => ({ supported: false, reason, rederives: false, canonicalFactory: false, initialControllers: [] });

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const ZERO_PERMISSIONS = `0x${"00".repeat(32)}` as Hex;
/** A bytes32 permission value whose upper 28 bytes are zero: LSP6 permissions are a few low bits, anything else is not one. */
const PERMISSION_VALUE = /^0x0{56}[0-9a-f]{8}$/i;

function addressFromKey(key: Hex, prefix: Hex): Address | undefined {
  return key.toLowerCase().startsWith(prefix.toLowerCase()) && key.length === 66 ? getAddress(`0x${key.slice(26)}`) : undefined;
}

/** Decodes the calldata of one LSP23 item (no network access). */
export function decodeDeployment(item: Pick<BackupLsp23Item, "profileAddress" | "factoryAddress" | "deploymentCalldata">): DecodedDeployment {
  const selector = item.deploymentCalldata.slice(0, 10).toLowerCase();
  if (selector === DEPLOY_CONTRACTS) return unsupported("deployContracts calldata cannot be verified; only deployERC1167Proxies is supported");
  if (selector !== DEPLOY_ERC1167_PROXIES) return unsupported("the calldata is not a deployERC1167Proxies call");
  let primary, secondary, module: Address, moduleData: Hex;
  try {
    const d = decodeFunctionData({ abi: LSP23_ABI, data: item.deploymentCalldata });
    if (d.functionName !== "deployERC1167Proxies") return unsupported("the calldata is not a deployERC1167Proxies call");
    [primary, secondary, module, moduleData] = d.args as unknown as [any, any, Address, Hex];
  } catch {
    return unsupported("the calldata could not be decoded");
  }
  const derived = computeERC1167Addresses(item.factoryAddress, primary, secondary, module, moduleData);

  const perms = new Map<string, DecodedInitialController>();
  const calls = new Map<string, Hex>();
  const dataKeys = new Map<string, Hex>();
  let dataKeyList: Hex[], dataValueList: Hex[];
  try {
    [dataKeyList, dataValueList] = decodeAbiParameters([{ type: "bytes32[]" }, { type: "bytes[]" }], moduleData) as unknown as [Hex[], Hex[]];
  } catch {
    return unsupported("the post-deployment data could not be decoded");
  }
  if (dataKeyList.length !== dataValueList.length) return unsupported("the post-deployment data has lists of different lengths");
  let urd: Address | undefined;
  let lsp3: Hex | undefined;
  dataKeyList.forEach((key, i) => {
    const value = dataValueList[i];
    const p = addressFromKey(key, DATA_KEYS.AddressPermissionsPermissionsPrefix);
    const c = addressFromKey(key, DATA_KEYS.AddressPermissionsAllowedCallsPrefix);
    const k = addressFromKey(key, DATA_KEYS.AddressPermissionsAllowedERC725YDataKeysPrefix);
    if (p) {
      const permissionsValid = PERMISSION_VALUE.test(value);
      perms.set(p, { address: p, permissions: permissionsValid ? (value.toLowerCase() as Hex) : ZERO_PERMISSIONS, permissionsValid, hasPermissions: permissionsValid && BigInt(value) !== 0n, allowedCalls: "0x", allowedERC725YDataKeys: "0x", isUrd: false });
    }
    else if (c) calls.set(c, value);
    else if (k) dataKeys.set(k, value);
    else if (key.toLowerCase() === DATA_KEYS.LSP1UniversalReceiverDelegate.toLowerCase() && value.length === 42 && isAddress(value, { strict: false })) urd = getAddress(value);
    else if (key.toLowerCase() === DATA_KEYS.LSP3Profile.toLowerCase()) lsp3 = value;
  });
  const initialControllers = [...perms.values()].map((c) => ({ ...c, allowedCalls: calls.get(c.address) ?? ("0x" as Hex), allowedERC725YDataKeys: dataKeys.get(c.address) ?? ("0x" as Hex), isUrd: urd !== undefined && sameAddress(c.address, urd) }));

  const versionOf = (table: Record<string, Address>, a: Address) => Object.entries(table).find(([, x]) => sameAddress(x, a))?.[0] ?? "imported";
  const plan: DecodedDeployment["plan"] = urd
    ? {
        factory: getAddress(item.factoryAddress),
        postDeploymentModule: getAddress(module),
        implementations: {
          universalProfileInit: { version: versionOf(LSP.UP_INIT, primary.implementationContract), address: getAddress(primary.implementationContract) },
          keyManagerInit: { version: versionOf(LSP.KM_INIT, secondary.implementationContract), address: getAddress(secondary.implementationContract) },
          universalReceiverDelegate: { version: versionOf(LSP.URD, urd), address: urd },
        },
        dataKeys: dataKeyList,
        dataValues: dataValueList,
        primaryContractDeploymentInit: { salt: primary.salt.toLowerCase() as Hex, fundingAmount: primary.fundingAmount.toString(), implementationContract: getAddress(primary.implementationContract), initializationCalldata: primary.initializationCalldata },
        secondaryContractDeploymentInit: {
          fundingAmount: secondary.fundingAmount.toString(),
          implementationContract: getAddress(secondary.implementationContract),
          initializationCalldata: secondary.initializationCalldata,
          addPrimaryContractAddress: secondary.addPrimaryContractAddress,
          extraInitializationParams: secondary.extraInitializationParams,
        },
        postDeploymentModuleCalldata: moduleData,
        generatedSalt: derived.generatedSalt,
        profile: derived.profile,
        keyManager: derived.keyManager,
      }
    : undefined;
  return {
    supported: true,
    derivedProfile: derived.profile,
    derivedKeyManager: derived.keyManager,
    rederives: sameAddress(derived.profile, item.profileAddress),
    canonicalFactory: sameAddress(item.factoryAddress, LSP.LSP23_FACTORY),
    initialControllers,
    ...(urd ? { urd } : {}),
    ...(lsp3 ? { lsp3 } : {}),
    ...(plan ? { plan } : {}),
  };
}

/** The file's initialControllers as decoded from the calldata, with the key index of every controller whose key the file holds. */
export function initialControllersFor(dec: DecodedDeployment, keyIndexOf: (a: Address) => number | undefined): BackupInitialController[] {
  return dec.initialControllers.map((c) => {
    const idx = c.isUrd ? undefined : keyIndexOf(c.address);
    const names = decodePermissions(c.permissions).names;
    return {
      address: c.address,
      ...(idx !== undefined ? { privateKeyIndex: idx } : {}),
      addressPermissions: { permissions: c.permissions, decodedPermissions: Object.fromEntries(names.map((n) => [n, true])), allowedCalls: c.allowedCalls, allowedERC725YDataKeys: c.allowedERC725YDataKeys },
    };
  });
}

/**
 * Names that the file's `decodedPermissions` lists but the permissions value does not set, or the
 * other way round (Q7: informational, recomputed from the value). Empty when consistent or absent.
 */
export function permissionMismatch(c: { permissions: Hex; decodedPermissions?: Record<string, boolean> }): string[] {
  if (!c.decodedPermissions) return [];
  const real = new Set<string>(decodePermissions(c.permissions).names);
  const listed = new Set(Object.entries(c.decodedPermissions).filter(([, v]) => v === true).map(([k]) => k));
  return [...new Set([...real, ...listed])].filter((n) => real.has(n) !== listed.has(n));
}

/**
 * Rebuilds a local deployment manifest from the calldata alone. `heldKeys` are the addresses whose
 * keys are available; the manifest's `controller` is the first held initial controller (else the
 * first one), so replaying and the post-deployment checks use a key the agent really has.
 * Returns the manifest, or the reason it cannot be trusted. Never returns an unverified manifest:
 * the profile and Key Manager must re-derive and the calldata must re-encode identically.
 */
export function manifestFromBackup(item: BackupLsp23Item, dec: DecodedDeployment, heldKeys: ReadonlySet<string>): { manifest?: DeploymentManifest; reason?: string } {
  if (!dec.supported || !dec.plan) return { reason: dec.reason ?? "the deployment data has no Universal Receiver Delegate" };
  if (!dec.rederives) return { reason: "the calldata does not derive the profile address stated in the file" };
  const controllers = dec.initialControllers.filter((c) => !c.isUrd);
  if (!controllers.length) return { reason: "the calldata has no controller" };
  if (controllers.some((c) => !c.permissionsValid)) return { reason: "a controller's permission value is not a valid permission set" };
  const chosen = controllers.find((c) => c.hasPermissions && heldKeys.has(c.address.toLowerCase())) ?? controllers.find((c) => c.hasPermissions);
  if (!chosen) return { reason: "no controller in the calldata has permissions" };
  if (dec.plan.primaryContractDeploymentInit.fundingAmount !== "0" || dec.plan.secondaryContractDeploymentInit.fundingAmount !== "0") return { reason: "the deployment sends value, which this skill does not replay" };
  const plan: Lsp23Plan = { ...dec.plan, deployCalldata: item.deploymentCalldata };
  const manifest = manifestFromPlan(
    {
      salt: dec.plan.primaryContractDeploymentInit.salt,
      controller: chosen.address,
      permissions: chosen.permissions,
      extraControllers: controllers.filter((c) => c !== chosen).map((c) => ({ address: c.address, permissions: c.permissions })),
      ...(dec.lsp3 ? { lsp3: dec.lsp3 } : {}),
    },
    plan,
  );
  const v = verifyManifest(manifest);
  return v.ok ? { manifest } : { reason: "the rebuilt manifest does not re-derive (the calldata is not the canonical encoding)" };
}
