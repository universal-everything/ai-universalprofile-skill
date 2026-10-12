// Shared transaction pipeline used by every sending verb:
//   build → simulate (eth_call) → estimate gas → fees → sign locally → send raw → wait receipt.
// The controller EOA pays gas on direct paths. Nothing is sent in --dry-run.
import { type Address, type Hex, type TransactionReceipt, type TransactionSerializable, decodeErrorResult, keccak256, type Abi } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { JsonRpcError } from "./rpc.ts";
import { ERROR_ABIS } from "./error-abis.ts";

export interface TxRequest {
  chainId: number;
  to?: Address; // undefined = contract creation
  data?: Hex;
  value?: bigint;
  gas?: bigint;
  /** extra ABIs (errors) to decode reverts with, in addition to the bundled LSP/ERC error set */
  errorAbis?: Abi[];
}

export interface TxOutcome {
  chainId: number;
  from: Address;
  to?: Address;
  hash?: Hex;
  status: "dry-run" | "success" | "reverted";
  blockNumber?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  contractAddress?: Address;
  receipt?: TransactionReceipt;
  explorerUrl?: string;
}

export interface DecodedRevert {
  selector?: Hex;
  errorName?: string;
  args?: unknown;
  message: string;
  raw?: Hex;
}

/** Extracts revert data from viem/JSON-RPC errors (walks the cause chain). */
export function revertData(e: unknown): Hex | undefined {
  let cur: any = e;
  for (let i = 0; i < 8 && cur; i++) {
    if (cur instanceof JsonRpcError && typeof cur.data === "string" && cur.data.startsWith("0x")) return cur.data as Hex;
    const d = cur?.data?.data ?? cur?.data;
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) return d as Hex;
    if (typeof cur?.raw === "string" && cur.raw.startsWith("0x")) return cur.raw as Hex;
    cur = cur.cause;
  }
  return undefined;
}

export function decodeRevert(data: Hex | undefined, extra: Abi[] = []): DecodedRevert {
  if (!data || data === "0x") return { message: "reverted without reason" };
  const selector = data.slice(0, 10) as Hex;
  for (const abi of [...extra, ...ERROR_ABIS]) {
    try {
      const d = decodeErrorResult({ abi, data });
      const args = d.args ? Array.from(d.args as readonly unknown[]) : [];
      return { selector, errorName: d.errorName, args, message: `${d.errorName}(${args.map(String).join(", ")})`, raw: data };
    } catch {}
  }
  return { selector, message: `unknown custom error ${selector}`, raw: data };
}

export async function simulate(ctx: VerbContext, req: TxRequest & { from: Address }): Promise<Hex> {
  try {
    return await ctx.rpc.request<Hex>(req.chainId, "eth_call", [
      { from: req.from, to: req.to, data: req.data ?? "0x", value: req.value ? `0x${req.value.toString(16)}` : undefined },
      "latest",
    ]);
  } catch (e) {
    const data = revertData(e);
    const decoded = decodeRevert(data, req.errorAbis);
    throw new UpError("SIMULATION_REVERTED", `simulation reverted: ${decoded.message}`, {
      hint: hintForRevert(decoded),
      details: decoded,
      cause: e,
    });
  }
}

export function hintForRevert(d: DecodedRevert): string | undefined {
  switch (d.errorName) {
    case "NotAuthorised":
      return "the controller lacks the LSP6 permission named in the error; ask the human to grant it (up permissions show <controller>)";
    case "NoPermissionsSet":
      return "this address is not a controller of the profile on this chain; authorise it first";
    case "NotAllowedCall":
    case "NoCallsAllowed":
      return "the target/function is not in the controller's AllowedCalls; ask the human to extend AllowedCalls";
    case "NotAllowedERC725YDataKey":
    case "NoERC725YDataKeysAllowed":
      return "the data key is not in AllowedERC725YDataKeys for this controller";
    case "InvalidRelayNonce":
      return "relay nonce is stale or reused; fetch a fresh one with: up nonce";
    case "RelayCallBeforeStartTime":
    case "RelayCallExpired":
      return "the relay call validity window is not satisfied; re-sign with a fresh window";
    case "ERC725X_InsufficientBalance":
      return "the profile holds less native coin on this chain than the call sends (balance, value in wei). Call values always come from the profile's own balance, never from the agent's gas money: ask the human to send the missing amount to the profile address (not the gas address), or lower the amount";
    case "InsufficientETH":
      return 'the target (usually a swap router; "ETH" means this chain\'s native coin, e.g. LYX on LUKSO) got less native coin than it needs. Native coin in: the profile sends it as the call value, so give --value with a unit (5lyx, 5ether; a bare 5 is 5 wei), equal to the native amount in the calldata, and check the profile\'s balance. Native coin out: the swap returned less than the minimum, so quote again. Then simulate again through the profile; never switch to a wallet app, a website or a transaction from the agent\'s key';
    case "TransactionDeadlinePassed":
      return "the deadline inside the call has passed: get a fresh quote, rebuild the call with a new deadline and simulate again through the profile";
    default:
      return undefined;
  }
}

