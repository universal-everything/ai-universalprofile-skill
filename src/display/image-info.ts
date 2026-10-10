// Pure-JS image header parsing for profile pictures and background images: format,
// MIME type and pixel size from the first bytes of a PNG, JPEG, GIF or WebP file
// (no decoding, no native modules). Width/height go into the LSP3 image entries.
//
// JPEG: the size comes from the first SOFn frame header; an EXIF orientation of
// 5..8 (rotated by 90°) swaps width and height, because browsers display the image
// rotated (CSS image-orientation: from-image is the default).
// SVG is refused on purpose: it is a document that can carry scripts and external
// references, and its size is not well defined; ask for a PNG/JPEG/WebP instead.

export type ImageFormat = "png" | "jpeg" | "gif" | "webp";

export interface ImageInfo {
  format: ImageFormat;
  mimeType: string;
  /** Display size in pixels (EXIF rotation applied for JPEG). */
  width: number;
  height: number;
  /** JPEG EXIF orientation (1..8) when present. */
  orientation?: number;
  /** Animated GIF/WebP/APNG detected (informational). */
  animated?: boolean;
}

export class ImageFormatError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

export const IMAGE_MIME: Record<ImageFormat, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** Largest side accepted (pixels). Real profile images are far smaller; larger values are corrupt or hostile headers. */
export const MAX_IMAGE_SIDE = 20_000;

const SUPPORTED = "PNG, JPEG, GIF or WebP";

const ascii = (b: Uint8Array, start: number, len: number) => (start + len <= b.length ? String.fromCharCode(...b.subarray(start, start + len)) : "");
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function need(b: Uint8Array, n: number, what: string): void {
  if (b.length < n) throw new ImageFormatError(`truncated ${what} file (${b.length} bytes)`, "the file is incomplete; send the original image again");
}

function checkSize(format: ImageFormat, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new ImageFormatError(`invalid ${format.toUpperCase()} size ${width}x${height}`, "the file is corrupt; export it again as PNG or JPEG");
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) throw new ImageFormatError(`${format.toUpperCase()} size ${width}x${height} is larger than ${MAX_IMAGE_SIDE} pixels per side`, "resize the image (e.g. to at most 2000 pixels per side) and try again");
}

function png(b: Uint8Array): ImageInfo {
  need(b, 33, "PNG");
  if (ascii(b, 12, 4) !== "IHDR") throw new ImageFormatError("PNG without an IHDR header", "the file is corrupt; export it again");
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  checkSize("png", width, height);
  // APNG: an acTL chunk before the first IDAT
  let animated = false;
  for (let p = 8; p + 8 <= b.length; ) {
    const len = u32be(b, p);
    const type = ascii(b, p + 4, 4);
    if (type === "acTL") animated = true;
    if (type === "IDAT" || type === "IEND" || len > b.length) break;
    p += 12 + len;
  }
  return { format: "png", mimeType: IMAGE_MIME.png, width, height, ...(animated ? { animated } : {}) };
}

function gif(b: Uint8Array): ImageInfo {
  need(b, 10, "GIF");
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  checkSize("gif", width, height);
  // more than one image descriptor (0x2c after a graphic control extension) = animated; cheap heuristic
  let frames = 0;
  for (let i = 10; i + 1 < b.length && frames < 2; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9) frames++;
  return { format: "gif", mimeType: IMAGE_MIME.gif, width, height, ...(frames > 1 ? { animated: true } : {}) };
}

function webp(b: Uint8Array): ImageInfo {
  need(b, 16, "WebP");
  const chunk = ascii(b, 12, 4);
  // chunk-specific minimum: the size fields end at byte 30 (VP8 / VP8X) or 25 (VP8L)
  need(b, chunk === "VP8L" ? 25 : 30, "WebP");
  let width: number;
  let height: number;
  let animated = false;
  if (chunk === "VP8 ") {
    // lossy: frame tag (3 bytes) + start code 9d 01 2a, then 14-bit width/height (2 bits scale)
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) throw new ImageFormatError("WebP (VP8) without a frame start code", "the file is corrupt; export it again");
    width = u16le(b, 26) & 0x3fff;
    height = u16le(b, 28) & 0x3fff;
  } else if (chunk === "VP8L") {
    // lossless: signature 0x2f, then 14 bits (width - 1) and 14 bits (height - 1), little-endian bit order
    if (b[20] !== 0x2f) throw new ImageFormatError("WebP (VP8L) without its signature byte", "the file is corrupt; export it again");
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (chunk === "VP8X") {
    // extended: flags byte, 3 reserved, 24-bit (canvas width - 1), 24-bit (canvas height - 1)
    animated = (b[20] & 0x02) !== 0;
    width = u24le(b, 24) + 1;
    height = u24le(b, 27) + 1;
  } else throw new ImageFormatError(`unknown WebP chunk "${chunk}"`, `use a ${SUPPORTED} image`);
  checkSize("webp", width, height);
  return { format: "webp", mimeType: IMAGE_MIME.webp, width, height, ...(animated ? { animated } : {}) };
}

