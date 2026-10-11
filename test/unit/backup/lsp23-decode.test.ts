// The LSP23 data in a backup: decoded from the calldata, never from the file's own hints.
import { describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { LSP } from "../../../src/chain/registry.ts";
import { decodeDeployment, initialControllersFor, manifestFromBackup, permissionMismatch } from "../../../src/backup/lsp23-decode.ts";
import { LSP23_ABI } from "../../../src/lsp/abis.ts";
import { ALL_PERMISSIONS_HEX, PERMISSIONS, URD_PERMISSIONS } from "../../../src/lsp/constants.ts";
import { verifyManifest } from "../../../src/lsp/lsp23.ts";
import { toBytes32 } from "../../../src/lsp/permissions.ts";
import { DATA_KEYS } from "../../../src/lsp/constants.ts";
import { HUMAN_ADMIN, editedDeployment, fakeManifest, newKey } from "../../support/backup-fixtures.ts";

const agent = privateKeyToAddress(newKey());
const humanPerm = toBytes32(0x0000_0000_0000_0008n);

function itemOf(m: ReturnType<typeof fakeManifest>) {
  return { profileAddress: m.profile, factoryAddress: m.plan.factory, deploymentCalldata: m.deployCalldata, initialChainID: 42, initialControllers: [] };
}

describe("decodeDeployment", () => {
  it("re-derives the profile and Key Manager, and lists the initial controllers with the URD flagged", () => {
    const m = fakeManifest({ controller: agent, extra: [{ address: HUMAN_ADMIN, permissions: humanPerm }] });
    const d = decodeDeployment(itemOf(m));
    expect(d.supported).toBe(true);
    expect(d.rederives).toBe(true);
    expect(d.canonicalFactory).toBe(true);
    expect(d.derivedProfile).toBe(m.profile);
    expect(d.derivedKeyManager).toBe(m.keyManager);
    expect(d.urd).toBe(LSP.URD["0.14.0"]);
    expect(d.initialControllers.map((c) => [c.address, c.isUrd])).toEqual([[LSP.URD["0.14.0"], true], [agent, false], [HUMAN_ADMIN, false]]);
    expect(d.initialControllers.find((c) => c.address === agent)).toMatchObject({ permissions: ALL_PERMISSIONS_HEX, allowedCalls: "0x", allowedERC725YDataKeys: "0x" });
    expect(d.initialControllers[0].permissions).toBe(toBytes32(URD_PERMISSIONS));
  });

  it("a stated profile address that the calldata does not derive is flagged (possible forgery)", () => {
    const m = fakeManifest({ controller: agent });
    const victim = getAddress("0x" + "11".repeat(20));
    const d = decodeDeployment({ ...itemOf(m), profileAddress: victim });
    expect(d.rederives).toBe(false);
    expect(d.derivedProfile).toBe(m.profile);
    expect(manifestFromBackup({ ...itemOf(m), profileAddress: victim }, d, new Set([agent.toLowerCase()])).reason).toMatch(/does not derive the profile address/);
  });

  it("a foreign factory derives a different address, so a forged factory cannot claim the profile", () => {
    const m = fakeManifest({ controller: agent });
    const d = decodeDeployment({ ...itemOf(m), factoryAddress: "0x2222222222222222222222222222222222222222" });
    expect(d.rederives).toBe(false);
    expect(d.canonicalFactory).toBe(false);
  });

  it("deployContracts calldata and garbage are unsupported, never turned into a manifest (Q12)", () => {
    const m = fakeManifest({ controller: agent });
    const dc = decodeDeployment({ ...itemOf(m), deploymentCalldata: ("0x17ad46a8" + "00".repeat(64)) as Hex });
    expect(dc).toMatchObject({ supported: false, rederives: false });
    expect(dc.reason).toMatch(/deployContracts/);
    expect(decodeDeployment({ ...itemOf(m), deploymentCalldata: "0x12345678" }).supported).toBe(false);
    expect(decodeDeployment({ ...itemOf(m), deploymentCalldata: "0x6a66a753" }).reason).toMatch(/could not be decoded/);
    expect(manifestFromBackup(itemOf(m) as any, dc, new Set()).manifest).toBeUndefined();
  });
});

describe("manifestFromBackup", () => {
  it("rebuilds the manifest from the calldata alone: same plan, calldata and addresses, and verifyManifest passes", () => {
    const orig = fakeManifest({ controller: agent, extra: [{ address: HUMAN_ADMIN, permissions: humanPerm }], lsp3: "0x6f357c6a" + "ab".repeat(32) + "cd".repeat(8) as Hex });
    const item = itemOf(orig);
    const { manifest, reason } = manifestFromBackup(item as any, decodeDeployment(item), new Set([agent.toLowerCase()]));
    expect(reason).toBeUndefined();
    expect(manifest!.plan).toEqual(orig.plan);
    expect(manifest!.deployCalldata).toBe(orig.deployCalldata);
    expect([manifest!.profile, manifest!.keyManager, manifest!.salt, manifest!.controller, manifest!.permissions, manifest!.lsp3]).toEqual([orig.profile, orig.keyManager, orig.salt, orig.controller, orig.permissions, orig.lsp3]);
    expect(manifest!.extraControllers).toEqual([{ address: HUMAN_ADMIN, permissions: humanPerm }]);
    expect(verifyManifest(manifest!).ok).toBe(true);
    expect(manifest!.chains).toEqual([]);
    expect(manifest!.deployments).toEqual({});
    expect(manifest!.seed).toBeUndefined();
  });

  it("the controller is the first initial controller whose key is held; the address stays the same either way", () => {
    const orig = fakeManifest({ controller: agent, extra: [{ address: HUMAN_ADMIN, permissions: humanPerm }] });
    const item = itemOf(orig);
    const dec = decodeDeployment(item);
    const held = manifestFromBackup(item as any, dec, new Set([HUMAN_ADMIN.toLowerCase()])).manifest!;
    expect(held.controller).toBe(HUMAN_ADMIN);
    expect(held.permissions).toBe(humanPerm);
    expect(held.profile).toBe(orig.profile);
    expect(verifyManifest(held).ok).toBe(true);
    expect(manifestFromBackup(item as any, dec, new Set()).manifest!.controller).toBe(agent); // none held: the first one
  });

  it("calldata that is not the canonical encoding is refused", () => {
    const orig = fakeManifest({ controller: agent });
    const item = { ...itemOf(orig), deploymentCalldata: (orig.deployCalldata + "00") as Hex }; // trailing byte: same decode, different bytes
    const r = manifestFromBackup(item as any, decodeDeployment(item), new Set([agent.toLowerCase()]));
    expect(r.manifest).toBeUndefined();
    expect(r.reason).toMatch(/canonical encoding/);
  });

  it("a deployment that sends value is not replayed", () => {
    const orig = fakeManifest({ controller: agent });
    const p = { ...orig.plan.primaryContractDeploymentInit, fundingAmount: 5n };
    const data = encodeFunctionData({ abi: LSP23_ABI, functionName: "deployERC1167Proxies", args: [p, { ...orig.plan.secondaryContractDeploymentInit, fundingAmount: 0n }, orig.plan.postDeploymentModule, orig.plan.postDeploymentModuleCalldata] });
    const item = { ...itemOf(orig), deploymentCalldata: data };
    const r = manifestFromBackup(item as any, { ...decodeDeployment(item), rederives: true }, new Set());
    expect(r.reason).toMatch(/sends value/);
  });
});

describe("initialControllersFor / permissionMismatch", () => {
  it("writes the calldata's controllers with key indices and permission names (all true)", () => {
    const m = fakeManifest({ controller: agent });
    const rows = initialControllersFor(decodeDeployment(itemOf(m)), (a) => (a === agent ? 3 : undefined));
    const mine = rows.find((r) => r.address === agent)!;
    expect(mine.privateKeyIndex).toBe(3);
    expect(Object.values(mine.addressPermissions.decodedPermissions!).every((v) => v === true)).toBe(true);
    expect(Object.keys(mine.addressPermissions.decodedPermissions!)).toContain("SETDATA");
    expect(rows.find((r) => r.address === LSP.URD["0.14.0"])!.privateKeyIndex).toBeUndefined();
  });

  it("Q7: decodedPermissions that disagree with the value are reported by name", () => {
    const setData = toBytes32(PERMISSIONS.SETDATA);
    expect(permissionMismatch({ permissions: setData, decodedPermissions: { SETDATA: true } })).toEqual([]);
    expect(permissionMismatch({ permissions: setData, decodedPermissions: { CALL: true } }).sort()).toEqual(["CALL", "SETDATA"]);
    expect(permissionMismatch({ permissions: setData })).toEqual([]);
    expect(permissionMismatch({ permissions: setData, decodedPermissions: { SETDATA: true, CALL: false } })).toEqual([]);
  });
});

describe("malformed or empty permissions in the calldata (findings 3 and 4)", () => {
  const permissionIndex = (keys: Hex[], who: string) => keys.findIndex((k) => k.toLowerCase() === (DATA_KEYS.AddressPermissionsPermissionsPrefix + who.slice(2)).toLowerCase());
  const item = (m: ReturnType<typeof fakeManifest>, calldata: Hex, profile = m.profile) => ({ ...itemOf(m), profileAddress: profile, deploymentCalldata: calldata });

  it("key and value lists of different lengths are unsupported data, not a controller with undefined permissions", () => {
    const m = fakeManifest({ controller: agent });
    const longer = editedDeployment(m, (k, v) => [k, v.slice(0, -1)]);
    const d = decodeDeployment(item(m, longer.calldata));
    expect(d).toMatchObject({ supported: false, rederives: false, initialControllers: [] });
    expect(d.reason).toMatch(/lists of different lengths/);
    const shorter = editedDeployment(m, (k, v) => [k.slice(0, -1), v]);
    expect(decodeDeployment(item(m, shorter.calldata)).supported).toBe(false);
  });

  it("a Universal Receiver Delegate key without its value is no TypeError", () => {
    const m = fakeManifest({ controller: agent });
    const urdAt = (k: Hex[]) => k.findIndex((x) => x.toLowerCase() === DATA_KEYS.LSP1UniversalReceiverDelegate.toLowerCase());
    const e = editedDeployment(m, (k, v) => {
      const i = urdAt(k);
      return [k, v.filter((_x, j) => j !== i)];
    });
    expect(() => decodeDeployment(item(m, e.calldata))).not.toThrow();
    expect(decodeDeployment(item(m, e.calldata)).supported).toBe(false);
  });

  it("a permission value that is not a 32-byte permission set is marked invalid and never counts", () => {
    const m = fakeManifest({ controller: agent });
    // empty, too short, a 32-byte value that is not a plain permission set, one byte short
    for (const bad of ["0x", "0x01", `0x${"ff".repeat(32)}`, `0x${"00".repeat(31)}`]) {
      const e = editedDeployment(m, (k, v) => {
        v[permissionIndex(k, agent)] = bad as Hex;
        return [k, v];
      });
      const dec = decodeDeployment(item(m, e.calldata, e.profile));
      const me = dec.initialControllers.find((c) => c.address === agent)!;
      expect(me, bad).toMatchObject({ permissionsValid: false, hasPermissions: false, permissions: `0x${"00".repeat(32)}` });
      expect(manifestFromBackup(item(m, e.calldata, e.profile) as any, dec, new Set([agent.toLowerCase()])).reason).toMatch(/not a valid permission set/);
    }
  });

  it("a zero permission value is valid but gives no manifest and no proof", () => {
    const m = fakeManifest({ controller: agent });
    const e = editedDeployment(m, (k, v) => {
      v[permissionIndex(k, agent)] = `0x${"00".repeat(32)}`;
      return [k, v];
    });
    const dec = decodeDeployment(item(m, e.calldata, e.profile));
    expect(dec.rederives).toBe(true);
    expect(dec.initialControllers.find((c) => c.address === agent)).toMatchObject({ permissionsValid: true, hasPermissions: false });
    const r = manifestFromBackup(item(m, e.calldata, e.profile) as any, dec, new Set([agent.toLowerCase()]));
    expect(r.manifest).toBeUndefined();
    expect(r.reason).toMatch(/no controller in the calldata has permissions/);
  });

  it("a held controller with no permissions is skipped for one that has some", () => {
    const m = fakeManifest({ controller: agent, extra: [{ address: HUMAN_ADMIN, permissions: humanPerm }] });
    const e = editedDeployment(m, (k, v) => {
      v[permissionIndex(k, agent)] = `0x${"00".repeat(32)}`;
      return [k, v];
    });
    const dec = decodeDeployment(item(m, e.calldata, e.profile));
    const r = manifestFromBackup(item(m, e.calldata, e.profile) as any, dec, new Set([agent.toLowerCase()]));
    expect(r.manifest?.controller).toBe(HUMAN_ADMIN);
  });
});
