// One picture for choosing a profile address: every candidate's identicon side by side, with
// its choice number and short address printed underneath. Sending one labelled image instead
// of several unlabelled ones means the human never has to guess which picture is which.
import { BLOCKIE_GRID, blockie } from "./blockies.ts";
import { encodeIndexedPng, type Rgba } from "./png.ts";

/** 5x7 bitmap glyphs for the characters a choice label needs. */
const FONT: Record<string, string[]> = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  c: [".....", ".....", ".###.", "#....", "#....", "#...#", ".###."],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  f: ["..##.", ".#...", "####.", ".#...", ".#...", ".#...", ".#..."],
  x: [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

/** "0x1a2b..9f0e": first and last four hex digits, the way people compare addresses. */
export function shortAddress(address: string): string {
  const a = address.toLowerCase();
  return `${a.slice(0, 6)}..${a.slice(-4)}`;
}

/** Width in pixels of `text` drawn at `scale` (one blank column between glyphs). */
function textWidth(text: string, scale: number): number {
  return text.length ? (text.length * (GLYPH_W + 1) - 1) * scale : 0;
}

export interface SheetItem {
  /** Printed large under the identicon, e.g. "1". */
  label: string;
  address: string;
}

const IDENTICON_SCALE = 9; // 8 cells -> 72 px
const NUMBER_SCALE = 4;
const ADDRESS_SCALE = 2;
const MARGIN = 20;
const ROW_GAP = 16;
const COL_GAP = 20;

/**
 * Renders the labelled identicons as one PNG (white background, dark text): one row per choice,
 * "[identicon]  n  0x1a2b..9f0e". Rows, not one wide strip, because chat apps on phones crop or
 * shrink wide images and the human must always see every number.
 */
export function candidateSheetPng(items: SheetItem[]): Buffer {
  if (!items.length) throw new Error("no candidates to draw");
  const iconSize = BLOCKIE_GRID * IDENTICON_SCALE;
  const numberW = Math.max(...items.map((it) => textWidth(it.label, NUMBER_SCALE)));
  const addressW = Math.max(...items.map((it) => textWidth(shortAddress(it.address), ADDRESS_SCALE)));
  const width = 2 * MARGIN + iconSize + COL_GAP + numberW + COL_GAP + addressW;
  const height = 2 * MARGIN + items.length * iconSize + (items.length - 1) * ROW_GAP;

  const palette: Rgba[] = [[255, 255, 255, 255], [34, 34, 34, 255]];
  const colour = (c: [number, number, number]) => {
    const i = palette.findIndex((p) => p[0] === c[0] && p[1] === c[1] && p[2] === c[2]);
    if (i >= 0) return i;
    palette.push([c[0], c[1], c[2], 255]);
    return palette.length - 1;
  };
  const pixels = new Uint8Array(width * height); // 0 = white
  const rect = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++) pixels.fill(v, y * width + x0, y * width + x0 + w);
  };
  const text = (s: string, x0: number, y0: number, scale: number) => {
    [...s].forEach((ch, n) => {
      const glyph = FONT[ch];
      if (!glyph) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
      const gx = x0 + n * (GLYPH_W + 1) * scale;
      for (let r = 0; r < GLYPH_H; r++) for (let c = 0; c < GLYPH_W; c++) if (glyph[r][c] === "#") rect(gx + c * scale, y0 + r * scale, scale, scale, 1);
    });
  };

  items.forEach((it, i) => {
    const y = MARGIN + i * (iconSize + ROW_GAP);
    const b = blockie(it.address);
    const bg = colour(b.colors.bgcolor);
    const fg = colour(b.colors.color);
    const spot = colour(b.colors.spotcolor);
    b.grid.forEach((v, cell) => {
      const cx = cell % BLOCKIE_GRID;
      const cy = Math.floor(cell / BLOCKIE_GRID);
      rect(MARGIN + cx * IDENTICON_SCALE, y + cy * IDENTICON_SCALE, IDENTICON_SCALE, IDENTICON_SCALE, v ? (v === 1 ? fg : spot) : bg);
    });
    const numberX = MARGIN + iconSize + COL_GAP;
    text(it.label, numberX + numberW - textWidth(it.label, NUMBER_SCALE), y + Math.floor((iconSize - GLYPH_H * NUMBER_SCALE) / 2), NUMBER_SCALE);
    text(shortAddress(it.address), numberX + numberW + COL_GAP, y + Math.floor((iconSize - GLYPH_H * ADDRESS_SCALE) / 2), ADDRESS_SCALE);
  });
  return encodeIndexedPng({ width, height, palette, pixels });
}
