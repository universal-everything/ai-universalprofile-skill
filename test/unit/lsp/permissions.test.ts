import { describe, expect, it } from "vitest";
import { ERC725, decodePermissions as e725Decode } from "@erc725/erc725.js";
import { LSP6Schema } from "@erc725/erc725.js/schemas";
import type { Hex } from "viem";
import { ALL_PERMISSIONS, CALLTYPE, PERMISSIONS, PERMISSION_NAMES, WILDCARD_ADDRESS, allowedCallsKey } from "../../../src/lsp/constants.ts";
import { PERMISSION_INFO, PRESETS, decodePermissions, encodePermissions, explainPermissions, getPreset, grantWarnings, hasPermission, parsePermissionName, toBytes32 } from "../../../src/lsp/permissions.ts";
import {
  callTypeNames,
  decodeAllowedCalls,
  decodeAllowedDataKeys,
  describeAllowedCall,
  encodeAllowedCalls,
  encodeAllowedDataKeys,
  isDataKeyAllowed,
  normaliseAllowedCall,
  parseCallTypes,
  validateAllowedCall,
} from "../../../src/lsp/allowed.ts";

const ctl = "0xcafecafecafecafecafecafecafecafecafecafe";

describe("permission bitmaps", () => {
  it("round-trips every single permission and matches erc725.js decodePermissions", () => {
    for (const n of PERMISSION_NAMES) {
      const hex = encodePermissions([n]);
      const d = decodePermissions(hex);
      expect(d.names).toEqual([n]);
      const e = e725Decode(hex) as Record<string, boolean>;
      const e725Name = n === "_4337_PERMISSION" ? "ERC4337_PERMISSION" : n;
      expect(e[e725Name], n).toBe(true);
      expect(Object.entries(e).filter(([k, v]) => v && k !== "ALL_PERMISSIONS").length).toBe(1);
    }
  });
  it("encodes combinations exactly like erc725.js", () => {
    const names = ["CALL", "STATICCALL", "TRANSFERVALUE", "SETDATA", "SIGN", "EXECUTE_RELAY_CALL"];
    expect(encodePermissions(names)).toBe(ERC725.encodePermissions(Object.fromEntries(names.map((n) => [n, true]))));
    expect(encodePermissions(["ALL_PERMISSIONS"])).toBe(ERC725.encodePermissions({ ALL_PERMISSIONS: true }));
    expect(encodePermissions(["ALL_PERMISSIONS", "REENTRANCY"])).toBe(ERC725.encodePermissions({ ALL_PERMISSIONS: true, REENTRANCY: true }));
  });
  it("accepts aliases and case-insensitive names; rejects unknown names", () => {
    expect(parsePermissionName("call")).toBe("CALL");
    expect(parsePermissionName("4337")).toBe("_4337_PERMISSION");
    expect(parsePermissionName("ERC4337_PERMISSION")).toBe("_4337_PERMISSION");
    expect(parsePermissionName("_4337_PERMISSION")).toBe("_4337_PERMISSION");
    expect(parsePermissionName("execute-relay-call")).toBe("EXECUTE_RELAY_CALL");
    expect(() => parsePermissionName("TELEPORT")).toThrow(/unknown LSP6 permission/);
  });
  it("preserves unknown bits on decode and when adding names to a base", () => {
    const raw = ("0x" + "8".padStart(64, "0").replace(/^0/, "1")) as Hex; // top bit + bit 3
    const d = decodePermissions(raw);
    expect(d.unknownBits).toContain(252);
    expect(d.names).toContain("ADDEXTENSIONS");
    expect(d.risk).toBe("high");
    const re = encodePermissions(["CALL"], raw);
    expect(BigInt(re)).toBe(BigInt(raw) | PERMISSIONS.CALL);
    expect(decodePermissions(re).unknownBits).toEqual(d.unknownBits);
  });
  it("hasPermission / isAdmin / isAllPermissions / risk", () => {
    const all = decodePermissions(ALL_PERMISSIONS);
    expect(all.isAllPermissions).toBe(true);
    expect(all.isAdmin).toBe(true);
    expect(all.risk).toBe("critical");
    expect(hasPermission(ALL_PERMISSIONS, "SIGN")).toBe(true);
    expect(hasPermission(ALL_PERMISSIONS, "REENTRANCY")).toBe(false);
    expect(decodePermissions("0x").names).toEqual([]);
    expect(decodePermissions(undefined).risk).toBe("none");
    expect(decodePermissions(PERMISSIONS.STATICCALL).risk).toBe("low");
    expect(toBytes32(1n)).toBe("0x" + "0".repeat(63) + "1");
  });
  it("every permission has a plain-language explanation and a risk label", () => {
    for (const n of PERMISSION_NAMES) {
      expect(PERMISSION_INFO[n].explanation.length).toBeGreaterThan(20);
      expect(["low", "medium", "high", "critical"]).toContain(PERMISSION_INFO[n].risk);
    }
    expect(explainPermissions(PERMISSIONS.CALL | (1n << 200n)).join("\n")).toMatch(/bit 200 \[unknown\]/);
  });
});

