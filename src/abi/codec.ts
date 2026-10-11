// Generic ABI encoder/decoder (no protocol logic). Accepts:
//  - a bundled contract name ("LSP7DigitalAsset", "ERC20", aliases like "lsp7"),
//  - a JSON ABI (array, {abi:[…]}, or a path to such a .json file),
//  - human-readable fragments ("function transfer(address to, uint256 amount) returns (bool)";
//    the "function " keyword may be omitted; several fragments separated by newlines or ";").
// Arguments are JSON values coerced per ABI type: integers from numbers, decimal/hex
// strings, "1.5e18" or "<n> ether|gwei|wei"; addresses checksum-validated; bytes as hex;
// tuples as arrays (positional) or objects (by component name); nested arrays.
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  decodeAbiParameters,
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  parseAbi,
  parseAbiParameters,
  type Abi,
  type AbiEvent,
  type AbiFunction,
  type AbiParameter,
  type Hex,
} from "viem";
import type { TrustLabel } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { bundledAbi, findBundled } from "./bundled.ts";
import { canonicalSignature, humanSignature, selectorOf, topicOf, type AbiError } from "./signature.ts";
import { assertNotKeyMaterialPath } from "../core/secret-guard.ts";

export interface AbiSource {
  abi: Abi;
  /** "bundled:<name>" | "file:<path>" | "inline" */
  source: string;
  trust: TrustLabel;
}

const KEYWORD = /^\s*(function|event|error|constructor|struct|fallback|receive)\b/;

/** Parses human-readable fragments; bare "name(type,…)" lines are treated as functions. */
export function parseFragments(input: string | readonly string[]): Abi {
  const lines = (typeof input === "string" ? input.split(/[\n;]/) : input.flatMap((s) => s.split(/[\n;]/))).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) throw new UpError("BAD_ARGS", "empty ABI fragment");
  const frags = lines.map((l) => (KEYWORD.test(l) ? l : `function ${l}`));
  try {
    return parseAbi(frags as readonly string[]) as Abi;
  } catch (e) {
    throw new UpError("BAD_ARGS", `cannot parse ABI fragment(s): ${(e as Error).message.split("\n")[0]}`, {
      hint: 'use Solidity-style signatures, e.g. "function balanceOf(address owner) view returns (uint256)"',
      details: { fragments: frags },
    });
  }
}

function validateJsonAbi(v: unknown, where: string): Abi {
  const arr = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as { abi?: unknown }).abi) ? (v as { abi: unknown[] }).abi : undefined;
  if (!arr) throw new UpError("BAD_ARGS", `${where} is not a JSON ABI (expected an array or an object with an "abi" array)`);
  for (const [i, item] of arr.entries()) {
    if (!item || typeof item !== "object" || typeof (item as { type?: unknown }).type !== "string") throw new UpError("BAD_ARGS", `${where}: ABI entry ${i} has no "type"`);
  }
  return arr as Abi;
}

/**
 * Resolves an ABI argument (string/array/object). Strings are tried as: JSON text →
 * bundled name → existing .json file → human-readable fragments.
 */
export function parseAbiInput(input: unknown): AbiSource {
  if (Array.isArray(input) && input.every((x) => typeof x === "string")) return { abi: parseFragments(input as string[]), source: "inline", trust: "user" };
  if (Array.isArray(input) || (input && typeof input === "object")) return { abi: validateJsonAbi(input, "--abi"), source: "inline", trust: "user" };
  if (typeof input !== "string" || input.trim() === "") throw new UpError("BAD_ARGS", "--abi must be a bundled contract name, a JSON ABI, a path to a .json ABI file, or human-readable fragments");
  const s = input.trim();
  if (s.startsWith("[") || s.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch (e) {
      throw new UpError("BAD_ARGS", `--abi looks like JSON but does not parse: ${(e as Error).message}`);
    }
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return { abi: parseFragments(parsed as string[]), source: "inline", trust: "user" };
    return { abi: validateJsonAbi(parsed, "--abi"), source: "inline", trust: "user" };
  }
  const b = !s.includes("(") ? findBundled(s) : undefined;
  if (b) return { abi: bundledAbi(b.name), source: `bundled:${b.name}`, trust: "bundled" };
  if (/\.json$/i.test(s) && existsSync(s) && statSync(s).isFile()) {
    assertNotKeyMaterialPath(s, "an ABI");
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(s, "utf8"));
    } catch {
      // never quote the parser message: it can contain the file's content
      throw new UpError("BAD_ARGS", `ABI file ${s} is not valid JSON`);
    }
    return { abi: validateJsonAbi(parsed, `ABI file ${s}`), source: `file:${s}`, trust: "user" };
  }
  if (!s.includes("(")) throw new UpError("ABI_NOT_FOUND", `"${s}" is not a bundled ABI name, an existing .json file, or a function signature`, { hint: "list bundled ABIs with: up abi bundled" });
  return { abi: parseFragments(s), source: "inline", trust: "user" };
}

