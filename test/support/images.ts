// Image fixtures generated in-test (no binary files in the repository): minimal but
// structurally valid PNG, JPEG (with optional EXIF orientation), GIF and WebP headers.
import { encodeIndexedPng } from "../../src/display/png.ts";

export function pngBytes(width: number, height: number, seed = 1): Uint8Array {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * seed) % 3;
  return new Uint8Array(encodeIndexedPng({ width, height, palette: [[255, 255, 255], [0, 0, 0], [seed % 256, 80, 160]], pixels }));
}

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function segment(marker: number, body: number[]): number[] {
  return [0xff, marker, ...be16(body.length + 2), ...body];
}

/** JPEG: SOI, APP0 (JFIF), optional APP1 EXIF orientation, DQT, DHT, SOF0 (or `sof`), SOS, EOI. */
export function jpegBytes(width: number, height: number, opts: { orientation?: number; bigEndian?: boolean; sof?: number; fill?: boolean } = {}): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  out.push(...segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (opts.orientation !== undefined) {
    const be = opts.bigEndian === true;
    const u16 = be ? be16 : le16;
    const u32 = (n: number) => (be ? [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] : le32(n));
    const tiff = [...ascii(be ? "MM" : "II"), ...u16(42), ...u32(8), ...u16(2),
      // entry 1: some other tag (ImageDescription offset, ignored), entry 2: Orientation SHORT
      ...u16(0x010e), ...u16(2), ...u32(1), ...u32(0),
      ...u16(0x0112), ...u16(3), ...u32(1), ...u16(opts.orientation), 0, 0,
      ...u32(0)];
    out.push(...segment(0xe1, [...ascii("Exif"), 0, 0, ...tiff]));
  }
  out.push(...segment(0xdb, [0, ...new Array(64).fill(1)]));
  out.push(...segment(0xc4, [0x00, ...new Array(16).fill(0)]));
  if (opts.fill) out.push(0xff, 0xff); // fill bytes before a marker are legal
  out.push(...segment(opts.sof ?? 0xc0, [8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  out.push(...segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9);
  return Uint8Array.from(out);
}

export function gifBytes(width: number, height: number, frames = 1): Uint8Array {
  const out = [...ascii("GIF89a"), ...le16(width), ...le16(height), 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  for (let i = 0; i < frames; i++) out.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, ...le16(width), ...le16(height), 0, 2, 2, 0x4c, 0x01, 0);
  out.push(0x3b);
  return Uint8Array.from(out);
}

function riff(chunk: string, body: number[]): Uint8Array {
  const payload = [...ascii("WEBP"), ...ascii(chunk), ...le32(body.length), ...body];
  return Uint8Array.from([...ascii("RIFF"), ...le32(payload.length), ...payload]);
}

export function webpLossy(width: number, height: number): Uint8Array {
  return riff("VP8 ", [0x50, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), ...new Array(16).fill(0)]);
}

export function webpLossless(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return riff("VP8L", [0x2f, ...le32(bits >>> 0), ...new Array(16).fill(0)]);
}

export function webpExtended(width: number, height: number, animated = false): Uint8Array {
  return riff("VP8X", [animated ? 0x02 : 0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1), ...new Array(16).fill(0)]);
}

export const SVG = new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
