import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { concat, encodeAbiParameters, getAddress, getContractAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { ERC725, encodePermissions as e725EncodePermissions } from "@erc725/erc725.js";
import { LSP6Schema } from "@erc725/erc725.js/schemas";
import {
  ENTRYPOINT_ALLOWED_PERMISSIONS,
  ENTRYPOINT_FORBIDDEN_PERMISSIONS,
  ENTRYPOINT_V06,
  EXTENSION_4337_KEY,
  NICK_FACTORY,
  P,
  PERMISSION_4337,
} from "../../../src/erc4337/constants.ts";
import {
  allowedCallsKey,
  allowedDataKeysKey,
  arrayIndexKey,
  arrayLengthKey,
  decodeAllowedCalls,
  decodeCompactBytesArray,
  encodeAllowedCalls,
  encodeAllowedDataKeys,
  encodeArrayLength,
  encodePermissions,
  permissionNames,
  permissionsFromNames,
  permissionsKey,
  type ControllerData,
} from "../../../src/erc4337/lsp6.ts";
import { entryPointAsset, extensionAddressFor, extensionAsset, extensionInitCode, sha256Hex } from "../../../src/erc4337/bytecode.ts";
import { buildDisablePlan, buildEnablePlan, computeEntryPointScope, type Status4337 } from "../../../src/erc4337/extension.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const fixture = (n: string) => JSON.parse(readFileSync(join(root, "test", "fixtures", "bytecode", `${n}.json`), "utf8"));
const CTL = getAddress("0xcafecafecafecafecafecafecafecafecafecafe");
const AGENT = getAddress("0xa9e17a9e17a9e17a9e17a9e17a9e17a9e17a9e17");
const UP = "0x1111111111111111111111111111111111111111" as Address;
const ALL_PERMISSIONS = 0x7f3f7fn;

describe("Extension4337 data key and 4337 permission", () => {
  it("LSP17Extension:<validateUserOp v0.6> key", () => {
    expect(EXTENSION_4337_KEY).toBe("0xcee78b4094da8601109600003a871cdd00000000000000000000000000000000");
    // LSP17 prefix = bytes10(keccak256("LSP17Extension")) ++ 0000
    expect(EXTENSION_4337_KEY.slice(0, 22)).toBe(keccak256(toBytes("LSP17Extension")).slice(0, 22));
  });
  it("_4337_PERMISSION is bit 23 and outside ALL_PERMISSIONS", () => {
    expect(PERMISSION_4337).toBe(0x800000n);
    expect(encodePermissions(PERMISSION_4337)).toBe("0x0000000000000000000000000000000000000000000000000000000000800000");
    expect(BigInt(e725EncodePermissions({ ALL_PERMISSIONS: true }))).toBe(ALL_PERMISSIONS);
    expect(ALL_PERMISSIONS & PERMISSION_4337).toBe(0n);
    expect(permissionNames(ALL_PERMISSIONS | PERMISSION_4337)).toContain("ERC4337");
    expect(permissionsFromNames(["4337", "CALL"])).toBe(PERMISSION_4337 | P.CALL);
    expect(() => permissionsFromNames(["NOPE"])).toThrow(/unknown LSP6 permission/);
  });
  it("permission bits 0..22 agree with erc725.js", () => {
    for (const name of ["CHANGEOWNER", "ADDCONTROLLER", "EDITPERMISSIONS", "ADDEXTENSIONS", "CHANGEEXTENSIONS", "SUPER_TRANSFERVALUE", "TRANSFERVALUE", "SUPER_CALL", "CALL", "SUPER_STATICCALL", "STATICCALL", "DEPLOY", "SUPER_SETDATA", "SETDATA", "SIGN", "EXECUTE_RELAY_CALL"] as const) {
      expect(BigInt(e725EncodePermissions({ [name]: true } as any)), name).toBe(P[name]);
    }
  });
  it("EntryPoint permission policy never includes admin bits", () => {
    for (const n of ["CHANGEOWNER", "ADDCONTROLLER", "EDITPERMISSIONS", "ADDEXTENSIONS", "CHANGEEXTENSIONS", "DELEGATECALL", "SUPER_DELEGATECALL", "REENTRANCY", "ERC4337"] as const) {
      expect(ENTRYPOINT_FORBIDDEN_PERMISSIONS).toContain(n);
      expect(ENTRYPOINT_ALLOWED_PERMISSIONS).not.toContain(n);
    }
  });
});

describe("local LSP6 encodings vs erc725.js", () => {
  it("controller keys", () => {
    const e = ERC725.encodeData([{ keyName: "AddressPermissions:Permissions:<address>", dynamicKeyParts: CTL, value: ["0x0000000000000000000000000000000000000000000000000000000000000800"] as any }], LSP6Schema);
    expect(e.keys[0]).toBe(permissionsKey(CTL));
    expect(ERC725.encodeKeyName("AddressPermissions:AllowedCalls:<address>", CTL)).toBe(allowedCallsKey(CTL));
    expect(ERC725.encodeKeyName("AddressPermissions:AllowedERC725YDataKeys:<address>", CTL)).toBe(allowedDataKeysKey(CTL));
  });
  it("AddressPermissions[] length and index keys", () => {
    const enc = ERC725.encodeData([{ keyName: "AddressPermissions[]", value: [CTL, AGENT, UP] }], LSP6Schema);
    expect(enc.keys[0]).toBe(arrayLengthKey);
    expect(enc.values[0]).toBe(encodeArrayLength(3n));
    expect(enc.keys.slice(1)).toEqual([arrayIndexKey(0), arrayIndexKey(1), arrayIndexKey(2)]);
    expect(encodeArrayLength(3n)).toHaveLength(2 + 32);
  });
  it("AllowedCalls encode like erc725.js and round-trip", () => {
    const ours = encodeAllowedCalls([
      { callTypes: ["CALL", "VALUE"], address: CTL, function: "0xa9059cbb" },
      { callTypes: "0x00000004", address: "*", standard: "0x12345678" },
    ]);
    const theirs = ERC725.encodeData([{ keyName: "AddressPermissions:AllowedCalls:<address>", dynamicKeyParts: CTL, value: [["0x00000003", CTL, "0xffffffff", "0xa9059cbb"], ["0x00000004", "0xffffffffffffffffffffffffffffffffffffffff", "0x12345678", "0xffffffff"]] as any }], LSP6Schema);
    expect(ours).toBe(theirs.values[0]);
    const back = decodeAllowedCalls(ours);
    expect(back[0]).toMatchObject({ callTypeNames: ["VALUE", "CALL"], address: CTL, standard: "*", function: "0xa9059cbb" });
    expect(back[1]).toMatchObject({ address: "*", standard: "0x12345678", function: "*" });
    expect(() => encodeAllowedCalls([{ callTypes: ["CALL"], address: "*" }])).toThrow(/InvalidWhitelistedCall/);
    expect(() => encodeAllowedCalls([{ callTypes: ["DELEGATECALL"], address: CTL }])).toThrow(/DELEGATECALL/);
    expect(encodeAllowedCalls([])).toBe("0x");
  });
  it("AllowedERC725YDataKeys encode like erc725.js", () => {
    const keys = ["0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5", "0x0cfc51aec37c55a4d0b1"];
    expect(encodeAllowedDataKeys(keys)).toBe(ERC725.encodeData([{ keyName: "AddressPermissions:AllowedERC725YDataKeys:<address>", dynamicKeyParts: CTL, value: keys }], LSP6Schema).values[0]);
    expect(decodeCompactBytesArray(encodeAllowedDataKeys(keys))).toEqual(keys);
    expect(() => decodeCompactBytesArray("0x0005aa")).toThrow(/malformed/);
  });
});

describe("bundled deploy bytecode (assets/bytecode)", () => {
  it("EntryPoint v0.6: creation code = pinned fixture, sha256/keccak recorded, CREATE2(Nick, 0) = canonical address", () => {
    const a = entryPointAsset();
    expect(a.creationCode).toBe(fixture("EntryPointV06").bytecode);
    expect(sha256Hex(a.creationCode)).toBe(a.creationCodeSha256);
    expect(createHash("sha256").update(Buffer.from(a.creationCode.slice(2), "hex")).digest("hex")).toBe(a.creationCodeSha256);
    expect(keccak256(a.creationCode)).toBe(a.creationCodeKeccak256);
    expect(a.deployment.factory).toBe(NICK_FACTORY);
    expect(a.deployment.salt).toBe("0x" + "00".repeat(32));
    expect(getContractAddress({ opcode: "CREATE2", from: NICK_FACTORY, salt: a.deployment.salt, bytecode: a.creationCode })).toBe(ENTRYPOINT_V06);
    expect(a.deployment.address).toBe(ENTRYPOINT_V06);
    // canonical runtime hash observed on LUKSO Testnet / Ethereum / Base (eth_getCode at 0x5FF1…2789)
    expect(a.runtimeCodeHash).toBe("0xc93c806e738300b5357ecdc2e971d6438d34d8e4e17b99b758b1f9cac91c8e70");
  });
  it("Extension4337: creation code = pinned fixture, documented salt, deterministic address per EntryPoint", () => {
    const a = extensionAsset();
    expect(a.creationCode).toBe(fixture("Extension4337").bytecode);
    expect(sha256Hex(a.creationCode)).toBe(a.creationCodeSha256);
    expect(a.deployment.salt).toBe(keccak256(toBytes(a.deployment.saltPreimage)));
    expect(a.deployment.saltPreimage).toBe("universal-profile-skill:Extension4337:v1");
    const init = concat([a.creationCode, encodeAbiParameters([{ type: "address" }], [ENTRYPOINT_V06])]);
    expect(extensionInitCode(ENTRYPOINT_V06)).toBe(init);
    expect(keccak256(init)).toBe(a.deployment.canonical.initCodeHash);
    const addr = getContractAddress({ opcode: "CREATE2", from: NICK_FACTORY, salt: a.deployment.salt, bytecode: init });
    expect(addr).toBe(a.deployment.canonical.address);
    expect(extensionAddressFor(ENTRYPOINT_V06)).toBe(addr);
    expect(addr).toBe("0xff49b05D73453e799cc8e402a09CcaEf78EdeB28");
    expect(extensionAddressFor("0x0000000071727De22E5E9d8BAf0edAc6f37da032")).not.toBe(addr);
  });
  it("provenance is recorded", () => {
    expect(entryPointAsset().provenance).toMatchObject({ package: "@account-abstraction/contracts", packageVersion: "0.6.0" });
    expect(extensionAsset().provenance).toMatchObject({ package: "@lukso/lsp17-contracts" });
    expect(String(extensionAsset().provenance.compiler)).toMatch(/0\.8\.17/);
  });
});

// ---------------------------------------------------------------------------

const ctl = (address: Address, permissions: bigint, allowedCalls: Hex = "0x", allowedDataKeys: Hex = "0x"): ControllerData => ({ address, permissions, allowedCalls, allowedDataKeys });
const NONE = ctl(ENTRYPOINT_V06, 0n);

describe("EntryPoint controller scope", () => {
  const calls = encodeAllowedCalls([{ callTypes: ["CALL", "VALUE"], address: CTL }]);
  it("mirror refuses to widen an unrestricted (SUPER_*) agent implicitly", () => {
    let err: any;
    try {
      computeEntryPointScope({}, ctl(AGENT, ALL_PERMISSIONS), NONE);
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("BAD_ARGS");
    expect(err.message).toMatch(/never mirrored implicitly/);
    expect(err.hint).toMatch(/--ep-scope super/);
  });
  it("mirror copies plain bits and the agent's allow-lists", () => {
    const s = computeEntryPointScope({}, ctl(AGENT, P.CALL | P.TRANSFERVALUE | P.SIGN | P.EXECUTE_RELAY_CALL, calls), NONE);
    expect(s.mode).toBe("mirror");
    expect(s.permissions).toBe(P.CALL | P.TRANSFERVALUE);
    expect(s.allowedCalls).toBe(calls);
    expect(s.allowedDataKeys).toBe("0x");
  });
  it("mirror drops bits without an allow-list and maps SUPER_x with allow-lists to x", () => {
    const s = computeEntryPointScope({ scope: "mirror" }, ctl(AGENT, P.SUPER_CALL | P.SETDATA, calls), NONE);
    expect(s.permissions).toBe(P.CALL);
    expect(s.warnings.join()).toMatch(/SETDATA/);
    expect(s.warnings.join()).toMatch(/SUPER_CALL/);
  });
  it("super grants exactly the four SUPER execution bits", () => {
    const s = computeEntryPointScope({ scope: "super" }, ctl(AGENT, ALL_PERMISSIONS), NONE);
    expect(permissionNames(s.permissions).sort()).toEqual(["SUPER_CALL", "SUPER_SETDATA", "SUPER_STATICCALL", "SUPER_TRANSFERVALUE"]);
  });
  it("custom validates bits and allow-lists", () => {
    expect(() => computeEntryPointScope({ scope: "custom", permissions: ["CALL", "ADDCONTROLLER"] }, ctl(AGENT, ALL_PERMISSIONS), NONE)).toThrow(/never hold ADDCONTROLLER/);
    expect(() => computeEntryPointScope({ scope: "custom", permissions: ["CALL"] }, ctl(AGENT, ALL_PERMISSIONS), NONE)).toThrow(/allows nothing/);
    expect(() => computeEntryPointScope({ scope: "custom" }, ctl(AGENT, ALL_PERMISSIONS), NONE)).toThrow(/--ep-permissions/);
    const s = computeEntryPointScope({ scope: "custom", permissions: ["CALL", "SUPER_SETDATA"], allowedCalls: [{ callTypes: ["CALL"], address: CTL }] }, ctl(AGENT, ALL_PERMISSIONS), NONE);
    expect(s.permissions).toBe(P.CALL | P.SUPER_SETDATA);
  });
  it("an existing EntryPoint controller is kept unless a scope is given", () => {
    const cur = ctl(ENTRYPOINT_V06, P.SUPER_CALL | P.ADDCONTROLLER);
    const s = computeEntryPointScope({}, ctl(AGENT, ALL_PERMISSIONS), cur);
    expect(s.mode).toBe("keep");
    expect(s.permissions).toBe(cur.permissions);
    expect(s.warnings.join()).toMatch(/ADDCONTROLLER/);
  });
});

function fakeStatus(over: { linked?: Address | null; linkedMatches?: boolean; ep?: ControllerData; signer?: ControllerData; array?: (Address | undefined)[] } = {}): Status4337 {
  const array = over.array ?? [CTL, AGENT];
  const ep = over.ep ?? NONE;
  const signer = over.signer ?? ctl(AGENT, ALL_PERMISSIONS);
  const idx = array.findIndex((a) => a?.toLowerCase() === ENTRYPOINT_V06.toLowerCase());
  return {
    chainId: 31337,
    profile: UP,
    keyManager: CTL,
    entryPoint: {} as any,
    nickFactory: {} as any,
    extension: { expected: "0xff49b05D73453e799cc8e402a09CcaEf78EdeB28", deployed: true, linked: over.linked ?? null, linkedHasCode: !!over.linked, linkedEntryPoint: null, linkedMatches: over.linkedMatches ?? false, linkedIsBundled: false },
    entryPointController: { address: ENTRYPOINT_V06, permissions: encodePermissions(ep.permissions), permissionNames: [], isController: ep.permissions !== 0n, inArray: idx >= 0, arrayIndex: idx, allowedCalls: [], allowedDataKeys: [], forbidden: [] },
    signer: { address: AGENT, permissions: encodePermissions(signer.permissions), permissionNames: [], has4337: (signer.permissions & PERMISSION_4337) !== 0n },
    deposit: 0n,
    enabled: false,
    missing: [],
    raw: { signer, entryPoint: ep, array: { length: BigInt(array.length), entries: array } },
  };
}

describe("enable / disable setDataBatch plans", () => {
  it("enable: link extension, add EntryPoint controller to AddressPermissions[], grant bit 23", () => {
    const s = fakeStatus();
    const scope = computeEntryPointScope({ scope: "super" }, s.raw.signer, s.raw.entryPoint);
    const plan = buildEnablePlan(s, scope, s.extension.expected);
    const byKey = Object.fromEntries(plan.keys.map((k, i) => [k, plan.values[i]]));
    expect(byKey[EXTENSION_4337_KEY]).toBe(s.extension.expected.toLowerCase());
    expect(BigInt(byKey[permissionsKey(ENTRYPOINT_V06)])).toBe(P.SUPER_CALL | P.SUPER_TRANSFERVALUE | P.SUPER_STATICCALL | P.SUPER_SETDATA);
    expect(byKey[arrayIndexKey(2)]).toBe(ENTRYPOINT_V06.toLowerCase());
    expect(byKey[arrayLengthKey]).toBe(encodeArrayLength(3n));
    expect(BigInt(byKey[permissionsKey(AGENT)])).toBe(ALL_PERMISSIONS | PERMISSION_4337);
    expect(plan.keys).not.toContain(allowedCallsKey(ENTRYPOINT_V06)); // unchanged 0x → 0x omitted
    expect(plan.payload!.slice(0, 10)).toBe("0x97902421");
    expect(plan.changes.find((c) => c.key === EXTENSION_4337_KEY)!.requires).toBe("ADDEXTENSIONS");
  });
  it("enable is idempotent when everything is in place", () => {
    const ep = ctl(ENTRYPOINT_V06, P.SUPER_CALL);
    const s = fakeStatus({ linked: "0xff49b05D73453e799cc8e402a09CcaEf78EdeB28", linkedMatches: true, ep, signer: ctl(AGENT, ALL_PERMISSIONS | PERMISSION_4337), array: [CTL, ENTRYPOINT_V06, AGENT] });
    const plan = buildEnablePlan(s, computeEntryPointScope({}, s.raw.signer, ep), s.extension.expected);
    expect(plan.keys).toEqual([]);
    expect(plan.payload).toBeUndefined();
  });
  it("enable refuses to grant bit 23 to a non-controller", () => {
    const s = fakeStatus({ signer: ctl(AGENT, 0n) });
    expect(() => buildEnablePlan(s, computeEntryPointScope({ scope: "super" }, s.raw.signer, NONE), s.extension.expected)).toThrow(/not a controller/);
  });
  it("disable: clears the key, removes the EntryPoint (swap-with-last), removes bit 23", () => {
    const ep = ctl(ENTRYPOINT_V06, P.CALL, encodeAllowedCalls([{ callTypes: ["CALL"], address: CTL }]));
    const s = fakeStatus({ linked: "0xff49b05D73453e799cc8e402a09CcaEf78EdeB28", linkedMatches: true, ep, signer: ctl(AGENT, ALL_PERMISSIONS | PERMISSION_4337), array: [CTL, ENTRYPOINT_V06, AGENT] });
    const plan = buildDisablePlan(s);
    const byKey = Object.fromEntries(plan.keys.map((k, i) => [k, plan.values[i]]));
    expect(byKey[EXTENSION_4337_KEY]).toBe("0x");
    expect(byKey[permissionsKey(ENTRYPOINT_V06)]).toBe("0x");
    expect(byKey[allowedCallsKey(ENTRYPOINT_V06)]).toBe("0x");
    expect(byKey[arrayIndexKey(1)]).toBe(AGENT.toLowerCase());
    expect(byKey[arrayIndexKey(2)]).toBe("0x");
    expect(byKey[arrayLengthKey]).toBe(encodeArrayLength(2n));
    expect(BigInt(byKey[permissionsKey(AGENT)])).toBe(ALL_PERMISSIONS);
    expect(buildDisablePlan(s, { keepSignerPermission: true }).keys).not.toContain(permissionsKey(AGENT));
  });
  it("disable of the last array slot only shrinks", () => {
    const s = fakeStatus({ ep: ctl(ENTRYPOINT_V06, P.SUPER_CALL), array: [CTL, AGENT, ENTRYPOINT_V06] });
    const plan = buildDisablePlan(s);
    const byKey = Object.fromEntries(plan.keys.map((k, i) => [k, plan.values[i]]));
    expect(byKey[arrayIndexKey(2)]).toBe("0x");
    expect(byKey[arrayIndexKey(1)]).toBeUndefined();
    expect(byKey[arrayLengthKey]).toBe(encodeArrayLength(2n));
  });
});
