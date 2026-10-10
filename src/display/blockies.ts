// Blockies identicon — faithful TypeScript port of `ethereum-blockies-base64`
// (makeBlockie), the fork used by LUKSO:
//   https://github.com/lukso-network/ethereum-blockies-base64 @ 1290187d9c099335a06a2f867d5240a6034a6631
//   (fork of https://github.com/MyCryptoHQ/ethereum-blockies-base64, v1.0.2)
//
// Upstream license (package.json "license": "MIT"):
//   MIT License — Copyright (c) MyCrypto
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions: The above copyright
//   notice and this permission notice shall be included in all copies or
//   substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
//   WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
// hsl2rgb is adapted (as upstream) from https://stackoverflow.com/questions/2353211/hsl-to-rgb-color-conversion
//
// The PRNG, colour and grid code below keeps the upstream arithmetic verbatim
// (int32 wrap-around of the seed hash, rand() = w/2^31 — the xorshift update
// XORs each value with its own arithmetic shift, so the sign bit cancels and
// rand() stays in [0, 1) — and the "grid value != 1 → spot colour" rule),
// because any "fix" would change the identicon users already see for their address.
// Only the PNG writer differs (src/display/png.ts, deflate-compressed instead of
// pnglib's stored blocks) — the decoded pixels and palette are identical, which
// test/unit/display/blockies.test.ts checks against the upstream output.
import { encodeIndexedPng, scaleGrid, type Rgba } from "./png.ts";

/** Upstream defaults: an 8x8 grid scaled by 16 → 128x128 px. */
export const BLOCKIE_GRID = 8;
export const BLOCKIE_DEFAULT_SCALE = 16;

class Xorshift {
  // Xorshift: [x, y, z, w] 32 bit values
  private readonly randseed: number[] = new Array(4);

  constructor(seed: string) {
    for (let i = 0; i < this.randseed.length; i++) this.randseed[i] = 0;
    for (let i = 0; i < seed.length; i++) {
      this.randseed[i % 4] = (this.randseed[i % 4] << 5) - this.randseed[i % 4] + seed.charCodeAt(i);
    }
  }

  rand(): number {
    // based on Java's String.hashCode(), expanded to 4 32bit values
    const randseed = this.randseed;
    const t = randseed[0] ^ (randseed[0] << 11);
    randseed[0] = randseed[1];
    randseed[1] = randseed[2];
    randseed[2] = randseed[3];
    randseed[3] = randseed[3] ^ (randseed[3] >> 19) ^ t ^ (t >> 8);
    return (randseed[3] >>> 0) / ((1 << 31) >>> 0);
  }
}

/** [h, s, l] in upstream units (h/360, s/100, l/100). */
type Hsl = [number, number, number];

function createColor(r: Xorshift): Hsl {
  // saturation is the whole color spectrum
  const h = Math.floor(r.rand() * 360);
  // saturation goes from 40 to 100, it avoids greyish colors
  const s = r.rand() * 60 + 40;
  // lightness can be anything from 0 to 100, but probabilities are a bell curve around 50%
  const l = (r.rand() + r.rand() + r.rand() + r.rand()) * 25;
  return [h / 360, s / 100, l / 100];
}

