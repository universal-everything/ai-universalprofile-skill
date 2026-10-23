// Universal Profile skill — backup verbs (loaded on demand by app.mjs)
// Universal Profile Agent Skill v0.2.0 — MIT-0 — https://github.com/universal-everything/ai-universalprofile-skill
// Built from source fingerprint 362e4d5b6525 (sha256 of the bundled src/ modules and build inputs) with `npm ci && npm run build` (esbuild, unminified). Do not edit; edit src/ instead.
import { $s0, $s1, $s2, $s3, $s4, $s5, $s6, $s7, $s10, $s14, $s15, $s16, $s17, $s18, $s20, $s21, $s22, $s23, $s24 } from "./app.mjs";
import { createRequire as __upCreateRequire } from "node:module";
const require = __upCreateRequire(import.meta.url);


// src/backup/run.ts
import { lstat as lstat2, readFile as readFile2, stat as stat2 } from "node:fs/promises";
import { basename as basename2 } from "node:path";
const { UpError: UpError7 } = $s2;
const { paths: paths3 } = $s3;
const { releaseKeys } = $s4;
const { readProfileRecord: readProfileRecord2 } = $s5;

// src/core/public-record.ts
const { UpError } = $s2;
const { looksLikeKey } = $s6;
const { containsSecret } = $s7;
var TEXT_FIELDS = /* @__PURE__ */ new Set(["name", "type", "hint", "passwordHint", "encryptionType", "backupDate", "file", "path", "destination", "alias", "label", "note", "effect", "say", "message", "chain", "network"]);
var PURE_HEX = /^(0x)?[0-9a-f]*$/i;
var MAX_DEPTH = 24;
function textHoldsKey(text) {
  return containsSecret(text) || containsSecret(text.replace(/[^0-9a-z]/gi, "")) || looksLikeKey(text);
}
function holdsKeyMaterial(value) {
  const seen = /* @__PURE__ */ new Set();
  const walk = (v, field, depth) => {
    if (typeof v === "string") {
      if (PURE_HEX.test(v) && !TEXT_FIELDS.has(field)) return containsSecret(v);
      return textHoldsKey(v);
    }
    if (v === null || typeof v !== "object") return false;
    if (seen.has(v) || depth > MAX_DEPTH) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some((x) => walk(x, field, depth + 1));
    return Object.entries(v).some(([k, x]) => textHoldsKey(k) || walk(x, k, depth + 1));
  };
  return walk(value, "", 0);
}
function assertNoKeyMaterial(what, value) {
  if (holdsKeyMaterial(value)) throw new UpError("BAD_ARGS", `${what} holds private key material (or text shaped like it); nothing was changed`, { hint: "rename or replace it" });
}

// src/backup/run.ts
const { safeFileText: safeFileText3 } = $s6;
const { chooseBackend, internalBackend: internalBackend3 } = $s20;

// src/backup/build.ts
import { readdir } from "node:fs/promises";
import { getAddress as getAddress4, isAddress as isAddress2 } from "./vendor-viem.mjs";
const { UpError: UpError5 } = $s2;
const { paths: paths2 } = $s3;
const { chainAddressesOf, linkEvidenceOf, readProfileRecord } = $s5;
const { hasCode } = $s18;
const { verifyManifest: verifyManifest2 } = $s15;
const { readControllers } = $s17;
const { internalBackend } = $s20;
const { chainControllerList, controllerFor } = $s23;
const { keptKeys } = $s24;

// src/backup/lsp30-format.ts
import { getAddress as getAddress2 } from "./vendor-viem.mjs";
const { UpError: UpError3 } = $s2;
const { PERMISSION_NAMES } = $s14;
const { canonicalDateTime, KEY_WITHHELD, safeFileText } = $s6;

// src/backup/lsp30-crypto.ts
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from "node:crypto";
import { getAddress } from "./vendor-viem.mjs";
const { UpError: UpError2 } = $s2;
const { registerSecret } = $s7;
const { addressOf, isValidPrivateKey, normalizePrivateKey } = $s22;
var ENCRYPTION_TYPE = "Key from PBKDF2. Encrypted with AES-GCM.";
var DEFAULT_ITERATIONS = 6e5;
var LEGACY_ITERATIONS = 1e4;
var MAX_ITERATIONS = 5e6;
var KEY_BYTES = 32;
var SALT_BYTES = 32;
var IV_BYTES = 16;
var TAG_BYTES = 16;
var WRONG_PASSWORD = "wrong password or damaged file";
function isValidIterations(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= MAX_ITERATIONS;
}
var ITERATIONS_RULE = `a whole number from 1 to ${MAX_ITERATIONS.toLocaleString("en-US")}`;
function kdfDescription(iterations) {
  return `PBKDF2-HMAC-SHA256 (${iterations.toLocaleString("en-US")} iterations), AES-256-GCM`;
}
function derive(password, salt, iterations) {
  return new Promise((resolve2, reject) => pbkdf2(Buffer.from(password, "utf8"), salt, iterations, KEY_BYTES, "sha256", (e, k) => e ? reject(e) : resolve2(k)));
}
function payloadText(keys) {
  const inner = JSON.stringify({ privateKeys: keys.map((k) => ({ address: getAddress(k.address), privateKey: k.privateKey.toLowerCase() })), seedPhrases: [] });
  return JSON.stringify(inner);
}
async function encryptSecrets(keys, password, iterations, fixed = {}) {
  if (!isValidIterations(iterations)) throw new UpError2("INTERNAL", `the iteration count for a backup must be ${ITERATIONS_RULE}`);
  const salt = fixed.salt ?? randomBytes(SALT_BYTES);
  const iv = fixed.iv ?? randomBytes(IV_BYTES);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new UpError2("INTERNAL", "salt or IV has the wrong length");
  const key = await derive(password, salt, iterations);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const ct = Buffer.concat([cipher.update(payloadText(keys), "utf8"), cipher.final()]);
  return { secret: Buffer.concat([ct, cipher.getAuthTag()]).toString("base64"), iv: iv.toString("base64"), salt: salt.toString("base64") };
}
var B64 = /^[A-Za-z0-9+/]+={0,2}$/;
function decodeField(value, name, min, max) {
  if (typeof value !== "string" || !B64.test(value) || value.length % 4 !== 0) throw new UpError2("BAD_ARGS", `the backup's ${name} is not valid Base64`);
  const b = Buffer.from(value, "base64");
  if (b.length < min || b.length > max) throw new UpError2("BAD_ARGS", `the backup's ${name} has an unexpected length`);
  return b;
}
function openKey(rawKey, index, claimed) {
  const privateKey = typeof rawKey === "string" ? normalizePrivateKey(rawKey) : void 0;
  if (!privateKey || !isValidPrivateKey(privateKey)) throw new UpError2("BAD_ARGS", `key number ${index} in the backup is not a valid private key`);
  registerSecret(privateKey);
  const address = addressOf(privateKey);
  const claimedAddress = typeof claimed === "string" && claimed.toLowerCase() !== address.toLowerCase() ? "different" : void 0;
  return { index, address, privateKey, ...claimedAddress ? { claimedAddress } : {} };
}
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function readPayload(plain) {
  const unsupported2 = () => new UpError2("BAD_ARGS", "the decrypted backup has an unsupported payload (expected the app's key list)");
  let v;
  let shape = "object";
  try {
    v = JSON.parse(plain);
    if (typeof v === "string") {
      v = JSON.parse(v);
      shape = "app";
    }
  } catch {
    throw unsupported2();
  }
  const keys = [];
  let seedPhraseEntries = 0;
  if (Array.isArray(v)) {
    shape = "array";
    v.forEach((e, position) => {
      if (!isObj(e)) throw unsupported2();
      if (e.type === "seedPhrase") {
        seedPhraseEntries++;
        return;
      }
      if (e.type !== "privateKey") throw new UpError2("BAD_ARGS", `entry ${position} of the decrypted backup is not a private key or a seed phrase`);
      const index = Number.isInteger(e.index) && e.index >= 0 ? e.index : position;
      if (keys.some((k) => k.index === index)) throw new UpError2("BAD_ARGS", `key number ${index} appears twice in the decrypted backup`);
      keys.push(openKey(e.secret ?? e.privateKey, index, e.address));
    });
  } else if (isObj(v) && Array.isArray(v.privateKeys)) {
    v.privateKeys.forEach((e, position) => {
      if (!isObj(e)) throw unsupported2();
      keys.push(openKey(e.privateKey, position, e.address));
    });
    if (Array.isArray(v.seedPhrases)) seedPhraseEntries = v.seedPhrases.length;
  } else throw unsupported2();
  return { keys, seedPhraseEntries, shape };
}
function passwordForms(password) {
  const forms = [{ form: "as-typed", text: password }];
  if (/[^\x00-\x7f]/.test(password)) {
    for (const [form, norm] of [["nfc", "NFC"], ["nfkc", "NFKC"]]) {
      const text = password.normalize(norm);
      if (!forms.some((f) => f.text === text)) forms.push({ form, text });
    }
  }
  return forms;
}
async function decryptSecrets(data, password, iterations) {
  if (!isValidIterations(iterations)) throw new UpError2("BAD_ARGS", `the backup's iterations is not ${ITERATIONS_RULE}`, { hint: "check the file with: up backup inspect <file>" });
  const salt = decodeField(data.salt, "salt", 8, 128);
  const iv = decodeField(data.iv, "iv", 12, 16);
  const sealed = decodeField(data.secret, "secret", TAG_BYTES + 1, 5 * 1024 * 1024);
  const ct = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  for (const { form, text } of passwordForms(password)) {
    const key = await derive(text, salt, iterations);
    let plain;
    try {
      const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      d.setAuthTag(tag);
      plain = Buffer.concat([d.update(ct), d.final()]);
    } catch {
      continue;
    }
    return { ...readPayload(plain.toString("utf8")), iterations, passwordForm: form };
  }
  throw new UpError2("BAD_ARGS", WRONG_PASSWORD, { hint: "check the password; if it is right, the file is damaged or was not made by the Universal Profile app or this skill", details: { reason: "wrong-password-or-damaged-file", iterations } });
}

