// Chain/contract/protocol registry: bundled seed (assets/registry) + local
// overlay ($UP_HOME/cache/registry/overlay.json written by `chains refresh` /
// `chains add`). The overlay never silently replaces bundled entries: it can
// add chains and append RPCs; facts carry trust labels.
import { readFileSync, existsSync } from "node:fs";
import type { Address, ChainInfo, Registry } from "../core/types.ts";
import { assetJson } from "../core/assets.ts";
import { UpError } from "../core/errors.ts";
import { paths } from "../core/home.ts";

export interface RegistryOverlay {
  chains?: ChainInfo[];
  updatedAt?: string;
}

export function loadOverlay(home: string): RegistryOverlay {
  const f = paths.cache(home, "registry", "overlay.json");
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

export function createRegistry(home: string): Registry {
  let chainsCache: ChainInfo[] | undefined;
  const load = (): ChainInfo[] => {
    if (chainsCache) return chainsCache;
    const bundled: ChainInfo[] = assetJson<{ chains: ChainInfo[] }>("registry", "chains.json").chains.map((c) => ({ ...c, rpcs: [...c.rpcs] }));
    const overlay = loadOverlay(home);
    for (const oc of overlay.chains ?? []) {
      const existing = bundled.find((c) => c.chainId === oc.chainId);
      if (!existing) bundled.push(oc);
      else {
        for (const r of oc.rpcs ?? []) if (!existing.rpcs.some((x) => x.url === r.url)) existing.rpcs.push(r);
      }
    }
    return (chainsCache = bundled);
  };

  return {
    chains: load,
    chain(idOrName) {
      const all = load();
      const s = String(idOrName).trim().toLowerCase();
      const byId = /^\d+$/.test(s) ? all.find((c) => c.chainId === Number(s)) : undefined;
      const found = byId ?? all.find((c) => c.slug === s || c.name.toLowerCase() === s) ?? ALIASES[s]?.map((id) => all.find((c) => c.chainId === id)).find(Boolean);
      if (!found) {
        throw new UpError("CHAIN_UNKNOWN", `unknown chain "${idOrName}"`, {
          hint: /^\d+$/.test(s) ? `add it with: up chains add ${s} (fetches metadata + RPCs from chainlist)` : "list chains with: up chains list",
        });
      }
      return found;
    },
    contracts: () => assetJson("registry", "contracts.json").contracts,
    protocols: () => assetJson("registry", "protocols.json"),
    canonical(name, version) {
      const c = assetJson("registry", "contracts.json").contracts[name];
      if (!c) return undefined;
      const vs = c.versions as Record<string, { address: Address }>;
      if (version) return vs[version.replace(/^v/, "")]?.address;
      const keys = Object.keys(vs).sort(semverDesc);
      return vs[keys[0]]?.address;
    },
  };
}

const ALIASES: Record<string, number[]> = {
  mainnet: [1],
  eth: [1],
  sepolia: [11155111],
  arbitrum: [42161],
  bsc: [56],
  bnb: [56],
  avalanche: [43114],
  avax: [43114],
  "lukso-mainnet": [42],
  robinhood: [4663],
  matic: [137],
};

function semverDesc(a: string, b: string): number {
  if (a === "singleton") return 1;
  if (b === "singleton") return -1;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
}

/** Canonical LSP addresses used by deployments (latest versions shipped upstream). */
export const LSP = {
  LSP23_FACTORY: "0x2300000A84D25dF63081feAa37ba6b62C4c89a30" as Address,
  UP_INIT_POST_DEPLOYMENT_MODULE: "0x000000000066093407b6704B89793beFfD0D8F00" as Address,
  UP_POST_DEPLOYMENT_MODULE: "0x0000005aD606bcFEF9Ea6D0BbE5b79847054BcD7" as Address,
  UP_INIT: { "0.14.0": "0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F", "0.12.1": "0x52c90985AF970D4E0DC26Cb5D052505278aF32A9" } as Record<string, Address>,
  KM_INIT: { "0.14.0": "0x2Fe3AeD98684E7351aD2D408A43cE09a738BF8a4", "0.12.1": "0xa75684d7D048704a2DB851D05Ba0c3cbe226264C" } as Record<string, Address>,
  URD: { "0.14.0": "0x7870C5B8BC9572A8001C3f96f7ff59961B23500D", "0.12.1": "0xA5467dfe7019bF2C7C5F7A707711B9d4cAD118c8" } as Record<string, Address>,
  ERC_TOKEN_CALLBACKS: "0x082d49D8487d2ed2527440c7879C66d850daaBc5" as Address,
  NICK_FACTORY: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address,
  ENTRYPOINT_V06: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as Address,
  MULTICALL3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
  LSP26: "0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA" as Address,
} as const;
