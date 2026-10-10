// Networks the skill recommends to people setting up a profile.
//
// LUKSO always comes first; then the top mainnets. Testnets are never recommended: they are
// used only when the human explicitly asks for one (`up chains list --testnets`).
// TODO(product): confirm the exact set of "initial top chains" after LUKSO.

/** Recommended networks in display order (chain ids; LUKSO first). */
export const RECOMMENDED_CHAINS: readonly number[] = [42, 1, 8453, 42161, 56, 137];

export function isRecommended(chainId: number): boolean {
  return RECOMMENDED_CHAINS.includes(chainId);
}

/** Sort key: recommended networks in their order first, everything else after (stable). */
export function recommendationRank(chainId: number): number {
  const i = RECOMMENDED_CHAINS.indexOf(chainId);
  return i === -1 ? RECOMMENDED_CHAINS.length : i;
}
