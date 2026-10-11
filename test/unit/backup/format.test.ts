// LSP-30 file: serializer (the app's exact bytes), validator, and the replica of the app's reader.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { decodeDeployment, initialControllersFor } from "../../../src/backup/lsp23-decode.ts";
import { ENCRYPTION_TYPE, encryptSecrets } from "../../../src/backup/lsp30-crypto.ts";
import { appIncompatibilities, backupDate, backupText, parseBackup, serializeBackup, type BackupFile } from "../../../src/backup/lsp30-format.ts";
import { appReads, looksLikeAppWriter } from "../../support/app-reader.ts";
import { fakeManifest, newKey } from "../../support/backup-fixtures.ts";

const kat = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "fixtures", "lsp30", "app-kat.json"), "utf8"));
const katText = JSON.stringify(kat.backupFile, undefined, 2);

/** A complete file with one deployed profile: the shape this skill writes. */
async function sampleFile(): Promise<{ file: BackupFile; keys: Hex[]; profile: Address }> {
  const keys = [newKey(), newKey()];
  const m = fakeManifest({ controller: privateKeyToAddress(keys[0]), extra: [{ address: "0x4444444444444444444444444444444444444444", permissions: "0x0000000000000000000000000000000000000000000000000000000000000008" }], chainIds: [42, 8453] });
  const dec = decodeDeployment({ profileAddress: m.profile, factoryAddress: m.plan.factory, deploymentCalldata: m.deployCalldata });
  const idx = (a: string) => keys.findIndex((k) => privateKeyToAddress(k).toLowerCase() === a.toLowerCase()) >= 0 ? keys.findIndex((k) => privateKeyToAddress(k).toLowerCase() === a.toLowerCase()) : undefined;
  const file: BackupFile = {
    version: 2,
    backupDate: "2026-10-10T12:00:00Z",
    accounts: [{ type: "LSP0-ERC725Account", name: "", address: m.profile, networks: [8453, 42].map((c) => ({ chainID: c, name: "x", controllers: keys.map((k, i) => ({ address: privateKeyToAddress(k), type: "App", privateKeyIndex: i, name: `AI agent key ${i}` })) })) }],
    LSP23CrossChainDeployment: [{ profileAddress: m.profile, initialChainID: 42, factoryAddress: m.plan.factory, deploymentCalldata: m.deployCalldata, salt: m.salt, initialControllers: initialControllersFor(dec, idx) }],
    secrets: { encrypted: true, passwordHint: "my hint", encryptionType: ENCRYPTION_TYPE, data: await encryptSecrets(keys.map((k) => ({ address: privateKeyToAddress(k), privateKey: k })), "format-test-password") },
  };
  return { file, keys, profile: m.profile };
}

