import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { eip681Erc20Transfer, eip681Native, parseQrText, qrMatrix, qrPng, qrText } from "../../../src/display/qr.ts";
import { decodePng } from "./support/png-decode.ts";

const ADDR = "0x0F4180da178ed1C71398a57ca8Cb177F69591f1f";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

/** Samples the centre pixel of every module of a rendered QR PNG → 1 = dark. */
function modulesFromPng(png: Buffer, size: number, scale: number, margin: number): Uint8Array {
  const d = decodePng(png);
  expect(d.width).toBe((size + 2 * margin) * scale);
  const out = new Uint8Array(size * size);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      const x = (c + margin) * scale + Math.floor(scale / 2);
      const y = (r + margin) * scale + Math.floor(scale / 2);
      const v = d.rgba[(y * d.width + x) * 4];
      out[r * size + c] = v < 128 ? 1 : 0;
    }
  // quiet zone is light
  expect(d.rgba[0]).toBe(255);
  return out;
}

describe("EIP-681 URIs", () => {
  it("builds native payment requests", () => {
    expect(eip681Native(ADDR.toLowerCase(), 42)).toBe(`ethereum:${ADDR}@42`);
    expect(eip681Native(ADDR, 8453, 1_500_000_000_000_000_000n)).toBe(`ethereum:${ADDR}@8453?value=1500000000000000000`);
    expect(eip681Native(ADDR, 1, 0n)).toBe(`ethereum:${ADDR}@1`);
    expect(() => eip681Native(ADDR, 0)).toThrow(/chain id/);
    expect(() => eip681Native("0x1234", 1)).toThrow(/address/);
    expect(() => eip681Native(ADDR, 1, -1n)).toThrow(/negative/);
  });

  it("builds the ERC-20 transfer form", () => {
    expect(eip681Erc20Transfer(USDC.toLowerCase(), 1, ADDR.toLowerCase(), 25_000_000n)).toBe(`ethereum:${USDC}@1/transfer?address=${ADDR}&uint256=25000000`);
  });
});

describe("QR rendering", () => {
  for (const text of [ADDR, eip681Native(ADDR, 42, 50_000_000_000_000_000n), eip681Erc20Transfer(USDC, 8453, ADDR, 1n)]) {
    it(`PNG and UTF-8 renderings carry the same matrix as qrcode.create: ${text.slice(0, 30)}…`, () => {
      const m = qrMatrix(text);
      const ref = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
      expect(m.size).toBe(ref.size);
      const refBits = Uint8Array.from(ref.data, (v) => (v ? 1 : 0));
      expect(Buffer.from(m.modules).equals(Buffer.from(refBits))).toBe(true);
      // PNG
      const fromPng = modulesFromPng(qrPng(m, { scale: 4, margin: 4 }), m.size, 4, 4);
      expect(Buffer.from(fromPng).equals(Buffer.from(refBits))).toBe(true);
      // UTF-8 (light modules drawn filled, default) and the dark-filled variant
      const t = qrText(m);
      expect(t.split("\n")).toHaveLength(Math.ceil((m.size + 4) / 2));
      expect(Buffer.from(parseQrText(t, m.size)).equals(Buffer.from(refBits))).toBe(true);
      const t2 = qrText(m, { lightIsFilled: false, margin: 1 });
      expect(Buffer.from(parseQrText(t2, m.size, { lightIsFilled: false, margin: 1 })).equals(Buffer.from(refBits))).toBe(true);
    });
  }

  it("rejects empty input", () => {
    expect(() => qrMatrix("")).toThrow();
  });
});
