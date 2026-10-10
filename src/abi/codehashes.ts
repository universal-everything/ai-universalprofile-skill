// Runtime code hashes (keccak256 of eth_getCode) of well-known singleton
// deployments, used to confirm that the code at a canonical address really is
// that contract. Only contracts whose runtime is chain-independent are pinned
// (Permit2 embeds chain-specific immutables and is therefore not listed).
// Verified 2026-10-09 with eth_getCode on LUKSO 42, LUKSO Testnet 4201,
// Ethereum 1, Base 8453, BSC 56 and Arbitrum One 42161 (Multicall3 on LUKSO is
// a different, LUKSO-specific build; both builds are listed).
import type { Address, Hex } from "viem";

export interface KnownCode {
  name: string;
  hashes: Hex[];
}

export const KNOWN_RUNTIME_CODEHASHES: Record<string, KnownCode> = {
  // LSP26 Follower System
  "0xf01103e5a9909fc0dbe8166da7085e0285daddca": { name: "LSP26FollowerSystem", hashes: ["0x1b4787819c61ebebb8bb693a482b224606c275b409a7f99d11c0fcf7d122a27d"] },
  // Multicall3 (standard build | LUKSO build)
  "0xca11bde05977b3631167028862be2a173976ca11": {
    name: "Multicall3",
    hashes: ["0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891", "0x8ec8aa5d07a37e47597b3a254f5cbf39fa2080526ae34db3a564fffed82b99ad"],
  },
  // ERC-4337 EntryPoint v0.6
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789": { name: "EntryPointV06", hashes: ["0xc93c806e738300b5357ecdc2e971d6438d34d8e4e17b99b758b1f9cac91c8e70"] },
  // Nick's deterministic deployment proxy
  "0x4e59b44847b379578588920ca78fbf26c0b4956c": { name: "NickFactory", hashes: ["0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989"] },
};

/** true/false when the address has pinned hashes, undefined when nothing is pinned. */
export function codeHashMatches(address: Address, hash: Hex | undefined): boolean | undefined {
  const k = KNOWN_RUNTIME_CODEHASHES[address.toLowerCase()];
  if (!k) return undefined;
  return !!hash && k.hashes.includes(hash.toLowerCase() as Hex);
}
