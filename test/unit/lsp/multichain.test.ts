// One profile, many chains — the pure parts: next steps per chain state, text formatting,
// per-chain error isolation of the status read, and the per-chain hints added to errors.
import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { UpError } from "../../../src/core/errors.ts";
import type { RpcManager } from "../../../src/core/types.ts";
import { chainLabel, describeChainStatus, formatAmount, formatProfileStatus, nextStepsFor, onChain, readChainStatus, withChainContext, type ChainProfileStatus } from "../../../src/lsp/multichain.ts";
import { writeProfileRecord } from "../../../src/core/profile-record.ts";
import { typedDataChainId } from "../../../src/lsp/verbs-sign.ts";
import { fakeCtx, fakeRpc, tmpHome } from "../abi/support/fake.ts";

const P = getAddress("0x1111111111111111111111111111111111111111");
const K = getAddress("0x2222222222222222222222222222222222222222");
const K2 = getAddress("0x3333333333333333333333333333333333333333");
const ALL = "0x00000000000000000000000000000000000000000000000000000000007f3f7f";

function base(over: Partial<ChainProfileStatus> = {}): ChainProfileStatus {
  return { chainId: 8453, chain: "Base", chainArg: "base", nativeSymbol: "ETH", profile: P, linked: false, lspContracts: true, deployed: false, relayUsable: false, manifest: false, ready: false, nextSteps: [], ...over };
}

const ctl = (over: Partial<NonNullable<ChainProfileStatus["controller"]>> = {}): NonNullable<ChainProfileStatus["controller"]> => ({
  address: K,
  scope: "default",
  isController: true,
  permissions: ["ALL"],
  permissionsHex: ALL,
  admin: true,
  canRelay: true,
  canSign: true,
  restrictedCalls: false,
  allowedCalls: 0,
  restrictedDataKeys: false,
  allowedDataKeys: 0,
  balance: "10",
  balanceFormatted: "0.00000000000000001 ETH",
  lowGas: false,
  ...over,
});

