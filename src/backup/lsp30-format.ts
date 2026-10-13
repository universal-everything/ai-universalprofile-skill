// LSP-30 backup file: types, serializer and validator.
//
// The serializer writes exactly what the Universal Profile mobile app writes (see lsp30-crypto.ts
// for the encryption): JSON.stringify(file, undefined, 2), UTF-8, no trailing newline, keys in the
// app's order, EIP-55 addresses, `version` the number 2, `backupDate` UTC without milliseconds, plus
// one field the app does not write: the PBKDF2 iteration count of encrypted secrets, stated as
// `secrets.iterations` before `data`. The app's reader drops that field and always derives with
// 10,000, so it opens a file stating 10,000 (`--legacy`) and reports a wrong password for any other.
//
// The validator is hand-written and more tolerant than the app's reader (quirks Q7 to Q16 in the
// design): optional fields stay optional, unknown fields are ignored, bad checksums only warn.
// `secrets.iterations` is the exception: when present it must be a whole number from 1 to 5,000,000
// (an error otherwise, so nothing is derived); when absent the file was made with exactly 10,000.
// Its messages name the place of a problem ("accounts[0].address"), never the value found there.
import { getAddress } from "viem";
import { UpError } from "../core/errors.ts";
import { PERMISSION_NAMES, type PermissionName } from "../lsp/constants.ts";
import { canonicalDateTime, KEY_WITHHELD, safeFileText } from "../core/safe-text.ts";
import type { Address, Hex } from "../core/types.ts";
import { decodeField, ENCRYPTION_TYPE, isValidIterations, ITERATIONS_RULE, LEGACY_ITERATIONS, type EncryptedData } from "./lsp30-crypto.ts";

export const BACKUP_VERSION = 2;
/** What an encryptionType other than the known one is shown as. */
export const UNRECOGNIZED_ENCRYPTION_TYPE = "unrecognized";
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export type BackupMode = "encrypted" | "unencrypted" | "public";

export interface BackupController {
  address: Address;
  type?: string;
  privateKeyIndex?: number;
  name?: string;
}
export interface BackupNetwork {
  chainID: number;
  name: string;
  controllers: BackupController[];
}
export interface BackupAccount {
  type?: string;
  name?: string;
  address: Address;
  networks: BackupNetwork[];
}
export interface BackupPermissions {
  permissions: Hex;
  /** Only LSP6 permission names this skill knows; any other property name of the file is counted in `unrecognisedNames` and dropped. */
  decodedPermissions?: Partial<Record<PermissionName, boolean>>;
  /** How many property names of the file's decodedPermissions are not a known LSP6 permission (never kept, never shown). */
  unrecognisedNames?: number;
  allowedCalls: Hex;
  allowedERC725YDataKeys: Hex;
}
export interface BackupInitialController {
  address: Address;
  privateKeyIndex?: number;
  addressPermissions: BackupPermissions;
}
export interface BackupLsp23Item {
  profileAddress: Address;
  initialChainID: number;
  factoryAddress: Address;
  deploymentCalldata: Hex;
  salt?: Hex;
  initialControllers: BackupInitialController[];
}
export interface PlainSecretEntry {
  type: "privateKey";
  index: number;
  address: Address;
  secret: Hex;
}
export type BackupSecrets =
  /** `iterations`: the PBKDF2 count `data` was encrypted with, written as `secrets.iterations` (this skill always states it; left out, the file reads as 10,000). */
  | { encrypted: true; passwordHint?: string; encryptionType: string; iterations?: number; data: EncryptedData }
  | { encrypted: false; data: PlainSecretEntry[] };

export interface BackupFile {
  version: 2;
  backupDate: string;
  accounts: BackupAccount[];
  LSP23CrossChainDeployment: BackupLsp23Item[];
  secrets: BackupSecrets;
}

