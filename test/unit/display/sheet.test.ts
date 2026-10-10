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

  it("draws every identicon with the right colours, side by side, on one white image", () => {
    const img = decodePng(candidateSheetPng(ADDRS.map((address, i) => ({ label: String(i + 1), address }))));
    expect(img.width).toBeGreaterThan(ADDRS.length * 96);
    expect(pixel(img, 0, 0)).toEqual([255, 255, 255]);
    // Column width = widest label (short address at scale 2) = (12*6-1)*2 = 142 px; gap 24; margin 24.
    ADDRS.forEach((address, i) => {
      const b = blockie(address);
      const x0 = 24 + i * (142 + 24) + Math.floor((142 - 96) / 2);
      for (let cell = 0; cell < 64; cell++) {
        const v = b.grid[cell];
        const want = v === 0 ? b.colors.bgcolor : v === 1 ? b.colors.color : b.colors.spotcolor;
        expect(pixel(img, x0 + (cell % 8) * 12 + 6, 24 + Math.floor(cell / 8) * 12 + 6)).toEqual(want);
      }
    });
  });

  it("prints dark label text under each identicon", () => {
    const img = decodePng(candidateSheetPng([{ label: "1", address: ADDRS[0] }]));
    let dark = 0;
    for (let y = 24 + 96; y < img.height; y++) for (let x = 0; x < img.width; x++) if (pixel(img, x, y).join() === "34,34,34") dark++;
    expect(dark).toBeGreaterThan(100);
  });

  it("refuses an empty list and unknown characters", () => {
    expect(() => candidateSheetPng([])).toThrow(/no candidates/);
    expect(() => candidateSheetPng([{ label: "A?", address: ADDRS[0] }])).toThrow(/no glyph/);
  });
});