// src/backup/lsp30-format.ts
var BACKUP_VERSION = 2;
var UNRECOGNIZED_ENCRYPTION_TYPE = "unrecognized";
var MAX_BACKUP_BYTES = 5 * 1024 * 1024;
function backupDate(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function serializeBackup(f) {
  const out = {
    version: BACKUP_VERSION,
    backupDate: f.backupDate,
    accounts: f.accounts.map((a) => ({
      type: a.type ?? "LSP0-ERC725Account",
      name: a.name ?? "",
      address: getAddress2(a.address),
      networks: a.networks.map((n) => ({
        chainID: n.chainID,
        name: n.name,
        controllers: n.controllers.map((c) => ({ address: getAddress2(c.address), type: c.type, privateKeyIndex: c.privateKeyIndex, name: c.name }))
      }))
    })),
    LSP23CrossChainDeployment: f.LSP23CrossChainDeployment.map((i) => ({
      profileAddress: getAddress2(i.profileAddress),
      initialChainID: i.initialChainID,
      factoryAddress: getAddress2(i.factoryAddress),
      deploymentCalldata: i.deploymentCalldata,
      salt: i.salt,
      initialControllers: i.initialControllers.map((c) => ({
        address: getAddress2(c.address),
        privateKeyIndex: c.privateKeyIndex,
        addressPermissions: {
          permissions: c.addressPermissions.permissions,
          decodedPermissions: c.addressPermissions.decodedPermissions,
          allowedCalls: c.addressPermissions.allowedCalls,
          allowedERC725YDataKeys: c.addressPermissions.allowedERC725YDataKeys
        }
      }))
    })),
    secrets: f.secrets.encrypted ? { encrypted: true, passwordHint: f.secrets.passwordHint || void 0, encryptionType: f.secrets.encryptionType, iterations: f.secrets.iterations, data: { secret: f.secrets.data.secret, iv: f.secrets.data.iv, salt: f.secrets.data.salt } } : { encrypted: false, data: f.secrets.data.map((e) => ({ type: e.type, index: e.index, address: getAddress2(e.address), secret: e.secret })) }
  };
  return JSON.stringify(out, void 0, 2);
}
function appIncompatibilities(f) {
  const out = [];
  f.LSP23CrossChainDeployment.forEach((item, i) => {
    if (!item.initialControllers.some((c) => c.privateKeyIndex !== void 0)) out.push(`LSP23CrossChainDeployment[${i}] has no initial controller with a key in this file; the app rejects such a file`);
  });
  return out;
}
var KNOWN_PERMISSION_NAMES = new Set(PERMISSION_NAMES);
function knownPermissionNames(o) {
  const known = {};
  let unrecognised = 0;
  for (const [k, v] of Object.entries(o)) {
    if (KNOWN_PERMISSION_NAMES.has(k) && typeof v === "boolean") known[k] = v;
    else unrecognised++;
  }
  return { known, unrecognised };
}
var isObj2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var HEX_BYTES = /^0x([0-9a-fA-F]{2})*$/;
var isNonNegInt = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
function backupText(bytes) {
  const bad = (message) => new UpError3("BAD_ARGS", message, { hint: "pass a backup file made by the Universal Profile app or by this skill (up backup export)" });
  if (bytes.length > MAX_BACKUP_BYTES) throw bad(`the backup file is larger than ${MAX_BACKUP_BYTES / 1024 / 1024} MiB`);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw bad("the backup file is not valid UTF-8 text");
  }
}
function parseBackup(text) {
  const issues = [];
  const error = (code, message) => issues.push({ level: "error", code, message });
  const warn = (code, message) => issues.push({ level: "warn", code, message });
  const fail = () => ({ issues });
  if (text.length > MAX_BACKUP_BYTES) {
    error("too-large", "the backup file is too large");
    return fail();
  }
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    error("not-json", "the file is not valid JSON");
    return fail();
  }
  if (!isObj2(root)) {
    error("not-object", "the file does not hold a JSON object");
    return fail();
  }
  if (root.version !== BACKUP_VERSION) {
    error("bad-version", `unsupported version (only version ${BACKUP_VERSION} is supported)`);
    return fail();
  }
  const date = canonicalDateTime(root.backupDate);
  if (!date) warn("bad-date", "backupDate is missing or not an ISO date-time; it is shown as unknown");
  const free = (v, where, max = 80) => {
    const t = safeFileText(v, max);
    if (t === KEY_WITHHELD) warn("key-shaped-text", `${where} looks like key material and is not shown`);
    return t;
  };
  const address = (v, where) => {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
      error("bad-address", `${where} is not a 20-byte hex address`);
      return void 0;
    }
    const cs = getAddress2(v);
    if (v !== cs && v !== v.toLowerCase() && v !== `0x${v.slice(2).toUpperCase()}`) warn("bad-checksum", `${where} has an invalid EIP-55 checksum`);
    return cs;
  };
  const hex = (v, where) => {
    if (typeof v !== "string" || !HEX_BYTES.test(v)) {
      error("bad-hex", `${where} is not 0x hex`);
      return void 0;
    }
    return v;
  };
  const keyIndex = (v, where) => {
    if (v === void 0) return void 0;
    if (!isNonNegInt(v)) {
      error("bad-key-index", `${where} is not a non-negative integer`);
      return void 0;
    }
    return v;
  };
  const list = (v, where) => {
    if (!Array.isArray(v)) {
      error("bad-shape", `${where} is not a list`);
      return [];
    }
    return v;
  };
  const accounts = list(root.accounts, "accounts").flatMap((a, i) => {
    const at = `accounts[${i}]`;
    if (!isObj2(a)) return error("bad-shape", `${at} is not an object`), [];
    const addr = address(a.address, `${at}.address`);
    if (a.type !== void 0 && a.type !== "LSP0-ERC725Account") warn("account-type", `${at}.type is not LSP0-ERC725Account`);
    const networks = list(a.networks, `${at}.networks`).flatMap((n, j) => {
      const nat = `${at}.networks[${j}]`;
      if (!isObj2(n)) return error("bad-shape", `${nat} is not an object`), [];
      if (!isNonNegInt(n.chainID) || n.chainID === 0) error("bad-chain", `${nat}.chainID is not a positive integer`);
      const controllers = list(n.controllers, `${nat}.controllers`).flatMap((c, k) => {
        const cat = `${nat}.controllers[${k}]`;
        if (!isObj2(c)) return error("bad-shape", `${cat} is not an object`), [];
        const ca = address(c.address, `${cat}.address`);
        const idx = keyIndex(c.privateKeyIndex, `${cat}.privateKeyIndex`);
        if (!ca) return [];
        return [{ address: ca, ...typeof c.type === "string" ? { type: free(c.type, `${cat}.type`, 40) } : {}, ...idx !== void 0 ? { privateKeyIndex: idx } : {}, ...typeof c.name === "string" ? { name: free(c.name, `${cat}.name`) } : {} }];
      });
      return [{ chainID: n.chainID, name: typeof n.name === "string" ? free(n.name, `${nat}.name`) : "", controllers }];
    });
    return addr ? [{ ...typeof a.type === "string" ? { type: free(a.type, `${at}.type`, 40) } : {}, ...typeof a.name === "string" ? { name: free(a.name, `${at}.name`) } : {}, address: addr, networks }] : [];
  });
  const lsp23 = list(root.LSP23CrossChainDeployment, "LSP23CrossChainDeployment").flatMap((it, i) => {
    const at = `LSP23CrossChainDeployment[${i}]`;
    if (!isObj2(it)) return error("bad-shape", `${at} is not an object`), [];
    const profile = address(it.profileAddress, `${at}.profileAddress`);
    const factory = address(it.factoryAddress, `${at}.factoryAddress`);
    const calldata = hex(it.deploymentCalldata, `${at}.deploymentCalldata`);
    if (!isNonNegInt(it.initialChainID) || it.initialChainID === 0) error("bad-chain", `${at}.initialChainID is not a positive integer`);
    const salt = it.salt === void 0 ? void 0 : hex(it.salt, `${at}.salt`);
    const initialControllers = list(it.initialControllers, `${at}.initialControllers`).flatMap((c, k) => {
      const cat = `${at}.initialControllers[${k}]`;
      if (!isObj2(c)) return error("bad-shape", `${cat} is not an object`), [];
      const ca = address(c.address, `${cat}.address`);
      const idx = keyIndex(c.privateKeyIndex, `${cat}.privateKeyIndex`);
      const p = isObj2(c.addressPermissions) ? c.addressPermissions : (error("bad-shape", `${cat}.addressPermissions is not an object`), {});
      const permissions = hex(p.permissions, `${cat}.addressPermissions.permissions`);
      const allowedCalls = hex(p.allowedCalls ?? "0x", `${cat}.addressPermissions.allowedCalls`);
      const allowedKeys = hex(p.allowedERC725YDataKeys ?? "0x", `${cat}.addressPermissions.allowedERC725YDataKeys`);
      if (!ca || !permissions || !allowedCalls || !allowedKeys) return [];
      const decoded = isObj2(p.decodedPermissions) ? knownPermissionNames(p.decodedPermissions) : void 0;
      return [{ address: ca, ...idx !== void 0 ? { privateKeyIndex: idx } : {}, addressPermissions: { permissions, ...decoded ? { decodedPermissions: decoded.known, ...decoded.unrecognised ? { unrecognisedNames: decoded.unrecognised } : {} } : {}, allowedCalls, allowedERC725YDataKeys: allowedKeys } }];
    });
    if (!profile || !factory || !calldata) return [];
    return [{ profileAddress: profile, initialChainID: it.initialChainID, factoryAddress: factory, deploymentCalldata: calldata, ...salt ? { salt } : {}, initialControllers }];
  });
  let secrets = { kind: "public" };
  const s = root.secrets;
  if (!isObj2(s) || typeof s.encrypted !== "boolean") error("bad-secrets", "secrets is missing or has no true/false 'encrypted'");
  else if (s.encrypted) {
    const d = s.data;
    const iterationsInFile = Object.hasOwn(s, "iterations");
    if (iterationsInFile && !isValidIterations(s.iterations)) error("bad-iterations", `secrets.iterations is not ${ITERATIONS_RULE}`);
    try {
      if (!isObj2(d)) throw new Error("data");
      decodeField(d.salt, "salt", 8, 128);
      decodeField(d.iv, "iv", 12, 16);
      decodeField(d.secret, "secret", 17, MAX_BACKUP_BYTES);
      secrets = { kind: "encrypted", ...typeof s.passwordHint === "string" && s.passwordHint ? { hint: free(s.passwordHint, "secrets.passwordHint", 255) } : {}, ...typeof s.encryptionType === "string" ? { encryptionType: s.encryptionType === ENCRYPTION_TYPE ? ENCRYPTION_TYPE : UNRECOGNIZED_ENCRYPTION_TYPE } : {}, iterations: iterationsInFile ? s.iterations : LEGACY_ITERATIONS, iterationsInFile, data: { secret: d.secret, iv: d.iv, salt: d.salt } };
      if (s.encryptionType !== ENCRYPTION_TYPE) warn("encryption-type", "encryptionType is not the one this skill and the app write; it is opened as PBKDF2-HMAC-SHA256 with AES-256-GCM all the same");
    } catch (e) {
      error("bad-secrets", e instanceof UpError3 ? e.message : "secrets.data needs Base64 secret, iv and salt");
    }
  } else {
    const entries = [];
    let skipped = 0;
    list(s.data, "secrets.data").forEach((e, i) => {
      const at = `secrets.data[${i}]`;
      if (!isObj2(e)) return error("bad-shape", `${at} is not an object`);
      if (e.type === "seedPhrase") {
        skipped++;
        return warn("seed-phrase", `${at} is a seed phrase; seed phrases are not supported and are skipped`);
      }
      if (e.type !== "privateKey") return error("bad-secret-type", `${at}.type is not privateKey`);
      if (!isNonNegInt(e.index)) return error("bad-key-index", `${at}.index is not a non-negative integer`);
      if (entries.some((x) => x.index === e.index)) return error("duplicate-key-index", `${at}.index is used twice`);
      const a = e.address === void 0 ? void 0 : address(e.address, `${at}.address`);
      entries.push({ index: e.index, ...a ? { address: a } : {}, secret: e.secret });
    });
    if (entries.length) warn("plain-secrets", "this file holds private keys in plain text: anyone who has a copy controls those keys");
    secrets = entries.length || skipped ? { kind: "plain", entries, skippedSeedEntries: skipped } : { kind: "public" };
  }
  if (issues.some((i) => i.level === "error")) return fail();
  return { backup: { backupDate: date ?? "unknown", accounts, lsp23, secrets }, issues };
}

