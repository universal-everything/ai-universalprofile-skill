// Protocol knowledge from assets/registry/protocols.json (addresses, chains where
// code was confirmed at snapshot time, chains where it is known to be absent).
// `verifyProtocol` re-checks code presence on a chain right now (eth_getCode);
// the bundled list is a seed, never proof.
import { getAddress, type Address, type Hex } from "viem";
import type { VerbContext } from "../core/types.ts";
import { assetJson } from "../core/assets.ts";
import { UpError } from "../core/errors.ts";
import { codeHash, getCode } from "./read.ts";
import { codeHashMatches } from "./codehashes.ts";

export interface ProtocolAddress {
  /** dotted path inside the protocol entry, e.g. "address", "warpRoutes.USDC.router" */
  role: string;
  address: Address;
}

export interface ProtocolInfo {
  name: string;
  description?: string;
  addresses: ProtocolAddress[];
  chains?: number[];
  absentOn?: number[];
  urls: Record<string, string>;
  abi?: string;
  source?: string;
}

interface ProtocolsFile {
  verifiedAt?: string;
  note?: string;
  protocols: Record<string, Record<string, unknown>>;
  indexers?: Record<string, Record<string, unknown>>;
}

function file(): ProtocolsFile {
  return assetJson<ProtocolsFile>("registry", "protocols.json");
}

function collect(obj: unknown, path: string, addresses: ProtocolAddress[], urls: Record<string, string>) {
  if (typeof obj === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(obj)) addresses.push({ role: path, address: getAddress(obj) });
    else if (/^https:\/\//.test(obj)) urls[path] = obj;
    return;
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) for (const [k, v] of Object.entries(obj)) collect(v, path ? `${path}.${k}` : k, addresses, urls);
}

export function listProtocols(): ProtocolInfo[] {
  return Object.entries(file().protocols).map(([name, p]) => {
    const addresses: ProtocolAddress[] = [];
    const urls: Record<string, string> = {};
    const { description, chains, absentOn, abi, source, ...rest } = p as Record<string, any>;
    collect(rest, "", addresses, urls);
    return {
      name,
      description,
      addresses,
      chains: Array.isArray(chains) ? chains : undefined,
      absentOn: Array.isArray(absentOn) ? absentOn : undefined,
      urls,
      abi: typeof abi === "string" ? abi : undefined,
      source: typeof source === "string" ? source : undefined,
    };
  });
}

export function listIndexers(): Record<string, Record<string, unknown>> {
  return file().indexers ?? {};
}

export function protocolsMeta(): { verifiedAt?: string; note?: string } {
  const f = file();
  return { verifiedAt: f.verifiedAt, note: f.note };
}

export function getProtocol(name: string): ProtocolInfo {
  const all = listProtocols();
  const p = all.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  if (!p) throw new UpError("BAD_ARGS", `unknown protocol "${name}"`, { hint: `known: ${all.map((x) => x.name).join(", ")}` });
  return p;
}

export type PresenceStatus = "present" | "absent";

export interface ProtocolCheck {
  role: string;
  address: Address;
  status: PresenceStatus;
  codeSize: number;
  codeHash?: Hex;
  /** what the bundled registry says for this chain */
  registry: "listed" | "listed-absent" | "unknown";
  agreesWithRegistry: boolean | null;
  /** runtime code hash vs the pinned hashes of this deployment (null = nothing pinned) */
  codeHashMatch: boolean | null;
}

export interface ProtocolVerification {
  protocol: string;
  chainId: number;
  checkedAt: string;
  results: ProtocolCheck[];
  summary: "present" | "absent" | "partial" | "no-addresses";
  warnings: string[];
}

export async function verifyProtocol(ctx: Pick<VerbContext, "rpc">, name: string, chainId: number): Promise<ProtocolVerification> {
  const p = getProtocol(name);
  const registry: ProtocolCheck["registry"] = p.chains?.includes(chainId) ? "listed" : p.absentOn?.includes(chainId) ? "listed-absent" : "unknown";
  const out: ProtocolVerification = { protocol: p.name, chainId, checkedAt: new Date().toISOString(), results: [], summary: "no-addresses", warnings: [] };
  for (const a of p.addresses) {
    const code = await getCode(ctx, chainId, a.address);
    const status: PresenceStatus = code === "0x" ? "absent" : "present";
    const check: ProtocolCheck = {
      role: a.role,
      address: a.address,
      status,
      codeSize: code === "0x" ? 0 : (code.length - 2) / 2,
      codeHash: codeHash(code),
      registry,
      agreesWithRegistry: registry === "unknown" ? null : (registry === "listed") === (status === "present"),
      codeHashMatch: status === "present" ? (codeHashMatches(a.address, codeHash(code)) ?? null) : null,
    };
    if (check.codeHashMatch === false) out.warnings.push(`${a.role} ${a.address}: code present but its hash differs from the known ${p.name} deployments — do not trust it`);
    if (check.agreesWithRegistry === false) out.warnings.push(`${a.role} ${a.address}: registry says ${registry === "listed" ? "present" : "absent"} on chain ${chainId}, chain says ${status}`);
    out.results.push(check);
  }
  if (out.results.length) {
    const present = out.results.filter((r) => r.status === "present").length;
    out.summary = present === out.results.length ? "present" : present === 0 ? "absent" : "partial";
  }
  if (p.addresses.length && registry === "unknown") out.warnings.push(`the bundled registry has no presence record for chain ${chainId}; this live check is the only evidence`);
  return out;
}
