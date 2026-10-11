// Which profiles of a backup may be restored (the app's anti-impersonation rules), with the network
// reads replaced: the checks that need no network come first, and no network answer (unknown chain,
// unreachable node, unreadable permissions) can turn a forged, keyless or permission-less file into a
// restorable one. Public Anvil keys only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import "../../../src/verbs/index.ts";
import { analyseAccounts, decideChain, decideProfile, openBackup, type AccountAnalysis } from "../../../src/backup/restore.ts";
import { createContext, preloadConfig } from "../../../src/core/context.ts";
import { clearSecretsForTests } from "../../../src/core/secret-guard.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import type { VerbContext } from "../../../src/core/types.ts";
import { DATA_KEYS } from "../../../src/lsp/constants.ts";
import { setBackendsForTests } from "../../../src/signer/index.ts";
import { editedDeployment, fakeManifest, seedHome } from "../../support/backup-fixtures.ts";

type Reach = { code: boolean | "throws"; permissions: bigint | "throws" };
const net = vi.hoisted(() => ({ chains: {} as Record<number, { code: boolean | "throws"; permissions: bigint | "throws" }> }));
vi.mock("../../../src/lsp/read.ts", async (original) => ({
  ...(await original<typeof import("../../../src/lsp/read.ts")>()),
  hasCode: async (_ctx: unknown, chainId: number) => {
    const c = net.chains[chainId];
    if (!c || c.code === "throws") throw new Error("node unreachable");
    return c.code;
  },
}));
vi.mock("../../../src/lsp/profile.ts", async (original) => ({
  ...(await original<typeof import("../../../src/lsp/profile.ts")>()),
  readControllerPermissions: async (_ctx: unknown, chainId: number) => {
    const c = net.chains[chainId];
    if (!c || c.permissions === "throws") throw new Error("node unreachable");
    return { permissions: { value: c.permissions } };
  },
}));

const A0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const me = privateKeyToAddress(A0);
const UNKNOWN = 999_999; // not in the registry
const KNOWN = 42;
const ctx = { registry: { chain: (id: number) => { if (id === UNKNOWN) throw new Error("unknown chain"); return { name: "known" }; } } } as unknown as VerbContext;
const saved = { home: process.env.UP_HOME, eph: process.env.UP_TEST_EPHEMERAL_KEY };
let publicFile: any;
let manifest: ReturnType<typeof fakeManifest>;

const reach = (chains: Record<number, Partial<Reach>>) => {
  net.chains = Object.fromEntries(Object.entries(chains).map(([id, c]) => [id, { code: true, permissions: 0n, ...c }]));
};
/** The analysis of the file's one profile; `held` are the keys this machine holds (a public file brings none). */
async function analyse(edit?: (f: any) => void, held: Address[] = [me]): Promise<AccountAnalysis> {
  const f = JSON.parse(JSON.stringify(publicFile));
  edit?.(f);
  const opened = await openBackup(JSON.stringify(f), undefined);
  return analyseAccounts(opened, new Set(held.map((a) => a.toLowerCase())))[0];
}
const networks = (...ids: number[]) => (f: any) => {
  f.accounts[0].networks = ids.map((chainID) => ({ chainID, name: "n", controllers: [{ address: me, type: "Device", name: "k" }] }));
};
const victimOf = (f: any) => {
  const victim = "0x" + "9a".repeat(20);
  f.accounts[0].address = victim;
  f.LSP23CrossChainDeployment[0].profileAddress = victim;
};
const verdict = async (a: AccountAnalysis, online = true) => (await decideProfile(ctx, a, online)).verdict;

