// Call inputs shared by exec/relayer verbs and usable by other modules:
//   --to --value --data           raw call
//   --to --fn "transfer(address,uint256)" --args '[...]'   human-readable signature
//   --to --abi <bundled name|file|json> --fn <name|signature> --args '[...]'
// Values: wei integer, hex, or a decimal with a unit suffix (ether/eth/lyx/gwei/wei).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, getAddress, isAddress, parseAbiItem, parseUnits, toFunctionSignature, zeroAddress, type Abi, type AbiFunction, type AbiParameter, type Address, type Hex } from "viem";
import { UpError } from "../core/errors.ts";
import { assetsDir } from "../core/assets.ts";
import { OPERATION, type ExecCall, type OperationType } from "./transport.ts";

export interface CallInput {
  to?: string;
  value?: string | number;
  data?: string;
  fn?: string;
  args?: unknown;
  abi?: string | Abi;
  operation?: string | number;
}

export function parseValue(v: string | number | bigint | undefined): bigint {
  if (v === undefined || v === null || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw new UpError("BAD_ARGS", `value ${v} must be a non-negative integer in wei (or use a unit, e.g. "0.1ether")`);
    return BigInt(v);
  }
  const s = v.trim().toLowerCase().replace(/_/g, "");
  if (/^0x[0-9a-f]+$/.test(s)) return BigInt(s);
  if (/^\d+$/.test(s)) return BigInt(s);
  const m = /^(\d+(?:\.\d+)?)\s*(ether|eth|lyx|lyxt|native|gwei|wei)$/.exec(s);
  if (!m) throw new UpError("BAD_ARGS", `cannot parse value "${v}"`, { hint: 'use wei ("1000000000000000000") or a unit ("1ether", "0.5 lyx", "20gwei")' });
  const decimals = m[2] === "gwei" ? 9 : m[2] === "wei" ? 0 : 18;
  return parseUnits(m[1], decimals);
}

export function parseOperation(op: string | number | undefined): OperationType {
  if (op === undefined || op === "") return OPERATION.CALL;
  if (typeof op === "number") {
    if (![0, 1, 2, 3, 4].includes(op)) throw new UpError("BAD_ARGS", `unknown operation ${op}`);
    return op as OperationType;
  }
  const k = op.trim().toUpperCase() as keyof typeof OPERATION;
  if (OPERATION[k] === undefined) throw new UpError("BAD_ARGS", `unknown operation "${op}" (call, staticcall, create, create2)`);
  return OPERATION[k];
}

/** Loads an ABI: bundled name (assets/abis/{lsp,reference,deployed}/<Name>.json), a JSON file path, or inline JSON. */
export function loadAbi(spec: string | Abi): { abi: Abi; source: string } {
  if (Array.isArray(spec)) return { abi: spec as Abi, source: "inline" };
  const s = String(spec).trim();
  if (s.startsWith("[") || s.startsWith("{")) {
    const j = JSON.parse(s);
    return { abi: (Array.isArray(j) ? j : j.abi) as Abi, source: "inline" };
  }
  if (existsSync(s)) {
    const j = JSON.parse(readFileSync(s, "utf8"));
    return { abi: (Array.isArray(j) ? j : j.abi) as Abi, source: `file:${s}` };
  }
  const base = s.replace(/\.json$/i, "");
  for (const dir of ["lsp", "reference", "deployed"]) {
    const f = join(assetsDir(), "abis", dir, `${base}.json`);
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, "utf8"));
      return { abi: (Array.isArray(j) ? j : j.abi) as Abi, source: `bundled:${dir}/${base}` };
    }
  }
  throw new UpError("ABI_NOT_FOUND", `no ABI "${s}" (not a file, not bundled)`, { hint: "use a bundled name like LSP7DigitalAsset, ERC20, UniversalProfile, or a path to a JSON ABI; discover ABIs with: up abi fetch <chain> <address>" });
}

/** Resolves a function from a human-readable signature or (with an ABI) a name/signature. */
export function resolveFunction(fn: string, abi?: Abi): AbiFunction {
  const s = fn.trim();
  if (abi) {
    const fns = abi.filter((x): x is AbiFunction => x.type === "function");
    const byName = fns.filter((f) => f.name === s);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) throw new UpError("BAD_ARGS", `function "${s}" is overloaded; pass the full signature`, { details: byName.map((f) => toFunctionSignature(f)) });
    const bySig = fns.find((f) => toFunctionSignature(f) === s.replace(/\s+/g, "") || toFunctionSignature(f) === s.replace(/^function\s+/, "").split(/\s/)[0]);
    if (bySig) return bySig;
    throw new UpError("BAD_ARGS", `function "${s}" not found in the ABI`);
  }
  if (!s.includes("(")) throw new UpError("BAD_ARGS", `--fn needs a signature like "transfer(address,uint256)" (or pass --abi)`);
  try {
    return parseAbiItem(s.startsWith("function ") ? s : `function ${s}`) as AbiFunction;
  } catch (e) {
    throw new UpError("BAD_ARGS", `cannot parse function signature "${s}": ${(e as Error).message}`);
  }
}

