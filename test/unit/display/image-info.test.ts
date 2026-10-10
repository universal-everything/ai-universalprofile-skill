import { describe, expect, it } from "vitest";
import { ImageFormatError, MAX_IMAGE_SIDE, imageInfo } from "../../../src/display/image-info.ts";
import { SVG, gifBytes, jpegBytes, pngBytes, webpExtended, webpLossless, webpLossy } from "../../support/images.ts";

const err = (b: Uint8Array) => {
  try {
    imageInfo(b);
  } catch (e) {
    return e as ImageFormatError;
  }
  throw new Error("expected an ImageFormatError");
};

describe("image header parsing (pure JS)", () => {
  it("PNG: IHDR width/height and MIME type", () => {
    expect(imageInfo(pngBytes(37, 21))).toEqual({ format: "png", mimeType: "image/png", width: 37, height: 21 });
    expect(imageInfo(pngBytes(1, 1)).width).toBe(1);
  });

  it("JPEG: first SOF frame header; DHT (C4) is not mistaken for a frame; fill bytes and progressive SOF2", () => {
    expect(imageInfo(jpegBytes(640, 480))).toEqual({ format: "jpeg", mimeType: "image/jpeg", width: 640, height: 480 });
    expect(imageInfo(jpegBytes(1200, 800, { sof: 0xc2, fill: true }))).toMatchObject({ width: 1200, height: 800 });
  });

  it("JPEG: EXIF orientation 5..8 swaps width and height (displayed size), 1..4 does not; both byte orders", () => {
    expect(imageInfo(jpegBytes(400, 300, { orientation: 1 }))).toMatchObject({ width: 400, height: 300, orientation: 1 });
    expect(imageInfo(jpegBytes(400, 300, { orientation: 3 }))).toMatchObject({ width: 400, height: 300, orientation: 3 });
    expect(imageInfo(jpegBytes(400, 300, { orientation: 6 }))).toMatchObject({ width: 300, height: 400, orientation: 6 });
    expect(imageInfo(jpegBytes(400, 300, { orientation: 8, bigEndian: true }))).toMatchObject({ width: 300, height: 400, orientation: 8 });
  });

  it("JPEG: an EXIF segment AFTER the frame header (before the scan) still rotates the size (4x3 stored, 3x4 displayed)", () => {
    expect(imageInfo(jpegBytes(400, 300, { orientation: 6, exifAfterSof: true }))).toMatchObject({ width: 300, height: 400, orientation: 6 });
    expect(imageInfo(jpegBytes(400, 300, { orientation: 1, exifAfterSof: true }))).toMatchObject({ width: 400, height: 300 });
  });

  it("GIF: logical screen size; animation detected", () => {
    expect(imageInfo(gifBytes(320, 200))).toEqual({ format: "gif", mimeType: "image/gif", width: 320, height: 200 });
    expect(imageInfo(gifBytes(16, 16, 3)).animated).toBe(true);
  });

  it("WebP: lossy (VP8), lossless (VP8L) and extended (VP8X, animated flag)", () => {
    expect(imageInfo(webpLossy(1024, 768))).toEqual({ format: "webp", mimeType: "image/webp", width: 1024, height: 768 });
    expect(imageInfo(webpLossless(500, 333))).toMatchObject({ format: "webp", width: 500, height: 333 });
    expect(imageInfo(webpLossless(16384, 1))).toMatchObject({ width: 16384, height: 1 });
    // a valid minimal lossless file is only 28 bytes: chunk-specific minimum, not a blanket 30
    const tiny = webpLossless(1, 1, 3);
    expect(tiny.length).toBe(28);
    expect(imageInfo(tiny)).toMatchObject({ format: "webp", width: 1, height: 1 });
    expect(() => imageInfo(webpLossless(1, 1, 0).subarray(0, 24))).toThrow(/truncated/);
    expect(imageInfo(webpExtended(1920, 1080))).toMatchObject({ width: 1920, height: 1080 });
    expect(imageInfo(webpExtended(64, 64, true)).animated).toBe(true);
  });

  it("refuses SVG with a hint to export PNG (scripts, no fixed pixel size)", () => {
    const e = err(SVG);
    expect(e.message).toMatch(/SVG/);
    expect(e.hint).toMatch(/PNG/);
    expect(err(new TextEncoder().encode("<svg viewBox='0 0 10 10'></svg>")).message).toMatch(/SVG/);
  });

  it("refuses HEIC/AVIF, BMP, TIFF and unknown data with a conversion hint", () => {
    expect(err(Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0])).message).toMatch(/HEIC\/AVIF/);
    expect(err(Uint8Array.from([...Buffer.from("BM"), 0, 0, 0, 0])).message).toMatch(/BMP/);
    expect(err(Uint8Array.from([...Buffer.from("II*"), 0, 8, 0, 0, 0])).message).toMatch(/TIFF/);
    expect(err(new TextEncoder().encode("hello world")).hint).toMatch(/PNG, JPEG, GIF or WebP/);
    expect(err(new Uint8Array(0)).message).toMatch(/unknown file type/);
  });

  it("rejects truncated, zero-size and absurd headers", () => {
    expect(err(pngBytes(10, 10).subarray(0, 20)).message).toMatch(/truncated/);
    const zero = pngBytes(10, 10);
    zero.set([0, 0, 0, 0], 16);
    expect(err(zero).message).toMatch(/invalid PNG size/);
    const huge = pngBytes(10, 10);
    new DataView(huge.buffer).setUint32(16, MAX_IMAGE_SIDE + 1);
    expect(err(huge).message).toMatch(/larger than/);
    const j = jpegBytes(100, 100);
    expect(err(j.subarray(0, 30)).message).toMatch(/JPEG/);
    expect(err(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])).message).toMatch(/without a frame header/);
    const badVp8 = webpLossy(10, 10);
    badVp8[23] = 0;
    expect(err(badVp8).message).toMatch(/start code/);
  });
});
