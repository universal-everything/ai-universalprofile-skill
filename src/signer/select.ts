// Which controller key signs on which chain (pure; no key material, no backends).
//
// One Universal Profile is one account on many chains. By default the agent uses ONE
// controller key everywhere (config.controller). A chain may have its own key
// (config.chainControllers[chainId]), e.g. to keep a low-value chain's key apart from
// the main one; every signature for that chain (transactions, LSP25 relay calls, relayer
// quota logins, UserOperations, ERC-1271 signatures, deployments) then uses that key.
// Configs without chainControllers behave exactly as before.
import { getAddress, isAddress, type Address } from "viem";
import { UpError } from "../core/errors.ts";
import type { UpConfig } from "../core/types.ts";

export type ControllerRef = NonNullable<UpConfig["controller"]>;

export interface SelectedController extends ControllerRef {
  /** "chain": a chain-specific key; "default": config.controller. */
  scope: "chain" | "default";
  /** Set when scope is "chain". */
  chainId?: number;
}

function checked(c: ControllerRef, where: string): ControllerRef {
  if (!c || typeof c.address !== "string" || !isAddress(c.address, { strict: false }) || typeof c.backend !== "string") {
    throw new UpError("NO_SIGNER", `${where} is not a valid controller entry`, { hint: "fix it with: up key activate <address> [--chain <id>]" });
  }
  return { ...c, address: getAddress(c.address) };
}

/**
 * The controller key used on `chainId`: the chain's own key when configured, else the
 * default key. Without a chain id the default key. Undefined when no key exists at all.
 */
export function controllerFor(cfg: UpConfig, chainId?: number): SelectedController | undefined {
  if (chainId !== undefined) {
    const own = cfg.chainControllers?.[String(chainId)];
    if (own) return { ...checked(own, `config.chainControllers["${chainId}"]`), scope: "chain", chainId };
  }
  if (!cfg.controller) return undefined;
  return { ...checked(cfg.controller, "config.controller"), scope: "default" };
}

/** Chain-specific keys as a sorted list (public data only). */
export function chainControllerList(cfg: UpConfig): { chainId: number; address: Address; backend: string; createdAt: string }[] {
  return Object.entries(cfg.chainControllers ?? {})
    .map(([id, c]) => ({ chainId: Number(id), ...checked(c, `config.chainControllers["${id}"]`) }))
    .filter((c) => Number.isInteger(c.chainId) && c.chainId > 0)
    .sort((a, b) => a.chainId - b.chainId);
}

/** Every distinct local controller key (default first), with the chains it is used on. */
export function localControllers(cfg: UpConfig): { address: Address; backend: string; default: boolean; chains: number[] }[] {
  const out: { address: Address; backend: string; default: boolean; chains: number[] }[] = [];
  if (cfg.controller) out.push({ address: getAddress(cfg.controller.address), backend: cfg.controller.backend, default: true, chains: [] });
  for (const c of chainControllerList(cfg)) {
    const hit = out.find((x) => x.address === c.address);
    if (hit) hit.chains.push(c.chainId);
    else out.push({ address: c.address, backend: c.backend, default: false, chains: [c.chainId] });
  }
  return out;
}