// src/backup/lsp23-decode.ts
import { decodeAbiParameters, decodeFunctionData, getAddress as getAddress3, isAddress } from "./vendor-viem.mjs";
const { LSP } = $s1;
const { LSP23_ABI } = $s10;
const { DATA_KEYS, PERMISSION_NAMES: PERMISSION_NAMES2, PERMISSIONS } = $s14;
const { computeERC1167Addresses, manifestFromPlan, verifyManifest } = $s15;
const { decodePermissions } = $s16;
var DEPLOY_ERC1167_PROXIES = "0x6a66a753";
var DEPLOY_CONTRACTS = "0x17ad46a8";
var unsupported = (reason) => ({ supported: false, reason, rederives: false, canonicalFactory: false, initialControllers: [] });
var sameAddress = (a, b) => a.toLowerCase() === b.toLowerCase();
var ZERO_PERMISSIONS = `0x${"00".repeat(32)}`;
var PERMISSION_VALUE = /^0x0{56}[0-9a-f]{8}$/i;
var DEFINED_PERMISSION_BITS = PERMISSION_NAMES2.reduce((m, n) => m | PERMISSIONS[n], 0n);
function hasDefinedPermission(value) {
  return (value & DEFINED_PERMISSION_BITS) !== 0n;
}
function addressFromKey(key, prefix) {
  return key.toLowerCase().startsWith(prefix.toLowerCase()) && key.length === 66 ? getAddress3(`0x${key.slice(26)}`) : void 0;
}
function decodeDeployment(item) {
  const selector = item.deploymentCalldata.slice(0, 10).toLowerCase();
  if (selector === DEPLOY_CONTRACTS) return unsupported("deployContracts calldata cannot be verified; only deployERC1167Proxies is supported");
  if (selector !== DEPLOY_ERC1167_PROXIES) return unsupported("the calldata is not a deployERC1167Proxies call");
  let primary, secondary, module, moduleData;
  try {
    const d = decodeFunctionData({ abi: LSP23_ABI, data: item.deploymentCalldata });
    if (d.functionName !== "deployERC1167Proxies") return unsupported("the calldata is not a deployERC1167Proxies call");
    [primary, secondary, module, moduleData] = d.args;
  } catch {
    return unsupported("the calldata could not be decoded");
  }
  const derived = computeERC1167Addresses(item.factoryAddress, primary, secondary, module, moduleData);
  const perms = /* @__PURE__ */ new Map();
  const calls = /* @__PURE__ */ new Map();
  const dataKeys = /* @__PURE__ */ new Map();
  let dataKeyList, dataValueList;
  try {
    [dataKeyList, dataValueList] = decodeAbiParameters([{ type: "bytes32[]" }, { type: "bytes[]" }], moduleData);
  } catch {
    return unsupported("the post-deployment data could not be decoded");
  }
  if (dataKeyList.length !== dataValueList.length) return unsupported("the post-deployment data has lists of different lengths");
  let urd;
  let lsp3;
  dataKeyList.forEach((key, i) => {
    const value = dataValueList[i];
    const p = addressFromKey(key, DATA_KEYS.AddressPermissionsPermissionsPrefix);
    const c = addressFromKey(key, DATA_KEYS.AddressPermissionsAllowedCallsPrefix);
    const k = addressFromKey(key, DATA_KEYS.AddressPermissionsAllowedERC725YDataKeysPrefix);
    if (p) {
      const permissionsValid = PERMISSION_VALUE.test(value);
      perms.set(p, { address: p, permissions: permissionsValid ? value.toLowerCase() : ZERO_PERMISSIONS, permissionsValid, hasPermissions: permissionsValid && hasDefinedPermission(BigInt(value)), allowedCalls: "0x", allowedERC725YDataKeys: "0x", isUrd: false });
    } else if (c) calls.set(c, value);
    else if (k) dataKeys.set(k, value);
    else if (key.toLowerCase() === DATA_KEYS.LSP1UniversalReceiverDelegate.toLowerCase() && value.length === 42 && isAddress(value, { strict: false })) urd = getAddress3(value);
    else if (key.toLowerCase() === DATA_KEYS.LSP3Profile.toLowerCase()) lsp3 = value;
  });
  const initialControllers = [...perms.values()].map((c) => ({ ...c, allowedCalls: calls.get(c.address) ?? "0x", allowedERC725YDataKeys: dataKeys.get(c.address) ?? "0x", isUrd: urd !== void 0 && sameAddress(c.address, urd) }));
  const versionOf = (table, a) => Object.entries(table).find(([, x]) => sameAddress(x, a))?.[0] ?? "imported";
  const plan = urd ? {
    factory: getAddress3(item.factoryAddress),
    postDeploymentModule: getAddress3(module),
    implementations: {
      universalProfileInit: { version: versionOf(LSP.UP_INIT, primary.implementationContract), address: getAddress3(primary.implementationContract) },
      keyManagerInit: { version: versionOf(LSP.KM_INIT, secondary.implementationContract), address: getAddress3(secondary.implementationContract) },
      universalReceiverDelegate: { version: versionOf(LSP.URD, urd), address: urd }
    },
    dataKeys: dataKeyList,
    dataValues: dataValueList,
    primaryContractDeploymentInit: { salt: primary.salt.toLowerCase(), fundingAmount: primary.fundingAmount.toString(), implementationContract: getAddress3(primary.implementationContract), initializationCalldata: primary.initializationCalldata },
    secondaryContractDeploymentInit: {
      fundingAmount: secondary.fundingAmount.toString(),
      implementationContract: getAddress3(secondary.implementationContract),
      initializationCalldata: secondary.initializationCalldata,
      addPrimaryContractAddress: secondary.addPrimaryContractAddress,
      extraInitializationParams: secondary.extraInitializationParams
    },
    postDeploymentModuleCalldata: moduleData,
    generatedSalt: derived.generatedSalt,
    profile: derived.profile,
    keyManager: derived.keyManager
  } : void 0;
  return {
    supported: true,
    derivedProfile: derived.profile,
    derivedKeyManager: derived.keyManager,
    rederives: sameAddress(derived.profile, item.profileAddress),
    canonicalFactory: sameAddress(item.factoryAddress, LSP.LSP23_FACTORY),
    initialControllers,
    ...urd ? { urd } : {},
    ...lsp3 ? { lsp3 } : {},
    ...plan ? { plan } : {}
  };
}
function initialControllersFor(dec, keyIndexOf) {
  return dec.initialControllers.map((c) => {
    const idx = c.isUrd ? void 0 : keyIndexOf(c.address);
    const names = decodePermissions(c.permissions).names;
    return {
      address: c.address,
      ...idx !== void 0 ? { privateKeyIndex: idx } : {},
      addressPermissions: { permissions: c.permissions, decodedPermissions: Object.fromEntries(names.map((n) => [n, true])), allowedCalls: c.allowedCalls, allowedERC725YDataKeys: c.allowedERC725YDataKeys }
    };
  });
}
function permissionMismatch(c) {
  if (!c.decodedPermissions) return [];
  const known = new Set(PERMISSION_NAMES2);
  const real = new Set(decodePermissions(c.permissions).names);
  const entries = Object.entries(c.decodedPermissions);
  const listed = new Set(entries.filter(([k, v]) => v === true && known.has(k)).map(([k]) => k));
  const unrecognised = (c.unrecognisedNames ?? 0) + entries.filter(([k]) => !known.has(k)).length;
  return [...[.../* @__PURE__ */ new Set([...real, ...listed])].filter((n) => real.has(n) !== listed.has(n)), ...unrecognised ? [`${unrecognised} unrecognised permission name${unrecognised === 1 ? "" : "s"} (not shown)`] : []];
}
function manifestFromBackup(item, dec, heldKeys) {
  if (!dec.supported || !dec.plan) return { reason: dec.reason ?? "the deployment data has no Universal Receiver Delegate" };
  if (!dec.rederives) return { reason: "the calldata does not derive the profile address stated in the file" };
  const controllers = dec.initialControllers.filter((c) => !c.isUrd);
  if (!controllers.length) return { reason: "the calldata has no controller" };
  if (controllers.some((c) => !c.permissionsValid)) return { reason: "a controller's permission value is not a valid permission set" };
  const chosen = controllers.find((c) => c.hasPermissions && heldKeys.has(c.address.toLowerCase())) ?? controllers.find((c) => c.hasPermissions);
  if (!chosen) return { reason: "no controller in the calldata has permissions" };
  if (dec.plan.primaryContractDeploymentInit.fundingAmount !== "0" || dec.plan.secondaryContractDeploymentInit.fundingAmount !== "0") return { reason: "the deployment sends value, which this skill does not replay" };
  const plan = { ...dec.plan, deployCalldata: item.deploymentCalldata };
  const manifest = manifestFromPlan(
    {
      salt: dec.plan.primaryContractDeploymentInit.salt,
      controller: chosen.address,
      permissions: chosen.permissions,
      extraControllers: controllers.filter((c) => c !== chosen).map((c) => ({ address: c.address, permissions: c.permissions })),
      ...dec.lsp3 ? { lsp3: dec.lsp3 } : {}
    },
    plan
  );
  const v = verifyManifest(manifest);
  return v.ok ? { manifest } : { reason: "the rebuilt manifest does not re-derive (the calldata is not the canonical encoding)" };
}

// src/backup/store.ts
import { createHash } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
const { UpError: UpError4 } = $s2;
const { appendLine, ensureDir, paths } = $s3;
const { assertNotKeyMaterialPath } = $s7;
const { looksLikeKey: looksLikeKey2 } = $s6;
const { writeNewFileExclusive } = $s24;
var sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
function backupsDir(home) {
  return paths.backups(home);
}
function indexFile(home) {
  return join(backupsDir(home), "index.jsonl");
}
async function appendIndex(home, entry) {
  assertNoKeyMaterial("a backups index line", entry);
  await ensureDir(backupsDir(home));
  await appendLine(indexFile(home), JSON.stringify(entry));
}
async function readIndex(home) {
  let text = "";
  try {
    text = await readFile(indexFile(home), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { backups: [], events: [] };
    throw e;
  }
  const backups = [];
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v.event === "string") events.push(v);
      else if (v && typeof v.file === "string" && typeof v.sha256 === "string") backups.push(v);
    } catch {
    }
  }
  return { backups, events };
}
var MAX_LABEL = 40;
var WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function sanitizeAgentLabel(raw) {
  if (typeof raw !== "string" || looksLikeKey2(raw)) return void 0;
  let t = raw.normalize("NFKC").replace(/[\p{C}\u2028\u2029]/gu, "").replace(/[^\p{L}\p{M}\p{N} ._-]/gu, " ");
  t = t.replace(/\s+/g, " ").replace(/\.{2,}/g, ".").replace(/(^| )[._-]+(?= |$)/g, "$1").replace(/ {2,}/g, " ").trim();
  t = [...t].slice(0, MAX_LABEL).join("").replace(/^[ .\-_]+|[ .\-_]+$/g, "");
  if (!t) return void 0;
  return WINDOWS_RESERVED.test(t) ? `${t}-agent` : t;
}
function agentLabel(given, env = process.env) {
  if (typeof given === "string" && given.trim()) {
    const label = sanitizeAgentLabel(given);
    if (!label) throw new UpError4("BAD_ARGS", "--bot-name has no usable letters or digits left after removing characters that are not allowed in a file name", { hint: `pass the agent's display name, e.g. --bot-name "Alice"` });
    return label;
  }
  return sanitizeAgentLabel(env.UP_AGENT_NAME);
}
async function defaultBackupPath(home, now = /* @__PURE__ */ new Date(), label) {
  const day = now.toISOString().slice(0, 10);
  const dir = backupsDir(home);
  const prefix = label ? `${label} - ` : "";
  for (let n = 1; n < 1e3; n++) {
    const file = join(dir, `${prefix}universal-profiles-backup-${day}${n === 1 ? "" : `-${n}`}.json`);
    if (!await lstat(file).then(() => true, () => false)) return file;
  }
  throw new UpError4("INTERNAL", "too many backups for today in the backups folder");
}
async function resolveDestination(home, given, label) {
  if (!given?.trim()) {
    await ensureDir(backupsDir(home));
    return defaultBackupPath(home, /* @__PURE__ */ new Date(), label);
  }
  const file = isAbsolute(given.trim()) ? given.trim() : resolve(given.trim());
  const parent = await stat(dirname(file)).catch(() => null);
  if (!parent?.isDirectory()) throw new UpError4("BAD_ARGS", `the folder ${dirname(file)} does not exist`);
  assertNotKeyMaterialPath(dirname(file), "backup destination", { allowBackups: true });
  if (await lstat(file).then(() => true, () => false)) throw new UpError4("BAD_ARGS", `${file} already exists; a backup is never overwritten`, { hint: "pass another --path, or omit it" });
  return file;
}
async function writeBackup(file, content) {
  const { warning } = await writeNewFileExclusive(file, content);
  return { sha256: sha256Hex(content), size: Buffer.byteLength(content), ...warning ? { warning } : {} };
}
async function readBackupFile(given) {
  if (!given?.trim()) throw new UpError4("BAD_ARGS", "give the path of a backup file");
  const file = resolve(given.trim());
  assertNotKeyMaterialPath(file, "backup file", { allowBackups: true });
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) throw new UpError4("BAD_ARGS", `no backup file at ${file}`, { hint: "pass the path the file was saved to (a chat attachment is saved by the host; use that path)" });
  if (st.size > MAX_BACKUP_BYTES) throw new UpError4("BAD_ARGS", `the backup file is larger than ${MAX_BACKUP_BYTES / 1024 / 1024} MiB`);
  const bytes = await readFile(file);
  return { file, text: backupText(bytes), sha256: sha256Hex(bytes), size: bytes.length };
}

