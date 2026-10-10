import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAbi, type Hex } from "viem";
import { createRegistry } from "../../../src/chain/registry.ts";
import { discoverAbi, explorerPlan, isSignableTrust, mergeAbis } from "../../../src/abi/discovery.ts";
import { EIP1967_SLOTS, lsp17ExtensionKey } from "../../../src/abi/proxy.ts";
import { fakeCtx, fakeRpc, mockFetch, tmpHome, type Route } from "./support/fake.ts";
import { LSP26_RUNTIME } from "../social/support/lsp26-runtime.ts";

const registry = createRegistry(tmpHome());
const chain = (id: number) => registry.chain(id);

const TARGET = "0x1111111111111111111111111111111111111111";
const IMPL = "0x2222222222222222222222222222222222222222";
// dispatcher with transfer(address,uint256) (bundled) and 0xdeadbeef (unknown)
const CODE = ("0x6080604052600436106100205760003560e01c" + "8063a9059cbb14" + "61002557" + "8063deadbeef14" + "61003057" + "5b600080fd5b00") as Hex;
const VERIFIED_ABI = parseAbi(["function hello(uint256 x) view returns (uint256)", "function poke(address who)"]);

beforeEach(() => {
  process.env.UP_HTTP_BACKOFF_MS = "1";
});
afterEach(() => {
  delete process.env.UP_HTTP_BACKOFF_MS;
});

describe("per-chain explorer plan (from the registry, never hard-coded)", () => {
  it("LUKSO 42: Blockscout only (Sourcify does not support LUKSO)", () => {
    const p = explorerPlan(chain(42), {});
    expect(p.sources.map((s) => s.label)).toEqual(["blockscout:explorer.execution.mainnet.lukso.network"]);
    expect(p.sources[0].url).toBe("https://explorer.execution.mainnet.lukso.network/api/v2/smart-contracts/{address}");
    expect(p.skipped.map((s) => s.kind)).toContain("sourcify");
  });

  it("Base 8453: Sourcify → Blockscout; Etherscan V2 only with a key, which never appears in the URL template", () => {
    const noKey = explorerPlan(chain(8453), {});
    expect(noKey.sources.map((s) => s.kind)).toEqual(["sourcify", "blockscout"]);
    expect(noKey.skipped).toContainEqual({ kind: "etherscan", reason: expect.stringMatching(/no Etherscan API key/) });
    const withKey = explorerPlan(chain(8453), { explorerKeys: { etherscan: "SECRETKEY" } });
    expect(withKey.sources.map((s) => s.kind)).toEqual(["sourcify", "blockscout", "etherscan"]);
    const es = withKey.sources[2];
    expect(es.url).toBe("https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getabi&address={address}");
    expect(JSON.stringify(withKey)).not.toContain("SECRETKEY");
  });

  it("Robinhood 4663: Sourcify-supported chain with a Blockscout explorer", () => {
    expect(explorerPlan(chain(4663), {}).sources.map((s) => s.kind)).toEqual(["sourcify", "blockscout"]);
  });

  it("Avalanche 43114: Routescan where listed", () => {
    const p = explorerPlan(chain(43114), {});
    expect(p.sources.map((s) => s.kind)).toEqual(["sourcify", "routescan"]);
    expect(p.sources[1].url).toContain("/v2/network/mainnet/evm/43114/etherscan/api");
  });

  it("0G 16661: only an 'other' explorer and no Sourcify → no rung-2/3 source", () => {
    const p = explorerPlan(chain(16661), {});
    expect(p.sources).toEqual([]);
    expect(p.skipped.map((s) => s.reason).join(" ")).toMatch(/no Sourcify support and no Blockscout/);
  });
});

function setup(chainId: number, contracts: Parameters<typeof fakeRpc>[0], routes: Route[], cfg = {}) {
  const rpc = fakeRpc(contracts);
  const m = mockFetch(routes);
  const ctx = fakeCtx(rpc, { defaultChain: chainId, ...cfg });
  return { rpc, m, ctx, discover: (addr: string, o = {}) => discoverAbi(ctx, chainId, addr as any, { fetch: m.fetch, ...o }) };
}

