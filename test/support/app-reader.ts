// A TypeScript replica of what the Universal Profile mobile app's reader requires of a backup file
// (shared library BackupReportV2 and its sub-schemas, read on origin/develop ed6218b4). It turns the
// spec-versus-app comparison (quirks Q7 to Q16) into a regression test: every file this skill writes
// must pass it, so the app can import it. Same hand-written style as src/backup/lsp30-format.ts.
// Given the password, it also opens the keys the way the app does: its zod schema (EncryptedSecretsReport)
// strips `secrets.iterations` and its AesEncryptor derives with a hard-coded 10,000 iterations.
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { getAddress } from "viem";

const HEX = /^0x[a-fA-F0-9]*$/;
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface AppReadResult {
  ok: boolean;
  errors: string[];
  /** Controllers kept after the app drops those without a name (NetworkControllersReport). */
  keptControllers: number;
}

/** The app's decryption: PBKDF2-HMAC-SHA256 (password as UTF-8, 10,000 iterations, whatever the file states), AES-GCM, two JSON.parse to its key list. */
function appDecrypts(data: { secret: string; iv: string; salt: string }, password: string): boolean {
  try {
    const sealed = Buffer.from(data.secret, "base64");
    const key = pbkdf2Sync(Buffer.from(password, "utf8"), Buffer.from(data.salt, "base64"), 10_000, 32, "sha256");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "base64"));
    d.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]).toString("utf8");
    const once = JSON.parse(plain);
    const inner = typeof once === "string" ? JSON.parse(once) : undefined;
    return isObj(inner) && Array.isArray(inner.privateKeys);
  } catch {
    return false;
  }
}