beforeEach(async () => {
  manifest = fakeManifest({ controller: me, label: "decisions", chainIds: [KNOWN] });
  const home = await seedHome({ keys: [A0], manifests: [manifest] });
  process.env.UP_HOME = home;
  const c = createContext({ home, flags: { json: true, dryRun: false, yes: false, approval: undefined } });
  await preloadConfig(c);
  const v = getVerb("backup export")!;
  const r = (await v.run(c, coerceArgs(v, { mode: "public" }))) as any;
  publicFile = JSON.parse(readFileSync(r.data.path, "utf8"));
  net.chains = {};
});
afterEach(() => {
  clearSecretsForTests();
  setBackendsForTests();
  for (const [k, v] of [["UP_HOME", saved.home], ["UP_TEST_EPHEMERAL_KEY", saved.eph]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("the network confirms or revokes (the baseline)", () => {
  it("a held key with permissions on the network: restorable", async () => {
    reach({ [KNOWN]: { permissions: 1n } });
    expect(await verdict(await analyse())).toBe("restorable");
  });

  it("revoked on the network but the calldata proves the key created the profile: restorable with a warning", async () => {
    reach({ [KNOWN]: { permissions: 0n } });
    const a = await analyse();
    expect(a.proof).toBe(true);
    expect(await verdict(a)).toBe("restorable-with-warning");
  });
});

describe("no held controller key (finding 3)", () => {
  it("is decided before any network answer: unknown network, unreachable node, even a deployed profile", async () => {
    for (const chains of [[UNKNOWN], [KNOWN]]) {
      reach({ [KNOWN]: { code: "throws" } });
      const a = await analyse(networks(...chains), []);
      expect(a.heldControllers).toEqual([]);
      expect(await verdict(a)).toBe("no-controlling-key");
      expect((await decideChain(ctx, a, chains[0])).status).toBe("no-controlling-key");
    }
    reach({ [KNOWN]: { code: true, permissions: 1n } });
    expect(await verdict(await analyse(undefined, []))).toBe("no-controlling-key");
    expect(await verdict(await analyse(undefined, []), false)).toBe("no-controlling-key");
  });
});

describe("a forged deployment (finding 3)", () => {
  const forged = (...ids: number[]) => analyse((f) => (victimOf(f), networks(...ids)(f)));

  it("no fallback makes it restorable: unknown network, unreachable node, unreadable permissions", async () => {
    const onlyUnknown = await forged(UNKNOWN);
    expect(onlyUnknown.forged).toBe(true);
    expect(await verdict(onlyUnknown)).toBe("impersonation-blocked");
    reach({ [KNOWN]: { code: "throws" } });
    expect(await verdict(await forged(KNOWN))).toBe("impersonation-blocked");
    reach({ [KNOWN]: { code: true, permissions: "throws" } });
    expect(await verdict(await forged(KNOWN))).toBe("impersonation-blocked");
    reach({ [KNOWN]: { code: "throws" } });
    expect(await verdict(await forged(KNOWN, UNKNOWN))).toBe("impersonation-blocked");
  });

  it("offline, the calldata checks still decide", async () => {
    expect(await verdict(await forged(KNOWN), false)).toBe("impersonation-blocked");
  });

  it("the network can still show that a held key really controls the profile", async () => {
    reach({ [KNOWN]: { permissions: 1n } });
    expect(await verdict(await forged(KNOWN))).toBe("restorable");
  });
});

describe("an unknown network never outweighs a blocked known one", () => {
  const noDeployment = (...ids: number[]) => analyse((f) => (f.LSP23CrossChainDeployment = [], networks(...ids)(f)));

  it("known chain: no permissions and no proof; plus a chain the registry does not know: blocked", async () => {
    reach({ [KNOWN]: { permissions: 0n } });
    expect(await verdict(await noDeployment(KNOWN))).toBe("impersonation-blocked");
    expect(await verdict(await noDeployment(UNKNOWN, KNOWN))).toBe("impersonation-blocked");
    expect(await verdict(await noDeployment(KNOWN, UNKNOWN))).toBe("impersonation-blocked");
  });

  it("only unknown networks, or an unknown one next to a profile that is not deployed: the held key is trusted (unverified)", async () => {
    expect(await verdict(await noDeployment(UNKNOWN))).toBe("unverified");
    reach({ [KNOWN]: { code: false } });
    expect(await verdict(await noDeployment(UNKNOWN, KNOWN))).toBe("unverified");
  });

  it("an unreachable known chain keeps its tolerance for a held controller", async () => {
    reach({ [KNOWN]: { code: "throws" } });
    expect(await verdict(await noDeployment(KNOWN))).toBe("unverified");
    reach({ [KNOWN]: { code: true, permissions: "throws" } });
    expect(await verdict(await noDeployment(KNOWN))).toBe("unverified");
  });
});

describe("a deployment whose permissions are empty is no proof (finding 4)", () => {
  /** The file with the calldata's permission value for the held key replaced; the stated profile is the address that calldata derives to. */
  const withPermission = (value: Hex) =>
    analyse((f) => {
      const e = editedDeployment(manifest, (k, v) => {
        const i = k.findIndex((x) => x.toLowerCase() === (DATA_KEYS.AddressPermissionsPermissionsPrefix + me.slice(2)).toLowerCase());
        v[i] = value;
        return [k, v];
      });
      f.accounts[0].address = e.profile;
      f.LSP23CrossChainDeployment[0].profileAddress = e.profile;
      f.LSP23CrossChainDeployment[0].deploymentCalldata = e.calldata;
    });

  it("zero permissions: the address re-derives but nothing proves the key: revoked on the network means blocked, not restorable with a warning", async () => {
    reach({ [KNOWN]: { permissions: 0n } });
    const a = await withPermission(`0x${"00".repeat(32)}`);
    expect(a.items[0].decoded.rederives).toBe(true);
    expect(a.proof).toBe(false);
    expect(a.items[0].manifest).toBeUndefined();
    expect(await verdict(a)).toBe("impersonation-blocked");
  });

  it("an invalid permission value: the same", async () => {
    reach({ [KNOWN]: { permissions: 0n } });
    const a = await withPermission("0x01");
    expect(a.proof).toBe(false);
    expect(await verdict(a)).toBe("impersonation-blocked");
  });

  it("real permissions: proof, so restorable with a warning when revoked", async () => {
    reach({ [KNOWN]: { permissions: 0n } });
    const a = await withPermission(`0x${"00".repeat(31)}ff`);
    expect(a.proof).toBe(true);
    expect(await verdict(a)).toBe("restorable-with-warning");
  });
});

describe("held controllers are scoped per network (second review, finding 3)", () => {
  const OTHER = "0x" + "5e".repeat(20);
  /** `known`: a network that lists my key; `elsewhere`: networks that list only a controller whose key is not held. */
  const split = (known: number, ...elsewhere: number[]) =>
    analyse((f) => {
      f.accounts[0].networks = [
        { chainID: known, name: "n", controllers: [{ address: me, type: "Device", name: "k" }] },
        ...elsewhere.map((chainID) => ({ chainID, name: "n", controllers: [{ address: OTHER, type: "Device", name: "someone else" }] })),
      ];
    });

  it("a key listed only on network A makes unknown network B no candidate, with A undeployed the profile is not restorable", async () => {
    reach({ [KNOWN]: { code: false } });
    const a = await split(KNOWN, UNKNOWN);
    expect(a.heldByChain.get(KNOWN)).toEqual([me]);
    expect(a.heldByChain.get(UNKNOWN)).toEqual([]);
    expect((await decideChain(ctx, a, UNKNOWN)).status).toBe("no-controlling-key");
    expect((await decideChain(ctx, a, KNOWN)).status).toBe("not-deployed");
    const d = await decideProfile(ctx, a, true);
    expect(d.verdict).toBe("no-controlling-key");
    expect(d.restorable).toBe(false);
  });

  it("the same with the node unreachable on A: only A has a held controller, so only A is tolerated", async () => {
    reach({ [KNOWN]: { code: "throws" } });
    const a = await split(KNOWN, UNKNOWN);
    const d = await decideProfile(ctx, a, true);
    expect(d.chains.map((c) => [c.chainId, c.status])).toEqual([[KNOWN, "unverified"], [UNKNOWN, "no-controlling-key"]]);
    expect(d.verdict).toBe("unverified");
    expect(d.restorable).toBe(true); // network A is plausible and lists a held key
  });

  it("a network that lists a held key and controls wins over networks that list none", async () => {
    reach({ [KNOWN]: { permissions: 1n } });
    expect((await decideProfile(ctx, await split(KNOWN, UNKNOWN), true)).verdict).toBe("restorable");
  });

  it("the deployment data's initial controllers count for the deployment's own network only", async () => {
    const a = await analyse((f) => {
      f.accounts[0].networks = [{ chainID: UNKNOWN, name: "n", controllers: [{ address: OTHER, type: "Device", name: "x" }] }];
      f.LSP23CrossChainDeployment[0].initialChainID = KNOWN;
    });
    expect(a.heldByChain.get(UNKNOWN)).toEqual([]);
    expect(await verdict(a)).toBe("no-controlling-key");
  });

  it("offline: a network without a held controller listed for it never counts, one with it is trusted", async () => {
    const a = await split(KNOWN, UNKNOWN);
    const d = await decideProfile(ctx, a, false);
    expect(d.chains.map((c) => [c.chainId, c.status])).toEqual([[KNOWN, "unverified"], [UNKNOWN, "no-controlling-key"]]);
    expect(d.restorable).toBe(true);
    const onlyElsewhere = await analyse((f) => {
      f.accounts[0].networks = [{ chainID: KNOWN, name: "n", controllers: [{ address: OTHER, type: "Device", name: "x" }] }];
      f.LSP23CrossChainDeployment[0].initialControllers = [];
      f.LSP23CrossChainDeployment[0].initialChainID = UNKNOWN;
    });
    expect((await decideProfile(ctx, onlyElsewhere, false)).restorable).toBe(false);
  });
});

describe("only a defined permission bit proves anything or controls (second review, finding 4)", () => {
  const BIT31 = `0x${"00".repeat(28)}80000000` as Hex;
  const withPermission = (value: Hex) =>
    analyse((f) => {
      const e = editedDeployment(manifest, (k, v) => {
        const i = k.findIndex((x) => x.toLowerCase() === (DATA_KEYS.AddressPermissionsPermissionsPrefix + me.slice(2)).toLowerCase());
        v[i] = value;
        return [k, v];
      });
      f.accounts[0].address = e.profile;
      f.LSP23CrossChainDeployment[0].profileAddress = e.profile;
      f.LSP23CrossChainDeployment[0].deploymentCalldata = e.calldata;
    });

  it("a calldata whose only permission is undefined bit 31 is no proof: no rebuilt manifest, not restorable with a warning", async () => {
    reach({ [KNOWN]: { permissions: 0n } });
    const a = await withPermission(BIT31);
    expect(a.items[0].decoded.rederives).toBe(true);
    expect(a.items[0].decoded.initialControllers.find((c) => c.address === me)).toMatchObject({ permissionsValid: true, hasPermissions: false });
    expect(a.proof).toBe(false);
    expect(a.items[0].manifest).toBeUndefined();
    expect(a.items[0].reason).toMatch(/no controller in the calldata has permissions/);
    expect(await verdict(a)).toBe("impersonation-blocked");
  });

  it("bit 31 next to a defined bit still proves it (the defined bit counts)", async () => {
    reach({ [KNOWN]: { permissions: 0n } });
    const a = await withPermission(`0x${"00".repeat(28)}80000001` as Hex);
    expect(a.proof).toBe(true);
    expect(await verdict(a)).toBe("restorable-with-warning");
  });

  it("on the network a key whose only bit is undefined does not control", async () => {
    reach({ [KNOWN]: { permissions: 1n << 31n } });
    expect(await verdict(await analyse())).toBe("restorable-with-warning"); // the calldata proves it; the network does not
    reach({ [KNOWN]: { permissions: 1n << 31n } });
    expect(await verdict(await analyse((f) => (f.LSP23CrossChainDeployment = [])))).toBe("impersonation-blocked");
  });
});
