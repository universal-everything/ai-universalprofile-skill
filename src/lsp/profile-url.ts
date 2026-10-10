// The human-facing web address of a Universal Profile.
//  - LUKSO mainnet (42):  GET https://profile.link/<address>/resolve
//  - LUKSO testnet (4201): GET https://t.profile.link/<address>/resolve
//    → { address, checksummed, name, fullName, resolved, link } and `link` is used
//    (e.g. https://profile.link/feindura; "%40" is shown as "@").
//  - any failure (network, unexpected answer, a link outside profile.link): the direct page
//    https://universaleverything.io/<checksummed address>?network=mainnet|testnet, which is
//    exactly where profile.link itself forwards to (checked live on 10 Oct 2026).
//  - other chains: universaleverything.io and profile.link show LUKSO data only, so the
//    result says so and adds the chain's block explorer page for the address when known.
// The resolve response is untrusted: only a link on the expected profile.link host with a
// plain path is accepted.
import { getAddress, type Address } from "viem";
import type { Registry } from "../core/types.ts";
import type { FetchLike } from "../abi/http.ts";
import { readCapped } from "../abi/http.ts";

export const LUKSO_MAINNET = 42;
export const LUKSO_TESTNET = 4201;

export interface ProfileUrl {
  chainId: number;
  address: Address;
  /** The best URL to give the human. */
  url: string;
  source: "profile.link" | "universaleverything" | "explorer" | "none";
  /** profile.link answered with this name (untrusted data). */
  name?: string;
  /** universaleverything.io page (LUKSO data). */
  universalEverything: string;
  explorer?: string;
  /** True when the page shows LUKSO data, not the chain the metadata was written on. */
  showsLuksoData: boolean;
  note?: string;
  resolveError?: string;
}

export function luksoNetwork(chainId: number, aliases: Record<number, "mainnet" | "testnet"> = {}): "mainnet" | "testnet" | undefined {
  if (aliases[chainId]) return aliases[chainId];
  return chainId === LUKSO_MAINNET ? "mainnet" : chainId === LUKSO_TESTNET ? "testnet" : undefined;
}

export function universalEverythingUrl(address: Address, network: "mainnet" | "testnet" = "mainnet"): string {
  return `https://universaleverything.io/${getAddress(address)}?network=${network}`;
}

export function profileLinkHost(network: "mainnet" | "testnet"): string {
  return network === "mainnet" ? "profile.link" : "t.profile.link";
}

/** Validates the `link` of a resolve answer; returns it with %40 shown as @, or undefined. */
export function acceptProfileLink(link: unknown, network: "mainnet" | "testnet"): string | undefined {
  if (typeof link !== "string" || link.length > 300) return undefined;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" || u.hostname !== profileLinkHost(network) || u.port || u.username || u.password || u.search || u.hash) return undefined;
  const path = u.pathname.replace(/%40/gi, "@");
  if (!/^\/[A-Za-z0-9._~@#-]{1,128}$/.test(path)) return undefined;
  return `https://${u.hostname}${path}`;
}

export interface ProfileUrlOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Test hook: treat these chain ids as LUKSO mainnet/testnet for URL purposes. */
  luksoAliases?: Record<number, "mainnet" | "testnet">;
  registry?: Pick<Registry, "chain">;
}

function explorerAddressUrl(registry: Pick<Registry, "chain"> | undefined, chainId: number, address: Address): string | undefined {
  try {
    const e = registry?.chain(chainId).explorers[0];
    return e ? `${e.url.replace(/\/+$/, "")}/address/${getAddress(address)}` : undefined;
  } catch {
    return undefined;
  }
}

function chainName(registry: Pick<Registry, "chain"> | undefined, chainId: number): string {
  try {
    return `${registry?.chain(chainId).name ?? "chain"} (${chainId})`;
  } catch {
    return `chain ${chainId}`;
  }
}

/** Resolves the profile URL. Never throws. */
export async function resolveProfileUrl(chainId: number, address: Address, opts: ProfileUrlOptions = {}): Promise<ProfileUrl> {
  const checksummed = getAddress(address);
  const network = luksoNetwork(chainId, opts.luksoAliases);
  if (!network) {
    const explorer = explorerAddressUrl(opts.registry, chainId, checksummed);
    return {
      chainId,
      address: checksummed,
      url: explorer ?? universalEverythingUrl(checksummed),
      source: explorer ? "explorer" : "none",
      universalEverything: universalEverythingUrl(checksummed),
      explorer,
      showsLuksoData: true,
      note: `universaleverything.io and profile.link show your profile's LUKSO data, not what is stored on ${chainName(opts.registry, chainId)}${explorer ? "; the block explorer page shows the profile on that chain" : "; no block explorer is known for that chain"}`,
    };
  }
  const fallback = universalEverythingUrl(checksummed, network);
  const base: ProfileUrl = { chainId, address: checksummed, url: fallback, source: "universaleverything", universalEverything: fallback, explorer: explorerAddressUrl(opts.registry, chainId, checksummed), showsLuksoData: false };
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await f(`https://${profileLinkHost(network)}/${checksummed}/resolve`, { signal: ctrl.signal, redirect: "error", headers: { accept: "application/json", "user-agent": "universal-profile-skill" } });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ...base, resolveError: `HTTP ${res.status}` };
    }
    const body = JSON.parse(new TextDecoder().decode(await readCapped(res, 16 * 1024, ctrl)));
    const answered = typeof body?.address === "string" ? body.address.toLowerCase() : undefined;
    if (answered !== checksummed.toLowerCase()) return { ...base, resolveError: "profile.link answered for another address" };
    const link = acceptProfileLink(body.link, network);
    if (!link) return { ...base, resolveError: "profile.link returned no usable link" };
    const name = typeof body.name === "string" && body.name.length <= 128 ? body.name : undefined;
    return { ...base, url: link, source: "profile.link", ...(name ? { name } : {}) };
  } catch (e) {
    return { ...base, resolveError: (e as Error)?.name === "AbortError" ? "timeout" : String((e as Error)?.message ?? e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}
