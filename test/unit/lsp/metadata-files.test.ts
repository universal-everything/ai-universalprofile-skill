// Loading the images the human provides (file, https URL, size limits, warnings) without any network.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256 } from "viem";
import { MAX_FILE_BYTES, describeFile, loadFile } from "../../../src/lsp/metadata.ts";
import { fetchFromGateway } from "../../../src/ipfs/gateway.ts";
import { gifBytes, jpegBytes, pngBytes, SVG } from "../../support/images.ts";

const dir = mkdtempSync(join(tmpdir(), "up-files-"));
const put = (name: string, bytes: Uint8Array) => {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};
const opts = { gateway: "https://gw.example/ipfs/" };
const publicLookup = async () => [{ address: "93.184.215.14", family: 4 }];

describe("loadFile", () => {
  it("local file: size, MIME from the content (not the extension), keccak256(bytes), describe line", async () => {
    const bytes = pngBytes(64, 64);
    const f = await loadFile(put("photo.jpg", bytes), "profileImage", opts);
    expect(f).toMatchObject({ source: "file", input: "photo.jpg", mimeType: "image/png", ext: "png", size: bytes.length, hash: keccak256(bytes) });
    expect(f.image).toMatchObject({ width: 64, height: 64 });
    expect(f.warnings.join()).toMatch(/blurry/); // < 128 px
    expect(describeFile(f)).toMatch(/^64x64 PNG, \d+ bytes, file photo\.jpg$/);
  });

  it("warnings: non-square profile picture, narrow background, animated GIF", async () => {
    expect((await loadFile(put("wide.png", pngBytes(400, 200)), "profileImage", opts)).warnings.join()).toMatch(/square/);
    expect((await loadFile(put("bg.jpg", jpegBytes(500, 200)), "backgroundImage", opts)).warnings.join()).toMatch(/only 500 pixels wide/);
    expect((await loadFile(put("anim.gif", gifBytes(300, 300, 3)), "profileImage", opts)).warnings.join()).toMatch(/animated/);
  });

  it("refuses missing, empty, oversized, SVG and non-image files with hints", async () => {
    await expect(loadFile(join(dir, "nope.png"), "profileImage", opts)).rejects.toMatchObject({ code: "BAD_ARGS", message: expect.stringMatching(/not found/) });
    await expect(loadFile(put("empty.png", new Uint8Array(0)), "profileImage", opts)).rejects.toMatchObject({ message: expect.stringMatching(/empty/) });
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(pngBytes(10, 10));
    await expect(loadFile(put("big.png", big), "profileImage", opts)).rejects.toMatchObject({ message: expect.stringMatching(/limit is 10\.0 MB/) });
    await expect(loadFile(put("logo.svg", SVG), "profileImage", opts)).rejects.toMatchObject({ hint: expect.stringMatching(/PNG/) });
    await expect(loadFile(put("notes.txt", new TextEncoder().encode("hello")), "backgroundImage", opts)).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(loadFile("ftp://x/y.png", "profileImage", opts)).rejects.toMatchObject({ hint: expect.stringMatching(/https/) });
    await expect(loadFile("data:image/png;base64,AAAA", "profileImage", opts)).rejects.toMatchObject({ code: "BAD_ARGS" });
  });

  it("avatar accepts a GLB model (magic glTF) as model/gltf-binary", async () => {
    const glb = Uint8Array.from([...Buffer.from("glTF"), 2, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const f = await loadFile(put("me.glb", glb), "avatar", opts);
    expect(f).toMatchObject({ mimeType: "model/gltf-binary", ext: "glb", image: undefined });
    await expect(loadFile(put("me2.glb", glb), "profileImage", opts)).rejects.toMatchObject({ code: "BAD_ARGS" });
  });

  it("https URL: guarded fetch (public hosts only); the query string is never shown", async () => {
    const bytes = jpegBytes(1200, 1200);
    const fetch = async (url: string) => (url.startsWith("https://img.example/a/me.jpg") ? new Response(bytes, { status: 200 }) : new Response("", { status: 404 }));
    const f = await loadFile("https://img.example/a/me.jpg?token=SECRET123", "profileImage", { ...opts, fetch: fetch as any, lookup: publicLookup });
    expect(f).toMatchObject({ source: "url", input: "https://img.example/a/me.jpg", mimeType: "image/jpeg" });
    expect(JSON.stringify(f.warnings) + describeFile(f)).not.toContain("SECRET123");
    const e = await loadFile("https://img.example/missing.png?token=SECRET123", "profileImage", { ...opts, fetch: fetch as any, lookup: publicLookup }).catch((x) => x);
    expect(e.message).not.toContain("SECRET123");
    await expect(loadFile("https://internal.example/x.png", "profileImage", { ...opts, fetch: fetch as any, lookup: async () => [{ address: "10.0.0.5", family: 4 }] })).rejects.toMatchObject({ message: expect.stringMatching(/non-public/) });
  });
});

describe("gateway redirects", () => {
  const cid = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
  it("follows a redirect on the same origin or to a public https host, refuses one into a private network", async () => {
    const ok = new Uint8Array([1, 2, 3]);
    const f = async (url: string) => {
      if (url === `https://gw.example/ipfs/${cid}`) return new Response(null, { status: 302, headers: { location: `/ipfs/${cid}?x=1` } });
      if (url === `https://gw.example/ipfs/${cid}?x=1`) return new Response(null, { status: 301, headers: { location: `https://cdn.example/${cid}` } });
      if (url === `https://cdn.example/${cid}`) return new Response(ok, { status: 200 });
      return new Response("", { status: 404 });
    };
    expect(await fetchFromGateway(cid, { gateway: "https://gw.example/ipfs/", fetch: f as any, lookup: async () => [{ address: "93.184.215.14", family: 4 }], attempts: 1 })).toEqual(ok);
    const evil = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    await expect(fetchFromGateway(cid, { gateway: "https://gw.example/ipfs/", fetch: evil as any, attempts: 1 })).rejects.toMatchObject({ code: "IPFS_ERROR", message: expect.stringMatching(/refused location/) });
  });
});