const blockscoutVerified = (exact = true): Route => [/\/api\/v2\/smart-contracts\//, () => ({ status: 200, body: { is_verified: true, is_fully_verified: exact, name: "Hello", abi: VERIFIED_ABI, implementations: [] } })];
const sourcify404: Route = [/sourcify\.dev\/server\/v2\/contract/, (url) => ({ status: 404, body: { match: null, chainId: "x", address: url } })];
const fourbyteEmpty: Route = [/4byte\.sourcify\.dev/, () => ({ status: 200, body: { ok: true, result: { function: {}, event: {} } } })];

describe("trust ladder", () => {
  it("LUKSO: keyless Blockscout v2 gives an exact ABI", async () => {
    const t = setup(42, { [TARGET]: { code: CODE } }, [blockscoutVerified(true)]);
    const rec = await t.discover(TARGET);
    expect(rec).toMatchObject({ trust: "exact", source: "blockscout:explorer.execution.mainnet.lukso.network", name: "Hello" });
    expect(rec.abi.map((x: any) => x.name)).toEqual(["hello", "poke"]);
    expect(t.m.requests.map((r) => r.url)).toEqual([`https://explorer.execution.mainnet.lukso.network/api/v2/smart-contracts/${TARGET}`]);
    expect(rec.attempts.find((a) => a.source === "sourcify")?.outcome).toMatch(/skipped/);
    expect(isSignableTrust(rec.trust)).toBe(true);
  });

  it("Base without key: Sourcify 404 → Blockscout unverified → (Etherscan skipped) → selector guesses", async () => {
    const t = setup(8453, { [TARGET]: { code: CODE } }, [sourcify404, [/base\.blockscout\.com/, () => ({ status: 200, body: { implementations: [], proxy_type: null } })], fourbyteEmpty]);
    const rec = await t.discover(TARGET);
    expect(rec.trust).toBe("guessed");
    expect(rec.source).toBe("selector-db");
    expect(rec.abi.map((x: any) => x.name)).toEqual(["transfer"]); // bundled-known selector named, 0xdeadbeef unknown
    expect(rec.guesses?.["0xdeadbeef"]).toEqual([]);
    const hosts = t.m.requests.map((r) => new URL(r.url).host);
    expect(hosts).toEqual(["sourcify.dev", "base.blockscout.com", "api.4byte.sourcify.dev"]);
    expect(hosts).not.toContain("api.etherscan.io");
    expect(rec.attempts.map((a) => a.rung)).toContain(5);
    expect(isSignableTrust(rec.trust)).toBe(false);
  });

  it("Base with an Etherscan key: Etherscan V2 multichain getabi → partial; the key is never stored", async () => {
    const t = setup(
      8453,
      { [TARGET]: { code: CODE } },
      [sourcify404, [/base\.blockscout\.com/, () => ({ status: 404, body: { message: "Not found" } })], [/api\.etherscan\.io/, () => ({ status: 200, body: { status: "1", message: "OK", result: JSON.stringify(VERIFIED_ABI) } })]],
      { explorerKeys: { etherscan: "SECRETKEY" } },
    );
    const rec = await t.discover(TARGET);
    expect(rec).toMatchObject({ trust: "partial", source: "etherscan-v2" });
    const es = t.m.requests.find((r) => r.url.includes("etherscan"))!;
    expect(es.url).toContain("chainid=8453");
    expect(es.url).toContain("apikey=SECRETKEY");
    expect(JSON.stringify(rec)).not.toContain("SECRETKEY");
  });

  it("Ethereum: Sourcify exact_match wins and later sources are not queried", async () => {
    const t = setup(1, { [TARGET]: { code: CODE } }, [[/sourcify\.dev\/server/, () => ({ status: 200, body: { match: "exact_match", abi: VERIFIED_ABI, proxyResolution: { isProxy: false, implementations: [] } } })]]);
    const rec = await t.discover(TARGET);
    expect(rec).toMatchObject({ trust: "exact", source: "sourcify" });
    expect(t.m.requests).toHaveLength(1);
    expect(t.m.requests[0].url).toBe(`https://sourcify.dev/server/v2/contract/1/${TARGET}?fields=abi,proxyResolution`);
  });

  it("Sourcify unsupported_chain → next family (Blockscout partial match)", async () => {
    const t = setup(8453, { [TARGET]: { code: CODE } }, [[/sourcify\.dev\/server/, () => ({ status: 400, body: { customCode: "unsupported_chain", message: "Chain not found" } })], blockscoutVerified(false)]);
    const rec = await t.discover(TARGET);
    expect(rec.trust).toBe("partial");
    expect(rec.attempts.find((a) => a.source === "sourcify")?.outcome).toMatch(/unsupported/);
  });

  it("chain with only an 'other' explorer: no explorer calls, straight to selector guesses", async () => {
    const t = setup(16661, { [TARGET]: { code: CODE } }, [fourbyteEmpty]);
    const rec = await t.discover(TARGET);
    expect(rec.trust).toBe("guessed");
    expect(t.m.requests.map((r) => new URL(r.url).host)).toEqual(["api.4byte.sourcify.dev"]);
    const off = setup(16661, { [TARGET]: { code: CODE } }, []);
    const rec2 = await off.discover(TARGET, { offline: true });
    expect(rec2.trust).toBe("guessed");
    expect(off.m.requests).toHaveLength(0);
  });

  it("backs off on HTTP 429 and retries", async () => {
    let n = 0;
    const t = setup(42, { [TARGET]: { code: CODE } }, [[/smart-contracts/, () => (n++ === 0 ? { status: 429, headers: { "retry-after": "0" } } : { status: 200, body: { is_verified: true, is_fully_verified: true, abi: VERIFIED_ABI } })]]);
    const rec = await t.discover(TARGET);
    expect(rec.trust).toBe("exact");
    expect(t.m.requests).toHaveLength(2);
  });

  it("canonical registry addresses are rung 1 (bundled) without any HTTP request", async () => {
    const t = setup(42, { "0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA": { code: LSP26_RUNTIME } }, []);
    const rec = await t.discover("0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA");
    expect(rec).toMatchObject({ trust: "bundled", source: "bundled:LSP26FollowerSystem" });
    expect(rec.notes[0]).toMatch(/code hash matches/);
    expect(t.m.requests).toHaveLength(0);
  });

  it("unexpected code at a canonical address with pinned code hashes is NOT treated as bundled", async () => {
    const t = setup(42, { "0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA": { code: CODE } }, [blockscoutVerified(true)]);
    const rec = await t.discover("0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA");
    expect(rec.trust).toBe("exact"); // fell through to the explorer
    expect(rec.notes.join(" ")).toMatch(/does not match its known deployments/);
  });

  it("ERC-1167 clones of a canonical implementation are bundled (UP clone)", async () => {
    const clone = `0x363d3d373d3d3d363d733024d38ea2434ba6635003dc1bdc0dab5882ed4f5af43d82803e903d91602b57fd5bf3` as Hex;
    const t = setup(42, { [TARGET]: { code: clone, interfaces: ["0x24871b3d", "0x629aa694", "0x6bb56a14"], data: {} }, "0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F": { code: "0x6001" } }, []);
    const rec = await t.discover(TARGET);
    expect(rec.trust).toBe("bundled");
    expect(rec.name).toMatch(/UniversalProfileInit@0\.14\.0 \(ERC-1167 clone\)/);
    expect(rec.proxy).toMatchObject({ isProxy: true, kind: "erc1167", implementation: "0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F" });
    expect(rec.standards).toContain("LSP0");
    expect(rec.abi.some((x: any) => x.name === "execute")).toBe(true);
    expect(t.m.requests).toHaveLength(0);
    // a clone whose implementation has no code on this chain is not "bundled"
    const orphan = setup(42, { [TARGET]: { code: clone, interfaces: ["0x24871b3d", "0x629aa694"], data: {} } }, []);
    const r2 = await orphan.discover(TARGET, { offline: true });
    expect(r2.trust).not.toBe("bundled");
    expect(r2.notes.join(" ")).toMatch(/implementation has no code/);
  });

  it("ERC-165 detection gives the standard ABI with trust onchain (offline)", async () => {
    const t = setup(16661, { [TARGET]: { code: CODE, interfaces: ["0xc52d6008", "0x629aa694"], data: {} } }, []);
    const rec = await t.discover(TARGET, { offline: true });
    expect(rec).toMatchObject({ trust: "onchain", source: "erc165:LSP7" });
    expect(rec.abi.some((x: any) => x.name === "authorizeOperator")).toBe(true);
  });

  it("EIP-1967 proxies merge the implementation ABI (trust proxy)", async () => {
    const slot = `0x000000000000000000000000${IMPL.slice(2)}` as Hex;
    const t = setup(
      42,
      { [TARGET]: { code: CODE, storage: { [EIP1967_SLOTS.implementation]: slot } }, [IMPL]: { code: "0x60016002" } },
      [[/smart-contracts\/0x2222/, () => ({ status: 200, body: { is_verified: true, is_fully_verified: true, abi: VERIFIED_ABI, name: "Impl" } })], [/smart-contracts\/0x1111/, () => ({ status: 200, body: { is_verified: true, is_fully_verified: true, abi: parseAbi(["function upgradeTo(address)"]), implementations: [{ address_hash: IMPL }] } })]],
    );
    const rec = await t.discover(TARGET);
    expect(rec.trust).toBe("proxy");
    expect(rec.proxy).toMatchObject({ isProxy: true, kind: "eip1967", implementation: IMPL, implementationTrust: "exact" });
    expect(rec.abi.map((x: any) => x.name).sort()).toEqual(["hello", "poke", "upgradeTo"]);
    expect(isSignableTrust(rec.trust)).toBe(true);
  });

  it("caches with code hash and reuses the entry", async () => {
    const t = setup(42, { [TARGET]: { code: CODE } }, [blockscoutVerified(true)]);
    await t.discover(TARGET);
    const again = await t.discover(TARGET);
    expect(again.cached).toBe(true);
    expect(t.m.requests).toHaveLength(1);
    const refreshed = await t.discover(TARGET, { refresh: true });
    expect(refreshed.cached).toBeUndefined();
    expect(t.m.requests).toHaveLength(2);
  });

  it("refuses EOAs with ABI_NOT_FOUND", async () => {
    const t = setup(42, {}, []);
    await expect(t.discover(TARGET)).rejects.toMatchObject({ code: "ABI_NOT_FOUND" });
  });

  it("LSP17 extensions: verified extension ABIs are merged, selector guesses are only listed", async () => {
    const clone = `0x363d3d373d3d3d363d733024d38ea2434ba6635003dc1bdc0dab5882ed4f5af43d82803e903d91602b57fd5bf3` as Hex;
    const CALLBACKS = "0x082d49D8487d2ed2527440c7879C66d850daaBc5";
    const ODD = "0x4444444444444444444444444444444444444444";
    const t = setup(
      42,
      {
        [TARGET]: {
          code: clone,
          interfaces: ["0x24871b3d", "0x629aa694"],
          data: { [lsp17ExtensionKey("0x150b7a02")]: CALLBACKS.toLowerCase() as Hex, [lsp17ExtensionKey("0xf23a6e61")]: ODD as Hex },
        },
        "0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F": { code: "0x6001" },
        [CALLBACKS]: { code: "0x6001" },
      },
      [],
    );
    const rec = await t.discover(TARGET, { offline: true });
    expect(rec.trust).toBe("bundled");
    const byS = Object.fromEntries(rec.extensions!.map((e) => [e.selector, e]));
    expect(byS["0x150b7a02"]).toMatchObject({ extension: CALLBACKS, source: expect.stringMatching(/^bundled:ERCTokenCallbacks/) });
    expect(byS["0x150b7a02"].unverified).toBeUndefined();
    expect(byS["0xf23a6e61"]).toMatchObject({ extension: ODD, unverified: true });
    const names = rec.abi.filter((x: any) => x.type === "function").map((x: any) => x.name);
    expect(names).toContain("onERC721Received");
    expect(names).not.toContain("onERC1155Received"); // a guess must not inherit the bundled label
  });

  it("explorer-only proxy hints are labelled remote-unpinned (delegation not verified on-chain)", async () => {
    const t = setup(
      42,
      { [TARGET]: { code: CODE }, [IMPL]: { code: "0x60016002" } },
      [
        [/smart-contracts\/0x2222/, () => ({ status: 200, body: { is_verified: true, is_fully_verified: true, abi: VERIFIED_ABI } })],
        [/smart-contracts\/0x1111/, () => ({ status: 200, body: { implementations: [{ address_hash: IMPL }] } })],
      ],
    );
    const rec = await t.discover(TARGET);
    expect(rec.proxy).toMatchObject({ kind: "explorer", implementation: IMPL });
    expect(rec.trust).toBe("remote-unpinned");
    expect(isSignableTrust(rec.trust)).toBe(false);
  });

  it("protocols.json addresses are bundled only on chains the registry lists (or with a pinned code hash)", async () => {
    const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const listed = setup(8453, { [PERMIT2]: { code: CODE } }, []);
    expect((await listed.discover(PERMIT2, { offline: true })).trust).toBe("bundled");
    const unlisted = setup(16661, { [PERMIT2]: { code: CODE } }, []);
    const rec = await unlisted.discover(PERMIT2, { offline: true });
    expect(rec.trust).not.toBe("bundled");
    expect(rec.notes.join(" ")).toMatch(/not recorded on chain 16661/);
  });

  it("mergeAbis deduplicates by signature", () => {
    const a = parseAbi(["function f(uint256)", "event E(address)"]);
    const b = parseAbi(["function f(uint256)", "function g()", "constructor()"]);
    expect(mergeAbis(a, b).map((x: any) => `${x.type}:${x.name ?? ""}`)).toEqual(["function:f", "event:E", "function:g"]);
  });
});