// src/backup/build.ts
var sameAddress2 = (a, b) => a.toLowerCase() === b.toLowerCase();
var REFRESH_TIMEOUT_MS = 8e3;
function withTimeout(p, ms) {
  return new Promise((resolve2, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then((v) => (clearTimeout(t), resolve2(v)), (e) => (clearTimeout(t), reject(e)));
  });
}
async function collectHeldKeys(ctx, cfg, warnings) {
  const listed = [];
  const add = (address, backend, kind) => {
    if (isAddress2(address, { strict: false }) && !listed.some((k) => sameAddress2(k.address, address))) listed.push({ address: getAddress4(address), backend, kind });
  };
  if (cfg.controller) add(cfg.controller.address, cfg.controller.backend, "default");
  for (const k of chainControllerList(cfg)) add(k.address, k.backend, "chain");
  for (const k of await keptKeys(ctx.home, cfg)) add(k.address, k.backend, k.kind);
  const held = [];
  for (const k of listed) {
    let has = false;
    try {
      has = await internalBackend(k.backend).has(k.address);
    } catch {
    }
    if (has) held.push(k);
    else warnings.push(`the key ${k.address} is listed but is not in its key store (${k.backend}); it cannot be part of the backup`);
  }
  return held;
}
function deployedChains(m, record) {
  const ids = /* @__PURE__ */ new Set();
  for (const d of Object.values(m?.deployments ?? {})) if (d && (d.status === "deployed" || d.status === "already-deployed") && Number.isInteger(d.chainId)) ids.add(d.chainId);
  for (const id of m?.chains ?? []) if (Number.isInteger(id)) ids.add(id);
  for (const c of record.joined?.chains ?? []) if (c?.deployed === true && Number.isInteger(c.chainId)) ids.add(c.chainId);
  for (const [id, c] of Object.entries(record.status?.chains ?? {})) if (c?.deployed === true && /^\d+$/.test(id)) ids.add(Number(id));
  for (const c of importedChainsOf(record)) ids.add(c.chainId);
  return [...ids];
}
function importedChainsOf(record) {
  const raw = record.imported?.chains;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => Number.isInteger(c?.chainId) && c.chainId > 0 ? [{ chainId: c.chainId, verified: c.provenance === "verified", controllers: (Array.isArray(c.controllers) ? c.controllers : []).filter((a) => typeof a === "string" && isAddress2(a, { strict: false })).map((a) => getAddress4(a)) }] : []);
}
function establishedFor(chainId, manifest, dec, record, onChain) {
  const out = [];
  const add = (address, source) => {
    if (typeof address === "string" && isAddress2(address, { strict: false }) && !out.some((x) => sameAddress2(x.address, address))) out.push({ address: getAddress4(address), source });
  };
  if (manifest && (manifest.chains?.includes(chainId) || manifest.deployments?.[String(chainId)])) {
    if (dec?.supported) for (const c of dec.initialControllers) !c.isUrd && add(c.address, "deployment");
    else add(manifest.controller, "deployment"), manifest.extraControllers?.forEach((c) => add(c.address, "deployment"));
  }
  for (const c of record.joined?.chains ?? []) if (c?.chainId === chainId && c.authorised !== false) add(c.controller ?? record.joined?.controller, "joined");
  const st = record.status?.chains?.[String(chainId)];
  if (st?.isController === true) add(st.controller, "checked");
  for (const a of record.linkEvidence?.controllers ?? []) add(a, "checked");
  for (const a of onChain) add(a, "chain");
  for (const c of importedChainsOf(record)) if (c.chainId === chainId) for (const a of c.controllers) add(a, "imported");
  return out;
}
async function collectProfiles(ctx, cfg, warnings, opts = {}) {
  const dir = paths2.profiles(ctx.home);
  const names = (await readdir(dir).catch(() => [])).filter((n) => /^0x[0-9a-fA-F]{40}\.json$/.test(n));
  const identities = /* @__PURE__ */ new Map();
  for (const n of names) identities.set(n.slice(0, 42).toLowerCase(), getAddress4(n.slice(0, 42)));
  if (cfg.defaultProfile) identities.set(cfg.defaultProfile.toLowerCase(), getAddress4(cfg.defaultProfile));
  if (opts.only) {
    for (const o of opts.only) if (!identities.has(o.toLowerCase())) throw new UpError5("BAD_ARGS", `no profile ${o} is known on this machine`, { hint: "the profiles known here are listed by: up profile status" });
  }
  const out = [];
  const aliasOf = (a) => Object.entries(cfg.aliases ?? {}).find(([, v]) => sameAddress2(v, a))?.[0] ?? "";
  const ordered = [...identities.values()].sort((a, b) => cfg.defaultProfile && sameAddress2(a, cfg.defaultProfile) ? -1 : cfg.defaultProfile && sameAddress2(b, cfg.defaultProfile) ? 1 : a.localeCompare(b));
  for (const id of ordered) {
    if (opts.only && !opts.only.some((o) => sameAddress2(o, id))) continue;
    let record;
    try {
      record = await readProfileRecord(ctx.home, id);
    } catch (e) {
      if (opts.damaged !== "warn") throw e;
      warnings.push(`the saved record of ${id} is damaged, so its networks and controllers are not shown (${e.message}); ask the human to repair the file, never delete it`);
      continue;
    }
    const linked = chainAddressesOf(record);
    let manifest = record.deployment;
    if (manifest && (manifest.kind !== "lsp23-erc1167-up" || !verifyManifest2(manifest).ok)) {
      warnings.push(`the deployment data of ${id} does not check out (it is left out of the backup)`);
      manifest = void 0;
    }
    const linkedChains = new Set(Object.keys(linked).map(Number));
    const imported = importedChainsOf(record);
    let chainIds = deployedChains(manifest, record).filter((c) => !linkedChains.has(c));
    const onChain = {};
    const refreshedChains = [];
    if (opts.refresh) {
      for (const c of new Set([...chainIds, ...cfg.chains ?? []].filter((x) => !linkedChains.has(x)))) {
        try {
          if (!await withTimeout(hasCode(ctx, c, id), REFRESH_TIMEOUT_MS)) continue;
          if (!chainIds.includes(c)) chainIds.push(c), refreshedChains.push(c);
          onChain[c] = (await withTimeout(readControllers(ctx, c, id), REFRESH_TIMEOUT_MS)).controllers.map((x) => x.address);
        } catch (e) {
          warnings.push(`could not refresh ${id} on chain ${c}: ${e.message}`);
        }
      }
    }
    chainIds = [...new Set(chainIds)];
    const recorded = manifest ? Object.values(manifest.deployments ?? {}).filter((d) => d?.status === "deployed" || d?.status === "already-deployed") : [];
    const importedHere = imported.filter((c) => !linkedChains.has(c.chainId));
    const dec = manifest ? decodeDeployment({ profileAddress: manifest.profile, factoryAddress: manifest.plan.factory, deploymentCalldata: manifest.deployCalldata }) : void 0;
    const controllers = {};
    for (const c of chainIds) controllers[c] = establishedFor(c, manifest, dec, record, onChain[c] ?? []);
    const first = [...recorded].sort((a, b) => a.deployedAt.localeCompare(b.deployedAt))[0]?.chainId;
    const importedInitial = Number.isInteger(record.imported?.initialChainID) ? record.imported.initialChainID : chainIds[0];
    const unverifiedChains = importedHere.filter((c) => !c.verified && !recorded.some((d) => d.chainId === c.chainId)).map((c) => c.chainId);
    if (unverifiedChains.length) warnings.push(`the networks ${unverifiedChains.join(", ")} of ${id} come from an imported backup and were not confirmed on a network from here`);
    if (chainIds.length) out.push({ address: id, name: aliasOf(id), chainIds, ...manifest && (recorded.length || importedHere.length) ? { manifest, initialChainId: first ?? importedInitial } : {}, onChain, controllers, unverifiedChains, refreshedChains });
    else if (!linkedChains.size) warnings.push(`the profile ${id} is not deployed or joined anywhere yet; nothing to back up for it`);
    for (const [chain, address] of Object.entries(linked)) {
      const c = Number(chain);
      const snap = record.status?.chains?.[chain];
      const own = snap && (typeof snap.profile !== "string" || !isAddress2(snap.profile, { strict: false }) || sameAddress2(snap.profile, address)) ? snap : void 0;
      const found = [];
      if (opts.refresh) {
        try {
          if (await withTimeout(hasCode(ctx, c, address), REFRESH_TIMEOUT_MS)) {
            found.push(...(await withTimeout(readControllers(ctx, c, address), REFRESH_TIMEOUT_MS)).controllers.map((x) => x.address));
          }
        } catch (e) {
          warnings.push(`could not refresh the linked address ${address} (profile ${id}) on chain ${c}: ${e.message}`);
        }
      }
      const evidence = { controllers: linkEvidenceOf(record, c) };
      out.push({ address, name: aliasOf(address), chainIds: [c], onChain: { [c]: found }, controllers: { [c]: establishedFor(c, void 0, void 0, { status: own ? { chains: { [chain]: own } } : void 0, linkEvidence: evidence }, found) }, unverifiedChains: [], refreshedChains: [] });
    }
  }
  return out;
}
async function collectState(ctx, opts = {}) {
  const cfg = await ctx.config();
  const warnings = [];
  const keys = await collectHeldKeys(ctx, cfg, warnings);
  const profiles = await collectProfiles(ctx, cfg, warnings, opts);
  return { keys, profiles, warnings };
}
function profileLine(p) {
  const chains = [...new Set(p.chainIds.filter((c) => !(p.refreshedChains ?? []).includes(c)))].sort((a, b) => a - b);
  const perChain = chains.map((c) => `${c}:${[...new Set((p.controllers[c] ?? []).filter((e) => e.source !== "chain").map((e) => e.address.toLowerCase()))].sort().join(",")}`);
  return `${p.address.toLowerCase()}|${perChain.join(";")}`;
}
function fingerprints(state) {
  const addrs = (xs) => xs.map((x) => x.address.toLowerCase()).sort();
  const profilePart = ["profiles", ...state.profiles.map(profileLine).sort(), "deployments", ...state.profiles.flatMap((p) => p.manifest ? [sha256Hex(p.manifest.deployCalldata.toLowerCase())] : []).sort()];
  return { full: sha256Hex(["keys", ...addrs(state.keys), ...profilePart].join("\n")), profiles: sha256Hex(profilePart.join("\n")) };
}
function chainName(ctx, id) {
  try {
    return ctx.registry.chain(id).name;
  } catch {
    return "Unknown chain";
  }
}
function keyName(k, activeHere) {
  if (activeHere) return "AI agent key";
  if (k.kind === "previous") return "AI agent key (previous)";
  if (k.kind === "additional" || k.kind === "recovered") return "AI agent key (not yet used)";
  return "AI agent key (other network)";
}
function buildBackup(ctx, cfg, state, mode, now = /* @__PURE__ */ new Date()) {
  const withKeys = mode !== "public";
  const indexOf = (a) => {
    const i = state.keys.findIndex((k) => sameAddress2(k.address, a));
    return withKeys && i >= 0 ? i : void 0;
  };
  const accounts = [];
  const lsp23 = [];
  for (const p of state.profiles) {
    const dec = p.manifest ? decodeDeployment({ profileAddress: p.manifest.profile, factoryAddress: p.manifest.plan.factory, deploymentCalldata: p.manifest.deployCalldata }) : void 0;
    const networks = [...p.chainIds].sort((a, b) => a === 42 ? -1 : b === 42 ? 1 : a - b).map((chainID) => {
      const active = controllerFor(cfg, chainID)?.address;
      const controllers = [];
      const push = (c) => {
        if (!controllers.some((x) => sameAddress2(x.address, c.address))) controllers.push(c);
      };
      const established = p.controllers[chainID] ?? [];
      for (const e of established) {
        const key = state.keys.find((k) => sameAddress2(k.address, e.address));
        if (key) push({ address: key.address, type: "Device", ...indexOf(key.address) !== void 0 ? { privateKeyIndex: indexOf(key.address) } : {}, name: keyName(key, !!active && sameAddress2(active, key.address)) });
        else if (dec?.urd && sameAddress2(dec.urd, e.address)) push({ address: e.address, type: "UniversalReceiver", name: "Universal Receiver" });
        else push({ address: e.address, type: "Device", name: e.source === "chain" ? "Controller (found on chain)" : "Co-owner (key not held by the agent)" });
      }
      if (dec?.urd && established.length) push({ address: dec.urd, type: "UniversalReceiver", name: "Universal Receiver" });
      return { chainID, name: chainName(ctx, chainID), controllers };
    });
    accounts.push({ type: "LSP0-ERC725Account", name: p.name, address: p.address, networks });
    if (p.manifest && dec) {
      if (p.initialChainId === void 0) continue;
      lsp23.push({
        profileAddress: p.manifest.profile,
        initialChainID: p.initialChainId,
        factoryAddress: p.manifest.plan.factory,
        deploymentCalldata: p.manifest.deployCalldata,
        salt: p.manifest.salt,
        initialControllers: initialControllersFor(dec, indexOf)
      });
    }
  }
  const file = { version: 2, backupDate: backupDate(now), accounts, LSP23CrossChainDeployment: lsp23 };
  const appIncompatible = appIncompatibilities({ ...file, secrets: { encrypted: false, data: [] } });
  return { file, keys: withKeys ? state.keys : [], chains: [...new Set(accounts.flatMap((a) => a.networks.map((n) => n.chainID)))].sort((a, b) => a - b), appIncompatible };
}

// src/backup/run.ts
const { checkHint, choosePassword } = $s0;

