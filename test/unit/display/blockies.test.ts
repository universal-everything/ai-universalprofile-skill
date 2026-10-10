// Golden tests: our blockies port must decode to exactly the same pixels as the
// upstream ethereum-blockies-base64 (lukso-network fork) output.
// Reference provenance: test/fixtures/identicon/vectors.json was produced by
// running the verbatim upstream source (test/fixtures/identicon/upstream/, files
// sha256-pinned) in a node:vm sandbox via generate-vectors.ts; the live test below
// re-runs that sandboxed upstream for further addresses.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toHex, getAddress } from "viem";
import { blockie, blockieColorsHex, blockiePng, blockieText, makeBlockie } from "../../../src/display/blockies.ts";
import { loadUpstreamMakeBlockie, UPSTREAM_SOURCE } from "../../fixtures/identicon/upstream.ts";
import { decodePng } from "./support/png-decode.ts";

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "fixtures", "identicon", "vectors.json"), "utf8")) as {
  source: typeof UPSTREAM_SOURCE;
  vectors: { address: string; dataUri: string }[];
};

function decodeUri(uri: string) {
  expect(uri.startsWith("data:image/png;base64,")).toBe(true);
  return decodePng(Buffer.from(uri.slice("data:image/png;base64,".length), "base64"));
}

describe("blockies identicon (faithful port)", () => {
  it("golden vectors were produced from the pinned upstream source", () => {
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(5);
    expect(vectors.source.commit).toBe(UPSTREAM_SOURCE.commit);
    expect(vectors.source.files).toEqual(UPSTREAM_SOURCE.files);
  });

  for (const v of vectors.vectors) {
    it(`matches upstream pixel-for-pixel: ${v.address}`, () => {
      const ref = decodeUri(v.dataUri);
      const ours = decodePng(blockiePng(v.address));
      expect([ours.width, ours.height]).toEqual([128, 128]);
      expect([ref.width, ref.height]).toEqual([128, 128]);
      expect(Buffer.from(ours.rgba).equals(Buffer.from(ref.rgba))).toBe(true);
      // same colours in the same allocation order (bgcolor, color, spotcolor; upstream pads PLTE to 3 entries)
      expect(ref.palette!.slice(0, ours.palette!.length)).toEqual(ours.palette);
      // and our data URI decodes to the same image
      expect(Buffer.from(decodeUri(makeBlockie(v.address)).rgba).equals(Buffer.from(ref.rgba))).toBe(true);
    });
  }

  it("matches the sandboxed upstream for 48 further addresses", () => {
    const upstream = loadUpstreamMakeBlockie();
    for (let i = 0; i < 48; i++) {
      const addr = getAddress(`0x${keccak256(toHex(`blockie-${i}`)).slice(26)}`);
      const ref = decodeUri(upstream(addr));
      const ours = decodePng(blockiePng(addr));
      expect(Buffer.from(ours.rgba).equals(Buffer.from(ref.rgba)), addr).toBe(true);
    }
  });

  it("is case-insensitive (seed = lower-cased address) and scales by integer factors", () => {
    const a = "0x7cB57B5A97eAbe94205C07890BE4c1aD31E486A8";
    expect(blockie(a)).toEqual(blockie(a.toLowerCase()));
    const small = decodePng(blockiePng(a, 1));
    const big = decodePng(blockiePng(a, 16));
    expect([small.width, small.height]).toEqual([8, 8]);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const s = Array.from(small.rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
        const b = Array.from(big.rgba.subarray(((y * 16 + 7) * 128 + x * 16 + 7) * 4, ((y * 16 + 7) * 128 + x * 16 + 7) * 4 + 4));
        expect(b).toEqual(s);
      }
  });

  it("mirrors the grid horizontally and uses only 3 colour classes", () => {
    const b = blockie("0x0F4180da178ed1C71398a57ca8Cb177F69591f1f");
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) expect(b.grid[y * 8 + x]).toBe(b.grid[y * 8 + 7 - x]);
    expect(new Set(b.grid).size).toBeLessThanOrEqual(3);
    expect(b.grid.every((v) => v >= 0 && v <= 2)).toBe(true);
  });

  it("renders a text approximation with the colour legend", () => {
    const a = "0x0F4180da178ed1C71398a57ca8Cb177F69591f1f";
    const t = blockieText(a).split("\n");
    expect(t).toHaveLength(9);
    expect(t.slice(0, 8).every((l) => [...l].length === 16)).toBe(true);
    const c = blockieColorsHex(a);
    expect(t[8]).toContain(c.color);
    expect(t[8]).toContain(c.bgcolor);
  });
});
