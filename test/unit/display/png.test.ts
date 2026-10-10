import { describe, expect, it } from "vitest";
import { crc32 as zlibCrc32 } from "node:zlib";
import { crc32, encodeIndexedPng, scaleGrid } from "../../../src/display/png.ts";
import { decodePng } from "./support/png-decode.ts";

describe("PNG encoder", () => {
  it("CRC-32 matches node:zlib", () => {
    for (const s of ["", "IEND", "IHDR\x00\x00\x00\x10", "The quick brown fox"]) {
      const b = Buffer.from(s, "latin1");
      expect(crc32(b)).toBe(zlibCrc32(b) >>> 0);
    }
  });

  it("produces a valid indexed PNG that decodes to the exact pixels", () => {
    const palette = [
      [255, 255, 255],
      [0, 0, 0],
      [12, 34, 56],
    ] as const;
    const cells = [0, 1, 2, 1, 0, 2];
    const { width, height, pixels } = scaleGrid(cells, 3, 2, 4, 1, 0);
    expect([width, height]).toEqual([20, 16]);
    const png = encodeIndexedPng({ width, height, palette: palette as any, pixels });
    const d = decodePng(png);
    expect(d).toMatchObject({ width: 20, height: 16, bitDepth: 8, colorType: 3 });
    expect(d.chunks).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]); // no tRNS when all opaque
    // border pixel = palette 0, cell (row 1, col 2) = palette 2
    const px = (x: number, y: number) => Array.from(d.rgba.subarray((y * 20 + x) * 4, (y * 20 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(4 + 4, 4)).toEqual([0, 0, 0, 255]); // row 0 col 1
    expect(px(4 + 8 + 3, 4 + 4 + 3)).toEqual([12, 34, 56, 255]); // row 1 col 2, last pixel of the cell
  });

  it("writes tRNS for translucent palette entries", () => {
    const png = encodeIndexedPng({ width: 1, height: 1, palette: [[1, 2, 3, 0]], pixels: Uint8Array.from([0]) });
    const d = decodePng(png);
    expect(d.chunks).toContain("tRNS");
    expect(Array.from(d.rgba)).toEqual([1, 2, 3, 0]);
  });

  it("rejects invalid input", () => {
    expect(() => encodeIndexedPng({ width: 2, height: 1, palette: [[0, 0, 0]], pixels: Uint8Array.from([0]) })).toThrow(/expected 2/);
    expect(() => encodeIndexedPng({ width: 1, height: 1, palette: [[0, 0, 0]], pixels: Uint8Array.from([1]) })).toThrow(/palette entry 1/);
    expect(() => encodeIndexedPng({ width: 1, height: 1, palette: [[256, 0, 0]], pixels: Uint8Array.from([0]) })).toThrow(/invalid palette/);
    expect(() => scaleGrid([0], 1, 1, 0)).toThrow(/scale/);
  });
});