async function fees(ctx: VerbContext, chainId: number): Promise<Pick<TransactionSerializable, "maxFeePerGas" | "maxPriorityFeePerGas" | "gasPrice" | "type">> {
  const block = await ctx.rpc.request<any>(chainId, "eth_getBlockByNumber", ["latest", false]);
  if (block?.baseFeePerGas) {
    const base = BigInt(block.baseFeePerGas);
    let tip = 1_000_000_000n;
    try {
      tip = BigInt(await ctx.rpc.request<Hex>(chainId, "eth_maxPriorityFeePerGas", []));
    } catch {}
    return { type: "eip1559", maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip };
  }
  const gp = BigInt(await ctx.rpc.request<Hex>(chainId, "eth_gasPrice", []));
  return { type: "legacy", gasPrice: (gp * 11n) / 10n };
}

export function explorerTxUrl(ctx: VerbContext, chainId: number, hash: Hex): string | undefined {
  try {
    const e = ctx.registry.chain(chainId).explorers[0];
    return e ? `${e.url}/tx/${hash}` : undefined;
  } catch {
    return undefined;
  }
}

/** Signs and sends a transaction from the controller EOA and waits for the receipt (or returns a dry-run outcome). */
/** Gas check without sending: what the transaction may cost, what `from` holds, and how much is missing.
 *  `suggestedFunding` adds a 50% margin to the shortfall so the human funds once. Read-only. */
export async function gasCheck(ctx: VerbContext, from: Address, req: TxRequest): Promise<{ gas: bigint; maxCostWei: bigint; balanceWei: bigint; shortfallWei: bigint; suggestedFundingWei: bigint; enough: boolean }> {
  const est = BigInt(
    await ctx.rpc.request<Hex>(req.chainId, "eth_estimateGas", [{ from, to: req.to, data: req.data ?? "0x", value: req.value ? `0x${req.value.toString(16)}` : undefined }]),
  );
  const gas = req.gas ?? (est * 125n) / 100n + 10_000n;
  const fee = await fees(ctx, req.chainId);
  const maxCostWei = gas * (fee.maxFeePerGas ?? fee.gasPrice ?? 0n) + (req.value ?? 0n);
  const balanceWei = BigInt(await ctx.rpc.request<Hex>(req.chainId, "eth_getBalance", [from, "latest"]));
  const shortfallWei = balanceWei >= maxCostWei ? 0n : maxCostWei - balanceWei;
  const suggestedFundingWei = shortfallWei === 0n ? 0n : shortfallWei + maxCostWei / 2n;
  return { gas, maxCostWei, balanceWei, shortfallWei, suggestedFundingWei, enough: shortfallWei === 0n };
}

