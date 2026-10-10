// funding suggest: how much of the native coin to ask the human for, in plain words.
//
// The agent pays its own gas: the human funds the agent's address once per network, and that
// balance pays for creating the profile and for the agent's later actions. Rule of thumb from the
// product owner: about $1 worth is enough to create the profile and leave gas for some actions;
// about $10 worth if the agent should do more right away. The suggestion never goes below what the
// deployment on that network actually costs right now (estimated on-chain), with a margin.
import { formatEther, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { defineVerb } from "../core/verbs.ts";
import { UpError } from "../core/errors.ts";
import type { VerbContext } from "../core/types.ts";
import { paths, readJson, writeJson } from "../core/home.ts";
import { httpJson, type FetchLike } from "../abi/http.ts";
import { gasCheck } from "./tx.ts";

export const PRICE_API = "https://api.coingecko.com/api/v3/simple/price";
const PRICE_TTL_MS = 10 * 60_000;

/** Display symbol: the registry names some ETH rollups' coin e.g. "BaseETH"; people know it as ETH. */
export function displaySymbol(symbol: string): string {
  return /ETH$/.test(symbol) && symbol !== "ETH" && !/^W/.test(symbol) ? "ETH" : symbol;
}

/** CoinGecko id for a native coin, "usd" for dollar stablecoins, undefined when unknown (no fiat claim then). */
export function priceIdFor(symbol: string): string | undefined {
  const s = displaySymbol(symbol);
  if (s === "ETH") return "ethereum";
  const ids: Record<string, string> = { LYX: "lukso-token-2", BNB: "binancecoin", POL: "polygon-ecosystem-token", AVAX: "avalanche-2" };
  if (ids[s]) return ids[s];
  if (/^(xDAI|USDC|USDT0|PathUSD)/.test(s)) return "usd";
  return undefined;
}

export async function priceUsd(ctx: VerbContext, symbol: string, opts: { fetch?: FetchLike; now?: number } = {}): Promise<number | undefined> {
  const id = priceIdFor(symbol);
  if (!id) return undefined;
  if (id === "usd") return 1;
  const now = opts.now ?? Date.now();
  const cacheFile = paths.cache(ctx.home, "prices.json");
  const cache = await readJson<Record<string, { usd: number; at: number }>>(cacheFile, {});
  const hit = cache[id];
  if (hit && now - hit.at < PRICE_TTL_MS && hit.usd > 0) return hit.usd;
  try {
    const r = await httpJson<Record<string, { usd?: number }>>(`${PRICE_API}?ids=${id}&vs_currencies=usd`, { fetch: opts.fetch, timeoutMs: 8000, retries: 1, label: "price API" });
    const usd = r.status === 200 ? r.body?.[id]?.usd : undefined;
    if (typeof usd === "number" && usd > 0) {
      cache[id] = { usd, at: now };
      await writeJson(cacheFile, cache).catch(() => {});
      return usd;
    }
  } catch {}
  return hit?.usd; // stale beats nothing; undefined → no fiat claim
}

/** Two significant digits, rounded up, without float noise ("4.2", "0.0021", "42"). */
export function friendlyAmount(wei: bigint): string {
  if (wei <= 0n) return "0";
  const s = formatEther(wei);
  const n = Number(s);
  const mag = Math.floor(Math.log10(n));
  const step = 10 ** (mag - 1);
  const up = Math.ceil(n / step - 1e-9) * step;
  return up >= 1 ? String(Number(up.toPrecision(2))) : up.toFixed(Math.max(0, 1 - mag));
}

/** Suggested starter budget in dollars per network: $1 on cheap networks; Ethereum mainnet gas is pricier,
 *  so $2–$5 there so the agent can still act after creating the profile. */
export function starterUsd(chainId: number): { min: number; max: number } {
  return chainId === 1 ? { min: 2, max: 5 } : { min: 1, max: 1 };
}

function usdToWei(usd: number, priceUsd: number): bigint {
  return parseEther((usd / priceUsd).toFixed(18));
}

/** On-chain estimate of a typical profile deployment's maximum gas cost on this chain (undefined if the LSP stack is missing or the estimate fails). */
async function deploymentCostWei(ctx: VerbContext, chainId: number, from: Address): Promise<bigint | undefined> {
  try {
    const { planDeployment, DEFAULT_IMPL_VERSION } = await import("../lsp/lsp23.ts");
    const { getPreset, toBytes32 } = await import("../lsp/permissions.ts");
    const salt = keccak256(toHex(`funding-estimate-${from}`)) as Hex;
    const plan = planDeployment({ salt, controller: from, permissions: toBytes32(getPreset("agent-owner").permissions), implementationVersion: DEFAULT_IMPL_VERSION });
    const g = await gasCheck(ctx, from, { chainId, to: plan.factory, data: plan.deployCalldata });
    return g.maxCostWei;
  } catch {
    return undefined;
  }
}

export interface FundingSuggestion {
  chainId: number;
  network: string;
  symbol: string;
  address: Address;
  priceUsd?: number;
  deploymentCost?: string;
  balance: string;
  balanceUsd?: number;
  /** True when the balance is below what the setup suggestion asks for (refill: below a few actions). */
  low: boolean;
  starter: { amount: string; usd?: number; range?: { min: string; max: string; usdMin: number; usdMax: number } };
  more: { amount: string; usd?: number };
}

defineVerb({
  name: "funding suggest",
  group: "chains",
  summary: "How much native coin to ask the human to send to the agent's address on a network: about $1 worth to create the profile plus some gas, about $10 worth for more actions (never less than the current deployment cost). Plain-language text included.",
  description:
    "Uses a live price (CoinGecko, cached 10 minutes) and an on-chain estimate of the profile deployment on that network. Without a price it suggests a coin amount only and makes no dollar claim. Show the QR of the address (up display address <address>) together with `text`.",
  risk: "read",
  params: [
    { name: "address", type: "string", description: "Address to fund (default: this agent's key for the chain)." },
    { name: "purpose", type: "string", description: "setup: first funding (create the profile + some gas); refill: the agent is running low.", enum: ["setup", "refill"], default: "setup" },
  ],
  examples: ["up funding suggest --chain lukso", "up funding suggest --chain ethereum", "up funding suggest --chain base --purpose refill"],
  async run(ctx, a) {
    const chainId = ctx.chainId(a.chain);
    const chain = ctx.registry.chain(chainId);
    const address = (a.address ? a.address : (await ctx.signer(chainId)).address) as Address;
    const symbol = displaySymbol(chain.nativeSymbol);
    const [price, deployCost, balanceHex] = await Promise.all([
      chain.testnet ? Promise.resolve(undefined) : priceUsd(ctx, chain.nativeSymbol), // test coins have no price
      deploymentCostWei(ctx, chainId, address),
      ctx.rpc.request<Hex>(chainId, "eth_getBalance", [address, "latest"]),
    ]);
    const floor = deployCost ? (deployCost * 3n) / 2n : 0n; // the deployment with a 50% margin
    const max = (x: bigint, y: bigint) => (x > y ? x : y);
    const tier = starterUsd(chainId);
    const starterMinWei = price ? max(usdToWei(tier.min, price), floor) : floor * 2n;
    const starterWei = price ? max(usdToWei(tier.max, price), floor) : floor * 2n; // the amount to ask for (top of the range)
    const moreWei = price ? max(usdToWei(10, price), starterWei * 2n) : starterWei * 10n;
    if (starterWei === 0n) throw new UpError("NETWORK_ERROR", `could not estimate gas or price on ${chain.name}`, { hint: `retry, or check the network: up chains verify ${chainId}` });
    const usdOf = (wei: bigint) => (price ? Math.round(Number(formatEther(wei)) * price * 100) / 100 : undefined);
    const balanceWei = BigInt(balanceHex);
    const purpose = a.purpose === "refill" ? "refill" : "setup";
    const s: FundingSuggestion = {
      chainId,
      network: chain.name,
      symbol,
      address,
      priceUsd: price,
      deploymentCost: deployCost ? formatEther(deployCost) : undefined,
      balance: formatEther(balanceWei),
      balanceUsd: usdOf(balanceWei),
      // setup: below the suggested start budget; refill: below half of it (a few actions left)
      low: purpose === "refill" ? balanceWei < starterMinWei / 2n : balanceWei < starterMinWei,
      starter: {
        amount: friendlyAmount(starterWei),
        usd: usdOf(starterWei),
        ...(price && tier.min !== tier.max ? { range: { min: friendlyAmount(starterMinWei), max: friendlyAmount(starterWei), usdMin: tier.min, usdMax: tier.max } } : {}),
      },
      more: { amount: friendlyAmount(moreWei), usd: usdOf(moreWei) },
    };
    const usd = (v?: number) => (v !== undefined ? ` (about $${v < 10 ? v.toFixed(2) : Math.round(v)})` : "");
    const ask = s.starter.range
      ? `about ${s.starter.range.min}–${s.starter.range.max} ${symbol} (about $${s.starter.range.usdMin}–$${s.starter.range.usdMax})`
      : `about ${s.starter.amount} ${symbol}${usd(s.starter.usd)}`;
    const test = chain.testnet ? " (test coins, e.g. from a faucet)" : "";
    const text =
      purpose === "refill" && !s.low
        ? `I still have ${friendlyAmount(balanceWei)} ${symbol}${usd(s.balanceUsd)} for gas on ${chain.name}; that's enough for now, no top-up needed.`
        : purpose === "refill"
        ? [
            `I'm running low on gas on ${chain.name}: I have ${friendlyAmount(balanceWei)} ${symbol}${usd(s.balanceUsd)} left.`,
            `Could you top me up with ${ask}${test} to my address ${address} (QR attached)? Then I can keep acting for you there.`,
            `For a bigger buffer, about ${s.more.amount} ${symbol}${usd(s.more.usd)}.`,
          ].join(" ")
        : [
            `Please send ${ask}${test} on ${chain.name} to my address ${address} (QR attached).`,
            `That covers creating the profile and leaves gas so I can keep acting for you afterwards without running out right away.`,
            `If you'd like me to do more right away, send about ${s.more.amount} ${symbol}${usd(s.more.usd)} instead.`,
            "This is my own gas money: with it I do everything myself, so you never have to sign anything.",
          ].join(" ");
    return { data: s, text };
  },
});