describe("presets", () => {
  it("agent-owner = ALL_PERMISSIONS without REENTRANCY/DELEGATECALL", () => {
    const p = PRESETS["agent-owner"].permissions;
    expect(p).toBe(ALL_PERMISSIONS);
    expect(p & (PERMISSIONS.REENTRANCY | PERMISSIONS.DELEGATECALL | PERMISSIONS.SUPER_DELEGATECALL)).toBe(0n);
  });
  it("agent-operator = CALL, STATICCALL, TRANSFERVALUE, SETDATA, SIGN, EXECUTE_RELAY_CALL with token-standard AllowedCalls", () => {
    const p = getPreset("agent-operator");
    expect(decodePermissions(p.permissions).names.sort()).toEqual(["CALL", "EXECUTE_RELAY_CALL", "SETDATA", "SIGN", "STATICCALL", "TRANSFERVALUE"]);
    expect(p.permissions & PERMISSIONS._4337_PERMISSION).toBe(0n);
    expect(() => encodeAllowedCalls(p.allowedCalls!)).not.toThrow();
    // current + legacy LSP7/LSP8 interface ids (0.14.0 LSP7 tokens report 0xb3c4928f)
    expect(p.allowedCalls!.map((c) => c.standard)).toEqual(["0xc52d6008", "0xb3c4928f", "0xdaa746b7", "0x3a271706", "0xecad9f75", "0x30dc5278"]);
    for (const c of p.allowedCalls!) expect(c).toMatchObject({ address: WILDCARD_ADDRESS, selector: "0xffffffff", callTypes: CALLTYPE.CALL | CALLTYPE.STATICCALL });
  });
  it("entrypoint-4337 never contains admin/extension bits", () => {
    const p = PRESETS["entrypoint-4337"].permissions;
    for (const n of ["CHANGEOWNER", "ADDCONTROLLER", "EDITPERMISSIONS", "ADDEXTENSIONS", "CHANGEEXTENSIONS"] as const) expect(p & PERMISSIONS[n]).toBe(0n);
    expect(decodePermissions(p).names.sort()).toEqual(["CALL", "SETDATA", "STATICCALL", "TRANSFERVALUE"]);
  });
  it("agent-reader and human-admin", () => {
    expect(decodePermissions(PRESETS["agent-reader"].permissions).names.sort()).toEqual(["SIGN", "STATICCALL"]);
    expect(PRESETS["human-admin"].permissions).toBe(ALL_PERMISSIONS);
    expect(() => getPreset("nope")).toThrow();
  });
  it("grant warnings flag dangerous bits", () => {
    expect(grantWarnings(0n)[0]).toMatch(/no permission/);
    expect(grantWarnings(PERMISSIONS.DELEGATECALL).join()).toMatch(/DELEGATECALL/);
    expect(grantWarnings(PERMISSIONS.ADDCONTROLLER).join()).toMatch(/control over who controls/);
    expect(grantWarnings(PERMISSIONS.CALL)).toEqual([]);
  });
});