/** Coerces JSON-friendly args (decimal strings, numbers) into the types viem expects. */
export function coerceArg(param: AbiParameter, v: unknown): unknown {
  const t = param.type;
  if (t.endsWith("]")) {
    const inner = { ...param, type: t.slice(0, t.lastIndexOf("[")) } as AbiParameter;
    if (!Array.isArray(v)) throw new UpError("BAD_ARGS", `argument ${param.name ?? ""} (${t}) must be an array`);
    return v.map((x) => coerceArg(inner, x));
  }
  if (t === "tuple") {
    const comps = (param as any).components as AbiParameter[];
    if (Array.isArray(v)) return comps.map((c, i) => coerceArg(c, v[i]));
    if (v && typeof v === "object") return Object.fromEntries(comps.map((c) => [c.name, coerceArg(c, (v as any)[c.name!])]));
    throw new UpError("BAD_ARGS", `argument ${param.name ?? ""} must be a tuple (array or object)`);
  }
  if (/^u?int\d*$/.test(t)) {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^-?(0x[0-9a-fA-F]+|\d+)$/.test(v.trim())) return BigInt(v.trim());
    throw new UpError("BAD_ARGS", `argument ${param.name ?? ""} (${t}) must be an integer (decimal string recommended), got ${JSON.stringify(v)}`);
  }
  if (t === "bool") return v === true || v === "true" || v === 1 || v === "1";
  if (t === "address") {
    if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new UpError("BAD_ARGS", `argument ${param.name ?? ""} must be an address, got ${JSON.stringify(v)}`);
    return getAddress(v);
  }
  return v;
}

export function encodeCall(fn: AbiFunction, args: unknown): Hex {
  const list = args === undefined || args === null || args === "" ? [] : Array.isArray(args) ? args : [args];
  if (list.length !== fn.inputs.length) throw new UpError("BAD_ARGS", `${fn.name} expects ${fn.inputs.length} argument(s), got ${list.length}`, { details: fn.inputs.map((i) => `${i.type} ${i.name ?? ""}`) });
  return encodeFunctionData({ abi: [fn], functionName: fn.name, args: fn.inputs.map((p, i) => coerceArg(p, list[i])) } as any);
}

/** Builds one ExecCall from user inputs; returns the ABI (if any) for decoding in the confirmation block. */
export function buildCall(input: CallInput): { call: ExecCall; abi?: Abi; fn?: AbiFunction } {
  const operation = parseOperation(input.operation);
  const isCreate = operation === OPERATION.CREATE || operation === OPERATION.CREATE2;
  let to: Address;
  if (isCreate) to = zeroAddress;
  else {
    if (!input.to || !isAddress(input.to, { strict: false })) throw new UpError("BAD_ARGS", "--to must be an address");
    to = getAddress(input.to);
  }
  const value = parseValue(input.value);
  let data: Hex = "0x";
  let abi: Abi | undefined;
  let fn: AbiFunction | undefined;
  if (input.fn) {
    if (input.data) throw new UpError("BAD_ARGS", "pass either --data or --fn/--args, not both");
    abi = input.abi ? loadAbi(input.abi).abi : undefined;
    fn = resolveFunction(input.fn, abi);
    data = encodeCall(fn, input.args);
    abi = abi ?? [fn];
  } else if (input.data) {
    if (!/^0x([0-9a-fA-F]{2})*$/.test(input.data)) throw new UpError("BAD_ARGS", "--data must be hex bytes");
    data = input.data as Hex;
    if (input.abi) abi = loadAbi(input.abi).abi;
  }
  return { call: { operation, to, value, data }, abi, fn };
}

export function buildCalls(inputs: CallInput[]): { calls: ExecCall[]; abi?: Abi } {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new UpError("BAD_ARGS", "--calls must be a non-empty JSON array of {to, value?, data? | fn, args?, abi?, operation?}");
  const calls: ExecCall[] = [];
  const abi: any[] = [];
  for (const i of inputs) {
    const b = buildCall(i);
    calls.push(b.call);
    if (b.abi) abi.push(...b.abi);
  }
  return { calls, abi: abi.length ? (abi as Abi) : undefined };
}
