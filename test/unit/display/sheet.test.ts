import { describe, expect, it } from "vitest";
import { candidateSheetPng, shortAddress } from "../../../src/display/sheet.ts";
import { blockie } from "../../../src/display/blockies.ts";
import { decodePng } from "./support/png-decode.ts";

const ADDRS = ["0x0F4180da178ed1C71398a57ca8Cb177F69591f1f", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0x3333333333333333333333333333333333333333"];

function pixel(img: ReturnType<typeof decodePng>, x: number, y: number): [number, number, number] {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]];
}

describe("address choice sheet", () => {
  it("shortens addresses to first and last four hex digits", () => {
    expect(shortAddress(ADDRS[0])).toBe("0x0f41..1f1f");
  });

  it("draws one row per choice with the right identicon colours, on one white, phone-friendly image", () => {
    const img = decodePng(candidateSheetPng(ADDRS.map((address, i) => ({ label: String(i + 1), address }))));
    expect(img.height).toBe(2 * 20 + ADDRS.length * 72 + (ADDRS.length - 1) * 16);
    expect(img.width).toBeLessThan(400); // narrow enough that chat apps show it whole
    expect(pixel(img, 0, 0)).toEqual([255, 255, 255]);
    ADDRS.forEach((address, i) => {
      const b = blockie(address);
      const y0 = 20 + i * (72 + 16);
      for (let cell = 0; cell < 64; cell++) {
        const v = b.grid[cell];
        const want = v === 0 ? b.colors.bgcolor : v === 1 ? b.colors.color : b.colors.spotcolor;
        expect(pixel(img, 20 + (cell % 8) * 9 + 4, y0 + Math.floor(cell / 8) * 9 + 4)).toEqual(want);
      }
    });
  });

  it("prints dark label text next to each identicon", () => {
    const img = decodePng(candidateSheetPng([{ label: "1", address: ADDRS[0] }]));
    let dark = 0;
    for (let y = 0; y < img.height; y++) for (let x = 20 + 72; x < img.width; x++) if (pixel(img, x, y).join() === "34,34,34") dark++;
    expect(dark).toBeGreaterThan(100);
  });

  it("refuses an empty list and unknown characters", () => {
    expect(() => candidateSheetPng([])).toThrow(/no candidates/);
    expect(() => candidateSheetPng([{ label: "A?", address: ADDRS[0] }])).toThrow(/no glyph/);
  });
});