// ---------------------------------------------------------------------------
// Function resolution
// ---------------------------------------------------------------------------

export function functionsOf(abi: Abi): AbiFunction[] {
  return abi.filter((x): x is AbiFunction => x.type === "function");
}

/**
 * Finds a function by name, canonical signature or full fragment. With overloads
 * the argument count disambiguates. A full signature that is not in the ABI is
 * returned as a standalone fragment only when `allowStandalone` is set.
 */
export function resolveFunction(abi: Abi, fn: string, argCount?: number, allowStandalone = false): { fn: AbiFunction; inAbi: boolean } {
  const f = fn.trim();
  if (f.includes("(")) {
    const parsed = parseFragments(f).find((x): x is AbiFunction => x.type === "function");
    if (!parsed) throw new UpError("BAD_ARGS", `"${fn}" is not a function signature`);
    const sel = selectorOf(parsed);
    const hit = functionsOf(abi).find((x) => selectorOf(x) === sel);
    if (hit) return { fn: hit, inAbi: true };
    if (allowStandalone) return { fn: parsed, inAbi: false };
    throw new UpError("ABI_NOT_FOUND", `function ${canonicalSignature(parsed)} (${sel}) is not in the ABI`);
  }
  if (/^0x[0-9a-fA-F]{8}$/.test(f)) {
    const hit = functionsOf(abi).find((x) => selectorOf(x) === f.toLowerCase());
    if (hit) return { fn: hit, inAbi: true };
    throw new UpError("ABI_NOT_FOUND", `no function with selector ${f} in the ABI`);
  }
  const named = functionsOf(abi).filter((x) => x.name === f);
  if (named.length === 0) {
    const ci = functionsOf(abi).filter((x) => x.name.toLowerCase() === f.toLowerCase()).map((x) => x.name);
    throw new UpError("ABI_NOT_FOUND", `no function "${f}" in the ABI`, { hint: ci.length ? `did you mean ${[...new Set(ci)].join(", ")}?` : "list functions with: up abi functions <address>" });
  }
  // distinct by selector (the same function can appear twice in merged ABIs)
  const distinct = [...new Map(named.map((x) => [selectorOf(x), x])).values()];
  if (distinct.length === 1) return { fn: distinct[0], inAbi: true };
  const byCount = argCount === undefined ? [] : distinct.filter((x) => x.inputs.length === argCount);
  if (byCount.length === 1) return { fn: byCount[0], inAbi: true };
  throw new UpError("BAD_ARGS", `"${f}" is overloaded; pass the full signature`, { details: { overloads: distinct.map(canonicalSignature) } });
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

function bad(path: string, msg: string, hint?: string): UpError {
  return new UpError("BAD_ARGS", `${path}: ${msg}`, hint ? { hint } : {});
}

const UNIT_DECIMALS: Record<string, number> = { wei: 0, gwei: 9, ether: 18, eth: 18 };

/**
 * Exact decimal → base units. Rejects more fractional digits than `decimals`
 * (never rounds silently).
 */
export function toBaseUnits(amount: string | number, decimals: number, what = "amount"): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw bad(what, `invalid decimals ${decimals}`);
  let s = typeof amount === "number" ? (Number.isFinite(amount) ? numberToPlain(amount) : "") : String(amount).trim().replace(/_/g, "");
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) throw bad(what, `"${amount}" is not a decimal number`);
  let intPart = m[1] || "0";
  let frac = m[2] ?? "";
  const exp = m[3] ? Number(m[3]) : 0;
  // apply exponent by moving the decimal point
  if (exp > 0) {
    const take = frac.slice(0, exp).padEnd(exp, "0");
    intPart += take;
    frac = frac.slice(exp);
  } else if (exp < 0) {
    const pad = intPart.padStart(-exp + 1, "0");
    frac = pad.slice(pad.length + exp) + frac;
    intPart = pad.slice(0, pad.length + exp);
  }
  frac = frac.replace(/0+$/, "");
  if (frac.length > decimals) throw bad(what, `"${amount}" has more than ${decimals} decimal places`, decimals === 0 ? "this asset is indivisible: use a whole number" : undefined);
  const v = BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt((frac || "0").padEnd(decimals, "0").slice(0, decimals) || "0");
  return neg ? -v : v;
}

