import { describe, expect, it } from "vitest";
import { getHarness, LOCAL_CHAIN_ID } from "./harness.ts";

describe("local chain harness", () => {
  it("serves JSON-RPC over HTTP and has the canonical LSP stack at mainnet addresses", async () => {
    const h = await getHarness();
    const res = await fetch(h.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    const body: any = await res.json();
    expect(Number(BigInt(body.result))).toBe(LOCAL_CHAIN_ID);
    expect(h.lsp.LSP23LinkedContractsFactory).toBe("0x2300000A84D25dF63081feAa37ba6b62C4c89a30");
    expect(h.lsp["UniversalProfileInit@0.14.0"]).toBe("0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F");
    expect(h.lsp["LSP6KeyManagerInit@0.14.0"]).toBe("0x2Fe3AeD98684E7351aD2D408A43cE09a738BF8a4");
    expect(h.lsp["LSP1UniversalReceiverDelegateUP@0.14.0"]).toBe("0x7870C5B8BC9572A8001C3f96f7ff59961B23500D");
    expect(h.lsp.UniversalProfileInitPostDeploymentModule).toBe("0x000000000066093407b6704B89793beFfD0D8F00");
    const code = await h.request("eth_getCode", [h.lsp.LSP23LinkedContractsFactory, "latest"]);
    expect(code.length).toBeGreaterThan(100);
  }, 120_000);
});
