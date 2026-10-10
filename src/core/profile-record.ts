// Local profile records: profiles/<address>.json, keyed by the profile's identity address.
// Several modules store their own top-level keys in the same record (deployment manifest,
// joined state, cross-chain status snapshot, per-chain addresses …), so writes merge.
//
// One Universal Profile is one account on many chains. Normally it has the same address
// everywhere (LSP23 replays the same inputs). When it exists at a different address on
// some chain (another factory or salt), that address is linked in `chainAddresses`.
import { getAddress, isAddress, type Address } from "viem";
import { paths, readJson, writeJson } from "./home.ts";
import { withLock } from "./lock.ts";

export async function readProfileRecord(home: string, profile: Address): Promise<Record<string, any>> {
  return readJson<Record<string, any>>(paths.profile(home, profile), {});
}

/**
 * The only way to change a profile record: under a per-profile cross-process lock, `fn` gets the
 * LATEST record from disk and returns the top-level keys to replace; every other key is kept.
 * A slow writer (e.g. a status snapshot computed from an older read) therefore never overwrites
 * a concurrent link, manifest or join update.
 */
export async function updateProfileRecord(home: string, profile: Address, fn: (latest: Record<string, any>) => Record<string, unknown> | Promise<Record<string, unknown>>): Promise<Record<string, any>> {
  return withLock(home, `profile-${getAddress(profile).toLowerCase()}`, async () => {
    const cur = await readProfileRecord(home, profile);
    const next = { ...cur, address: getAddress(profile), ...(await fn(cur)) };
    await writeJson(paths.profile(home, profile), next);
    return next;
  });
}

/** Replaces the given top-level keys, merged into the latest record under the lock. */
export async function writeProfileRecord(home: string, profile: Address, patch: Record<string, unknown>): Promise<void> {
  await updateProfileRecord(home, profile, () => patch);
}

/** Linked chain-specific addresses of a record (chainId → address); invalid entries are ignored. */
export function chainAddressesOf(record: Record<string, any>): Record<string, Address> {
  const out: Record<string, Address> = {};
  const raw = record?.chainAddresses;
  if (!raw || typeof raw !== "object") return out;
  for (const [id, a] of Object.entries(raw)) {
    if (/^\d+$/.test(id) && typeof a === "string" && isAddress(a, { strict: false })) out[id] = getAddress(a);
  }
  return out;
}

/** The address the profile `identity` has on `chainId`: the linked one, else the identity address itself. */
export async function profileAddressOn(home: string, identity: Address, chainId: number): Promise<Address> {
  const linked = chainAddressesOf(await readProfileRecord(home, identity))[String(chainId)];
  return linked ?? getAddress(identity);
}