function numberToPlain(n: number): string {
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) throw bad("amount", `${n} exceeds the safe integer range — pass it as a string`);
  return String(n);
}

/** Formats base units as a decimal string without trailing zeros. */
export function fromBaseUnits(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  if (decimals === 0) return (neg ? "-" : "") + abs.toString();
  const s = abs.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + int + (frac ? `.${frac}` : "");
}

/** Integer from number | bigint | decimal/hex string | "1.5e18" | "<n> ether|gwei|wei". */
export function parseInteger(v: unknown, path = "value"): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw bad(path, `${v} is not a safe integer`, "pass large or fractional numbers as strings");
    return BigInt(v);
  }
  if (typeof v !== "string") throw bad(path, `expected an integer, got ${v === null ? "null" : typeof v}`);
  const s = v.trim().replace(/_/g, "");
  if (/^-?0x[0-9a-fA-F]+$/.test(s)) return s.startsWith("-") ? -BigInt(s.slice(1)) : BigInt(s);
  if (/^-?\d+$/.test(s)) return BigInt(s);
  const unit = /^(-?[\d.]+(?:[eE][+-]?\d+)?)\s*(wei|gwei|ether|eth)$/i.exec(s);
  if (unit) return toBaseUnits(unit[1], UNIT_DECIMALS[unit[2].toLowerCase()], path);
  if (/^-?[\d.]+[eE][+-]?\d+$/.test(s)) return toBaseUnits(s, 0, path);
  throw bad(path, `"${v}" is not an integer`, 'use a decimal or 0x-hex string, "1.5e18", or "<n> ether|gwei|wei"');
}

function checkRange(v: bigint, type: string, path: string): bigint {
  const m = /^(u?)int(\d*)$/.exec(type)!;
  const bits = BigInt(m[2] || "256");
  if (m[1] === "u") {
    if (v < 0n) throw bad(path, `${v} is negative but ${type} is unsigned`);
    if (v >= 1n << bits) throw bad(path, `${v} does not fit in ${type}`);
  } else {
    const lim = 1n << (bits - 1n);
    if (v < -lim || v >= lim) throw bad(path, `${v} does not fit in ${type}`);
  }
  return v;
}

export function coerceAddress(v: unknown, path = "address"): `0x${string}` {
  if (typeof v !== "string") throw bad(path, "expected an address string");
  const s = v.trim();
  if (!isAddress(s, { strict: false })) throw bad(path, `"${s}" is not a 20-byte hex address`);
  const body = s.slice(2);
  if (body !== body.toLowerCase() && body !== body.toUpperCase() && !isAddress(s, { strict: true })) {
    throw bad(path, `"${s}" has an invalid EIP-55 checksum (possible typo)`, "double-check the address; pass it all lower-case only if you are sure");
  }
  return getAddress(s);
}