/** Returns what the app's zod schemas and report builders would accept (and, with `password`, whether it opens the keys); errors name the field. */
export function appReads(text: string, password?: string): AppReadResult {
  const errors: string[] = [];
  const need = (cond: unknown, msg: string) => {
    if (!cond) errors.push(msg);
    return Boolean(cond);
  };
  let root: any;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Invalid JSON"], keptControllers: 0 };
  }
  need(isObj(root), "root is not an object");
  need(root.version === 2, "version must be the literal 2");
  need(typeof root.backupDate === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(root.backupDate) && !Number.isNaN(Date.parse(root.backupDate)), "backupDate must be an ISO datetime ending in Z");
  need(Array.isArray(root.accounts), "accounts must be a list");
  need(Array.isArray(root.LSP23CrossChainDeployment), "LSP23CrossChainDeployment must be a list");
  let kept = 0;
  for (const [i, a] of (root.accounts ?? []).entries()) {
    need(a.type === "LSP0-ERC725Account", `accounts[${i}].type must be LSP0-ERC725Account`);
    need(a.name === undefined || typeof a.name === "string", `accounts[${i}].name must be a string when present`);
    need(typeof a.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(a.address), `accounts[${i}].address must be 20 bytes`);
    for (const [j, n] of (a.networks ?? []).entries()) {
      need(typeof n.chainID === "number", `accounts[${i}].networks[${j}].chainID must be a number`);
      need(typeof n.name === "string", `accounts[${i}].networks[${j}].name must be a string`);
      for (const [k, c] of (n.controllers ?? []).entries()) {
        const at = `accounts[${i}].networks[${j}].controllers[${k}]`;
        need(typeof c.address === "string" && HEX.test(c.address), `${at}.address must be hex`);
        need(typeof c.type === "string", `${at}.type is required`);
        need(c.privateKeyIndex === undefined || (Number.isInteger(c.privateKeyIndex) && c.privateKeyIndex >= 0), `${at}.privateKeyIndex must be a non-negative integer`);
        need(c.name === undefined || typeof c.name === "string", `${at}.name must be a string when present`);
        if (typeof c.name === "string") kept++; // a controller without a name is dropped by the app on import
      }
    }
  }
  for (const [i, l] of (root.LSP23CrossChainDeployment ?? []).entries()) {
    const at = `LSP23CrossChainDeployment[${i}]`;
    for (const f of ["profileAddress", "factoryAddress"]) need(typeof l[f] === "string" && HEX.test(l[f]), `${at}.${f} must be hex`);
    need(typeof l.initialChainID === "number", `${at}.initialChainID must be a number`);
    need(typeof l.deploymentCalldata === "string" && HEX.test(l.deploymentCalldata), `${at}.deploymentCalldata must be hex`);
    need(Array.isArray(l.initialControllers), `${at}.initialControllers must be a list`);
    for (const [k, c] of (l.initialControllers ?? []).entries()) {
      const p = c.addressPermissions;
      need(typeof c.address === "string" && HEX.test(c.address), `${at}.initialControllers[${k}].address must be hex`);
      need(isObj(p), `${at}.initialControllers[${k}].addressPermissions is required`);
      if (isObj(p)) {
        need(typeof p.permissions === "string" && HEX.test(p.permissions), `${at}.initialControllers[${k}].permissions must be hex`);
        need(isObj(p.decodedPermissions) && Object.values(p.decodedPermissions).every((v) => v === true), `${at}.initialControllers[${k}].decodedPermissions is required and may only hold true`);
        need(typeof p.allowedCalls === "string" && HEX.test(p.allowedCalls), `${at}.initialControllers[${k}].allowedCalls must be hex`);
        need(typeof p.allowedERC725YDataKeys === "string" && HEX.test(p.allowedERC725YDataKeys), `${at}.initialControllers[${k}].allowedERC725YDataKeys must be hex`);
      }
    }
    // the app asserts that at least one initial controller has a key (LSP23CrossChainDeploymentItemReport)
    need((l.initialControllers ?? []).some((c: any) => c.privateKeyIndex !== undefined), `${at} needs an initial controller with a privateKeyIndex`);
  }
  const s = root.secrets;
  if (need(isObj(s) && typeof s.encrypted === "boolean", "secrets.encrypted must be a boolean")) {
    if (s.encrypted) {
      need(s.passwordHint === undefined || typeof s.passwordHint === "string", "secrets.passwordHint must be a string when present");
      need(typeof s.encryptionType === "string", "secrets.encryptionType is required");
      for (const f of ["secret", "iv", "salt"]) need(typeof s.data?.[f] === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(s.data[f]), `secrets.data.${f} must be Base64`);
      need(Buffer.from(s.data?.salt ?? "", "base64").length === 32 && Buffer.from(s.data?.iv ?? "", "base64").length === 16, "salt must be 32 bytes and iv 16 bytes (what the app writes)");
      if (password !== undefined && !errors.length) need(appDecrypts(s.data, password), "the app derives the key with 10,000 iterations whatever the file states: it reports a wrong password");
    } else {
      need(Array.isArray(s.data), "secrets.data must be a list");
      for (const [i, e] of (s.data ?? []).entries()) {
        need(e.type === "privateKey", `secrets.data[${i}].type must be privateKey`);
        need(Number.isInteger(e.index), `secrets.data[${i}].index must be a number`);
        need(typeof e.address === "string" && HEX.test(e.address), `secrets.data[${i}].address is required`);
        need(typeof e.secret === "string" && /^0x[0-9a-fA-F]{64}$/.test(e.secret), `secrets.data[${i}].secret must be 32 bytes hex`);
      }
    }
  }
  return { ok: errors.length === 0, errors, keptControllers: kept };
}

/** True when `text` is exactly what the app would write: 2-space JSON, no trailing newline, checksummed addresses. */
export function looksLikeAppWriter(text: string): boolean {
  if (text.endsWith("\n")) return false;
  const v = JSON.parse(text);
  if (JSON.stringify(v, undefined, 2) !== text) return false;
  const addrs: string[] = [];
  for (const a of v.accounts) {
    addrs.push(a.address);
    for (const n of a.networks) for (const c of n.controllers) addrs.push(c.address);
  }
  for (const l of v.LSP23CrossChainDeployment) addrs.push(l.profileAddress, l.factoryAddress, ...l.initialControllers.map((c: any) => c.address));
  if (!v.secrets.encrypted) addrs.push(...v.secrets.data.map((e: any) => e.address));
  return addrs.every((a) => getAddress(a) === a);
}
