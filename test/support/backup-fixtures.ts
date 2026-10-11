// Fixtures for the backup tests: deployment manifests that were never sent to a chain, and a
// temp UP_HOME seeded with keys (in the in-memory test key store), config and profile records.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { paths } from "../../src/core/home.ts";
import { updateProfileRecord } from "../../src/core/profile-record.ts";
import type { UpConfig } from "../../src/core/types.ts";
import { ALL_PERMISSIONS_HEX } from "../../src/lsp/constants.ts";
import { manifestFromPlan, planDeployment, type DeploymentManifest } from "../../src/lsp/lsp23.ts";
import { toBytes32 } from "../../src/lsp/permissions.ts";
import { getBackend } from "../../src/signer/index.ts";
import { recordKey } from "../../src/signer/inventory.ts";
import { resetMemoryBackend } from "../../src/signer/memory.ts";

export const HUMAN_ADMIN = "0x4444444444444444444444444444444444444444" as Address;

/** A manifest as `account deploy` leaves it, with a deployment record per chain (nothing was sent anywhere). */
export function fakeManifest(o: { controller: Address; extra?: { address: Address; permissions: Hex }[]; label?: string; chainIds?: number[]; lsp3?: Hex }): DeploymentManifest {
  const salt = keccak256(toHex(o.label ?? `salt-${o.controller}`));
  const inputs = { salt, controller: o.controller, permissions: ALL_PERMISSIONS_HEX, preset: "agent-owner", extraControllers: o.extra, lsp3: o.lsp3 };
  const m = manifestFromPlan(inputs, planDeployment(inputs));
  const chainIds = o.chainIds ?? [42];
  m.chains = [...chainIds];
  m.deployments = Object.fromEntries(chainIds.map((c, i) => [String(c), { chainId: c, status: "deployed" as const, deployedAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), verified: {} }]));
  return m;
}

export interface SeedSpec {
  /** Private keys: [0] is the default key. */
  keys: Hex[];
  /** Indices into keys that are additional keys (candidates.json). */
  candidates?: number[];
  /** Indices of previous keys (config.previousControllers). */
  previous?: number[];
  /** A key used on one chain only. */
  chainKey?: { chainId: number; index: number };
  manifests?: DeploymentManifest[];
  /** Profiles joined (not created) by this agent: address → chains. */
  joined?: { address: Address; chains: number[] }[];
  defaultProfile?: Address;
  extraConfig?: Partial<UpConfig>;
}

/** Writes a complete agent state into `home` and puts the keys into the in-memory key store (fresh store first). */
export async function seedHome(spec: SeedSpec, home = mkdtempSync(join(tmpdir(), "up-backup-"))): Promise<string> {
  process.env.UP_TEST_EPHEMERAL_KEY = "1";
  resetMemoryBackend();
  const mem = getBackend("memory");
  mkdirSync(paths.keys(home), { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  const entry = (i: number) => ({ address: privateKeyToAddress(spec.keys[i]), backend: "memory", createdAt: now });
  for (const k of spec.keys) {
    await mem.importKey!(k);
    await recordKey(home, { address: privateKeyToAddress(k), backend: "memory" });
  }
  const cfg: UpConfig = {
    version: 1,
    controller: entry(0),
    ...(spec.previous?.length ? { previousControllers: spec.previous.map((i) => ({ address: privateKeyToAddress(spec.keys[i]), backend: "memory", switchedAt: now })) } : {}),
    ...(spec.chainKey ? { chainControllers: { [String(spec.chainKey.chainId)]: entry(spec.chainKey.index) } } : {}),
    ...(spec.defaultProfile ?? spec.manifests?.[0]?.profile ? { defaultProfile: (spec.defaultProfile ?? spec.manifests![0].profile) as Address } : {}),
    chains: [...new Set([...(spec.manifests ?? []).flatMap((m) => m.chains), ...(spec.joined ?? []).flatMap((j) => j.chains)])],
    ...spec.extraConfig,
  };
  writeFileSync(paths.config(home), JSON.stringify(cfg), { mode: 0o600 });
  if (spec.candidates?.length) writeFileSync(join(paths.keys(home), "candidates.json"), JSON.stringify(spec.candidates.map(entry)), { mode: 0o600 });
  process.env.UP_HOME = home;
  for (const m of spec.manifests ?? []) await updateProfileRecord(home, m.profile, () => ({ deployment: m }));
  for (const j of spec.joined ?? []) await updateProfileRecord(home, j.address, () => ({ joined: { at: now, checkedAt: now, controller: privateKeyToAddress(spec.keys[0]), chains: j.chains.map((chainId) => ({ chainId, authorised: true, deployed: true })) } }));
  return home;
}

export const newKey = (): Hex => generatePrivateKey();
export { toBytes32 };
