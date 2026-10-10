// Tiny PNG encoder (no dependencies besides node:zlib): 8-bit indexed-colour
// images with an optional per-entry alpha (tRNS). Used for identicons and QR
// codes; generated at runtime so the skill ships no binary assets.
//
// Layout (PNG spec, ISO/IEC 15948): signature, IHDR, PLTE, [tRNS], IDAT, IEND.
// Every scanline uses filter type 0 (None); the image data is zlib-deflated.
import { deflateSync } from "node:zlib";

export type Rgba = readonly [r: number, g: number, b: number, a?: number];

export interface IndexedImage {
  width: number;
  height: number;
  /** Palette entries (max 256). Alpha defaults to 255. */
  palette: readonly Rgba[];
  /** width*height palette indices, row-major. */
  pixels: Uint8Array;
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable: Uint32Array | undefined;

/** CRC-32 (ISO 3309 / ITU-T V.42, polynomial 0xEDB88320) as used by PNG chunks. */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Encodes an indexed-colour image as PNG bytes. */
export function encodeIndexedPng(img: IndexedImage): Buffer {
  const { width, height, palette, pixels } = img;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`invalid PNG size ${width}x${height}`);
  if (palette.length < 1 || palette.length > 256) throw new Error(`palette must have 1..256 entries (got ${palette.length})`);
  if (pixels.length !== width * height) throw new Error(`pixel buffer has ${pixels.length} entries, expected ${width * height}`);

  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method 0
  ihdr[12] = 0; // no interlace

  const plte = new Uint8Array(palette.length * 3);
  const trns = new Uint8Array(palette.length);
  let anyAlpha = false;
  palette.forEach((c, i) => {
    for (const v of [c[0], c[1], c[2], c[3] ?? 255]) if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`invalid palette entry ${i}: ${c.join(",")}`);
    plte[i * 3] = c[0];
    plte[i * 3 + 1] = c[1];
    plte[i * 3 + 2] = c[2];
    trns[i] = c[3] ?? 255;
    if (trns[i] !== 255) anyAlpha = true;
  });

  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const idx = pixels[y * width + x];
      if (idx >= palette.length) throw new Error(`pixel (${x},${y}) references palette entry ${idx} of ${palette.length}`);
      raw[y * (width + 1) + 1 + x] = idx;
    }
  }
  const idat = deflateSync(raw, { level: 9 });

  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("PLTE", plte), ...(anyAlpha ? [chunk("tRNS", trns)] : []), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  return Buffer.concat(parts);
}

/** Scales a cell grid (row-major palette indices) by an integer factor with an optional quiet border (in cells). */
export function scaleGrid(cells: ArrayLike<number>, cols: number, rows: number, scale: number, border = 0, borderIndex = 0): { width: number; height: number; pixels: Uint8Array } {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`scale must be a positive integer (got ${scale})`);
  const width = (cols + 2 * border) * scale;
  const height = (rows + 2 * border) * scale;
  const pixels = new Uint8Array(width * height).fill(borderIndex);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = cells[r * cols + c];
      const y0 = (r + border) * scale;
      const x0 = (c + border) * scale;
      for (let dy = 0; dy < scale; dy++) pixels.fill(v, (y0 + dy) * width + x0, (y0 + dy) * width + x0 + scale);
    }
  }
  return { width, height, pixels };
}
