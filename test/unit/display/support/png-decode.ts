// Strict test-side PNG decoder (8-bit indexed or greyscale/RGB(A), filter 0
// only — what both our encoder and upstream pnglib produce). Verifies the
// signature, chunk CRCs (node:zlib crc32 as the independent oracle) and the
// zlib stream (inflateSync), and returns RGBA pixels.
import { crc32, inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  chunks: string[];
  palette?: [number, number, number, number][];
  rgba: Uint8Array;
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(buf: Uint8Array): DecodedPng {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error("bad PNG signature");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8;
  const chunks: string[] = [];
  let ihdr: Uint8Array | undefined;
  let plte: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (off < buf.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...buf.subarray(off + 4, off + 8));
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = view.getUint32(off + 8 + len);
    const expect = crc32(Buffer.from(buf.subarray(off + 4, off + 8 + len))) >>> 0;
    if (crc !== expect) throw new Error(`CRC mismatch in ${type}: ${crc} != ${expect}`);
    chunks.push(type);
    if (type === "IHDR") ihdr = data;
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    off += 12 + len;
    if (type === "IEND") break;
  }
  if (off !== buf.length) throw new Error("trailing bytes after IEND");
  if (!ihdr || chunks[0] !== "IHDR" || chunks[chunks.length - 1] !== "IEND") throw new Error("bad chunk order");
  const hv = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const width = hv.getUint32(0);
  const height = hv.getUint32(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0) throw new Error("unsupported compression/filter/interlace");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (!channels) throw new Error(`bad colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat.map((x) => Buffer.from(x))));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error(`inflated size ${raw.length} != ${height * (stride + 1)}`);
  let palette: [number, number, number, number][] | undefined;
  if (colorType === 3) {
    if (!plte) throw new Error("indexed PNG without PLTE");
    palette = [];
    for (let i = 0; i < plte.length / 3; i++) palette.push([plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], trns && i < trns.length ? trns[i] : 255]);
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error(`filter ${filter} not supported by the test decoder`);
    for (let x = 0; x < width; x++) {
      const p = y * (stride + 1) + 1 + x * channels;
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const c = palette![raw[p]];
        if (!c) throw new Error(`palette index ${raw[p]} out of range`);
        rgba.set(c, o);
      } else if (colorType === 0) rgba.set([raw[p], raw[p], raw[p], 255], o);
      else if (colorType === 2) rgba.set([raw[p], raw[p + 1], raw[p + 2], 255], o);
      else if (colorType === 4) rgba.set([raw[p], raw[p], raw[p], raw[p + 1]], o);
      else rgba.set([raw[p], raw[p + 1], raw[p + 2], raw[p + 3]], o);
    }
  }
  return { width, height, bitDepth, colorType, chunks, palette, rgba };
}