function parseJsonIfString(v: unknown, path: string, want: "array" | "object-or-array"): unknown {
  if (typeof v === "string" && /^\s*[[{]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      throw bad(path, `invalid JSON ${want}`);
    }
  }
  return v;
}

/** Coerces one JSON value to the viem representation of an ABI parameter. */
export function coerceValue(param: AbiParameter, value: unknown, path = param.name || "value"): unknown {
  const type = param.type;
  const arr = /^(.*)\[(\d*)\]$/.exec(type);
  if (arr) {
    const v = parseJsonIfString(value, path, "array");
    if (!Array.isArray(v)) throw bad(path, `expected an array for ${type}`);
    if (arr[2] !== "" && v.length !== Number(arr[2])) throw bad(path, `expected exactly ${arr[2]} elements for ${type}, got ${v.length}`);
    const inner = { ...param, type: arr[1] } as AbiParameter;
    return v.map((x, i) => coerceValue(inner, x, `${path}[${i}]`));
  }
  if (type === "tuple") {
    const comps = (param as { components?: readonly AbiParameter[] }).components ?? [];
    const v = parseJsonIfString(value, path, "object-or-array");
    const named = comps.length > 0 && comps.every((c) => c.name);
    if (Array.isArray(v)) {
      if (v.length !== comps.length) throw bad(path, `tuple expects ${comps.length} components, got ${v.length}`);
      const vals = comps.map((c, i) => coerceValue(c, v[i], `${path}.${c.name || i}`));
      return named ? Object.fromEntries(comps.map((c, i) => [c.name!, vals[i]])) : vals;
    }
    if (v && typeof v === "object") {
      if (!named) throw bad(path, "tuple has unnamed components; pass an array");
      const obj = v as Record<string, unknown>;
      const extra = Object.keys(obj).filter((k) => !comps.some((c) => c.name === k));
      if (extra.length) throw bad(path, `unknown tuple field(s): ${extra.join(", ")}`);
      return Object.fromEntries(
        comps.map((c) => {
          if (!(c.name! in obj)) throw bad(`${path}.${c.name}`, "missing tuple field");
          return [c.name!, coerceValue(c, obj[c.name!], `${path}.${c.name}`)];
        }),
      );
    }
    throw bad(path, "expected an array or object for a tuple");
  }
  if (/^u?int\d*$/.test(type)) return checkRange(parseInteger(value, path), type, path);
  if (type === "address") return coerceAddress(value, path);
  if (type === "bool") {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || (typeof value === "string" && value.trim().toLowerCase() === "true")) return true;
    if (value === 0 || value === "0" || (typeof value === "string" && value.trim().toLowerCase() === "false")) return false;
    throw bad(path, `expected true/false, got ${JSON.stringify(value)}`);
  }
  if (type === "string") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
    throw bad(path, "expected a string");
  }
  if (type === "bytes") {
    if (value instanceof Uint8Array) return ("0x" + Buffer.from(value).toString("hex")) as Hex;
    if (typeof value !== "string" || !isHex(value.trim(), { strict: true }) || (value.trim().length - 2) % 2 !== 0) throw bad(path, "expected 0x-prefixed hex with an even number of digits");
    return value.trim().toLowerCase() as Hex;
  }
  const fixed = /^bytes(\d+)$/.exec(type);
  if (fixed) {
    const n = Number(fixed[1]);
    if (typeof value !== "string" || !isHex(value.trim(), { strict: true })) throw bad(path, `expected 0x-prefixed hex for ${type}`);
    const s = value.trim().toLowerCase();
    if (s.length !== 2 + 2 * n) throw bad(path, `${type} needs exactly ${n} bytes (${2 * n} hex digits), got ${(s.length - 2) / 2}`, "pad explicitly (left-pad numbers/addresses, right-pad strings) so the intent is unambiguous");
    return s as Hex;
  }
  if (type === "function") {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{48}$/.test(value)) throw bad(path, "expected 24-byte hex (address + selector)");
    return value.toLowerCase();
  }
  throw bad(path, `unsupported ABI type ${type}`);
}

