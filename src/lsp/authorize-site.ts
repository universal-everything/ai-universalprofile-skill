// The authorization website, the network its links are for and the capability names: the part of
// the authorization link the rest of the skill needs at start (verb help, per-chain hints). The
// link itself (authorize-link.ts) and the verbs' code (authorize-run.ts) load when a verb runs.

export const AUTHORIZE_WEBSITE = "https://authorize.universalprofile.cloud";

/** LUKSO mainnet, the only network the website's wallet connection supports. */
export const LUKSO_MAINNET_CHAIN_ID = 42;

export interface AuthorizeHooks {
  /** Chain id behind the website's `network=mainnet`. Always 42 in the product; tests point it at a local chain. */
  mainnetChainId: number;
}
const hooks: AuthorizeHooks = { mainnetChainId: LUKSO_MAINNET_CHAIN_ID };

/** Tests only: override hooks; call without arguments to restore the product defaults. */
export function setAuthorizeHooksForTests(h?: Partial<AuthorizeHooks>): void {
  Object.assign(hooks, { mainnetChainId: LUKSO_MAINNET_CHAIN_ID }, h ?? {});
}

/**
 * Networks the website can authorize on. Its wallet connection supports LUKSO mainnet only, so
 * other networks get the manual hand-over (`permissions recommend`) instead of a link.
 */
export function authorizeNetwork(chainId: number): { param: "mainnet"; name: string } | undefined {
  return chainId === hooks.mainnetChainId ? { param: "mainnet", name: "LUKSO" } : undefined;
}

/** The chain an authorization link targets by default (LUKSO mainnet). */
export function authorizeDefaultChainId(): number {
  return hooks.mainnetChainId;
}

export const CAPABILITIES = ["tokens", "nfts", "social", "profile", "pay", "sign"] as const;
export type Capability = (typeof CAPABILITIES)[number];