/** EXIF orientation (tag 0x0112 in IFD0) from an APP1 "Exif\0\0" segment body. */
function exifOrientation(b: Uint8Array, start: number, end: number): number | undefined {
  if (ascii(b, start, 6) !== "Exif\u0000\u0000") return undefined;
  const t = start + 6;
  if (t + 8 > end) return undefined;
  const order = ascii(b, t, 2);
  const le = order === "II";
  if (!le && order !== "MM") return undefined;
  const r16 = (i: number) => (le ? u16le(b, i) : u16be(b, i));
  const r32 = (i: number) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i));
  if (r16(t + 2) !== 42) return undefined;
  const ifd = t + r32(t + 4);
  if (ifd + 2 > end) return undefined;
  const n = r16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) return undefined;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : undefined;
    }
  }
  return undefined;
}

function jpeg(b: Uint8Array): ImageInfo {
  need(b, 4, "JPEG");
  let orientation: number | undefined;
  let frame: { width: number; height: number } | undefined;
  let p = 2;
  while (p < b.length) {
    // markers start with 0xFF; any number of 0xFF fill bytes may precede the marker code
    if (b[p] !== 0xff) throw new ImageFormatError(`JPEG marker expected at byte ${p}`, "the file is corrupt; export it again");
    while (p < b.length && b[p] === 0xff) p++;
    if (p >= b.length) break;
    const marker = b[p++];
    // standalone markers without a length: TEM, RSTn, SOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan: no metadata segments follow
    if (p + 2 > b.length) break;
    const len = u16be(b, p);
    if (len < 2 || p + len > b.length) throw new ImageFormatError("JPEG segment runs past the end of the file", "the file is incomplete or corrupt; export it again");
    if (marker === 0xe1 && orientation === undefined) orientation = exifOrientation(b, p + 2, p + len);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    // (the frame size is recorded and scanning continues: an APP1/EXIF segment may still follow before the scan)
    if (!frame && marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (len < 7) throw new ImageFormatError("JPEG frame header too short", "the file is corrupt; export it again");
      frame = { height: u16be(b, p + 3), width: u16be(b, p + 5) };
      checkSize("jpeg", frame.width, frame.height);
    }
    p += len;
  }
  if (!frame) throw new ImageFormatError("JPEG without a frame header (SOF)", "the file is incomplete or corrupt; export it again");
  let { width, height } = frame;
  if (orientation !== undefined && orientation >= 5) [width, height] = [height, width];
  return { format: "jpeg", mimeType: IMAGE_MIME.jpeg, width, height, ...(orientation !== undefined ? { orientation } : {}) };
}

/** Detects the format and reads the pixel size. Throws ImageFormatError (with a hint) for anything else. */
export function imageInfo(bytes: Uint8Array): ImageInfo {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return png(b);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b);
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return gif(b);
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webp(b);
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.includes("<svg")) {
    throw new ImageFormatError("SVG images are not supported", `SVG files can contain scripts and have no fixed pixel size; export the image as PNG (or JPEG/WebP) and use that file`);
  }
  if (ascii(b, 4, 4) === "ftyp") throw new ImageFormatError("HEIC/AVIF images are not supported", `convert the image to ${SUPPORTED} (e.g. export as JPEG) and try again`);
  if (ascii(b, 0, 2) === "BM") throw new ImageFormatError("BMP images are not supported", `convert the image to ${SUPPORTED} and try again`);
  if (ascii(b, 0, 4) === "II*\u0000" || ascii(b, 0, 4) === "MM\u0000*") throw new ImageFormatError("TIFF images are not supported", `convert the image to ${SUPPORTED} and try again`);
  throw new ImageFormatError("not a supported image (unknown file type)", `use a ${SUPPORTED} image`);
}
