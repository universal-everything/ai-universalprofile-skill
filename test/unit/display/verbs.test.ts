import { describe, expect, it } from "vitest";
import { statSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseAbi, stringToHex } from "viem";
import "../../../src/display/verbs.ts";
import { coerceArgs, getVerb } from "../../../src/core/verbs.ts";
import { paths } from "../../../src/core/home.ts";
import { LSP4_KEYS } from "../../../src/abi/detect.ts";
import { bundledAbi } from "../../../src/abi/bundled.ts";
import { fakeCtx, fakeRpc } from "../abi/support/fake.ts";
import { decodePng } from "./support/png-decode.ts";

const ADDR = "0x0F4180da178ed1C71398a57ca8Cb177F69591f1f";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const LSP7T = "0x3333333333333333333333333333333333333333";

const rpc = fakeRpc({
  [USDC]: {
    abi: parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function name() view returns (string)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"]),
    handlers: { decimals: () => 6, symbol: () => "USDC", name: () => "USD Coin", totalSupply: () => 10n ** 12n, balanceOf: () => 0n },
  },
  [LSP7T]: {
    interfaces: ["0xc52d6008", "0x629aa694"],
    data: { [LSP4_KEYS.TokenName.toLowerCase()]: stringToHex("Lukso Token"), [LSP4_KEYS.TokenSymbol.toLowerCase()]: stringToHex("LT") },
    abi: bundledAbi("LSP7DigitalAsset"),
    handlers: { decimals: () => 18, totalSupply: () => 0n, balanceOf: () => 0n },
  },
});

async function run(name: string, raw: Record<string, unknown>, cfg = {}) {
  const v = getVerb(name)!;
  const ctx = fakeCtx(rpc, cfg);
  return { ctx, r: await v.run(ctx, coerceArgs(v, raw)) };
}

function checkMedia(file: string) {
  if (process.platform === "win32") return;
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
  decodePng(readFileSync(file)); // valid PNG
}

describe("qr verb", () => {
  it("native funding request: plain + EIP-681 PNGs, UTF-8 QR, text with network + switch-wallet note", async () => {
    const { ctx, r } = await run("qr", { address: ADDR.toLowerCase(), chain: "42", amount: "0.05", label: "controller (gas)" });
    expect(r.media).toHaveLength(2);
    for (const m of r.media!) {
      expect(m.path.startsWith(paths.media(ctx.home))).toBe(true);
      expect(m.mimeType).toBe("image/png");
      checkMedia(m.path);
    }
    const d = r.data as any;
    expect(d.address).toBe(ADDR);
    expect(d.plain.content).toBe(ADDR);
    expect(d.eip681.content).toBe(`ethereum:${ADDR}@42?value=50000000000000000`);
    expect(d.text).toContain("controller (gas): " + ADDR);
    expect(d.text).toMatch(/Network: LUKSO \(chain id 42\) — switch your wallet to this network/);
    expect(d.text).toContain("Asset: LYX (native coin)");
    expect(d.text).toContain("Amount: 0.05 LYX (50000000000000000 wei)");
    expect(r.text).toContain("█");
    expect(r.warnings!.join(" ")).toMatch(/check the network/);
    // unique names
    expect(new Set(r.media!.map((m) => m.path)).size).toBe(2);
  });

  it("without a chain: plain address QR only, honest text", async () => {
    const { r } = await run("qr", { address: ADDR });
    expect(r.media).toHaveLength(1);
    expect((r.data as any).eip681).toEqual({ reason: "EIP-681 needs a chain id" });
    expect((r.data as any).text).toMatch(/Network: not specified/);
  });

  it("ERC-20 request uses the EIP-681 transfer form with token decimals", async () => {
    const { r } = await run("qr", { address: ADDR, chain: "8453", token: USDC, amount: "25" });
    const d = r.data as any;
    expect(d.eip681.content).toBe(`ethereum:${USDC}@8453/transfer?address=${ADDR}&uint256=25000000`);
    expect(d.text).toContain('Asset: "USDC" (ERC20');
    expect(d.text).toContain("Amount: 25 USDC (25000000 base units)");
  });

  it("LSP7 request: plain QR only, explains why there is no EIP-681 variant", async () => {
    const { r } = await run("qr", { address: ADDR, chain: "42", token: LSP7T, amount: "1" });
    expect(r.media).toHaveLength(1);
    expect((r.data as any).eip681.reason).toMatch(/LSP7 transfers cannot be expressed/);
    await expect(run("qr", { address: ADDR, chain: "42", token: LSP7T, variant: "eip681" })).rejects.toThrow(/no EIP-681 variant/);
  });

  it("never renders key material", async () => {
    await expect(run("qr", { address: `0x${"ab".repeat(32)}` })).rejects.toMatchObject({ code: "BAD_ARGS", message: expect.stringMatching(/private key/) });
    await expect(run("identicon", { address: "ab".repeat(32) })).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(run("qr", { address: "0x1234" })).rejects.toMatchObject({ code: "BAD_ARGS" });
  });
});

describe("identicon + display address", () => {
  it("identicon writes a PNG of the requested size", async () => {
    const { r } = await run("identicon", { address: ADDR, size: 64 });
    const png = decodePng(readFileSync(r.media![0].path));
    expect([png.width, png.height]).toEqual([64, 64]);
    checkMedia(r.media![0].path);
    await expect(run("identicon", { address: ADDR, size: 100 })).rejects.toThrow(/multiple of 8/);
  });

  it("display address bundles identicon + QR (+ EIP-681 with --amount) + text", async () => {
    const { r } = await run("display address", { address: ADDR, chain: "42", label: "Profile candidate #1" });
    expect(r.media!.map((m) => m.description)).toEqual([`Identicon (blockies) for ${ADDR}`, `QR code: ${ADDR} (plain address, LUKSO)`]);
    expect((r.data as any).text).toContain("Profile candidate #1: " + ADDR);
    const { r: r2 } = await run("display address", { address: ADDR, chain: "42", amount: "1" });
    expect(r2.media).toHaveLength(3);
    expect((r2.data as any).eip681.content).toBe(`ethereum:${ADDR}@42?value=1000000000000000000`);
  });
});

