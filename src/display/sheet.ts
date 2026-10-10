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

const IDENTICON_SCALE = 12; // 8 cells -> 96 px
const NUMBER_SCALE = 4;
const ADDRESS_SCALE = 2;
const MARGIN = 24;
const GAP = 24;

/** Renders the labelled identicons as one PNG (white background, dark text). */
export function candidateSheetPng(items: SheetItem[]): Buffer {
  if (!items.length) throw new Error("no candidates to draw");
  const iconSize = BLOCKIE_GRID * IDENTICON_SCALE;
  const colWidth = Math.max(iconSize, ...items.map((it) => Math.max(textWidth(shortAddress(it.address), ADDRESS_SCALE), textWidth(it.label, NUMBER_SCALE))));
  const numberH = GLYPH_H * NUMBER_SCALE;
  const addressH = GLYPH_H * ADDRESS_SCALE;
  const width = 2 * MARGIN + items.length * colWidth + (items.length - 1) * GAP;
  const height = 2 * MARGIN + iconSize + 14 + numberH + 10 + addressH;

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
    const x = MARGIN + i * (colWidth + GAP);
    const b = blockie(it.address);
    const bg = colour(b.colors.bgcolor);
    const fg = colour(b.colors.color);
    const spot = colour(b.colors.spotcolor);
    const ix = x + Math.floor((colWidth - iconSize) / 2);
    b.grid.forEach((v, cell) => {
      const cx = cell % BLOCKIE_GRID;
      const cy = Math.floor(cell / BLOCKIE_GRID);
      rect(ix + cx * IDENTICON_SCALE, MARGIN + cy * IDENTICON_SCALE, IDENTICON_SCALE, IDENTICON_SCALE, v ? (v === 1 ? fg : spot) : bg);
    });
    const numberY = MARGIN + iconSize + 14;
    text(it.label, x + Math.floor((colWidth - textWidth(it.label, NUMBER_SCALE)) / 2), numberY, NUMBER_SCALE);
    const short = shortAddress(it.address);
    text(short, x + Math.floor((colWidth - textWidth(short, ADDRESS_SCALE)) / 2), numberY + numberH + 10, ADDRESS_SCALE);
  });
  return encodeIndexedPng({ width, height, palette, pixels });
}