function createImageData(r: Xorshift, size: number): number[] {
  const width = size; // Only support square icons for now
  const height = size;
  const dataWidth = Math.ceil(width / 2);
  const mirrorWidth = width - dataWidth;
  const data: number[] = [];
  for (let y = 0; y < height; y++) {
    let row: number[] = [];
    for (let x = 0; x < dataWidth; x++) {
      // this makes foreground and background color to have a 43% (1/2.3) probability
      // spot color has 13% chance
      row[x] = Math.floor(r.rand() * 2.3);
    }
    const mirrored = row.slice(0, mirrorWidth).reverse();
    row = row.concat(mirrored);
    for (let i = 0; i < row.length; i++) data.push(row[i]);
  }
  return data;
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** Upstream hsl2rgb: h, s, l in [0, 1] → [r, g, b, 255]. */
export function hsl2rgb(h: number, s: number, l: number): [number, number, number, number] {
  let r: number, g: number, b: number;
  if (s == 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255];
}

export interface Blockie {
  /** Seed actually used (lower-cased input, as upstream). */
  seed: string;
  /** 8x8 grid, row-major: 0 = background, 1 = colour, 2 = spot colour. */
  grid: number[];
  colors: { color: [number, number, number]; bgcolor: [number, number, number]; spotcolor: [number, number, number] };
}

/**
 * Computes the blockie for an address exactly like upstream `buildOpts` +
 * `createImageData`: seed = address.toLowerCase(); colours are drawn in the
 * order color, bgcolor, spotcolor, then the grid.
 */
export function blockie(address: string): Blockie {
  if (!address) throw new Error("No seed provided");
  const seed = address.toLowerCase();
  const r = new Xorshift(seed);
  const color = createColor(r);
  const bgcolor = createColor(r);
  const spotcolor = createColor(r);
  const grid = createImageData(r, BLOCKIE_GRID);
  const rgb = (c: Hsl) => hsl2rgb(...c).slice(0, 3) as [number, number, number];
  return { seed, grid, colors: { color: rgb(color), bgcolor: rgb(bgcolor), spotcolor: rgb(spotcolor) } };
}

/**
 * Palette in upstream allocation order. pnglib allocates bgcolor first (index 0,
 * also the initial value of every pixel), then color, then spotcolor, and reuses
 * an existing entry when two colours are identical.
 */
function palette(b: Blockie): { entries: Rgba[]; bg: number; fg: number; spot: number } {
  const entries: Rgba[] = [];
  const indexOf = (c: [number, number, number]) => {
    const i = entries.findIndex((e) => e[0] === c[0] && e[1] === c[1] && e[2] === c[2]);
    if (i >= 0) return i;
    entries.push([c[0], c[1], c[2], 255]);
    return entries.length - 1;
  };
  const bg = indexOf(b.colors.bgcolor);
  const fg = indexOf(b.colors.color);
  const spot = indexOf(b.colors.spotcolor);
  return { entries, bg, fg, spot };
}

/** Renders the blockie as a PNG; scale 16 reproduces upstream's 128x128 image. */
export function blockiePng(address: string, scale = BLOCKIE_DEFAULT_SCALE): Buffer {
  const b = blockie(address);
  const pal = palette(b);
  const cells = b.grid.map((v) => (v ? (v == 1 ? pal.fg : pal.spot) : pal.bg));
  const { width, height, pixels } = scaleGrid(cells, BLOCKIE_GRID, BLOCKIE_GRID, scale);
  return encodeIndexedPng({ width, height, palette: pal.entries, pixels });
}

/** `data:image/png;base64,…` like upstream makeBlockie (pixel-identical, different compression). */
export function makeBlockie(address: string): string {
  return `data:image/png;base64,${blockiePng(address).toString("base64")}`;
}

const hex = (c: [number, number, number]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

/** Text approximation for clients without images: 8 rows of 2-char cells + colour legend. */
export function blockieText(address: string): string {
  const b = blockie(address);
  const glyph = (v: number) => (v === 0 ? "  " : v === 1 ? "██" : "▒▒");
  const rows: string[] = [];
  for (let y = 0; y < BLOCKIE_GRID; y++) rows.push(b.grid.slice(y * BLOCKIE_GRID, (y + 1) * BLOCKIE_GRID).map(glyph).join(""));
  rows.push(`██ ${hex(b.colors.color)}  ▒▒ ${hex(b.colors.spotcolor)}  (blank) ${hex(b.colors.bgcolor)}`);
  return rows.join("\n");
}

export function blockieColorsHex(address: string): { color: string; bgcolor: string; spotcolor: string } {
  const b = blockie(address);
  return { color: hex(b.colors.color), bgcolor: hex(b.colors.bgcolor), spotcolor: hex(b.colors.spotcolor) };
}