describe("nextStepsFor: one concrete fix per chain state", () => {
  it("not deployed + manifest → replay at the same address, never fund the address before", () => {
    const s = nextStepsFor(base({ manifest: true, controller: ctl({ isController: false }) }));
    expect(s[0]).toBe("deploy your profile on Base (8453) at the same address: up account deploy --chain base --dry-run, then with the human's approval (replays the saved deployment manifest; the agent's key pays the gas)");
    expect(s[1]).toBe(`do not send assets to ${P} on Base until your profile is deployed there`);
  });

  it("not deployed + manifest + no gas → fund the agent's key on that chain first", () => {
    const s = nextStepsFor(base({ manifest: true, controller: ctl({ isController: false, lowGas: true }) }));
    expect(s[0]).toContain(`first fund the agent's key ${K} on Base for gas: up display address ${K} --chain base`);
  });

  it("not deployed, no manifest → the human deploys it (same inputs) or links the address it has there", () => {
    const s = nextStepsFor(base());
    expect(s[0]).toMatch(/^your profile is not deployed on Base \(8453\) yet and this agent has no deployment manifest to replay: ask the human to deploy it there/);
    expect(s[0]).toContain("up profile link <address> --chain base");
  });

  it("LSP contracts missing on the chain → says it cannot be deployed there", () => {
    expect(nextStepsFor(base({ lspContracts: false, manifest: true }))[0]).toMatch(/^the LSP contracts are not deployed on Base \(8453\)/);
  });

  it("deployed but not a Key-Manager-owned UP → do not treat it as the profile", () => {
    expect(nextStepsFor(base({ deployed: true, isUniversalProfile: false }))[0]).toMatch(/is not a Universal Profile owned by a Key Manager/);
  });

  it("deployed, key not a controller → ask the human to authorise THIS chain; offers another local key that already is one", () => {
    const s = nextStepsFor(base({ deployed: true, isUniversalProfile: true, keyManager: K2, controller: ctl({ isController: false, scope: "chain" }), otherLocalController: { address: K2, permissions: ["CALL"] } }));
    expect(s[0]).toBe(`ask the human to authorise this agent's key ${K} on Base (8453) (permissions are per chain; a grant on another chain does not count here): up permissions recommend --chain base prints the recommended set to hand over`);
    expect(s[1]).toBe(`or use the agent's key ${K2}, which already is a controller on Base: up key activate ${K2} --chain base (needs the human's approval)`);
  });

  it("controller without gas and without relay → funding request (and the relay alternative when a relayer exists)", () => {
    const s = nextStepsFor(base({ deployed: true, isUniversalProfile: true, keyManager: K2, controller: ctl({ lowGas: true, canRelay: false }), relayer: { name: "universal", baseUrl: "https://r.example" } }));
    expect(s[0]).toMatch(/^fund the agent's key .* on Base \(8453\) for gas/);
    expect(s[1]).toContain(`up controller edit ${K} --add EXECUTE_RELAY_CALL --chain base`);
  });

  it("ready → says how (relayer or direct)", () => {
    expect(nextStepsFor(base({ deployed: true, isUniversalProfile: true, keyManager: K2, controller: ctl() }))[0]).toBe("ready: the agent can act as your profile on Base directly (its key pays gas)");
    expect(nextStepsFor(base({ deployed: true, isUniversalProfile: true, keyManager: K2, controller: ctl({ lowGas: true }), relayUsable: true, relayer: { name: "universal", baseUrl: "x" } }))[0]).toMatch(/gaslessly through the relayer universal \(check quota: up relayer quota --chain base\)/);
  });

  it("unreachable chain → RPC fix only", () => {
    expect(nextStepsFor(base({ error: "all RPC endpoints failed for chain 8453" }))).toEqual(["could not read Base (8453) (all RPC endpoints failed for chain 8453); retry later or find a working RPC: up chains rpc find 8453"]);
  });
});

describe("describeChainStatus / formatProfileStatus: profile language", () => {
  it("one line per chain, the whole overview for the human", () => {
    const lukso = base({ chainId: 42, chain: "LUKSO", chainArg: "lukso", nativeSymbol: "LYX", deployed: true, isUniversalProfile: true, version: "0.14.0", keyManager: K2, controller: ctl({ balanceFormatted: "0.05 LYX" }), profileBalanceFormatted: "1.5 LYX", ready: true });
    lukso.nextSteps = nextStepsFor(lukso);
    const scoped = base({ deployed: true, isUniversalProfile: true, keyManager: K2, controller: ctl({ scope: "chain", permissions: ["CALL", "SETDATA"], permissionsHex: "0x0000000000000000000000000000000000000000000000000000000000040800", admin: false, canRelay: false, restrictedCalls: true, allowedCalls: 2, restrictedDataKeys: true, allowedDataKeys: 0, lowGas: true, balanceFormatted: "0 ETH" }), relayer: { name: "universal", baseUrl: "x" } });
    const missing = base({ chainId: 1, chain: "Ethereum", chainArg: "ethereum" });
    expect(describeChainStatus(lukso)).toBe(`LUKSO (42): deployed (UP 0.14.0); the agent can act with all permissions; profile balance 1.5 LYX; agent key gas 0.05 LYX`);
    expect(describeChainStatus(scoped)).toBe(`Base (8453): deployed; the agent (chain key ${K}) can act with CALL, SETDATA (calls limited to 2 AllowedCalls entries; no allowed data keys); agent key gas 0 ETH (low); relayer universal (needs EXECUTE_RELAY_CALL)`);
    expect(describeChainStatus(missing)).toBe("Ethereum (1): not deployed yet");
    expect(describeChainStatus(base({ linked: true, profile: K2 }))).toBe(`Base (8453): not deployed yet at its linked address ${K2}`);
    expect(describeChainStatus(base({ error: "boom" }))).toBe("Base (8453): could not be checked (boom)");
    const text = formatProfileStatus(P, [lukso, missing], K);
    expect(text.split("\n")[0]).toBe(`Your Universal Profile ${P} — one account on 2 chains; each chain has its own deployment, controllers, permissions and balances (agent key ${K}):`);
    expect(text).toContain(`- LUKSO (42): deployed`);
    expect(text).toContain("  → ready: the agent can act as your profile on LUKSO directly (its key pays gas)");
    expect(text).toContain("- Ethereum (1): not deployed yet");
    expect(text.endsWith("Ready on: LUKSO.")).toBe(true);
    expect(text).not.toMatch(/separate account|other account/i);
  });

  it("amounts are shown with at most 6 decimals (exact wei stays in the data)", () => {
    expect(formatAmount(9_999407891326331840n, "ETH")).toBe("9.999407 ETH");
    expect(formatAmount(10n ** 18n, "LYX")).toBe("1 LYX");
    expect(formatAmount(0n, "ETH")).toBe("0 ETH");
    expect(formatAmount(10n, "ETH")).toBe("< 0.000001 ETH");
    expect(formatAmount(1_500000000000000000n, "LYX")).toBe("1.5 LYX");
  });

  it("chain labels fall back cleanly for unknown chains", () => {
    const ctx = fakeCtx(fakeRpc({}));
    expect(chainLabel(ctx, 42)).toMatchObject({ name: "LUKSO", arg: "lukso", nativeSymbol: "LYX", lspDeployed: true });
    expect(chainLabel(ctx, 999999991)).toEqual({ chainId: 999999991, name: "chain 999999991", arg: "999999991", nativeSymbol: "native coin" });
    expect(onChain({ name: "chain 5", chainId: 5 })).toBe("chain 5");
  });
});

describe("readChainStatus: per-chain isolation", () => {
  it("one unreachable chain is reported, the other chains are still read (and the applicable key is known for every chain)", async () => {
    const ok = fakeRpc({}, { balances: { [K.toLowerCase()]: 10n ** 18n } });
    const rpc: RpcManager = {
      ...ok,
      request: async (chainId: number, method: string, params?: unknown[]) => {
        if (chainId === 8453) throw new UpError("RPC_UNAVAILABLE", "all RPC endpoints failed for chain 8453");
        return ok.request(chainId, method, params);
      },
    } as RpcManager;
    const ctx = fakeCtx(rpc, { controller: { address: K, backend: "memory", createdAt: "x" }, chainControllers: { "8453": { address: K2, backend: "memory", createdAt: "x" } } });
    const [lukso, baseChain] = await Promise.all([readChainStatus(ctx, P, 42, { manifest: true }), readChainStatus(ctx, P, 8453, { manifest: true })]);
    expect(lukso).toMatchObject({ chainId: 42, chain: "LUKSO", deployed: false, ready: false });
    expect(lukso.error).toBeUndefined();
    expect(lukso.controller).toMatchObject({ address: K, scope: "default", lowGas: false });
    expect(lukso.nextSteps[0]).toMatch(/^deploy your profile on LUKSO \(42\) at the same address: up account deploy --chain lukso/);
    expect(baseChain).toMatchObject({ chainId: 8453, chain: "Base", error: "all RPC endpoints failed for chain 8453", errorCode: "RPC_UNAVAILABLE", ready: false });
    expect(baseChain.controller).toMatchObject({ address: K2, scope: "chain" });
    expect(baseChain.nextSteps).toEqual(["could not read Base (8453) (all RPC endpoints failed for chain 8453); retry later or find a working RPC: up chains rpc find 8453"]);
  });

  it("uses the linked address on a chain where the profile lives elsewhere", async () => {
    const home = tmpHome();
    await writeProfileRecord(home, P, { chainAddresses: { "8453": K2, "1": "not-an-address" } });
    const ctx = fakeCtx(fakeRpc({}), {}, home);
    const s = await readChainStatus(ctx, P, 8453);
    expect(s).toMatchObject({ profile: K2, linked: true });
    expect((await readChainStatus(ctx, P, 1)).profile).toBe(P); // invalid entries are ignored
  });
});

describe("typedDataChainId: the chain EIP-712 typed data is bound to", () => {
  const td = (chainId: unknown) => ({ domain: { name: "x", chainId }, types: {}, primaryType: "X", message: {} }) as any;
  it("parses numbers, decimal and hex strings, bigints; absent = undefined; rejects garbage", () => {
    expect(typedDataChainId(td(8453))).toBe(8453);
    expect(typedDataChainId(td("8453"))).toBe(8453);
    expect(typedDataChainId(td("0x2105"))).toBe(8453);
    expect(typedDataChainId(td(42n))).toBe(42);
    expect(typedDataChainId(td(undefined))).toBeUndefined();
    expect(typedDataChainId({ types: {}, primaryType: "X", message: {} } as any)).toBeUndefined();
    for (const bad of ["base", 0, -1, 1.5, "0x"]) expect(() => typedDataChainId(td(bad)), String(bad)).toThrow(/chain id/);
  });
});

describe("withChainContext: per-chain hints on chain errors", () => {
  const ctx = fakeCtx(fakeRpc({}));
  const S = K as Address;
  it("NotAuthorised → grant exactly that permission on this chain; code, message and details unchanged", () => {
    const e = new UpError("SIMULATION_REVERTED", "simulation reverted: NotAuthorised", { hint: "orig", details: { errorName: "NotAuthorised", args: [S, "TRANSFERVALUE"] } });
    const w = withChainContext(ctx, e, 8453, P, S) as UpError;
    expect(w.code).toBe("SIMULATION_REVERTED");
    expect(w.message).toBe(e.message);
    expect(w.details).toBe(e.details);
    expect(w.hint).toBe(`on Base the agent's key ${S} lacks TRANSFERVALUE on your profile ${P}: ask the human to grant exactly that there (up controller edit ${S} --add TRANSFERVALUE --chain base); permissions on other chains are unaffected`);
  });
  it("NoPermissionsSet / NotAllowedCall / data keys, also inside ERC-4337 revert details", () => {
    const np = withChainContext(ctx, new UpError("SIMULATION_REVERTED", "x", { details: { errorName: "NoPermissionsSet" } }), 42, P, S) as UpError;
    expect(np.hint).toContain("up permissions recommend --chain lukso");
    const nc = withChainContext(ctx, new UpError("NOT_AUTHORISED", "x", { hint: "the signing controller …", details: { revert: { errorName: "NotAllowedCall" } } }), 42, P, S) as UpError;
    expect(nc.hint).toContain("outside the AllowedCalls");
    expect(nc.hint).toMatch(/; the signing controller …$/); // ERC-4337 explanations are kept
    const dk = withChainContext(ctx, new UpError("SIMULATION_REVERTED", "x", { details: { errorName: "NoERC725YDataKeysAllowed" } }), 42, P, S) as UpError;
    expect(dk.hint).toContain("up allowed-keys show --chain lukso");
  });
  it("insufficient gas → the funding command for this chain replaces the generic hint", () => {
    const e = new UpError("TX_FAILED", `controller ${S} has insufficient native balance on chain 42 (has 0 wei, needs up to 5 wei)`, { hint: "generic" });
    expect((withChainContext(ctx, e, 42, P, S) as UpError).hint).toBe(`ask the human to fund the agent's key ${S} on LUKSO (42) with LYX for gas: up display address ${S} --chain lukso (QR code); or use a relayer if one covers LUKSO (up relayer list)`);
  });
  it("leaves every other error untouched (ambiguous relay outcomes, preflight errors, plain errors)", () => {
    const relay = new UpError("RELAYER_ERROR", "x", { hint: "do not resend", details: { code: "relay_outcome_unknown" } });
    expect(withChainContext(ctx, relay, 42, P, S)).toBe(relay);
    const pre = new UpError("NOT_AUTHORISED", "x", { details: { errorName: "NoPermissionsSet", chain: "LUKSO" } });
    expect(withChainContext(ctx, pre, 42, P, S)).toBe(pre);
    const plain = new Error("x");
    expect(withChainContext(ctx, plain, 42, P, S)).toBe(plain);
  });
});
