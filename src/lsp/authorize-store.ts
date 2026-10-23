// The authorization links this agent made (public data only), in <UP_HOME>/authorize-requests.json:
// `permissions check-grant` compares on-chain state with the newest one, and `profile join`
// uses it as the baseline instead of the general recommendation.
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { join } from "node:path";
import { readJson, writeJson } from "../core/home.ts";
import type { AuthorizeRequest } from "./authorize-link.ts";

const MAX_SAVED = 20;

export const authorizeRequestsFile = (home: string) => join(home, "authorize-requests.json");

export interface SavedAuthorizeRequest {
  id: string;
  createdAt: string;
  url: string;
  chainId: number;
  controller: Address;
  profile?: Address;
  name?: string;
  purpose?: string;
  capabilities: string[];
  permissions: Hex;
  allowedCalls: Hex | null;
  allowedDataKeys: Hex | null;
}

export async function savedAuthorizeRequests(home: string): Promise<SavedAuthorizeRequest[]> {
  const f = await readJson<{ requests?: unknown }>(authorizeRequestsFile(home), {});
  return Array.isArray(f.requests) ? (f.requests as SavedAuthorizeRequest[]).filter((r) => r && typeof r.url === "string" && typeof r.controller === "string") : [];
}

/** The newest saved link for this controller and profile (a link without a profile matches any profile). */
export async function latestAuthorizeRequest(home: string, controller: Address, profile?: Address): Promise<SavedAuthorizeRequest | undefined> {
  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  return (await savedAuthorizeRequests(home)).reverse().find((r) => same(r.controller, controller) && (!r.profile || !profile || same(r.profile, profile)));
}

export async function saveAuthorizeRequest(home: string, req: AuthorizeRequest): Promise<SavedAuthorizeRequest> {
  const entry: SavedAuthorizeRequest = {
    id: keccak256(toBytes(req.url)).slice(2, 18),
    createdAt: new Date().toISOString(),
    url: req.url,
    chainId: req.chainId,
    controller: req.controller,
    ...(req.profile ? { profile: req.profile } : {}),
    ...(req.name ? { name: req.name } : {}),
    ...(req.purpose ? { purpose: req.purpose } : {}),
    capabilities: req.capabilities,
    permissions: req.permissions.hex,
    allowedCalls: req.allowedCalls.encoded,
    allowedDataKeys: req.allowedDataKeys.encoded,
  };
  const requests = [...(await savedAuthorizeRequests(home)).filter((r) => r.id !== entry.id), entry].slice(-MAX_SAVED);
  await writeJson(authorizeRequestsFile(home), { version: 1, note: "authorization links this agent made (public data only)", requests });
  return entry;
}
