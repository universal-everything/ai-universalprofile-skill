// The agent's persistent LSP25 relay channel for a profile.
//
// A relay nonce is channel × 2^128 + counter: calls on one channel execute strictly in order, calls on
// different channels are independent. The skill gives every profile ONE channel per state folder
// (UP_HOME, i.e. per agent): a random uint128 from the operating system's CSPRNG, created once, saved as
// public data in the profile record (profiles/<identity>.json, `relayChannel`) and then used for every
// relayed call on every chain (linked per-chain addresses included) and through every relayer. The
// counter itself lives on chain, per chain, Key Manager, controller key and channel; it is read live
// (getNonce) right before signing and never stored or counted here. Per-chain or later keys of the same
// agent use the same channel number with their own on-chain counters.
//
// Why: two agents acting for one profile never share a counter, so they cannot invalidate each other's
// signed calls; one agent keeps one ordered sequence instead of a channel per relayer; and the first
// storage write of a counter (zero to non-zero) is paid once per chain, Key Manager and key, not on every
// call (later calls are cheaper, not free). The channel is not a secret; a collision with another agent's
// channel is astronomically unlikely, not impossible. It applies to LSP25 relay calls only: the key's own
// transaction nonce and ERC-4337 nonces are separate counters and are never random.
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { getAddress, type Address } from "viem";
import type { VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { isJsonObject, paths, writeJson } from "../core/home.ts";
import { withLock } from "../core/lock.ts";
import { chainAddressesOf, readProfileRecord } from "../core/profile-record.ts";

const U128 = (1n << 128n) - 1n;
/** Channel 0 is the shared strictly ordered channel and 1..3 are values people pick by hand: never a saved channel. */
export const MIN_SAVED_CHANNEL = 4n;

export interface RelayChannel {
  channel: bigint;
  createdAt?: string;
  /** "random" (created here) or "adopted" (an earlier channel of this agent and profile, given explicitly) */
  source?: string;
}

let entropy: (n: number) => Uint8Array = (n) => randomBytes(n);
/** Tests only: replaces the CSPRNG behind new channels with a fixture (no argument: back to crypto.randomBytes). */
export function setChannelEntropy(fn?: (n: number) => Uint8Array): void {
  entropy = fn ?? ((n) => randomBytes(n));
}

/** A new random channel: 16 bytes from the CSPRNG as a uint128; 0..3 are drawn again. */
export function randomChannel(): bigint {
  for (let i = 0; i < 8; i++) {
    const b = entropy(16);
    if (b.length !== 16) break;
    const c = BigInt("0x" + Buffer.from(b).toString("hex"));
    if (c >= MIN_SAVED_CHANNEL) return c;
  }
  throw new UpError("INTERNAL", "the random number generator gave no usable relay channel; nothing was saved", { hint: "run up doctor" });
}

const damaged = (file: string) =>
  new UpError("INTERNAL", `the saved relay channel in ${file} is damaged; nothing was signed and no new channel was made`, {
    hint: "restore the earlier relayChannel value in that file (it is public: earlier `up nonce` or `up nonce channel` output shows it); never delete it to get a new channel while calls signed on it may still be pending",
  });

/** The saved channel of a profile record; undefined when none was created. A damaged value is an error, never a reason for a new channel. */
export function savedChannelOf(record: Record<string, any>, file: string): RelayChannel | undefined {
  if (!("relayChannel" in record)) return undefined;
  const r = record.relayChannel;
  if (!isJsonObject(r) || typeof r.channel !== "string" || !/^[1-9][0-9]{0,38}$/.test(r.channel)) throw damaged(file);
  const channel = BigInt(r.channel);
  if (channel < MIN_SAVED_CHANNEL || channel > U128) throw damaged(file);
  return { channel, createdAt: typeof r.createdAt === "string" ? r.createdAt : undefined, source: typeof r.source === "string" ? r.source : undefined };
}

/** What this state folder knows about the profile's relay channel, without writing anything (a damaged record is an error). */
export async function relayChannelState(home: string, identity: Address): Promise<{ saved?: RelayChannel; restored: boolean }> {
  const id = getAddress(identity);
  const record = await readProfileRecord(home, id);
  return { saved: savedChannelOf(record, paths.profile(home, id)), restored: record.imported !== undefined };
}

/** A channel that may be saved: 4 to 2^128 - 1 (0..3 are shared, hand-picked values). */
export function assertSavableChannel(channel: bigint): void {
  if (channel < MIN_SAVED_CHANNEL || channel > U128) throw new UpError("BAD_ARGS", "a saved relay channel must be between 4 and 2^128 - 1 (0..3 are shared, hand-picked values)");
}

/** The error a relayed send gets for a profile restored from a backup whose channel is not known here. */
export function restoredWithoutChannel(identity: Address): UpError {
  return new UpError("NOT_SUPPORTED", `the profile ${identity} was restored from a backup into this state folder, and its relay channel is not known here (a key backup does not carry it); nothing was signed`, {
    hint: "a relayed action from before the restore may still be pending on the earlier channel: check it first (up exec receipt <hash>), or wait until its validity window has passed (10 minutes by default). Then, with the human's approval, create this profile's channel: up nonce channel create --channel <earlier channel> to continue the one used before (its calls stay in order), or up nonce channel create for a new random channel (--dry-run shows what would be saved). Never repeat an earlier action before you know it did not execute",
    details: { code: "relay_channel_not_created", profile: identity, restored: true },
  });
}

/**
 * The profile's saved channel, created when it has none: random (or `adopt`, an earlier channel of this agent
 * and profile), under the profile record's lock with a fresh strict read inside it, so concurrent first uses
 * (other processes, direct library calls) all get the single saved value. A saved channel is never replaced.
 * A profile restored from a backup gets a channel only through an explicit call (`explicit`).
 */
export async function ensureRelayChannel(home: string, identity: Address, opts: { explicit?: boolean; adopt?: bigint } = {}): Promise<RelayChannel & { created: boolean }> {
  const id = getAddress(identity);
  const file = paths.profile(home, id);
  const keep = (have: RelayChannel) => {
    if (opts.adopt !== undefined && opts.adopt !== have.channel) {
      throw new UpError("BAD_ARGS", `this profile already has the relay channel ${have.channel} in this state folder; a saved channel is never replaced`, { hint: "for one call on another channel pass --channel to that call (advanced; never to get around a pending call)" });
    }
    return { ...have, created: false };
  };
  if (opts.adopt !== undefined) assertSavableChannel(opts.adopt);
  const seen = await relayChannelState(home, id);
  if (seen.saved) return keep(seen.saved);
  return withLock(home, `profile-${id.toLowerCase()}`, async () => {
    const latest = await readProfileRecord(home, id);
    const have = savedChannelOf(latest, file);
    if (have) return keep(have);
    if (latest.imported !== undefined && !opts.explicit) throw restoredWithoutChannel(id);
    const channel = opts.adopt ?? randomChannel();
    const relayChannel = { channel: channel.toString(), createdAt: new Date().toISOString(), source: opts.adopt !== undefined ? "adopted" : "random" };
    await writeJson(file, { ...latest, address: id, relayChannel });
    return { channel, createdAt: relayChannel.createdAt, source: relayChannel.source, created: true };
  });
}

/**
 * The profile identity a chain-specific profile address belongs to: the one profile whose record links it on
 * `chainId`, else the address itself. It does not depend on who asks (--profile or the default profile), so every
 * relayed call to one address on one chain uses one saved channel, also when the address has a record of its own
 * (it relayed as itself before the link). Several linking profiles are refused, and so is any damaged record (it
 * could be the one that links it): never a guess that picks another channel.
 */
export async function profileIdentityFor(ctx: VerbContext, chainId: number, profile: Address): Promise<Address> {
  const p = getAddress(profile);
  let names: string[] = [];
  try {
    names = (await readdir(paths.profiles(ctx.home))).filter((n) => /^0x[0-9a-fA-F]{40}\.json$/.test(n));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new UpError("INTERNAL", `cannot read the profile records in ${paths.profiles(ctx.home)} (${(e as NodeJS.ErrnoException).code ?? "error"}); nothing was changed`, { hint: "fix the folder's permissions" });
  }
  const linking: Address[] = [];
  for (const n of names) {
    const id = getAddress(n.slice(0, 42));
    const linked = chainAddressesOf(await readProfileRecord(ctx.home, id))[String(chainId)];
    if (id !== p && linked === p) linking.push(id);
  }
  if (linking.length > 1) {
    throw new UpError("BAD_ARGS", `${p} is linked on chain ${chainId} by several profiles (${linking.join(", ")}); nothing was signed`, {
      hint: `an address on a chain belongs to one profile: ask the human which link is wrong and remove it (up profile link --unlink --chain ${chainId} --profile <that profile> --approval "<human's words>")`,
    });
  }
  return linking[0] ?? p;
}