describe("serializer writes the app's bytes", () => {
  it("reproduces the app-shaped vector file byte for byte (key order, 2-space indent, no trailing newline)", () => {
    const { backup } = parseBackup(katText);
    const s = backup!.secrets as { kind: "encrypted"; hint?: string; data: any };
    const out = serializeBackup({
      version: 2,
      backupDate: backup!.backupDate,
      accounts: backup!.accounts,
      LSP23CrossChainDeployment: backup!.lsp23,
      secrets: { encrypted: true, passwordHint: s.hint, encryptionType: ENCRYPTION_TYPE, data: s.data },
    });
    expect(out).toBe(katText);
    expect(out.endsWith("\n")).toBe(false);
    expect(looksLikeAppWriter(out)).toBe(true);
  });

  it("keys come out in the app's order at every level", async () => {
    const { file } = await sampleFile();
    const v = JSON.parse(serializeBackup(file));
    expect(Object.keys(v)).toEqual(["version", "backupDate", "accounts", "LSP23CrossChainDeployment", "secrets"]);
    expect(Object.keys(v.accounts[0])).toEqual(["type", "name", "address", "networks"]);
    expect(Object.keys(v.accounts[0].networks[0])).toEqual(["chainID", "name", "controllers"]);
    expect(Object.keys(v.accounts[0].networks[0].controllers[0])).toEqual(["address", "type", "privateKeyIndex", "name"]);
    expect(Object.keys(v.LSP23CrossChainDeployment[0])).toEqual(["profileAddress", "initialChainID", "factoryAddress", "deploymentCalldata", "salt", "initialControllers"]);
    const keyed = v.LSP23CrossChainDeployment[0].initialControllers.find((c: any) => c.privateKeyIndex !== undefined);
    expect(Object.keys(keyed)).toEqual(["address", "privateKeyIndex", "addressPermissions"]);
    expect(Object.keys(keyed.addressPermissions)).toEqual(["permissions", "decodedPermissions", "allowedCalls", "allowedERC725YDataKeys"]);
    expect(Object.keys(v.secrets)).toEqual(["encrypted", "passwordHint", "encryptionType", "data"]);
    expect(Object.keys(v.secrets.data)).toEqual(["secret", "iv", "salt"]);
    expect(v.version).toBe(2);
  });

  it("unencrypted entries, public secrets and an omitted empty hint", async () => {
    const { file } = await sampleFile();
    const k = newKey();
    const plain = JSON.parse(serializeBackup({ ...file, secrets: { encrypted: false, data: [{ type: "privateKey", index: 0, address: privateKeyToAddress(k), secret: k }] } }));
    expect(plain.secrets).toEqual({ encrypted: false, data: [{ type: "privateKey", index: 0, address: privateKeyToAddress(k), secret: k }] });
    expect(Object.keys(plain.secrets.data[0])).toEqual(["type", "index", "address", "secret"]);
    expect(JSON.parse(serializeBackup({ ...file, secrets: { encrypted: false, data: [] } })).secrets).toEqual({ encrypted: false, data: [] });
    const noHint = JSON.parse(serializeBackup({ ...file, secrets: { ...(file.secrets as any), passwordHint: "" } }));
    expect("passwordHint" in noHint.secrets).toBe(false); // Q13
  });

  it("backupDate is UTC without milliseconds", () => {
    expect(backupDate(new Date("2026-10-10T12:34:56.789Z"))).toBe("2026-10-10T12:34:56Z");
    expect(backupDate()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("every address is written EIP-55 even when the input is lower case", async () => {
    const { file } = await sampleFile();
    const lower = { ...file, accounts: file.accounts.map((a) => ({ ...a, address: a.address.toLowerCase() as Address })) };
    expect(JSON.parse(serializeBackup(lower)).accounts[0].address).toBe(getAddress(file.accounts[0].address));
  });
});

describe("the app's reader (replica) accepts what the skill writes", () => {
  it("a full encrypted file with a deployed profile", async () => {
    const { file } = await sampleFile();
    const r = appReads(serializeBackup(file));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(looksLikeAppWriter(serializeBackup(file))).toBe(true);
    expect(r.keptControllers).toBe(4); // every controller has a name, so none is dropped
  });

  it("an unencrypted file", async () => {
    const { file, keys } = await sampleFile();
    const text = serializeBackup({ ...file, secrets: { encrypted: false, data: keys.map((k, index) => ({ type: "privateKey" as const, index, address: privateKeyToAddress(k), secret: k })) } });
    expect(appReads(text).errors).toEqual([]);
  });

  it("the app-made vector too", () => {
    expect(appReads(katText).errors).toEqual([]);
  });

  it("the replica rejects what the app rejects (so the test above means something)", async () => {
    const { file } = await sampleFile();
    const base = JSON.parse(serializeBackup(file));
    const mutate = (fn: (v: any) => void) => {
      const v = structuredClone(base);
      fn(v);
      return appReads(JSON.stringify(v)).errors.join("|");
    };
    expect(mutate((v) => (v.version = 3))).toContain("version");
    expect(mutate((v) => delete v.accounts[0].networks[0].controllers[0].type)).toContain("type is required");
    expect(mutate((v) => delete v.LSP23CrossChainDeployment[0].initialControllers[0].addressPermissions.decodedPermissions)).toContain("decodedPermissions");
    expect(mutate((v) => (v.LSP23CrossChainDeployment[0].initialControllers[0].addressPermissions.decodedPermissions = { SETDATA: false }))).toContain("only hold true");
    expect(mutate((v) => v.LSP23CrossChainDeployment[0].initialControllers.forEach((c: any) => delete c.privateKeyIndex))).toContain("privateKeyIndex");
    expect(mutate((v) => (v.secrets.data.iv = Buffer.alloc(12).toString("base64")))).toContain("16 bytes");
  });
});

describe("app compatibility flag (Q10)", () => {
  it("is compatible when an initial controller has a key, not when the file has no keys", async () => {
    const { file } = await sampleFile();
    expect(appIncompatibilities(file)).toEqual([]);
    const publicFile: BackupFile = { ...file, LSP23CrossChainDeployment: file.LSP23CrossChainDeployment.map((l) => ({ ...l, initialControllers: l.initialControllers.map(({ privateKeyIndex, ...c }) => c) })), secrets: { encrypted: false, data: [] } };
    expect(appIncompatibilities(publicFile)).toHaveLength(1);
    expect(appReads(serializeBackup(publicFile)).ok).toBe(false); // the app really rejects it
  });
});

describe("validator", () => {
  it("accepts a good file and reports the secrets kind", async () => {
    const { file } = await sampleFile();
    const { backup, issues } = parseBackup(serializeBackup(file));
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(backup!.secrets.kind).toBe("encrypted");
    expect(backup!.accounts[0].networks.map((n) => n.chainID)).toEqual([8453, 42]); // order is kept as written
    expect(backup!.lsp23).toHaveLength(1);
  });

  const SENTINEL = "SENTINEL-do-not-echo-9f3a";
  const errorsOf = (v: unknown) => parseBackup(JSON.stringify(v)).issues.filter((i) => i.level === "error");

  it("its messages never repeat what the file contains", async () => {
    const { file } = await sampleFile();
    const base = JSON.parse(serializeBackup(file));
    const cases: [string, (v: any) => void][] = [
      ["address", (v) => (v.accounts[0].address = SENTINEL)],
      ["hex", (v) => (v.LSP23CrossChainDeployment[0].deploymentCalldata = SENTINEL)],
      ["chain", (v) => (v.accounts[0].networks[0].chainID = SENTINEL)],
      ["index", (v) => (v.accounts[0].networks[0].controllers[0].privateKeyIndex = SENTINEL)],
      ["secrets", (v) => (v.secrets = SENTINEL)],
      ["data", (v) => (v.secrets.data.salt = SENTINEL)],
      ["list", (v) => (v.accounts = SENTINEL)],
      ["version", (v) => (v.version = SENTINEL)],
      ["controller", (v) => (v.accounts[0].networks[0].controllers[0] = SENTINEL)],
    ];
    for (const [name, mutate] of cases) {
      const v = structuredClone(base);
      mutate(v);
      const { backup, issues } = parseBackup(JSON.stringify(v));
      expect(backup, name).toBeUndefined();
      expect(issues.length, name).toBeGreaterThan(0);
      expect(JSON.stringify(issues), name).not.toContain(SENTINEL);
    }
  });

  it("not JSON, wrong root, wrong version", () => {
    expect(parseBackup("{ nope").issues[0].code).toBe("not-json");
    expect(parseBackup("[]").issues[0].code).toBe("not-object");
    expect(parseBackup(JSON.stringify({ version: 1 })).issues[0].code).toBe("bad-version");
    expect(parseBackup(JSON.stringify({ version: "2" })).issues[0].code).toBe("bad-version");
  });

  it("Q7/Q8/Q9/Q16: optional fields stay optional, unknown fields are ignored", () => {
    const min = {
      version: 2,
      backupDate: "2026-10-10T12:00:00Z",
      accounts: [{ address: "0x" + "ab".repeat(20), networks: [{ chainID: 42, controllers: [{ address: "0x" + "cd".repeat(20) }] }], futureField: 1 }],
      LSP23CrossChainDeployment: [],
      secrets: { encrypted: false, data: [] },
      extra: true,
    };
    const { backup, issues } = parseBackup(JSON.stringify(min));
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(backup!.accounts[0].networks[0].controllers[0]).toEqual({ address: getAddress("0x" + "cd".repeat(20)) });
    expect(backup!.secrets.kind).toBe("public");
  });

  it("Q14: an invalid checksum only warns; wrong length is an error; all-lower and all-upper are fine", () => {
    const addr = getAddress("0x" + "ab".repeat(20));
    const flipped = addr.replace(/[a-f]/i, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    const build = (a: string) => ({ version: 2, backupDate: "2026-10-10T12:00:00Z", accounts: [{ address: a, networks: [] }], LSP23CrossChainDeployment: [], secrets: { encrypted: false, data: [] } });
    expect(parseBackup(JSON.stringify(build(flipped))).issues.map((i) => [i.level, i.code])).toContainEqual(["warn", "bad-checksum"]);
    expect(parseBackup(JSON.stringify(build(addr.toLowerCase()))).issues).toEqual([]);
    expect(parseBackup(JSON.stringify(build("0x" + addr.slice(2).toUpperCase()))).issues).toEqual([]);
    expect(errorsOf(build("0x1234"))[0].code).toBe("bad-address");
  });

  it("Q9: a seed phrase entry is skipped with a note; plain keys get a loud note; duplicate indices are an error", () => {
    const k = newKey();
    const plainEntry = (i: number) => ({ type: "privateKey", index: i, address: privateKeyToAddress(k), secret: k });
    const f = (data: unknown[]) => ({ version: 2, backupDate: "2026-10-10T12:00:00Z", accounts: [], LSP23CrossChainDeployment: [], secrets: { encrypted: false, data } });
    const a = parseBackup(JSON.stringify(f([plainEntry(0), { type: "seedPhrase", index: 1, secret: "x y z" }])));
    expect(a.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["seed-phrase", "plain-secrets"]));
    expect(a.backup!.secrets).toMatchObject({ kind: "plain", skippedSeedEntries: 1 });
    expect(JSON.stringify(a.issues)).not.toContain("x y z");
    expect(errorsOf(f([plainEntry(0), plainEntry(0)]))[0].code).toBe("duplicate-key-index");
  });

  it("Q11/Q12: a missing salt is fine; an unknown encryptionType only warns", async () => {
    const { file } = await sampleFile();
    const v = JSON.parse(serializeBackup(file));
    delete v.LSP23CrossChainDeployment[0].salt;
    v.secrets.encryptionType = "something else";
    const { backup, issues } = parseBackup(JSON.stringify(v));
    expect(backup).toBeDefined();
    expect(issues.map((i) => i.code)).toContain("encryption-type");
  });

  it("size and encoding limits", () => {
    expect(() => backupText(new Uint8Array(5 * 1024 * 1024 + 1))).toThrow(/larger than 5 MiB/);
    expect(() => backupText(new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow(/not valid UTF-8/);
    expect(backupText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]))).toBe("{}");
  });
});

describe("free text and the date in a file are untrusted (review finding 1)", () => {
  const KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public Anvil key 0
  const addr = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const file = (over: Record<string, unknown> = {}, secrets: unknown = { encrypted: false, data: [] }) => ({ version: 2, backupDate: "2026-10-10T12:00:00Z", accounts: [{ address: addr, name: "Alice", networks: [{ chainID: 42, name: "LUKSO", controllers: [{ address: addr, type: "Device", name: "Phone" }] }] }], LSP23CrossChainDeployment: [], secrets, ...over });

  it("a date that is not an ISO date-time becomes unknown, with a note", () => {
    for (const d of [KEY, `0x${KEY}`, "yesterday", "2026-10-10", 5, undefined]) {
      const r = parseBackup(JSON.stringify(file({ backupDate: d })));
      expect(r.backup!.backupDate, String(d)).toBe("unknown");
      expect(r.issues).toContainEqual(expect.objectContaining({ level: "warn", code: "bad-date" }));
      expect(JSON.stringify(r.issues)).not.toContain(KEY);
    }
    expect(parseBackup(JSON.stringify(file())).backup!.backupDate).toBe("2026-10-10T12:00:00Z");
  });

  it("names, types and the hint that look like a key are withheld, each with a note that names the place only", () => {
    const f = file({ accounts: [{ address: addr, name: KEY, type: "LSP0-ERC725Account", networks: [{ chainID: 42, name: `0x${KEY}`, controllers: [{ address: addr, type: KEY.toUpperCase(), name: `k ${KEY}` }] }] }] }, { encrypted: true, passwordHint: KEY, encryptionType: ENCRYPTION_TYPE, data: { secret: Buffer.alloc(40, 1).toString("base64"), iv: Buffer.alloc(16, 2).toString("base64"), salt: Buffer.alloc(32, 3).toString("base64") } });
    const { backup, issues } = parseBackup(JSON.stringify(f));
    expect(backup!.accounts[0].name).toBe("[withheld: looks like key material]");
    expect(backup!.accounts[0].networks[0].name).toBe("[withheld: looks like key material]");
    expect(backup!.accounts[0].networks[0].controllers[0]).toMatchObject({ type: "[withheld: looks like key material]", name: "[withheld: looks like key material]" });
    expect((backup!.secrets as any).hint).toBe("[withheld: looks like key material]");
    expect(issues.filter((i) => i.code === "key-shaped-text").map((i) => i.message)).toEqual(expect.arrayContaining(["accounts[0].name looks like key material and is not shown", "secrets.passwordHint looks like key material and is not shown"]));
    expect(JSON.stringify({ backup, issues }).toLowerCase()).not.toContain(KEY);
  });

  it("an encryptionType other than the known one is replaced by a fixed label", () => {
    const secrets = (t: unknown) => ({ encrypted: true, encryptionType: t, data: { secret: Buffer.alloc(40, 1).toString("base64"), iv: Buffer.alloc(16, 2).toString("base64"), salt: Buffer.alloc(32, 3).toString("base64") } });
    for (const t of [KEY, "AES with a long story", "x".repeat(500)]) {
      const r = parseBackup(JSON.stringify(file({}, secrets(t))));
      expect((r.backup!.secrets as any).encryptionType).toBe("unrecognized");
      expect(r.issues).toContainEqual(expect.objectContaining({ code: "encryption-type" }));
    }
    expect((parseBackup(JSON.stringify(file({}, secrets(ENCRYPTION_TYPE)))).backup!.secrets as any).encryptionType).toBe(ENCRYPTION_TYPE);
  });
});