export async function sendTx(ctx: VerbContext, signer: Signer, req: TxRequest): Promise<TxOutcome> {
  const from = signer.address;
  // 1) simulate (contract creation: simulate too)
  await simulate(ctx, { ...req, from });
  if (ctx.flags.dryRun) return { chainId: req.chainId, from, to: req.to, status: "dry-run" };

  // 2) gas, nonce, fees
  let gas = req.gas;
  if (!gas) {
    const est = BigInt(
      await ctx.rpc.request<Hex>(req.chainId, "eth_estimateGas", [
        { from, to: req.to, data: req.data ?? "0x", value: req.value ? `0x${req.value.toString(16)}` : undefined },
      ]),
    );
    gas = (est * 125n) / 100n + 10_000n;
  }
  const nonce = Number(BigInt(await ctx.rpc.request<Hex>(req.chainId, "eth_getTransactionCount", [from, "pending"])));
  const fee = await fees(ctx, req.chainId);
  const balance = BigInt(await ctx.rpc.request<Hex>(req.chainId, "eth_getBalance", [from, "latest"]));
  const maxCost = gas * (fee.maxFeePerGas ?? fee.gasPrice ?? 0n) + (req.value ?? 0n);
  if (balance < maxCost) {
    throw new UpError("TX_FAILED", `controller ${from} has insufficient native balance on chain ${req.chainId} (has ${balance} wei, needs up to ${maxCost} wei)`, {
      hint: `you are out of gas on chain ${req.chainId}. If a relayer pays for this profile there, send through it instead (--via relay; check: up relayer quota --chain ${req.chainId}). Otherwise ask the human for a top-up in plain words with dollar values: up funding suggest --chain ${req.chainId} --purpose refill (QR: up display address ${from} --chain ${req.chainId})`,
      details: { balance, maxCost },
    });
  }

  // 3) sign + send
  const tx: TransactionSerializable = { chainId: req.chainId, to: req.to, data: req.data, value: req.value ?? 0n, gas, nonce, ...fee } as TransactionSerializable;
  const raw = await signer.signTransaction(tx);
  // The hash is known before submission. Ambiguous submission errors (timeouts, "already known",
  // "nonce too low" after a failover) must never lead to a rebuilt second transaction: we look the
  // hash up instead and always report hash + nonce so the agent can check before retrying.
  const hash = keccak256(raw);
  try {
    const returned = await ctx.rpc.request<Hex>(req.chainId, "eth_sendRawTransaction", [raw]);
    if (returned && returned.toLowerCase() !== hash.toLowerCase()) ctx.log(`node returned hash ${returned}, expected ${hash}`);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).toLowerCase();
    const ambiguous = !(e instanceof JsonRpcError) || /already known|known transaction|nonce too low|already imported|replacement transaction underpriced/.test(msg);
    if (!ambiguous) throw e;
    const seen = await ctx.rpc.request<unknown>(req.chainId, "eth_getTransactionByHash", [hash]).catch(() => null);
    if (!seen) {
      throw new UpError("TX_FAILED", `submission of ${hash} on chain ${req.chainId} is ambiguous: ${(e as Error)?.message ?? e}`, {
        hint: `do NOT rebuild and resend: check with \`up exec receipt ${hash} --chain ${req.chainId}\` and the controller nonce first; the transaction may still be mined`,
        details: { hash, nonce, from, chainId: req.chainId },
        cause: e,
      });
    }
    ctx.log(`transaction ${hash} already known to the network after an ambiguous submission; waiting for its receipt`);
  }
  ctx.log(`sent ${hash} on chain ${req.chainId}`);

  // 4) receipt
  let receipt: TransactionReceipt;
  try {
    receipt = await waitForReceipt(ctx, req.chainId, hash);
  } catch (e) {
    throw new UpError("TX_FAILED", `no receipt yet for ${hash} on chain ${req.chainId}`, {
      hint: `the transaction may still be pending — do NOT resend; check later with: up exec receipt ${hash} --chain ${req.chainId}`,
      details: { hash, nonce, from, chainId: req.chainId },
      cause: e,
    });
  }
  const out: TxOutcome = {
    chainId: req.chainId,
    from,
    to: req.to,
    hash,
    status: receipt.status === "success" ? "success" : "reverted",
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
    contractAddress: receipt.contractAddress ?? undefined,
    receipt,
    explorerUrl: explorerTxUrl(ctx, req.chainId, hash),
  };
  if (out.status !== "success") {
    throw new UpError("TX_FAILED", `transaction ${hash} reverted on chain ${req.chainId}`, { details: { ...out, receipt: undefined }, hint: "re-run with --dry-run to see the decoded revert reason" });
  }
  return out;
}

export async function waitForReceipt(ctx: VerbContext, chainId: number, hash: Hex, timeoutMs = Number(process.env.UP_RECEIPT_TIMEOUT_MS ?? 180_000)): Promise<TransactionReceipt> {
  const client = ctx.rpc.publicClient(chainId);
  let confirmations = 1;
  try {
    confirmations = ctx.registry.chain(chainId).confirmations ?? 1;
  } catch {}
  return await client.waitForTransactionReceipt({ hash, confirmations, timeout: timeoutMs, pollingInterval: Number(process.env.UP_POLL_MS ?? 2000) });
}
