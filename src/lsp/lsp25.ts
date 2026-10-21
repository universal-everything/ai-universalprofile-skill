// LSP25 ExecuteRelayCall: message encoding, EIP-191 v0 digest, signing,
// multi-channel nonces and validity windows.
//
// digest = keccak256(0x19 ‖ 0x00 ‖ keyManager ‖ encodePacked(uint256 25, uint256 chainId,
//            uint256 nonce, uint256 validityTimestamps, uint256 value, bytes payload))
// Source: LSP25MultiChannelNonce._recoverSignerFromLSP25Signature (lsp25-contracts) and
// https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-25-ExecuteRelayCall.md#signature-format
// `value` is the msg.value the relayer sends with executeRelayCall (0 for normal relayers);
// value moved *by the profile* lives inside the payload (ERC725X execute value).
import { concat, encodeFunctionData, encodePacked, getAddress, keccak256, recoverAddress, toBytes, type Address, type Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { LSP25_VERSION } from "./constants.ts";
import { KM_ABI } from "./abis.ts";
import { read } from "./read.ts";

const U128 = (1n << 128n) - 1n;

export interface Lsp25Message {
  keyManager: Address;
  chainId: number | bigint;
  nonce: bigint;
  validityTimestamps: bigint;
  /** msg.value sent by the relayer with executeRelayCall (normally 0) */
  value: bigint;
  payload: Hex;
}

/** abi.encodePacked(LSP25_VERSION, chainId, nonce, validityTimestamps, value, payload) — the "data" of EIP-191 v0. */
export function encodeLsp25Message(m: Omit<Lsp25Message, "keyManager">): Hex {
  return encodePacked(["uint256", "uint256", "uint256", "uint256", "uint256", "bytes"], [LSP25_VERSION, BigInt(m.chainId), m.nonce, m.validityTimestamps, m.value, m.payload]);
}

/** EIP-191 version 0 ("data with intended validator") digest. */
export function lsp25Digest(m: Lsp25Message): Hex {
  return keccak256(concat(["0x19", "0x00", getAddress(m.keyManager), encodeLsp25Message(m)]));
}

export async function signLsp25(signer: Signer, m: Lsp25Message): Promise<Hex> {
  return signer.signIntendedValidator(getAddress(m.keyManager), encodeLsp25Message(m));
}

export async function recoverLsp25Signer(m: Lsp25Message, signature: Hex): Promise<Address> {
  return recoverAddress({ hash: lsp25Digest(m), signature });
}

// --- nonces ----------------------------------------------------------------

export function composeNonce(channelId: bigint, sequence: bigint): bigint {
  if (channelId < 0n || channelId > U128 || sequence < 0n || sequence > U128) throw new Error("channelId and sequence must be uint128");
  return (channelId << 128n) | sequence;
}

export function splitNonce(nonce: bigint): { channelId: bigint; sequence: bigint } {
  return { channelId: nonce >> 128n, sequence: nonce & U128 };
}

/**
 * The EARLIER default nonce channel per relayer × chain (relay-api-plan §5.2): keccak256("<relayer>:<chainId>")
 * truncated to 128 bits. Kept for library compatibility and so that `up nonce` can show the counters of
 * calls signed on it before; it is never a default any more: relayed calls use the profile's saved random
 * channel (src/lsp/relay-channel.ts), or an explicit --channel.
 */
export function defaultChannel(relayerName: string, chainId: number): bigint {
  const h = BigInt(keccak256(toBytes(`${relayerName.toLowerCase()}:${chainId}`)));
  const c = h >> 128n;
  return c === 0n ? 1n : c;
}

export async function getRelayNonce(ctx: VerbContext, chainId: number, keyManager: Address, signer: Address, channelId: bigint): Promise<bigint> {
  if (channelId < 0n || channelId > U128) throw new UpError("BAD_ARGS", "nonce channel must be a uint128");
  return read<bigint>(ctx, chainId, keyManager, KM_ABI, "getNonce", [signer, channelId]);
}

// --- validity windows ------------------------------------------------------

export function encodeValidityTimestamps(start: bigint, end: bigint): bigint {
  if (start < 0n || start > U128 || end < 0n || end > U128) throw new Error("validity timestamps must be uint128");
  if (end !== 0n && end < start) throw new Error("validity end is before start");
  return (start << 128n) | end;
}

export function decodeValidityTimestamps(v: bigint): { start: bigint; end: bigint; unlimited: boolean } {
  return { start: v >> 128n, end: v & U128, unlimited: v === 0n };
}

/** Window [now - backdate, now + seconds]; seconds = 0 => unlimited (validityTimestamps = 0). */
export function validityWindow(nowSec: bigint, seconds: number, backdateSec = 60): bigint {
  if (seconds === 0) return 0n;
  if (!Number.isInteger(seconds) || seconds < 0) throw new Error("validity seconds must be a non-negative integer");
  const start = nowSec > BigInt(backdateSec) ? nowSec - BigInt(backdateSec) : 0n;
  return encodeValidityTimestamps(start, nowSec + BigInt(seconds));
}

/** Client-side check mirroring LSP25MultiChannelNonce._verifyValidityTimestamps. */
export function checkValidity(v: bigint, nowSec: bigint): "ok" | "not-yet-valid" | "expired" {
  if (v === 0n) return "ok";
  const { start, end } = decodeValidityTimestamps(v);
  if (nowSec < start) return "not-yet-valid";
  if (end !== 0n && nowSec > end) return "expired";
  return "ok";
}

// --- calldata --------------------------------------------------------------

export function encodeExecuteRelayCall(signature: Hex, nonce: bigint, validityTimestamps: bigint, payload: Hex): Hex {
  return encodeFunctionData({ abi: KM_ABI, functionName: "executeRelayCall", args: [signature, nonce, validityTimestamps, payload] });
}

export interface SignedRelayCall {
  signature: Hex;
  nonce: bigint;
  validityTimestamps: bigint;
  value: bigint;
  payload: Hex;
}

export function encodeExecuteRelayCallBatch(calls: SignedRelayCall[]): Hex {
  return encodeFunctionData({
    abi: KM_ABI,
    functionName: "executeRelayCallBatch",
    args: [calls.map((c) => c.signature), calls.map((c) => c.nonce), calls.map((c) => c.validityTimestamps), calls.map((c) => c.value), calls.map((c) => c.payload)],
  });
}

/**
 * Signs a batch for executeRelayCallBatch with sequential nonces on one channel
 * (the KM checks them in order, so nonce i = start + i). msg.value of the batch tx must equal Σ values.
 */
export async function signRelayBatch(
  signer: Signer,
  base: { keyManager: Address; chainId: number; channelId: bigint; startSequence: bigint; validityTimestamps: bigint },
  items: { payload: Hex; value?: bigint }[],
): Promise<SignedRelayCall[]> {
  const out: SignedRelayCall[] = [];
  for (let i = 0; i < items.length; i++) {
    const nonce = composeNonce(base.channelId, base.startSequence + BigInt(i));
    const value = items[i].value ?? 0n;
    const signature = await signLsp25(signer, { keyManager: base.keyManager, chainId: base.chainId, nonce, validityTimestamps: base.validityTimestamps, value, payload: items[i].payload });
    out.push({ signature, nonce, validityTimestamps: base.validityTimestamps, value, payload: items[i].payload });
  }
  return out;
}