/** Accepts an array (positional) or an object keyed by parameter names. */
export function coerceArgs(params: readonly AbiParameter[], args: unknown, what = "args"): unknown[] {
  let a = args;
  if (a === undefined || a === null || a === "") a = [];
  if (typeof a === "string") {
    const s = a.trim();
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        a = JSON.parse(s);
      } catch {
        throw bad(what, "invalid JSON");
      }
    } else a = [s]; // a single scalar
  }
  if (!Array.isArray(a)) {
    if (a && typeof a === "object") {
      const obj = a as Record<string, unknown>;
      if (!params.every((p) => p.name)) throw bad(what, "some parameters are unnamed; pass a JSON array");
      const extra = Object.keys(obj).filter((k) => !params.some((p) => p.name === k));
      if (extra.length) throw bad(what, `unknown argument(s): ${extra.join(", ")}`, `expected: ${params.map((p) => p.name).join(", ")}`);
      a = params.map((p) => {
        if (!(p.name! in obj)) throw bad(`${what}.${p.name}`, "missing argument");
        return obj[p.name!];
      });
    } else a = [a];
  }
  const list = a as unknown[];
  if (list.length !== params.length) {
    throw bad(what, `expected ${params.length} argument(s) (${params.map((p) => `${p.type}${p.name ? " " + p.name : ""}`).join(", ")}), got ${list.length}`);
  }
  return params.map((p, i) => coerceValue(p, list[i], p.name || `#${i}`));
}

// ---------------------------------------------------------------------------
// JSON-safe output
// ---------------------------------------------------------------------------

export function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return "0x" + Buffer.from(v).toString("hex");
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}

export interface NamedValue {
  name: string;
  type: string;
  value: unknown;
}

export function namedValues(params: readonly AbiParameter[], values: readonly unknown[] | unknown): NamedValue[] {
  const list = Array.isArray(values) ? values : params.length === 1 ? [values] : [];
  return params.map((p, i) => ({ name: p.name || `#${i}`, type: p.type, value: jsonSafe(list[i]) }));
}