// src/backup/restore.ts
import { basename } from "node:path";
import { getAddress as getAddress5, isAddress as isAddress3 } from "./vendor-viem.mjs";
const { UpError: UpError6 } = $s2;
const { updateProfileRecord } = $s5;
const { containsSecret: containsSecret2 } = $s7;
const { KEY_WITHHELD: KEY_WITHHELD2, safeFileText: safeFileText2 } = $s6;
const { verifyManifest: verifyManifest3 } = $s15;
const { readControllerPermissions } = $s17;
const { hasCode: hasCode2 } = $s18;
const { internalBackend: internalBackend2 } = $s20;
const { readCandidates, importRecorded, updateCandidates, withKeyLock } = $s24;
const { readInventory } = $s21;
const { chainControllerList: chainControllerList2 } = $s23;
function issueSummary(issues) {
  return issues.filter((i) => i.level === "error").map((i) => `${i.code}: ${i.message}`).join("; ");
}
async function openBackup(text, password) {
  const { backup, issues } = parseBackup(text);
  if (!backup) throw new UpError6("BAD_ARGS", `the backup file is not valid: ${issueSummary(issues) || "unreadable"}`, { details: { issues }, hint: "check it with: up backup inspect <file>" });
  const s = backup.secrets;
  let keys = [];
  let seedPhraseEntries = 0;
  let decryption;
  if (s.kind === "encrypted") {
    if (!password) throw new UpError6("BAD_ARGS", "this backup is password protected: its password is needed", { hint: "ask the human for the password and pass it with --password (or --password-env / --password-stdin)", details: { passwordHint: s.hint ?? null } });
    const opened = await decryptSecrets(s.data, password, s.iterations);
    keys = opened.keys;
    seedPhraseEntries = opened.seedPhraseEntries;
    decryption = { iterations: opened.iterations, iterationsInFile: s.iterationsInFile, passwordForm: opened.passwordForm, shape: opened.shape };
  } else if (s.kind === "plain") {
    keys = s.entries.map((e) => openKey(e.secret, e.index, e.address));
    seedPhraseEntries = s.skippedSeedEntries;
  }
  const byIndex = new Map(keys.map((k) => [k.index, k]));
  const all = [...issues];
  const scrubbed = scrubPublicText(backup);
  if (scrubbed) all.push({ level: "warn", code: "key-material-in-metadata", message: `${scrubbed} name${scrubbed === 1 ? "" : "s"} or label${scrubbed === 1 ? "" : "s"} in the file held a private key (or looked like one) and ${scrubbed === 1 ? "was" : "were"} replaced` });
  const referenced = /* @__PURE__ */ new Set();
  for (const a of backup.accounts) for (const n of a.networks) for (const c of n.controllers) if (c.privateKeyIndex !== void 0) referenced.add(c.privateKeyIndex);
  for (const l of backup.lsp23) for (const c of l.initialControllers) if (c.privateKeyIndex !== void 0) referenced.add(c.privateKeyIndex);
  for (const i of referenced) if (!byIndex.has(i)) all.push({ level: "warn", code: "unresolved-key-index", message: `a controller points at key number ${i}, which the file does not hold` });
  for (const k of keys) if (k.claimedAddress) all.push({ level: "warn", code: "address-mismatch", message: `key number ${k.index} is stored with an address that is not its own; the real address is used` });
  if (seedPhraseEntries) all.push({ level: "warn", code: "seed-phrase", message: `${seedPhraseEntries} seed phrase entr${seedPhraseEntries === 1 ? "y" : "ies"} found; seed phrases are not supported and were skipped` });
  return { parsed: backup, issues: all, keys, seedPhraseEntries, decryption };
}
var holdsKey = textHoldsKey;
function scrubPublicText(backup) {
  let n = 0;
  const clean = (v) => {
    if (v === void 0 || !holdsKey(v)) return v;
    n++;
    return KEY_WITHHELD2;
  };
  for (const a of backup.accounts) {
    if (a.name !== void 0) a.name = clean(a.name);
    if (a.type !== void 0) a.type = clean(a.type);
    for (const net of a.networks) {
      net.name = clean(net.name) ?? "";
      for (const c of net.controllers) {
        if (c.name !== void 0) c.name = clean(c.name);
        if (c.type !== void 0) c.type = clean(c.type);
      }
    }
  }
  const sec = backup.secrets;
  if (sec.kind === "encrypted") {
    if (sec.hint !== void 0) sec.hint = clean(sec.hint);
    if (sec.encryptionType !== void 0) sec.encryptionType = clean(sec.encryptionType);
  }
  backup.backupDate = clean(backup.backupDate) ?? "unknown";
  return n;
}
function assertNoKeyIn(what, ...texts) {
  for (const t of texts) if (t && (containsSecret2(t) || containsSecret2(t.replace(/[^0-9a-z]/gi, "")))) throw new UpError6("BAD_ARGS", `${what} holds private key material; nothing was changed`, { hint: "rename or replace it" });
}
var sameAddress3 = (a, b) => a.toLowerCase() === b.toLowerCase();
function analyseAccounts(opened, localKeys) {
  const fileByAddress = new Map(opened.keys.map((k) => [k.address.toLowerCase(), k]));
  const held = /* @__PURE__ */ new Set([...fileByAddress.keys(), ...localKeys]);
  return opened.parsed.accounts.map((account) => {
    const items = opened.parsed.lsp23.filter((l) => sameAddress3(l.profileAddress, account.address)).map((item) => {
      const decoded = decodeDeployment(item);
      const { manifest, reason } = manifestFromBackup(item, decoded, held);
      return { item, decoded, manifest, reason, permissionNotes: item.initialControllers.flatMap((c) => permissionMismatch(c.addressPermissions).map((n) => `${n} for ${c.address}`)) };
    });
    const listed = /* @__PURE__ */ new Set();
    const indices = /* @__PURE__ */ new Set();
    for (const n of account.networks) for (const c of n.controllers) listed.add(c.address.toLowerCase()), c.privateKeyIndex !== void 0 && indices.add(c.privateKeyIndex);
    for (const it of items) for (const c of it.item.initialControllers) listed.add(c.address.toLowerCase()), c.privateKeyIndex !== void 0 && indices.add(c.privateKeyIndex);
    const heldControllers = [...listed].filter((a) => held.has(a)).map((a) => getAddress5(a));
    const heldByChain = /* @__PURE__ */ new Map();
    const fileKeys = opened.keys.filter((k) => indices.has(k.index) || listed.has(k.address.toLowerCase()));
    const proof = items.some((it) => it.decoded.rederives && it.decoded.initialControllers.some((c) => !c.isUrd && c.hasPermissions && held.has(c.address.toLowerCase())));
    const forged = items.some((i) => i.decoded.supported && !i.decoded.rederives);
    const chains = [.../* @__PURE__ */ new Set([...account.networks.map((n) => n.chainID), ...account.networks.length ? [] : items.map((i) => i.item.initialChainID)])];
    for (const chainId of chains) {
      const here = /* @__PURE__ */ new Set();
      for (const n of account.networks) if (n.chainID === chainId) for (const c of n.controllers) here.add(c.address.toLowerCase());
      for (const it of items) if (it.item.initialChainID === chainId) for (const c of it.item.initialControllers) here.add(c.address.toLowerCase());
      heldByChain.set(chainId, [...here].filter((a) => held.has(a)).map((a) => getAddress5(a)));
    }
    return { account, chains, items, heldControllers, heldByChain, fileKeys, proof, forged };
  });
}
function assertProfileRecordClean(x) {
  assertNoKeyMaterial(`the backup's data for the profile ${x.account.address}`, { account: x.account, items: x.items.map((i) => ({ item: i.item, manifest: i.manifest })) });
}
async function decideChain(ctx, a, chainId) {
  const candidates = a.heldByChain.get(chainId) ?? [];
  if (!candidates.length) return { chainId, status: "no-controlling-key" };
  const forged = a.forged && !a.proof;
  const open = (status, note) => forged ? { chainId, status: "impersonation-blocked", note: "the deployment data in the file does not create this profile and the network cannot confirm that a backup key controls it" } : { chainId, status, note };
  try {
    ctx.registry.chain(chainId);
  } catch {
    return open("unknown-network", "this network is not in the registry");
  }
  try {
    if (!await hasCode2(ctx, chainId, a.account.address)) return { chainId, status: "not-deployed" };
  } catch {
    return open("unverified", "the network could not be reached");
  }
  let inconclusive = false;
  for (const key of candidates) {
    try {
      const info = await readControllerPermissions(ctx, chainId, a.account.address, key);
      if (hasDefinedPermission(info.permissions.value)) return { chainId, status: "controls" };
    } catch {
      inconclusive = true;
    }
  }
  if (inconclusive) return open("unverified", "the permissions could not be read");
  if (a.proof) return { chainId, status: "restorable-with-warning", note: "controller-permissions-revoked: the key no longer has permissions on this network, but the file proves it created the profile" };
  return { chainId, status: "impersonation-blocked" };
}
async function decideProfile(ctx, a, online) {
  const address = a.account.address;
  if (!online) {
    const chains2 = a.chains.map((chainId) => ({
      chainId,
      status: a.heldByChain.get(chainId)?.length ? a.forged && !a.proof ? "impersonation-blocked" : "unverified" : "no-controlling-key",
      note: "not checked on the network"
    }));
    const verdict2 = chains2.some((c) => c.status === "unverified") ? "unverified" : chains2.some((c) => c.status === "impersonation-blocked") ? "impersonation-blocked" : "no-controlling-key";
    return { address, verdict: verdict2, restorable: verdict2 === "unverified", chains: chains2 };
  }
  const chains = [];
  for (const c of a.chains) chains.push(await decideChain(ctx, a, c));
  const has = (s) => chains.some((c) => c.status === s);
  const verdict = has("controls") ? "restorable" : has("restorable-with-warning") ? "restorable-with-warning" : has("unverified") ? "unverified" : has("impersonation-blocked") ? "impersonation-blocked" : has("unknown-network") ? "unverified" : has("no-controlling-key") ? "no-controlling-key" : "not-deployed";
  return { address, verdict, restorable: verdict === "restorable" || verdict === "restorable-with-warning" || verdict === "unverified", chains };
}
async function localKeyStores(ctx, cfg) {
  const known = [];
  if (cfg.controller) known.push(cfg.controller);
  known.push(...chainControllerList2(cfg), ...cfg.previousControllers ?? [], ...await readCandidates(ctx.home), ...await readInventory(ctx.home));
  const out = /* @__PURE__ */ new Map();
  for (const k of known) {
    const id = k.address.toLowerCase();
    if (out.has(id)) continue;
    try {
      if (await internalBackend2(k.backend).has(k.address)) out.set(id, k.backend);
    } catch {
    }
  }
  return out;
}
async function existingStore(address, known, target) {
  const hit = known.get(address.toLowerCase());
  if (hit || !target) return hit;
  try {
    return await target.has(address) ? target.id : void 0;
  } catch {
    return void 0;
  }
}
async function restoreKeys(ctx, keys, backend, backupDate2, known, activeAddress) {
  const results = [];
  await withKeyLock(ctx.home, async () => {
    for (const k of keys) {
      const where = await existingStore(k.address, known, backend);
      if (where) {
        results.push({ address: k.address, status: "exists", backend: where });
        continue;
      }
      try {
        if (!backend) throw new UpError6("INTERNAL", "no key store was chosen for the new keys");
        await importRecorded(ctx.home, backend, k.privateKey, `restored from LSP-30 backup ${backupDate2}`);
        results.push({ address: k.address, status: "restored", backend: backend.id });
        if (!activeAddress || !sameAddress3(activeAddress, k.address)) await updateCandidates(ctx.home, (list) => [...list, { address: k.address, backend: backend.id, createdAt: (/* @__PURE__ */ new Date()).toISOString() }]);
      } catch (e) {
        results.push({ address: k.address, status: "failed", ...backend ? { backend: backend.id } : {} });
        const err = e instanceof UpError6 ? e : new UpError6("INTERNAL", e.message);
        throw new UpError6(err.code, `${err.message} (${results.filter((r) => r.status === "restored").length} key(s) were restored before this; they stay in the key store and are listed)`, { hint: err.hint, details: { keys: results } });
      }
    }
  });
  return results;
}
var IMPORTED_VERIFIED = "verified";
var IMPORTED_UNVERIFIED = "imported, unverified";
function importedChains(analysis, decision) {
  const known = (chainId) => !["not-deployed", "impersonation-blocked", "no-controlling-key"].includes(decision?.chains.find((c) => c.chainId === chainId)?.status ?? "");
  return analysis.chains.filter(known).map((chainId) => {
    const listed = /* @__PURE__ */ new Set();
    const out = [];
    const add = (a) => !listed.has(a.toLowerCase()) && (listed.add(a.toLowerCase()), out.push(getAddress5(a)));
    for (const n of analysis.account.networks) if (n.chainID === chainId) for (const c of n.controllers) add(c.address);
    for (const it of analysis.items) if (it.item.initialChainID === chainId) for (const c of it.item.initialControllers) add(c.address);
    const status = decision?.chains.find((c) => c.chainId === chainId)?.status;
    return { chainId, provenance: status === "controls" || status === "restorable-with-warning" ? IMPORTED_VERIFIED : IMPORTED_UNVERIFIED, controllers: out.slice(0, 64) };
  });
}
function mergeChains(before, now) {
  const byId = /* @__PURE__ */ new Map();
  for (const c of Array.isArray(before) ? before : []) {
    if (Number.isInteger(c?.chainId) && Array.isArray(c?.controllers)) byId.set(c.chainId, { chainId: c.chainId, provenance: c.provenance === IMPORTED_VERIFIED ? IMPORTED_VERIFIED : IMPORTED_UNVERIFIED, controllers: c.controllers.filter((a) => typeof a === "string" && isAddress3(a, { strict: false })).map(getAddress5) });
  }
  for (const c of now) {
    const old = byId.get(c.chainId);
    const controllers = [...new Map([...old?.controllers ?? [], ...c.controllers].map((a) => [a.toLowerCase(), a])).values()];
    byId.set(c.chainId, { chainId: c.chainId, provenance: old?.provenance === IMPORTED_VERIFIED || c.provenance === IMPORTED_VERIFIED ? IMPORTED_VERIFIED : IMPORTED_UNVERIFIED, controllers });
  }
  return [...byId.values()].sort((a, b) => a.chainId - b.chainId);
}
async function writeProfileRecords(ctx, profiles, info) {
  const out = [];
  for (const { analysis, manifest, decision } of profiles) {
    let status = "none";
    const name = analysis.account.name && analysis.account.name !== KEY_WITHHELD2 ? safeFileText2(analysis.account.name) : "";
    assertNoKeyIn("the backup", basename(info.file), info.backupDate, name);
    await updateProfileRecord(ctx.home, analysis.account.address, (latest) => {
      const patch = {
        imported: {
          file: safeFileText2(basename(info.file), 120),
          sha256: info.sha256,
          backupDate: info.backupDate,
          at: (/* @__PURE__ */ new Date()).toISOString(),
          ...name ? { name } : {},
          ...analysis.items[0] ? { initialChainID: analysis.items[0].item.initialChainID } : {},
          chains: mergeChains(latest.imported?.chains, importedChains(analysis, decision)),
          restoredKeys: info.restoredKeys,
          skippedKeys: info.skippedKeys
        }
      };
      const cur = latest.deployment;
      if (manifest && !cur) {
        const v = verifyManifest3(manifest);
        if (v.ok) {
          patch.deployment = manifest;
          status = "restored";
        }
      } else if (manifest && cur) status = cur.deployCalldata?.toLowerCase() === manifest.deployCalldata.toLowerCase() ? "kept-existing" : "conflict";
      assertNoKeyMaterial(`the record of the profile ${analysis.account.address}`, patch);
      return patch;
    });
    out.push({ address: analysis.account.address, manifest: status, chains: analysis.chains });
  }
  return out;
}
async function applyImportConfig(ctx, change) {
  assertNoKeyMaterial("the configuration change", change);
  const known = [];
  const unknownChains = [];
  for (const c of change.chains) {
    try {
      ctx.registry.chain(c);
      known.push(c);
    } catch {
      unknownChains.push(c);
    }
  }
  const result = { chainsAdded: [], unknownChains, activeSet: false, defaultProfileSet: false };
  await ctx.updateConfig((cur) => {
    const next = { ...cur, version: 1 };
    result.chainsAdded = known.filter((c) => !(cur.chains ?? []).includes(c));
    if (result.chainsAdded.length) next.chains = [...cur.chains ?? [], ...result.chainsAdded];
    if (!cur.defaultProfile && change.defaultProfile) {
      next.defaultProfile = change.defaultProfile;
      result.defaultProfileSet = true;
    }
    if (!cur.controller && change.active) {
      next.controller = { address: change.active.address, backend: change.active.backend, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
      result.activeSet = true;
    }
    return next;
  });
  return result;
}

// src/backup/run.ts
var sameAddress4 = (a, b) => a.toLowerCase() === b.toLowerCase();
var short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
function chainName2(ctx, id) {
  try {
    return ctx.registry.chain(id).name;
  } catch {
    return `chain ${id}`;
  }
}
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
function hasPasswordArgs(a) {
  return a.password !== void 0 || a["password-env"] !== void 0 || a["password-stdin"] === true || a["generate-password"] === true;
}
var DELIVERY = "Attach the file at data.path to your reply with your chat's attachment mechanism (OpenClaw: the message tool, action send, media = that path). Never read, print, cat, open, copy or upload the file's contents yourself.";
var COMPATIBILITY = {
  default: "The file states secrets.iterations = 600000. This skill and app versions that read secrets.iterations open it; Universal Profile app and extension versions that do not read it always derive with 10,000, so they cannot open it and report a wrong password. A copy for those: --legacy (weaker lock), only with the human's approval.",
  legacy: "The file states secrets.iterations = 10000 (--legacy): the count app and extension versions that do not read secrets.iterations always use, so they open it, as do this skill and newer versions."
};
var LEGACY_WARNING = "LEGACY: the keys are locked with 10,000 PBKDF2 iterations (the old app's count, stated in the file) so that app versions that do not read secrets.iterations can open it; a password guess costs 60 times less than with the default 600,000. Use it only when the human needs such an app version; a generated password is best";
var VERDICT_TEXT = {
  restorable: "a key from the backup still controls it",
  "restorable-with-warning": "the file proves a key created it, but that key no longer has permissions on the network",
  unverified: "not confirmed on the network",
  "not-deployed": "it is not deployed on any network I could check",
  "no-controlling-key": "the backup has no key that controls it",
  "impersonation-blocked": "none of the backup's keys controls it on the network, and the file does not prove it created it: not restored"
};
function decisionData(d, x) {
  return {
    address: d.address,
    verdict: d.verdict,
    restorable: d.restorable,
    why: VERDICT_TEXT[d.verdict],
    chains: d.chains,
    deployment: x.items.map((i) => ({ rederivesProfile: i.decoded.rederives, canRebuildLocalManifest: Boolean(i.manifest), ...i.reason ? { reason: i.reason } : {} }))
  };
}
async function verifyRoundTrip(text, built, keys, password, iterations) {
  const fail = () => new UpError7("INTERNAL", "backup verification failed: the file does not read back as intended; nothing was written");
  const opened = await openBackup(text, password).catch(() => {
    throw fail();
  });
  if (opened.keys.length !== keys.length || opened.keys.some((k, i) => k.index !== i || !sameAddress4(k.address, keys[i].address) || k.privateKey !== keys[i].privateKey.toLowerCase() || k.claimedAddress)) throw fail();
  if (opened.parsed.accounts.length !== built.file.accounts.length || opened.parsed.lsp23.length !== built.file.LSP23CrossChainDeployment.length) throw fail();
  if (opened.parsed.secrets.kind === "encrypted" && (opened.decryption?.iterations !== iterations || opened.decryption?.iterationsInFile !== true)) throw fail();
}
async function runExport(ctx, a) {
  const mode = a.mode;
  const legacy = a.legacy === true;
  if (mode !== "encrypted" && (hasPasswordArgs(a) || a.hint)) throw new UpError7("BAD_ARGS", `a password or hint only applies to an encrypted backup (this one is ${mode})`);
  if (mode !== "encrypted" && legacy) throw new UpError7("BAD_ARGS", `--legacy only applies to an encrypted backup (this one is ${mode})`);
  const iterations = mode === "encrypted" ? legacy ? LEGACY_ITERATIONS : DEFAULT_ITERATIONS : void 0;
  const kdf = iterations !== void 0 ? kdfDescription(iterations) : void 0;
  const compatibility = iterations !== void 0 ? legacy ? COMPATIBILITY.legacy : COMPATIBILITY.default : void 0;
  if (mode === "unencrypted" && a["explicit-consent"] !== true) {
    throw new UpError7("BAD_ARGS", "an unencrypted backup needs --explicit-consent: it puts the keys in a file anyone can use", { hint: "recommend the encrypted backup; only if the human insists, add --explicit-consent and their --approval" });
  }
  assertNoKeyMaterial("the backup destination or hint", { path: a.path, hint: a.hint, botName: a["bot-name"] });
  const label = agentLabel(a["bot-name"]);
  const cfg = await ctx.config();
  const only = a.profiles?.length ? await Promise.all(a.profiles.map((p) => ctx.resolveAddress(p))) : void 0;
  const state = await collectState(ctx, { only, refresh: a.refresh === true });
  if (!state.profiles.length && !state.keys.length) throw new UpError7("BAD_ARGS", "there is nothing to back up yet: no profile and no key on this machine", { hint: "set up the profile first (up start)" });
  if (mode !== "public" && !state.keys.length) throw new UpError7("NO_SIGNER", "none of the agent's keys is in a key store here, so there are no keys to back up", { hint: "a backup without keys is --mode public" });
  const built = buildBackup(ctx, cfg, state, mode);
  const appCompatible = built.appIncompatible.length === 0 && (iterations === void 0 || iterations === LEGACY_ITERATIONS);
  assertNoKeyMaterial("an account name, alias or label of the backup", built.file);
  const dest = await resolveDestination(ctx.home, a.path, label);
  assertNoKeyMaterial("the backup destination", { path: dest });
  const profiles = state.profiles.map((p) => p.address);
  const warnings = [...state.warnings];
  if (!state.profiles.length) warnings.push("the agent has no deployed profile yet: the file holds only its keys");
  if (mode !== "public" && built.appIncompatible.length) warnings.push(...built.appIncompatible.map((w) => `the app may reject this file: ${w}`));
  if (mode === "public" && built.file.LSP23CrossChainDeployment.length) warnings.push("the Universal Profile app cannot import a public file that has deployment data (it needs a key)");
  if (mode === "unencrypted") warnings.push("UNENCRYPTED: this file holds the private keys in plain text. Anyone with a copy controls those keys and what they control. Delete it after use; if it was ever sent through a chat or e-mail, treat the keys as exposed and move the funds");
  if (legacy) warnings.push(LEGACY_WARNING);
  if (mode !== "public") {
    const summary = {
      effect: mode === "encrypted" ? "write a backup file with the agent's keys locked by a password" : "write a backup file with the agent's keys in PLAIN TEXT",
      destination: dest,
      profiles,
      chains: built.chains.map((c) => `${chainName2(ctx, c)} (${c})`),
      keyAddresses: built.keys.map((k) => k.address),
      keyCount: built.keys.length,
      format: mode === "encrypted" ? `LSP-30 version 2, ${legacy ? "LEGACY lock: " : ""}${kdf}` : "LSP-30 version 2, keys not encrypted",
      ...compatibility ? { compatibility } : {},
      password: mode === "encrypted" ? hasPasswordArgs(a) && a["generate-password"] !== true ? "chosen by the human" : "generated (returned to the agent to tell the human)" : "none",
      note: mode === "encrypted" ? "anyone with the file AND the password controls these keys" : "anyone with the file controls these keys",
      warnings
    };
    assertNoKeyMaterial("the export confirmation", summary);
    await ctx.consent({ verb: "backup export", risk: "secret", summary });
  }
  if (ctx.flags.dryRun) {
    return { data: { dryRun: true, mode, path: dest, profiles, keys: built.keys.map((k) => k.address), chains: built.chains, ...iterations !== void 0 ? { iterations, legacy, kdf } : {}, appCompatible }, text: `Dry run: a ${mode} backup of ${plural(profiles.length, "profile", "profiles")} and ${plural(built.keys.length, "key", "keys")} would be written to ${dest}${kdf ? ` (${kdf})` : ""}.`, warnings };
  }
  const choice = mode === "encrypted" ? await choosePassword(a, true) : void 0;
  const hint = choice ? checkHint(a.hint, choice.password) : void 0;
  warnings.push(...choice?.warnings ?? []);
  const secretKeys = [];
  for (const k of built.keys) {
    const backend = internalBackend3(k.backend);
    if (!backend.exportPrivateKey) throw new UpError7("NOT_SUPPORTED", `the ${k.backend} key store cannot export keys for a backup`);
    secretKeys.push({ address: k.address, privateKey: await backend.exportPrivateKey(k.address) });
  }
  const secrets = mode === "encrypted" ? { encrypted: true, ...hint ? { passwordHint: hint } : {}, encryptionType: ENCRYPTION_TYPE, iterations, data: await encryptSecrets(secretKeys, choice.password, iterations) } : { encrypted: false, data: mode === "unencrypted" ? secretKeys.map((k, index) => ({ type: "privateKey", index, address: k.address, secret: k.privateKey })) : [] };
  const file = { ...built.file, secrets };
  const text = serializeBackup(file);
  await verifyRoundTrip(text, built, secretKeys, choice?.password, iterations);
  assertNoKeyMaterial("an account name, alias, hint or the destination of the backup", { file: built.file, hint, path: dest });
  await appendIndex(ctx.home, { at: (/* @__PURE__ */ new Date()).toISOString(), event: "reserved", file: dest }).catch(() => {
    throw new UpError7("INTERNAL", "the backups index cannot be written, so no backup was made; nothing was written", { hint: `check that ${paths3.backups(ctx.home)} is writable and not full` });
  });
  let written;
  try {
    written = await writeBackup(dest, text);
  } catch (e) {
    const exists = await lstat2(dest).then(() => true, () => false);
    const ours = exists && !(e instanceof UpError7 && /already exists/.test(e.message));
    await appendIndex(ctx.home, { at: (/* @__PURE__ */ new Date()).toISOString(), event: ours ? "committed" : "cancelled", file: dest }).catch(() => {
    });
    throw e;
  }
  await appendIndex(ctx.home, { at: (/* @__PURE__ */ new Date()).toISOString(), event: "committed", file: dest }).catch(() => {
  });
  if (written.warning) warnings.push(written.warning);
  ctx.log(`${mode} backup written: ${dest}`);
  const fp = fingerprints(state);
  let indexed = true;
  await appendIndex(ctx.home, {
    at: (/* @__PURE__ */ new Date()).toISOString(),
    file: dest,
    sha256: written.sha256,
    mode,
    encrypted: mode === "encrypted",
    profiles,
    keys: built.keys.map((k) => k.address),
    chains: built.chains,
    fingerprint: fp.full,
    profilesFingerprint: fp.profiles,
    hintPresent: Boolean(hint),
    appCompatible,
    ...iterations !== void 0 ? { iterations } : {}
  }).catch(() => {
    indexed = false;
    warnings.push("the backup was written, but it could not be added to the backups index, so `up backup list` will not show it. The file is kept and still protected from other readers; use it as normal");
  });
  const what = profiles.length === 1 ? "my account" : profiles.length > 1 ? `my ${profiles.length} accounts` : "my keys";
  const made = legacy ? ", made so that the Universal Profile app can open it" : "";
  const restoreWhere = legacy ? "You can restore it in the Universal Profile app or with me. Its lock is weaker than my usual one, so keep the file especially safe." : "You can restore it with me. The Universal Profile app opens it only in versions that support its stronger lock; if yours can't, ask me for an app-compatible copy.";
  const say = mode === "encrypted" && choice?.generated ? `Here is the backup of ${what}${made}. Its password is: ${choice.password}
Keep the file and the password in different safe places (a password manager is ideal). ${restoreWhere}` : mode === "encrypted" ? `Here is the backup of ${what}${made}. It is locked with the password you chose; without it the file cannot be opened. Keep the file and the password in different places. ${restoreWhere}` : mode === "unencrypted" ? `Here is the backup of ${what}, WITHOUT a password. Anyone who gets this file controls my keys and what they control: treat it like a recovery phrase, don't forward it, and delete it after use.` : `Here is a copy of the details of ${what}: no keys and no password are in it, so nobody can take control with it. It helps me set ${what === "my keys" ? "up" : "it up"} again, but it cannot restore control on its own${built.appIncompatible.length ? " and the Universal Profile app can't open it" : ""}.`;
  const data = {
    mode,
    path: dest,
    sha256: written.sha256,
    size: written.size,
    encrypted: mode === "encrypted",
    profiles,
    keys: built.keys.map((k) => k.address),
    keyCount: built.keys.length,
    chains: built.chains,
    appCompatible,
    ...iterations !== void 0 ? { iterations, legacy, kdf, compatibility } : {},
    hintPresent: Boolean(hint),
    indexed,
    ...choice?.generated ? { password: choice.password, passwordGenerated: true } : {},
    say,
    next: [
      DELIVERY,
      mode === "encrypted" && choice?.generated ? "Tell the human data.say (it has the password) with the attachment, and do not repeat the password elsewhere." : "Tell the human data.say with the attachment.",
      "Do not delete or read backup files. The human decides what to keep.",
      ...mode === "encrypted" && !legacy ? ["Only if the human needs to restore it in a Universal Profile app or extension version that cannot open it (it says the password is wrong): offer a copy made with up backup export --legacy, which has a weaker lock, and make it only with their approval."] : [],
      ...mode === "unencrypted" ? ["Deliver the file only because the human explicitly asked, after hearing the warning in data.say."] : []
    ]
  };
  if (choice?.generated) releaseKeys(data, "password");
  return {
    data,
    text: [say, "", `File: ${dest}`, `sha256: ${written.sha256}`, `Contents: ${plural(profiles.length, "profile", "profiles")}, ${plural(built.keys.length, "key", "keys")}${kdf ? `; ${legacy ? "LEGACY lock, " : ""}${kdf}` : ""}`].join("\n"),
    warnings
  };
}
async function runList(ctx, a) {
  const state = await collectState(ctx);
  const fp = fingerprints(state);
  const { backups, events } = await readIndex(ctx.home);
  const rows = await Promise.all(
    backups.map(async (b) => {
      const st = await stat2(b.file).catch(() => null);
      const exists = Boolean(st?.isFile());
      const oversized = exists && st.size > MAX_BACKUP_BYTES;
      let changed = oversized;
      if (exists && !oversized) changed = sha256Hex(await readFile2(b.file)) !== b.sha256;
      return { file: b.file, at: b.at, mode: b.mode, encrypted: b.encrypted, profiles: b.profiles, keys: b.keys, chains: b.chains, ...typeof b.iterations === "number" ? { iterations: b.iterations } : {}, appCompatible: b.appCompatible, exists, changed, oversized, covers: { keys: b.mode !== "public" && b.fingerprint === fp.full, profiles: b.profilesFingerprint === fp.profiles } };
    })
  );
  const usable = (r) => r.exists && !r.changed;
  const newestWithKeys = [...rows].reverse().find((r) => r.mode !== "public" && usable(r));
  const current = Boolean(newestWithKeys?.covers.keys);
  const publicCurrent = rows.some((r) => usable(r) && r.covers.profiles);
  const anything = state.keys.length > 0 || state.profiles.length > 0;
  const alreadyAsked = events.some((e) => e.event === "asked" && e.fingerprint === fp.full);
  let ask = null;
  if (anything && state.keys.length > 0 && !current && !alreadyAsked) {
    const reason = newestWithKeys ? "changed" : "no-backup";
    ask = {
      reason,
      kind: "keys",
      say: newestWithKeys ? "My account or my keys have changed since the last backup. Do you want a fresh backup? I'd give you a file and a password; keep them in different safe places and you can restore it with me." : "Do you want a backup of my account? I'd give you a file and a password; keep them in different safe places and you can restore it with me."
    };
  }
  if (a["mark-asked"] === true) await appendIndex(ctx.home, { at: (/* @__PURE__ */ new Date()).toISOString(), event: "asked", fingerprint: fp.full, kind: ask?.kind ?? "keys" });
  const plaintext = rows.filter((r) => r.mode === "unencrypted" && r.exists).map((r) => r.file);
  const warnings = [
    ...state.warnings,
    ...plaintext.map((f) => `a plain-text backup still exists at ${f}: it holds the keys unprotected. Tell the human to delete it once it is no longer needed (backups are never deleted by the skill)`),
    ...rows.filter((r) => !r.exists).map((r) => `the backup ${r.file} no longer exists`),
    ...rows.filter((r) => r.exists && r.changed && !r.oversized).map((r) => `the backup ${r.file} was changed after it was made`),
    ...rows.filter((r) => r.oversized).map((r) => `the backup ${r.file} is larger than ${MAX_BACKUP_BYTES / 1024 / 1024} MiB: it cannot be opened, so it does not count as a backup. Make a new one (up backup export)`)
  ];
  const text = rows.length ? [`${plural(rows.length, "backup", "backups")} made here. ${current ? "The newest backup with keys covers the current keys and profiles." : newestWithKeys ? "The keys or profiles changed since the newest backup with keys." : "No backup with keys yet."}`, ...rows.map((r) => `- ${r.at.slice(0, 10)} ${r.mode}${r.exists ? "" : " (file gone)"}: ${r.file}`)].join("\n") : "No backup has been made on this machine yet.";
  return { data: { backups: rows, current, publicCurrent, keys: state.keys.map((k) => k.address), profiles: state.profiles.map((p) => p.address), plaintextBackups: plaintext, ask, ...ask ? { next: ['Ask the human once, in your own words, using data.ask.say. If they agree: ask them for a password they will remember (at least 6 characters with a lowercase and an uppercase letter, a number and a symbol), or offer to make one up for them; then up backup export --password <theirs> --approval "<their words>" (without --password one is generated). If they decline: run up backup list --mark-asked and do not ask again until this returns a new data.ask.'] } : {} }, text, warnings };
}
async function runInspect(ctx, a) {
  const f = await readBackupFile(a.path);
  const { backup, issues } = parseBackup(f.text);
  const base = { file: f.file, size: f.size, sha256: f.sha256 };
  if (!backup) return { data: { ...base, valid: false, issues }, text: `This is not a usable backup file:
${issues.map((i) => `- ${i.message}`).join("\n")}`, warnings: [] };
  let opened;
  if (backup.secrets.kind === "plain") {
    try {
      opened = await openBackup(f.text, void 0);
    } catch (e) {
      issues.push({ level: "error", code: "bad-key", message: e instanceof UpError7 ? e.message : "a key in the file is not valid" });
    }
  }
  const keyedBy = (idx) => idx !== void 0;
  const analyses = analyseAccounts(opened ?? { parsed: backup, issues, keys: [], seedPhraseEntries: 0 }, /* @__PURE__ */ new Set());
  const lsp23 = analyses.flatMap((x) => x.items);
  const allIssues = [...issues];
  const itemId = (i) => `${i.profileAddress.toLowerCase()}:${sha256Hex(i.deploymentCalldata.toLowerCase())}`;
  const placed = new Set(lsp23.map((x) => itemId(x.item)));
  for (const it of backup.lsp23) if (!placed.has(itemId(it))) allIssues.push({ level: "warn", code: "orphan-deployment", message: `the deployment data for ${it.profileAddress} belongs to no account in the file` });
  for (const it of lsp23) {
    if (!it.decoded.supported) allIssues.push({ level: "warn", code: "unsupported-deployment", message: `deployment data for ${it.item.profileAddress}: ${it.decoded.reason}` });
    else {
      if (!it.decoded.rederives) allIssues.push({ level: "error", code: "profile-mismatch", message: `the deployment data for ${it.item.profileAddress} derives a different profile address (${it.decoded.derivedProfile}): the file may be forged` });
      if (!it.decoded.canonicalFactory) allIssues.push({ level: "warn", code: "non-canonical-factory", message: `deployment data for ${it.item.profileAddress} uses a factory that is not the canonical LSP23 factory` });
    }
    for (const n of it.permissionNotes) allIssues.push({ level: "warn", code: "decoded-permissions", message: `decodedPermissions disagrees with the permissions value: ${n}` });
  }
  const s = backup.secrets;
  const keyMaterial = s.kind === "encrypted" ? { kind: "encrypted", encryptionType: s.encryptionType ?? null, iterations: s.iterations, iterationsInFile: s.iterationsInFile, hintPresent: Boolean(s.hint), ...s.hint ? { hint: safeFileText3(s.hint, 255) } : {}, sizes: { secretBytes: Buffer.from(s.data.secret, "base64").length, ivBytes: Buffer.from(s.data.iv, "base64").length, saltBytes: Buffer.from(s.data.salt, "base64").length } } : s.kind === "plain" ? { kind: "plain-text keys", keyCount: opened?.keys.length ?? 0, keyAddresses: opened?.keys.map((k) => k.address) ?? [] } : { kind: "public (no keys)" };
  const warnings = [];
  if (s.kind === "plain") warnings.push("this file holds private keys in plain text: if it was ever sent through a chat, e-mail or any tool an AI can read, treat those keys as exposed and move the funds to new keys");
  const accounts = backup.accounts.map((acc) => ({
    address: acc.address,
    name: safeFileText3(acc.name),
    networks: acc.networks.map((n) => ({ chainId: n.chainID, network: chainName2(ctx, n.chainID), controllers: n.controllers.map((c) => ({ address: c.address, name: safeFileText3(c.name), type: safeFileText3(c.type, 40), hasKey: keyedBy(c.privateKeyIndex) })) }))
  }));
  const deployments = lsp23.map((it) => ({
    profile: it.item.profileAddress,
    initialChainId: it.item.initialChainID,
    factory: it.item.factoryAddress,
    supported: it.decoded.supported,
    ...it.decoded.reason ? { reason: it.decoded.reason } : {},
    rederivesProfile: it.decoded.rederives,
    canonicalFactory: it.decoded.canonicalFactory,
    initialControllers: it.decoded.initialControllers.map((c) => ({ address: c.address, isUniversalReceiver: c.isUrd, permissions: c.permissions, hasKey: it.item.initialControllers.some((x) => sameAddress4(x.address, c.address) && keyedBy(x.privateKeyIndex)) })),
    canRebuildLocalManifest: Boolean(it.manifest)
  }));
  const text = [
    `Backup of ${plural(accounts.length, "profile", "profiles")} (version 2, made ${backup.backupDate || "at an unknown time"}); ${s.kind === "encrypted" ? `keys are password protected (${kdfDescription(s.iterations)}${s.iterationsInFile ? "" : "; the file states no count, so 10,000"}${s.iterations === LEGACY_ITERATIONS ? "" : "; app versions that do not read secrets.iterations cannot open it"})` : keyMaterial.kind === "plain-text keys" ? "KEYS ARE IN PLAIN TEXT" : "no keys in it"}.`,
    ...accounts.map((x) => `- ${x.address}${x.name ? ` "${x.name}"` : ""}: ${x.networks.map((n) => n.network).join(", ") || "no networks"}`),
    ...allIssues.map((i) => `${i.level === "error" ? "Problem" : "Note"}: ${i.message}`)
  ].join("\n");
  return { data: { ...base, valid: !allIssues.some((i) => i.level === "error"), version: 2, backupDate: backup.backupDate, keyMaterial, accounts, deployments, issues: allIssues }, text, warnings };
}
async function runVerify(ctx, a) {
  const f = await readBackupFile(a.path);
  const pw = await choosePassword(a, false);
  const opened = await openBackup(f.text, pw?.password);
  const cfg = await ctx.config();
  const known = await localKeyStores(ctx, cfg);
  const analyses = analyseAccounts(opened, new Set(known.keys()));
  const keys = opened.keys.map((k) => ({ index: k.index, address: k.address, status: known.has(k.address.toLowerCase()) ? "exists" : "new" }));
  const profiles = [];
  for (const x of analyses) {
    const d = a.online === true ? await decideProfile(ctx, x, true) : void 0;
    profiles.push({
      address: x.account.address,
      chains: x.chains,
      keys: x.fileKeys.map((k) => k.address),
      deployment: x.items.map((i) => ({ rederivesProfile: i.decoded.rederives, canRebuildLocalManifest: Boolean(i.manifest), ...i.reason ? { reason: i.reason } : {} })),
      proofFromFile: x.proof,
      ...d ? { decision: decisionData(d, x) } : {}
    });
  }
  const bad = opened.issues.filter((i) => i.level === "error");
  return {
    data: { file: f.file, sha256: f.sha256, valid: bad.length === 0, keys, profiles, decryption: opened.decryption ?? null, issues: opened.issues, online: a.online === true },
    text: [
      `The backup opens${opened.decryption ? " with that password" : ""}: ${plural(keys.length, "key", "keys")} (${keys.filter((k) => k.status === "new").length} not on this machine yet), ${plural(profiles.length, "profile", "profiles")}.`,
      ...profiles.map((p) => `- ${p.address}: ${p.decision ? `${p.decision.verdict} (${p.decision.why})` : "not checked on the network (add --online)"}`),
      ...opened.issues.map((i) => `${i.level === "error" ? "Problem" : "Note"}: ${i.message}`)
    ].join("\n"),
    warnings: opened.issues.filter((i) => i.level === "warn").map((i) => i.message)
  };
}
async function runImport(ctx, a) {
  const offline = a.offline === true;
  if (offline && !/offline/i.test(ctx.flags.approval ?? "")) throw new UpError7("BAD_ARGS", "--offline skips the check that the profile really belongs to the backup's keys; it needs the human's approval to say so", { hint: "ask the human, and pass their words containing 'offline' as --approval" });
  const f = await readBackupFile(a.path);
  const pw = await choosePassword(a, false);
  const opened = await openBackup(f.text, pw?.password);
  assertNoKeyIn("the file path", f.file);
  assertNoKeyIn("the backup", opened.parsed.backupDate, ...opened.parsed.accounts.flatMap((x) => [x.name, ...x.networks.flatMap((n) => n.controllers.map((c) => c.name))]));
  const cfg = await ctx.config();
  const known = await localKeyStores(ctx, cfg);
  let analyses = analyseAccounts(opened, new Set(known.keys()));
  if (a.profiles?.length) {
    const wanted2 = await Promise.all(a.profiles.map((p) => ctx.resolveAddress(p)));
    for (const w of wanted2) if (!analyses.some((x) => sameAddress4(x.account.address, w))) throw new UpError7("BAD_ARGS", `the backup has no profile ${w}`, { hint: "list them with: up backup inspect <file>" });
    analyses = analyses.filter((x) => wanted2.some((w) => sameAddress4(w, x.account.address)));
  }
  for (const x of analyses) assertProfileRecordClean(x);
  const decisions = [];
  for (const x of analyses) decisions.push(await decideProfile(ctx, x, !offline));
  const chosen = analyses.filter((_, i) => decisions[i].restorable);
  const skipped = analyses.map((x, i) => ({ x, d: decisions[i] })).filter((p) => !p.d.restorable);
  const wanted = /* @__PURE__ */ new Map();
  for (const k of opened.keys) if (a["all-keys"] === true || chosen.some((x) => x.fileKeys.some((y) => sameAddress4(y.address, k.address)))) wanted.set(k.address.toLowerCase(), k);
  const keysToRestore = [...wanted.values()];
  const needStore = keysToRestore.some((k) => !known.has(k.address.toLowerCase()));
  const backend = needStore ? await chooseBackend(a.backend) : void 0;
  const keyPlan = await Promise.all(keysToRestore.map(async (k) => ({ address: k.address, status: known.has(k.address.toLowerCase()) || backend && await backend.has(k.address).catch(() => false) ? "exists" : "new" })));
  let activeAddress;
  if (!cfg.controller && keysToRestore.length) {
    const fromManifest = chosen.flatMap((x) => x.items).find((i) => i.manifest && wanted.has(i.manifest.controller.toLowerCase()))?.manifest?.controller;
    activeAddress = fromManifest ?? keysToRestore[0].address;
  }
  const profileRows = analyses.map((x, i) => decisionData(decisions[i], x));
  const plan = {
    file: safeFileText3(basename2(f.file), 120),
    sha256: f.sha256,
    backupDate: opened.parsed.backupDate,
    profiles: profileRows.map((p) => ({ address: p.address, verdict: p.verdict, restoring: p.restorable, why: p.why })),
    keys: keyPlan,
    keyStore: backend?.id ?? null,
    activeKey: activeAddress ?? null,
    checkedOnNetwork: !offline
  };
  if (!chosen.length && a["all-keys"] !== true) {
    const why = skipped.map((p) => `${short(p.x.account.address)}: ${VERDICT_TEXT[p.d.verdict]}`).join("; ");
    return {
      data: { ...plan, restored: false, say: `I could not restore anything from this backup${why ? ` (${why})` : ""}.`, next: ["Tell the human what data.say says. Nothing was changed."] },
      text: `Nothing was restored${why ? `: ${why}` : ""}.`,
      warnings: opened.issues.filter((i) => i.level === "warn").map((i) => i.message)
    };
  }
  for (const x of chosen) await readProfileRecord2(ctx.home, x.account.address);
  const summary = {
    effect: "restore profiles and keys from a backup file into this agent's key store and records",
    ...plan,
    keyStoreNote: "keys are only ever added; none is overwritten or deleted. A key already here is skipped",
    ...offline ? { warning: "the check on the networks is skipped: whether the backup's keys control the profiles is not confirmed" } : {}
  };
  assertNoKeyMaterial("the import confirmation", summary);
  await ctx.consent({ verb: "backup import", risk: "secret", summary });
  if (ctx.flags.dryRun) return { data: { dryRun: true, ...plan }, text: `Dry run: ${plural(chosen.length, "profile", "profiles")} and ${plural(keysToRestore.length, "key", "keys")} would be restored from ${plan.file}.` };
  const keyResults = keysToRestore.length ? await restoreKeys(ctx, keysToRestore, backend, opened.parsed.backupDate, known, activeAddress) : [];
  const restoredKeys = keyResults.filter((r) => r.status === "restored").map((r) => r.address);
  const notRestored = opened.keys.filter((k) => !keyResults.some((r) => sameAddress4(r.address, k.address))).map((k) => k.address);
  const manifests = chosen.map((x) => ({ analysis: x, manifest: x.items.find((i) => i.manifest)?.manifest, decision: decisions.find((d) => sameAddress4(d.address, x.account.address)) }));
  const records = await writeProfileRecords(ctx, manifests, { file: f.file, sha256: f.sha256, backupDate: opened.parsed.backupDate, restoredKeys, skippedKeys: notRestored });
  const activeResult = activeAddress ? keyResults.find((r) => sameAddress4(r.address, activeAddress)) : void 0;
  const configResult = await applyImportConfig(ctx, {
    defaultProfile: chosen[0]?.account.address,
    chains: [...new Set(chosen.flatMap((x) => x.chains))],
    ...activeResult && activeResult.backend ? { active: { address: activeResult.address, backend: activeResult.backend } } : {}
  });
  await appendIndex(ctx.home, { at: (/* @__PURE__ */ new Date()).toISOString(), event: "import", file: f.file, sha256: f.sha256, profiles: chosen.map((x) => x.account.address), keys: keyResults.map((r) => r.address) });
  ctx.log(`backup imported: ${chosen.length} profile(s), ${restoredKeys.length} key(s)`);
  const warnings = [
    ...opened.issues.filter((i) => i.level === "warn").map((i) => i.message),
    ...decisions.filter((d) => d.verdict === "restorable-with-warning" || d.verdict === "unverified").map((d) => `${d.address}: ${VERDICT_TEXT[d.verdict]}`),
    ...skipped.map((p) => `${p.x.account.address} was not restored: ${VERDICT_TEXT[p.d.verdict]}`),
    ...records.filter((r) => r.manifest === "conflict").map((r) => `${r.address}: this machine already has deployment data for the profile that differs from the backup's; it was kept`),
    ...a["all-keys"] !== true && notRestored.length ? [`${notRestored.length} other key${notRestored.length === 1 ? "" : "s"} in the file belong${notRestored.length === 1 ? "s" : ""} to none of the restored profiles and ${notRestored.length === 1 ? "was" : "were"} not restored (add --all-keys to restore ${notRestored.length === 1 ? "it" : "them"} too)`] : [],
    ...configResult.unknownChains.map((c) => `chain ${c} is not in the registry and was not added (up chains add ${c})`)
  ];
  const notDeployed = chosen.flatMap((x) => x.chains.map((c) => ({ x, c })));
  const say = `I restored ${plural(chosen.length, "account", "accounts")} and ${plural(restoredKeys.length, "key", "keys")} from your backup${keyResults.length > restoredKeys.length ? ` (${keyResults.length - restoredKeys.length} ${keyResults.length - restoredKeys.length === 1 ? "was" : "were"} already here)` : ""}.` + (skipped.length ? ` ${plural(skipped.length, "account", "accounts")} in the file could not be restored, because nothing shows the backup's keys control ${skipped.length === 1 ? "it" : "them"}.` : "") + (restoredKeys.length && !configResult.activeSet ? " The restored keys are kept safe but I keep signing with my current key until you tell me to switch." : "");
  const data = {
    ...plan,
    restored: true,
    keysResult: keyResults,
    profilesResult: records.map((r) => ({ address: r.address, status: "imported", manifest: r.manifest, chains: r.chains })),
    skippedProfiles: skipped.map((p) => ({ address: p.x.account.address, verdict: p.d.verdict })),
    config: configResult,
    say,
    next: [
      "Tell the human data.say.",
      "Check where each restored profile stands: up profile status",
      ...notDeployed.length ? ["For a network where the profile is not deployed yet: up account deploy --chain <id> (replays the restored deployment at the same address)"] : [],
      ...restoredKeys.length && !configResult.activeSet ? ["To sign with a restored key: up key address lists them; up key activate <address> (needs the human's approval)"] : []
    ]
  };
  return {
    data,
    text: [say, ...keyResults.map((r) => `key ${r.address}: ${r.status}`), ...records.map((r) => `profile ${r.address}: imported${r.manifest === "restored" ? " (deployment data restored)" : ""}`)].join("\n"),
    warnings
  };
}
export {
  collectProfiles,
  runExport,
  runImport,
  runInspect,
  runList,
  runVerify
};