describe("AllowedCalls CompactBytesArray", () => {
  const entries = [
    { callTypes: CALLTYPE.CALL, address: "0x1111111111111111111111111111111111111111", standard: "0xffffffff", selector: "0xa9059cbb" },
    { callTypes: CALLTYPE.CALL | CALLTYPE.VALUE, address: WILDCARD_ADDRESS, standard: "0x12345678", selector: "0xffffffff" },
    { callTypes: CALLTYPE.STATICCALL, address: "0x2222222222222222222222222222222222222222", standard: "*", selector: "*" },
  ];
  it("encodes exactly like erc725.js and decodes erc725.js output", () => {
    const ours = encodeAllowedCalls(entries);
    const theirs = ERC725.encodeData(
      [{ keyName: "AddressPermissions:AllowedCalls:<address>", dynamicKeyParts: ctl, value: entries.map((e) => [("0x" + e.callTypes.toString(16).padStart(8, "0")) as string, e.address, e.standard === "*" ? "0xffffffff" : e.standard, e.selector === "*" ? "0xffffffff" : e.selector]) as any }],
      LSP6Schema,
    );
    expect(theirs.keys[0]).toBe(allowedCallsKey(ctl));
    expect(ours).toBe(theirs.values[0]);
    const back = decodeAllowedCalls(ours);
    expect(back.length).toBe(3);
    expect(back[0]).toEqual({ callTypes: 2, address: "0x1111111111111111111111111111111111111111", standard: "0xffffffff", selector: "0xa9059cbb" });
    expect(back[1].address).toBe(WILDCARD_ADDRESS);
    const decoded = ERC725.decodeData([{ keyName: "AddressPermissions:AllowedCalls:<address>", dynamicKeyParts: ctl, value: ours }], LSP6Schema)[0].value as string[][];
    expect(decoded.map((d) => d[1].toLowerCase())).toEqual(back.map((b) => b.address.toLowerCase()));
    expect(decoded.map((d) => d[3])).toEqual(back.map((b) => b.selector));
  });
  it("rejects all-wildcard entries (InvalidWhitelistedCall) and empty call types", () => {
    expect(() => encodeAllowedCalls([{ callTypes: 2, address: "*", standard: "*", selector: "*" }])).toThrow(/InvalidWhitelistedCall/);
    expect(validateAllowedCall(normaliseAllowedCall({ callTypes: 0, address: ctl })).errors.join()).toMatch(/no call type/);
    expect(validateAllowedCall(normaliseAllowedCall({ callTypes: ["DELEGATECALL"], address: ctl })).warnings.join()).toMatch(/always rejected/);
    expect(validateAllowedCall(normaliseAllowedCall({ callTypes: "CALL", address: ctl, standard: "0x12345678" })).warnings.join()).toMatch(/ERC-165/);
  });
  it("decoding rejects malformed values", () => {
    expect(() => decodeAllowedCalls("0x0010" + "00".repeat(16) as Hex)).toThrow(/element length 16/);
    expect(() => decodeAllowedCalls("0x0020" + "00".repeat(10) as Hex)).toThrow(/truncated/);
    expect(decodeAllowedCalls("0x")).toEqual([]);
    expect(encodeAllowedCalls([])).toBe("0x");
  });
  it("parses call types from names, hex and numbers", () => {
    expect(parseCallTypes(["CALL", "VALUE"])).toBe(3);
    expect(parseCallTypes("CALL|STATICCALL")).toBe(6);
    expect(parseCallTypes("0x00000008")).toBe(8);
    expect(parseCallTypes(5)).toBe(5);
    expect(parseCallTypes("transfervalue")).toBe(1);
    expect(() => parseCallTypes("JUMP")).toThrow();
    expect(callTypeNames(7)).toEqual(["VALUE", "CALL", "STATICCALL"]);
    expect(describeAllowedCall(normaliseAllowedCall({ callTypes: 3, to: ctl, function: "0xa9059cbb" }))).toMatch(/VALUE\+CALL → 0xCaFe/i);
  });
});

describe("AllowedERC725YDataKeys CompactBytesArray", () => {
  const keys = ["0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5", "0x0cfc51aec37c55a4d0b1", "0xaa"];
  it("encodes exactly like erc725.js and round-trips", () => {
    const ours = encodeAllowedDataKeys(keys);
    const theirs = ERC725.encodeData([{ keyName: "AddressPermissions:AllowedERC725YDataKeys:<address>", dynamicKeyParts: ctl, value: keys }], LSP6Schema);
    expect(ours).toBe(theirs.values[0]);
    expect(decodeAllowedDataKeys(ours)).toEqual(keys);
    const d = ERC725.decodeData([{ keyName: "AddressPermissions:AllowedERC725YDataKeys:<address>", dynamicKeyParts: ctl, value: ours }], LSP6Schema)[0].value;
    expect(d).toEqual(keys);
  });
  it("rejects empty / >32-byte entries and malformed values", () => {
    expect(() => encodeAllowedDataKeys(["0x"])).toThrow();
    expect(() => encodeAllowedDataKeys(["0x" + "aa".repeat(33)])).toThrow();
    expect(() => decodeAllowedDataKeys("0x0021" + "aa".repeat(33) as Hex)).toThrow();
    expect(() => decodeAllowedDataKeys("0x0005aa" as Hex)).toThrow(/truncated/);
  });
  it("prefix matching like LSP6SetDataModule", () => {
    expect(isDataKeyAllowed("0x0cfc51aec37c55a4d0b1a65c6255c4bf2fbdf6277f3cc0730c45b828b6db8b47", keys as Hex[])).toBe(true);
    expect(isDataKeyAllowed("0x1234000000000000000000000000000000000000000000000000000000000000", keys as Hex[])).toBe(false);
  });
});
