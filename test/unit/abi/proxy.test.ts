import { describe, expect, it } from "vitest";
import { encodeKeyName } from "@erc725/erc725.js";
import { parseAbi, type Hex } from "viem";
import { dispatcherSelectors, EIP1967_SLOTS, ERC1822_SLOT, lsp17ExtensionKey, lsp17Extensions, parseErc1167, resolveProxy, slotAddress } from "../../../src/abi/proxy.ts";
import { fakeCtx, fakeRpc } from "./support/fake.ts";

const IMPL = "0x3024D38EA2434BA6635003Dc1BDC0daB5882ED4F";
const word = (a: string) => `0x000000000000000000000000${a.slice(2).toLowerCase()}` as Hex;

describe("slot decoding", () => {
  it("decodes addresses from storage words", () => {
    expect(slotAddress(word(IMPL))).toBe(IMPL);
    expect(slotAddress(`0x${"0".repeat(64)}`)).toBeUndefined();
    expect(slotAddress("0x")).toBeUndefined();
    expect(slotAddress(`0x01${"0".repeat(22)}${IMPL.slice(2)}` as Hex)).toBeUndefined(); // dirty upper bytes = not an address slot
    expect(EIP1967_SLOTS.implementation).toBe("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
  });

  it("parses ERC-1167 minimal proxies incl. short-push vanity variants", () => {
    expect(parseErc1167(`0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3`)).toBe(IMPL);
    // PUSH19 (0x72) for an implementation with one leading zero byte; jump target 0x2a
    const vanity = "0x00bbccddeeff00112233445566778899aabbccdd";
    expect(parseErc1167(`0x363d3d373d3d3d363d72${vanity.slice(4)}5af43d82803e903d91602a57fd5bf3`)?.toLowerCase()).toBe(vanity);
    expect(parseErc1167("0x6080604052")).toBeUndefined();
    expect(parseErc1167(`0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d916000fd`)).toBeUndefined();
  });

  it("builds LSP17Extension keys exactly like erc725.js", () => {
    for (const sel of ["0x150b7a02", "0xf23a6e61", "0x01ffc9a7"] as Hex[]) expect(lsp17ExtensionKey(sel)).toBe(encodeKeyName("LSP17Extension:<bytes4>", [sel]));
  });

  it("extracts dispatcher selectors and skips push data", () => {
    const code = ("0x6080604052" + "8063a9059cbb14" + "61002557" + "63095ea7b38114" + "7f" + "63aabbccdd14".padEnd(64, "0") + "00") as Hex;
    expect(dispatcherSelectors(code)).toEqual(["0xa9059cbb", "0x095ea7b3"]); // the PUSH32 payload is not scanned
  });
});

describe("resolveProxy", () => {
  it("detects EIP-1967 implementation, beacon and ERC-1822 slots", async () => {
    const P = "0x1000000000000000000000000000000000000001";
    const BEACON = "0x2000000000000000000000000000000000000002";
    const ADMIN = "0x3000000000000000000000000000000000000003";
    const rpc = fakeRpc({
      [P]: { storage: { [EIP1967_SLOTS.implementation]: word(IMPL), [EIP1967_SLOTS.admin]: word(ADMIN) } },
      "0x4000000000000000000000000000000000000004": { storage: { [EIP1967_SLOTS.beacon]: word(BEACON) } },
      [BEACON]: { abi: parseAbi(["function implementation() view returns (address)"]), handlers: { implementation: () => IMPL } },
      "0x5000000000000000000000000000000000000005": { storage: { [ERC1822_SLOT]: word(IMPL) } },
      "0x6000000000000000000000000000000000000006": {},
    });
    const ctx = fakeCtx(rpc);
    expect(await resolveProxy(ctx, 42, P)).toMatchObject({ isProxy: true, kind: "eip1967", implementation: IMPL, admin: ADMIN });
    expect(await resolveProxy(ctx, 42, "0x4000000000000000000000000000000000000004")).toMatchObject({ isProxy: true, kind: "eip1967-beacon", beacon: BEACON, implementation: IMPL });
    expect(await resolveProxy(ctx, 42, "0x5000000000000000000000000000000000000005")).toMatchObject({ isProxy: true, kind: "erc1822", implementation: IMPL });
    expect(await resolveProxy(ctx, 42, "0x6000000000000000000000000000000000000006")).toMatchObject({ isProxy: false });
  });

  it("reads LSP17 extensions (20-byte and value-forwarding 21-byte values)", async () => {
    const UP = "0x7000000000000000000000000000000000000007";
    const EXT = "0x082d49D8487d2ed2527440c7879C66d850daaBc5";
    const rpc = fakeRpc({
      [UP]: {
        interfaces: ["0x24871b3d"],
        data: {
          [lsp17ExtensionKey("0x150b7a02")]: EXT.toLowerCase() as Hex,
          [lsp17ExtensionKey("0xf23a6e61")]: `${EXT.toLowerCase()}01` as Hex,
        },
      },
    });
    const exts = await lsp17Extensions(fakeCtx(rpc), 42, UP, ["0x150b7a02", "0xf23a6e61", "0xbc197c81"]);
    expect(exts).toEqual([
      { selector: "0x150b7a02", extension: EXT, forwardsValue: false },
      { selector: "0xf23a6e61", extension: EXT, forwardsValue: true },
    ]);
  });
});