function short(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** "transfer(to: 0x…, amount: 1000)". */
export function describeCall(fn: AbiFunction | AbiError, args: readonly unknown[]): string {
  return `${fn.name}(${namedValues(fn.inputs, args)
    .map((x) => `${x.name}: ${short(x.value)}`)
    .join(", ")})`;
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

export interface EncodedCall {
  data: Hex;
  selector: Hex;
  signature: string;
  fragment: string;
  args: NamedValue[];
  description: string;
}

export function encodeCall(fn: AbiFunction, args: unknown): EncodedCall {
  const values = coerceArgs(fn.inputs, args);
  let data: Hex;
  try {
    data = encodeFunctionData({ abi: [fn], functionName: fn.name, args: values } as any);
  } catch (e) {
    throw new UpError("BAD_ARGS", `cannot encode ${canonicalSignature(fn)}: ${(e as Error).message.split("\n")[0]}`);
  }
  return { data, selector: selectorOf(fn), signature: canonicalSignature(fn), fragment: humanSignature(fn), args: namedValues(fn.inputs, values), description: describeCall(fn, values) };
}

/** Encodes bare parameters (no selector), e.g. --types "address,uint256". */
export function encodeParams(types: string, args: unknown): { data: Hex; params: NamedValue[] } {
  const params = parseTypes(types);
  const values = coerceArgs(params, args);
  return { data: encodeAbiParameters(params, values as any), params: namedValues(params, values) };
}

export function parseTypes(types: string): readonly AbiParameter[] {
  try {
    return parseAbiParameters(types.trim()) as readonly AbiParameter[];
  } catch (e) {
    throw new UpError("BAD_ARGS", `cannot parse parameter types "${types}": ${(e as Error).message.split("\n")[0]}`);
  }
}

export function decodeParams(types: string, data: Hex): NamedValue[] {
  const params = parseTypes(types);
  try {
    return namedValues(params, decodeAbiParameters(params, data) as readonly unknown[]);
  } catch (e) {
    throw new UpError("BAD_ARGS", `data does not decode as (${types}): ${(e as Error).message.split("\n")[0]}`);
  }
}

export function requireHex(v: unknown, what: string): Hex {
  if (typeof v !== "string" || !isHex(v.trim(), { strict: true }) || (v.trim().length - 2) % 2 !== 0) throw new UpError("BAD_ARGS", `${what} must be 0x-prefixed hex with an even number of digits`);
  return v.trim().toLowerCase() as Hex;
}

export interface DecodedCall {
  selector: Hex;
  signature: string;
  fragment: string;
  args: NamedValue[];
  description: string;
  source: string;
  /** true when re-encoding the decoded args reproduces the input exactly */
  exact: boolean;
}

/** Tries every candidate ABI (in order) for the calldata's selector. */
export function decodeCalldata(data: Hex, candidates: { abi: Abi; source: string }[]): DecodedCall | undefined {
  if (data.length < 10) throw new UpError("BAD_ARGS", "calldata is shorter than a 4-byte selector");
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  for (const c of candidates) {
    for (const fn of functionsOf(c.abi).filter((x) => selectorOf(x) === selector)) {
      try {
        const d = decodeFunctionData({ abi: [fn], data });
        const args = (d.args ?? []) as readonly unknown[];
        let exact = false;
        try {
          exact = encodeFunctionData({ abi: [fn], functionName: fn.name, args } as any).toLowerCase() === data.toLowerCase();
        } catch {}
        return { selector, signature: canonicalSignature(fn), fragment: humanSignature(fn), args: namedValues(fn.inputs, args), description: describeCall(fn, args), source: c.source, exact };
      } catch {
        /* collision or malformed data: try next */
      }
    }
  }
  return undefined;
}

export function decodeReturn(fn: AbiFunction, data: Hex): NamedValue[] {
  try {
    const r = decodeFunctionResult({ abi: [fn], functionName: fn.name, data } as any);
    return namedValues(fn.outputs ?? [], (fn.outputs?.length ?? 0) > 1 ? (r as readonly unknown[]) : [r]);
  } catch (e) {
    throw new UpError("BAD_ARGS", `return data does not decode as ${humanSignature(fn)}: ${(e as Error).message.split("\n")[0]}`);
  }
}

const PANIC: Record<string, string> = {
  "0": "generic compiler panic",
  "1": "assert(false)",
  "17": "arithmetic overflow/underflow",
  "18": "division or modulo by zero",
  "33": "invalid enum value",
  "34": "corrupt storage byte array",
  "49": "pop() on empty array",
  "50": "array index out of bounds",
  "65": "out of memory / array too large",
  "81": "call to uninitialised internal function",
};

export interface DecodedError {
  selector: Hex;
  name: string;
  signature: string;
  args: NamedValue[];
  message: string;
  source: string;
}

export function decodeErrorData(data: Hex, candidates: { abi: Abi; source: string }[]): DecodedError | undefined {
  if (data.length < 10) return undefined;
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  for (const c of candidates) {
    const errs = c.abi.filter((x): x is AbiError => x.type === "error" && selectorOf(x) === selector);
    for (const err of errs) {
      try {
        const d = decodeErrorResult({ abi: [err], data });
        const args = (d.args ?? []) as readonly unknown[];
        let message = describeCall(err, args);
        if (err.name === "Panic" && args.length === 1) message += ` — ${PANIC[String(args[0])] ?? "unknown panic code"}`;
        if (err.name === "Error" && args.length === 1) message = `revert: ${String(args[0])}`;
        return { selector, name: err.name, signature: canonicalSignature(err), args: namedValues(err.inputs, args), message, source: c.source };
      } catch {}
    }
  }
  return undefined;
}

export interface DecodedEvent {
  topic: Hex;
  name: string;
  signature: string;
  fragment: string;
  args: NamedValue[];
  description: string;
  source: string;
}

export function decodeLog(topics: Hex[], data: Hex, candidates: { abi: Abi; source: string }[]): DecodedEvent | undefined {
  if (topics.length === 0) return undefined;
  const topic = topics[0].toLowerCase() as Hex;
  for (const c of candidates) {
    for (const ev of c.abi.filter((x): x is AbiEvent => x.type === "event" && !x.anonymous && topicOf(x) === topic)) {
      try {
        const d = decodeEventLog({ abi: [ev], topics: topics as [Hex, ...Hex[]], data, strict: true });
        const raw = d.args as unknown;
        const values = Array.isArray(raw) ? raw : ev.inputs.map((i, k) => (raw as Record<string, unknown>)[i.name ?? String(k)]);
        return { topic, name: ev.name, signature: canonicalSignature(ev), fragment: humanSignature(ev), args: namedValues(ev.inputs, values), description: describeCall(ev as unknown as AbiError, values), source: c.source };
      } catch {
        /* indexed-ness mismatch between same-signature events (e.g. ERC-20 vs ERC-721 Transfer): try next */
      }
    }
  }
  return undefined;
}
