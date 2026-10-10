// Canonical signatures, selectors and human-readable formatting of ABI items.
// (viem's formatAbiItem is not exported from the main entry we vendor.)
import { keccak256, slice, stringToHex, type Abi, type AbiEvent, type AbiFunction, type AbiParameter, type Hex } from "viem";

/** viem does not re-export abitype's AbiError from its main entry. */
export type AbiError = Extract<Abi[number], { type: "error" }>;

type Item = AbiFunction | AbiError | AbiEvent;

/** Canonical ABI type: tuples expanded to "(t1,t2)" with the array suffix kept. */
export function canonicalType(p: AbiParameter): string {
  if (p.type.startsWith("tuple")) {
    const comps = (p as { components?: readonly AbiParameter[] }).components ?? [];
    return `(${comps.map(canonicalType).join(",")})${p.type.slice("tuple".length)}`;
  }
  return p.type;
}

/** e.g. "transfer(address,uint256)". */
export function canonicalSignature(item: Item): string {
  return `${item.name}(${item.inputs.map(canonicalType).join(",")})`;
}

export function selectorOfSignature(signature: string): Hex {
  return slice(keccak256(stringToHex(signature)), 0, 4);
}

export function topicOfSignature(signature: string): Hex {
  return keccak256(stringToHex(signature));
}

export function selectorOf(item: AbiFunction | AbiError): Hex {
  return selectorOfSignature(canonicalSignature(item));
}

export function topicOf(item: AbiEvent): Hex {
  return topicOfSignature(canonicalSignature(item));
}

function humanParam(p: AbiParameter, indexed?: boolean): string {
  const t = p.type.startsWith("tuple")
    ? `(${((p as { components?: readonly AbiParameter[] }).components ?? []).map((c) => humanParam(c)).join(", ")})${p.type.slice("tuple".length)}`
    : p.type;
  return [t, indexed ? "indexed" : "", p.name ?? ""].filter(Boolean).join(" ");
}

/** Human-readable fragment, e.g. "function transfer(address to, uint256 amount) returns (bool)". */
export function humanSignature(item: Item): string {
  if (item.type === "event") {
    return `event ${item.name}(${item.inputs.map((i) => humanParam(i, (i as { indexed?: boolean }).indexed)).join(", ")})`;
  }
  if (item.type === "error") return `error ${item.name}(${item.inputs.map((i) => humanParam(i)).join(", ")})`;
  const mut = item.stateMutability && item.stateMutability !== "nonpayable" ? ` ${item.stateMutability}` : "";
  const outs = item.outputs?.length ? ` returns (${item.outputs.map((o) => humanParam(o)).join(", ")})` : "";
  return `function ${item.name}(${item.inputs.map((i) => humanParam(i)).join(", ")})${mut}${outs}`;
}

export function isReadOnly(fn: AbiFunction): boolean {
  return fn.stateMutability === "view" || fn.stateMutability === "pure" || (fn as { constant?: boolean }).constant === true;
}