/** `YYYY-MM-DDTHH:mm:ssZ`, UTC, no milliseconds (the app's format). */
export function backupDate(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The file as text, in the app's key order (`secrets.iterations` before `data`). Undefined fields are left out (an empty hint is omitted). */
export function serializeBackup(f: BackupFile): string {
  const out = {
    version: BACKUP_VERSION,
    backupDate: f.backupDate,
    accounts: f.accounts.map((a) => ({
      type: a.type ?? "LSP0-ERC725Account",
      name: a.name ?? "",
      address: getAddress(a.address),
      networks: a.networks.map((n) => ({
        chainID: n.chainID,
        name: n.name,
        controllers: n.controllers.map((c) => ({ address: getAddress(c.address), type: c.type, privateKeyIndex: c.privateKeyIndex, name: c.name })),
      })),
    })),
    LSP23CrossChainDeployment: f.LSP23CrossChainDeployment.map((i) => ({
      profileAddress: getAddress(i.profileAddress),
      initialChainID: i.initialChainID,
      factoryAddress: getAddress(i.factoryAddress),
      deploymentCalldata: i.deploymentCalldata,
      salt: i.salt,
      initialControllers: i.initialControllers.map((c) => ({
        address: getAddress(c.address),
        privateKeyIndex: c.privateKeyIndex,
        addressPermissions: {
          permissions: c.addressPermissions.permissions,
          decodedPermissions: c.addressPermissions.decodedPermissions,
          allowedCalls: c.addressPermissions.allowedCalls,
          allowedERC725YDataKeys: c.addressPermissions.allowedERC725YDataKeys,
        },
      })),
    })),
    secrets: f.secrets.encrypted
      ? { encrypted: true, passwordHint: f.secrets.passwordHint || undefined, encryptionType: f.secrets.encryptionType, iterations: f.secrets.iterations, data: { secret: f.secrets.data.secret, iv: f.secrets.data.iv, salt: f.secrets.data.salt } }
      : { encrypted: false, data: f.secrets.data.map((e) => ({ type: e.type, index: e.index, address: getAddress(e.address), secret: e.secret })) },
  };
  return JSON.stringify(out, undefined, 2);
}

/**
 * Whether the app can import this file: its reader rejects a file with LSP-23 data unless at
 * least one initial controller per item has a key index (Q10). Empty when compatible.
 */
export function appIncompatibilities(f: BackupFile): string[] {
  const out: string[] = [];
  f.LSP23CrossChainDeployment.forEach((item, i) => {
    if (!item.initialControllers.some((c) => c.privateKeyIndex !== undefined)) out.push(`LSP23CrossChainDeployment[${i}] has no initial controller with a key in this file; the app rejects such a file`);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export interface Issue {
  level: "error" | "warn";
  code: string;
  message: string;
}

export type ParsedSecrets =
  | { kind: "public" }
  | { kind: "plain"; entries: { index: number; address?: Address; secret: unknown }[]; skippedSeedEntries: number }
  /** `iterations`: the count to derive with, exactly; `iterationsInFile`: whether the file states it (false: 10,000, what every file without the field was made with). */
  | { kind: "encrypted"; hint?: string; encryptionType?: string; iterations: number; iterationsInFile: boolean; data: EncryptedData };

export interface ParsedBackup {
  backupDate: string;
  accounts: BackupAccount[];
  lsp23: BackupLsp23Item[];
  secrets: ParsedSecrets;
}

const KNOWN_PERMISSION_NAMES: ReadonlySet<string> = new Set(PERMISSION_NAMES);

/** The known LSP6 permission names of a file's `decodedPermissions` (boolean values only), and how many other property names it had. */
function knownPermissionNames(o: Record<string, unknown>): { known: Partial<Record<PermissionName, boolean>>; unrecognised: number } {
  const known: Partial<Record<PermissionName, boolean>> = {};
  let unrecognised = 0;
  for (const [k, v] of Object.entries(o)) {
    if (KNOWN_PERMISSION_NAMES.has(k) && typeof v === "boolean") known[k as PermissionName] = v;
    else unrecognised++;
  }
  return { known, unrecognised };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX_BYTES = /^0x([0-9a-fA-F]{2})*$/;
const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Bytes of a file as UTF-8 text (BOM tolerated); invalid UTF-8 and oversized input are rejected without quoting. */
export function backupText(bytes: Uint8Array): string {
  const bad = (message: string) => new UpError("BAD_ARGS", message, { hint: "pass a backup file made by the Universal Profile app or by this skill (up backup export)" });
  if (bytes.length > MAX_BACKUP_BYTES) throw bad(`the backup file is larger than ${MAX_BACKUP_BYTES / 1024 / 1024} MiB`);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw bad("the backup file is not valid UTF-8 text");
  }
}

/**
 * Parses and checks a backup file. `backup` is set only when there is no error issue; callers
 * show `issues` either way.
 */
export function parseBackup(text: string): { backup?: ParsedBackup; issues: Issue[] } {
  const issues: Issue[] = [];
  const error = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warn", code, message });
  const fail = () => ({ issues });

  if (text.length > MAX_BACKUP_BYTES) {
    error("too-large", "the backup file is too large");
    return fail();
  }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    error("not-json", "the file is not valid JSON");
    return fail();
  }
  if (!isObj(root)) {
    error("not-object", "the file does not hold a JSON object");
    return fail();
  }
  if (root.version !== BACKUP_VERSION) {
    error("bad-version", `unsupported version (only version ${BACKUP_VERSION} is supported)`);
    return fail();
  }
  // the date is shown and stored: only an ISO date-time is kept, anything else (it could carry key material) is replaced
  const date = canonicalDateTime(root.backupDate);
  if (!date) warn("bad-date", "backupDate is missing or not an ISO date-time; it is shown as unknown");
  /** Free text from the file, made safe (invisible characters out, key-shaped text withheld, capped). */
  const free = (v: unknown, where: string, max = 80): string => {
    const t = safeFileText(v, max);
    if (t === KEY_WITHHELD) warn("key-shaped-text", `${where} looks like key material and is not shown`);
    return t;
  };

  /** A 20-byte hex address as checksummed text; wrong length is an error, a wrong checksum only a warning (Q14). */
  const address = (v: unknown, where: string): Address | undefined => {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
      error("bad-address", `${where} is not a 20-byte hex address`);
      return undefined;
    }
    const cs = getAddress(v);
    if (v !== cs && v !== v.toLowerCase() && v !== `0x${v.slice(2).toUpperCase()}`) warn("bad-checksum", `${where} has an invalid EIP-55 checksum`);
    return cs;
  };
  const hex = (v: unknown, where: string): Hex | undefined => {
    if (typeof v !== "string" || !HEX_BYTES.test(v)) {
      error("bad-hex", `${where} is not 0x hex`);
      return undefined;
    }
    return v as Hex;
  };
  const keyIndex = (v: unknown, where: string): number | undefined => {
    if (v === undefined) return undefined;
    if (!isNonNegInt(v)) {
      error("bad-key-index", `${where} is not a non-negative integer`);
      return undefined;
    }
    return v;
  };
  const list = (v: unknown, where: string): unknown[] => {
    if (!Array.isArray(v)) {
      error("bad-shape", `${where} is not a list`);
      return [];
    }
    return v;
  };

  const accounts: BackupAccount[] = list(root.accounts, "accounts").flatMap((a, i): BackupAccount[] => {
    const at = `accounts[${i}]`;
    if (!isObj(a)) return (error("bad-shape", `${at} is not an object`), []);
    const addr = address(a.address, `${at}.address`);
    if (a.type !== undefined && a.type !== "LSP0-ERC725Account") warn("account-type", `${at}.type is not LSP0-ERC725Account`);
    const networks = list(a.networks, `${at}.networks`).flatMap((n, j): BackupNetwork[] => {
      const nat = `${at}.networks[${j}]`;
      if (!isObj(n)) return (error("bad-shape", `${nat} is not an object`), []);
      if (!isNonNegInt(n.chainID) || n.chainID === 0) error("bad-chain", `${nat}.chainID is not a positive integer`);
      const controllers = list(n.controllers, `${nat}.controllers`).flatMap((c, k): BackupController[] => {
        const cat = `${nat}.controllers[${k}]`;
        if (!isObj(c)) return (error("bad-shape", `${cat} is not an object`), []);
        const ca = address(c.address, `${cat}.address`);
        const idx = keyIndex(c.privateKeyIndex, `${cat}.privateKeyIndex`);
        if (!ca) return [];
        return [{ address: ca, ...(typeof c.type === "string" ? { type: free(c.type, `${cat}.type`, 40) } : {}), ...(idx !== undefined ? { privateKeyIndex: idx } : {}), ...(typeof c.name === "string" ? { name: free(c.name, `${cat}.name`) } : {}) }];
      });
      return [{ chainID: n.chainID as number, name: typeof n.name === "string" ? free(n.name, `${nat}.name`) : "", controllers }];
    });
    return addr ? [{ ...(typeof a.type === "string" ? { type: free(a.type, `${at}.type`, 40) } : {}), ...(typeof a.name === "string" ? { name: free(a.name, `${at}.name`) } : {}), address: addr, networks }] : [];
  });

  const lsp23: BackupLsp23Item[] = list(root.LSP23CrossChainDeployment, "LSP23CrossChainDeployment").flatMap((it, i): BackupLsp23Item[] => {
    const at = `LSP23CrossChainDeployment[${i}]`;
    if (!isObj(it)) return (error("bad-shape", `${at} is not an object`), []);
    const profile = address(it.profileAddress, `${at}.profileAddress`);
    const factory = address(it.factoryAddress, `${at}.factoryAddress`);
    const calldata = hex(it.deploymentCalldata, `${at}.deploymentCalldata`);
    if (!isNonNegInt(it.initialChainID) || it.initialChainID === 0) error("bad-chain", `${at}.initialChainID is not a positive integer`);
    const salt = it.salt === undefined ? undefined : hex(it.salt, `${at}.salt`);
    const initialControllers = list(it.initialControllers, `${at}.initialControllers`).flatMap((c, k): BackupInitialController[] => {
      const cat = `${at}.initialControllers[${k}]`;
      if (!isObj(c)) return (error("bad-shape", `${cat} is not an object`), []);
      const ca = address(c.address, `${cat}.address`);
      const idx = keyIndex(c.privateKeyIndex, `${cat}.privateKeyIndex`);
      const p = isObj(c.addressPermissions) ? c.addressPermissions : (error("bad-shape", `${cat}.addressPermissions is not an object`), {});
      const permissions = hex(p.permissions, `${cat}.addressPermissions.permissions`);
      const allowedCalls = hex(p.allowedCalls ?? "0x", `${cat}.addressPermissions.allowedCalls`);
      const allowedKeys = hex(p.allowedERC725YDataKeys ?? "0x", `${cat}.addressPermissions.allowedERC725YDataKeys`);
      if (!ca || !permissions || !allowedCalls || !allowedKeys) return [];
      // property names are file text that would be shown and stored: only the known permission names pass, the rest is counted
      const decoded = isObj(p.decodedPermissions) ? knownPermissionNames(p.decodedPermissions) : undefined;
      return [{ address: ca, ...(idx !== undefined ? { privateKeyIndex: idx } : {}), addressPermissions: { permissions, ...(decoded ? { decodedPermissions: decoded.known, ...(decoded.unrecognised ? { unrecognisedNames: decoded.unrecognised } : {}) } : {}), allowedCalls, allowedERC725YDataKeys: allowedKeys } }];
    });
    if (!profile || !factory || !calldata) return [];
    return [{ profileAddress: profile, initialChainID: it.initialChainID as number, factoryAddress: factory, deploymentCalldata: calldata, ...(salt ? { salt } : {}), initialControllers }];
  });

  let secrets: ParsedSecrets = { kind: "public" };
  const s = root.secrets;
  if (!isObj(s) || typeof s.encrypted !== "boolean") error("bad-secrets", "secrets is missing or has no true/false 'encrypted'");
  else if (s.encrypted) {
    const d = s.data;
    // the count is authoritative: only a missing property means 10,000; a present one is used as stated or refused here, before anything is derived
    const iterationsInFile = Object.hasOwn(s, "iterations");
    if (iterationsInFile && !isValidIterations(s.iterations)) error("bad-iterations", `secrets.iterations is not ${ITERATIONS_RULE}`);
    try {
      if (!isObj(d)) throw new Error("data");
      decodeField(d.salt, "salt", 8, 128);
      decodeField(d.iv, "iv", 12, 16);
      decodeField(d.secret, "secret", 17, MAX_BACKUP_BYTES);
      // only the one known label is passed on; any other value is replaced by a fixed one
      secrets = { kind: "encrypted", ...(typeof s.passwordHint === "string" && s.passwordHint ? { hint: free(s.passwordHint, "secrets.passwordHint", 255) } : {}), ...(typeof s.encryptionType === "string" ? { encryptionType: s.encryptionType === ENCRYPTION_TYPE ? ENCRYPTION_TYPE : UNRECOGNIZED_ENCRYPTION_TYPE } : {}), iterations: iterationsInFile ? (s.iterations as number) : LEGACY_ITERATIONS, iterationsInFile, data: { secret: d.secret as string, iv: d.iv as string, salt: d.salt as string } };
      if (s.encryptionType !== ENCRYPTION_TYPE) warn("encryption-type", "encryptionType is not the one this skill and the app write; it is opened as PBKDF2-HMAC-SHA256 with AES-256-GCM all the same");
    } catch (e) {
      error("bad-secrets", e instanceof UpError ? e.message : "secrets.data needs Base64 secret, iv and salt");
    }
  } else {
    const entries: { index: number; address?: Address; secret: unknown }[] = [];
    let skipped = 0;
    list(s.data, "secrets.data").forEach((e, i) => {
      const at = `secrets.data[${i}]`;
      if (!isObj(e)) return error("bad-shape", `${at} is not an object`);
      if (e.type === "seedPhrase") {
        skipped++;
        return warn("seed-phrase", `${at} is a seed phrase; seed phrases are not supported and are skipped`);
      }
      if (e.type !== "privateKey") return error("bad-secret-type", `${at}.type is not privateKey`);
      if (!isNonNegInt(e.index)) return error("bad-key-index", `${at}.index is not a non-negative integer`);
      if (entries.some((x) => x.index === e.index)) return error("duplicate-key-index", `${at}.index is used twice`);
      const a = e.address === undefined ? undefined : address(e.address, `${at}.address`);
      entries.push({ index: e.index, ...(a ? { address: a } : {}), secret: e.secret });
    });
    if (entries.length) warn("plain-secrets", "this file holds private keys in plain text: anyone who has a copy controls those keys");
    secrets = entries.length || skipped ? { kind: "plain", entries, skippedSeedEntries: skipped } : { kind: "public" };
  }

  // a controller's key index must point at a key (checked here for plain files; after decryption for encrypted ones)
  if (issues.some((i) => i.level === "error")) return fail();
  return { backup: { backupDate: date ?? "unknown", accounts, lsp23, secrets }, issues };
}
