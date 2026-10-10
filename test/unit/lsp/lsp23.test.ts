import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, getContractAddress, keccak256, type Hex } from "viem";
import { ERC725 } from "@erc725/erc725.js";
import { LSP6Schema } from "@erc725/erc725.js/schemas";
import { LSP } from "../../../src/chain/registry.ts";
import { LSP23_ABI } from "../../../src/lsp/abis.ts";
import { ALL_PERMISSIONS_HEX, DATA_KEYS, URD_PERMISSIONS, permissionsKey } from "../../../src/lsp/constants.ts";
import { toBytes32 } from "../../../src/lsp/permissions.ts";
import { buildInitialData, candidateSalts, computeERC1167Addresses, erc1167InitCode, manifestFromPlan, planDeployment, verifyManifest } from "../../../src/lsp/lsp23.ts";

const CTL = "0x1111111111111111111111111111111111111111" as const;
const SALT = ("0x" + "42".repeat(32)) as Hex;
const base = { salt: SALT, controller: CTL, permissions: ALL_PERMISSIONS_HEX, preset: "agent-owner" };

describe("LSP23 plan (UniversalProfileInit + KeyManagerInit + post-deployment module)", () => {
  it("uses the canonical factory, module and v0.14.0 implementations and the canonical init calldata", () => {
    const p = planDeployment(base);
    expect(p.factory).toBe(LSP.LSP23_FACTORY);
    expect(p.postDeploymentModule).toBe(LSP.UP_INIT_POST_DEPLOYMENT_MODULE);
    expect(p.implementations.universalProfileInit.address).toBe(LSP.UP_INIT["0.14.0"]);
    expect(p.implementations.keyManagerInit.address).toBe(LSP.KM_INIT["0.14.0"]);
    expect(p.implementations.universalReceiverDelegate.address).toBe(LSP.URD["0.14.0"]);
    // UP initialize(postDeploymentModule) so the module can delegatecall setDataAndTransferOwnership
    expect(p.primaryContractDeploymentInit.initializationCalldata).toBe("0xc4d66de8" + "000000000000000000000000" + LSP.UP_INIT_POST_DEPLOYMENT_MODULE.slice(2).toLowerCase());
    expect(p.secondaryContractDeploymentInit).toMatchObject({ initializationCalldata: "0xc4d66de8", addPrimaryContractAddress: true, extraInitializationParams: "0x", fundingAmount: "0" });
    const d = decodeFunctionData({ abi: LSP23_ABI, data: p.deployCalldata });
    expect(d.functionName).toBe("deployERC1167Proxies");
    expect(p.deployCalldata.slice(0, 10)).toBe("0x6a66a753");
  });

  it("post-deployment calldata = abi.encode(bytes32[] keys, bytes[] values) with controller, URD and permissions", () => {
    const p = planDeployment(base);
    const [keys, values] = decodeAbiParameters([{ type: "bytes32[]" }, { type: "bytes[]" }], p.postDeploymentModuleCalldata);
    const kv = Object.fromEntries(keys.map((k, i) => [k.toLowerCase(), values[i].toLowerCase()]));
    const urd = LSP.URD["0.14.0"];
    expect(kv[DATA_KEYS.LSP1UniversalReceiverDelegate]).toBe(urd.toLowerCase());
    expect(kv[permissionsKey(urd)]).toBe(toBytes32(URD_PERMISSIONS));
    expect(kv[permissionsKey(CTL)]).toBe(ALL_PERMISSIONS_HEX);
    expect(kv[DATA_KEYS["SupportedStandards:LSP3Profile"]]).toBe("0x5ef83ad9");
    // AddressPermissions[] cross-checked with erc725.js array encoding (16-byte length, controller then URD)
    const arr = ERC725.encodeData([{ keyName: "AddressPermissions[]", value: [CTL, urd] }], LSP6Schema);
    arr.keys.forEach((k, i) => expect(kv[k.toLowerCase()]).toBe(arr.values[i].toLowerCase()));
  });

  it("local address computation equals the factory formula (salt → generated salt → ERC-1167 CREATE2)", () => {
    const p = planDeployment(base);
    const gen = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes" }, { type: "bool" }, { type: "bytes" }, { type: "address" }, { type: "bytes" }], [SALT, LSP.KM_INIT["0.14.0"], "0xc4d66de8", true, "0x", LSP.UP_INIT_POST_DEPLOYMENT_MODULE, p.postDeploymentModuleCalldata]));
    expect(p.generatedSalt).toBe(gen);
    expect(p.profile).toBe(getContractAddress({ opcode: "CREATE2", from: LSP.LSP23_FACTORY, salt: gen, bytecode: erc1167InitCode(LSP.UP_INIT["0.14.0"]) }));
    expect(p.keyManager).toBe(getContractAddress({ opcode: "CREATE2", from: LSP.LSP23_FACTORY, salt: keccak256(p.profile), bytecode: erc1167InitCode(LSP.KM_INIT["0.14.0"]) }));
    expect(erc1167InitCode(LSP.UP_INIT["0.14.0"])).toBe("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + LSP.UP_INIT["0.14.0"].slice(2) + "5af43d82803e903d91602b57fd5bf3");
  });

  it("determinism: same inputs ⇒ same addresses (no chainId in the derivation); any input change ⇒ different address", () => {
    const a = planDeployment(base);
    expect(planDeployment({ ...base }).profile).toBe(a.profile);
    expect(planDeployment({ ...base, salt: ("0x" + "43".repeat(32)) as Hex }).profile).not.toBe(a.profile);
    expect(planDeployment({ ...base, controller: "0x2222222222222222222222222222222222222222" }).profile).not.toBe(a.profile);
    expect(planDeployment({ ...base, permissions: toBytes32(0x800n) }).profile).not.toBe(a.profile);
    expect(planDeployment({ ...base, implementationVersion: "0.12.1" }).profile).not.toBe(a.profile);
    expect(planDeployment({ ...base, lsp3: "0x00006f357c6a" }).profile).not.toBe(a.profile);
    const c = computeERC1167Addresses(a.factory, a.primaryContractDeploymentInit, a.secondaryContractDeploymentInit, a.postDeploymentModule, a.postDeploymentModuleCalldata);
    expect(c.profile).toBe(a.profile);
  });

  it("candidate salts are reproducible from the seed", () => {
    const seed = ("0x" + "ab".repeat(32)) as Hex;
    const s = candidateSalts(seed, 5);
    expect(new Set(s).size).toBe(5);
    expect(candidateSalts(seed, 5)).toEqual(s);
    expect(candidateSalts(seed, 1, 3)[0]).toBe(s[3]);
    expect(() => candidateSalts("0x12" as Hex, 1)).toThrow();
    expect(() => candidateSalts(seed, 0)).toThrow();
  });

  it("manifest re-derives its addresses and detects tampering", () => {
    const p = planDeployment(base);
    const m = manifestFromPlan(base, p, { seed: SALT, candidateIndex: 0 });
    expect(verifyManifest(m).ok).toBe(true);
    expect(m.permissionNames).toContain("CHANGEOWNER");
    const t = structuredClone(m);
    t.plan.postDeploymentModuleCalldata = (t.plan.postDeploymentModuleCalldata.slice(0, -2) + "ff") as Hex;
    expect(verifyManifest(t).ok).toBe(false);
  });

  it("rejects bad inputs", () => {
    expect(() => planDeployment({ ...base, salt: "0x01" as Hex })).toThrow();
    expect(() => planDeployment({ ...base, permissions: toBytes32(0n) })).toThrow(/non-zero/);
    expect(() => buildInitialData(LSP.URD["0.14.0"], ALL_PERMISSIONS_HEX, LSP.URD["0.14.0"])).toThrow(/Universal Receiver Delegate/);
    expect(() => buildInitialData(CTL, ALL_PERMISSIONS_HEX, LSP.URD["0.14.0"], { extraControllers: [{ address: CTL, permissions: ALL_PERMISSIONS_HEX }] })).toThrow(/twice/);
    expect(() => planDeployment({ ...base, implementationVersion: "9.9.9" })).toThrow();
  });
});
