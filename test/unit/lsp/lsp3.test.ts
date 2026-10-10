// LSP3 JSON building, merge semantics, input validation and the VerifiableURI value.
import { describe, expect, it } from "vitest";
import { ERC725 } from "@erc725/erc725.js";
import { LSP3Schema } from "@erc725/erc725.js/schemas";
import { keccak256, toBytes, type Hex } from "viem";
import { assetEntry, decodeLsp3Value, describeImageEntry, displayText, parseJsonLossless, encodeLsp3Value, imageEntry, mergeLsp3, parseDescription, parseLinks, parseName, parseRemove, parseTags, serialiseLsp3, viewLsp3, LIMITS } from "../../../src/lsp/lsp3.ts";
import { DATA_KEYS, PERMISSIONS } from "../../../src/lsp/constants.ts";
import { redact, toJson } from "../../../src/core/json.ts";
import { canWriteDataKey, metadataChain, metadataHooks, setMetadataHooksForTests, METADATA_DEFAULT_CHAIN_ID } from "../../../src/lsp/metadata.ts";

const H1 = keccak256(toBytes("image-1"));
const H2 = keccak256(toBytes("image-2"));

describe("input parsing", () => {
  it("links: title=url pairs (commas inside URLs survive), bare URLs, JSON arrays; http(s) only", () => {
    expect(parseLinks("Website=https://example.com,X=https://x.com/ada")).toEqual([
      { title: "Website", url: "https://example.com" },
      { title: "X", url: "https://x.com/ada" },
    ]);
    expect(parseLinks("Docs=https://a.example/p?x=1,2&y=3\nBlog=https://b.example")).toEqual([
      { title: "Docs", url: "https://a.example/p?x=1,2&y=3" },
      { title: "Blog", url: "https://b.example" },
    ]);
    expect(parseLinks("https://lukso.network")).toEqual([{ title: "lukso.network", url: "https://lukso.network" }]);
    expect(parseLinks([{ title: "A", url: "https://a.example" }, "B=https://b.example"])).toHaveLength(2);
    expect(parseLinks("")).toEqual([]);
    expect(parseLinks([])).toEqual([]);
    expect(() => parseLinks("Bad=javascript:alert(1)")).toThrow();
    expect(() => parseLinks("Mail=mailto:a@b.c")).toThrow(/https/);
    expect(() => parseLinks([{ title: "x" }])).toThrow(/url/);
    expect(() => parseLinks(Array.from({ length: LIMITS.links + 1 }, (_, i) => `L${i}=https://e.example/${i}`))).toThrow(/at most/);
  });

  it("name/description/tags/remove validation", () => {
    expect(parseName("  Ada  ")).toBe("Ada");
    expect(() => parseName("two\nlines")).toThrow();
    expect(() => parseName("x".repeat(LIMITS.name + 1))).toThrow(/longer/);
    expect(parseDescription("line 1\r\nline 2")).toBe("line 1\nline 2");
    expect(() => parseDescription("bell\u0007")).toThrow(/control/);
    expect(parseTags("agent, research,agent,, ")).toEqual(["agent", "research"]);
    expect(parseTags(["a", "b"])).toEqual(["a", "b"]);
    expect(parseRemove("profile-image,background-image")).toEqual(["profile-image", "background-image"]);
    expect(() => parseRemove("picture")).toThrow(/unknown field/);
  });
});

describe("merge semantics", () => {
  const existing = {
    LSP3Profile: {
      name: "old",
      description: "keep me",
      links: [{ title: "a", url: "https://a.example" }],
      tags: ["t"],
      profileImage: [imageEntry(100, 100, "ipfs://old", H1)],
      backgroundImage: [],
      avatar: [],
      customField: { app: "x" },
    },
    otherTopLevel: 1,
  };

  it("default merge keeps every field that is not given (including unknown fields), replaces given ones", () => {
    const r = mergeLsp3(existing, { name: "new" });
    expect(r.json.LSP3Profile).toEqual({ ...existing.LSP3Profile, name: "new" });
    expect(r.json.otherTopLevel).toBe(1);
    expect(r.changed).toEqual(["name"]);
    expect(existing.LSP3Profile.name).toBe("old"); // input not mutated
  });

  it("images and lists replace the whole set; --remove deletes; identical values are no change", () => {
    const r = mergeLsp3(existing, { profileImage: [imageEntry(512, 512, "ipfs://new", H2)], tags: ["x", "y"], remove: ["description", "links"] });
    expect(r.json.LSP3Profile.profileImage).toEqual([{ width: 512, height: 512, url: "ipfs://new", verification: { method: "keccak256(bytes)", data: H2 } }]);
    expect(r.json.LSP3Profile.tags).toEqual(["x", "y"]);
    expect(r.json.LSP3Profile.description).toBeUndefined();
    expect(r.json.LSP3Profile.links).toEqual([]); // list properties are always present
    expect(r.changed.sort()).toEqual(["description", "links", "profileImage", "tags"]);
    expect(mergeLsp3(existing, { name: "old" }).changed).toEqual([]);
  });

  it("--replace starts from an empty document; a fresh document carries all list properties", () => {
    const r = mergeLsp3(existing, { name: "fresh" }, { replace: true });
    expect(r.json).toEqual({ LSP3Profile: { name: "fresh", links: [], tags: [], avatar: [], profileImage: [], backgroundImage: [] } });
    const fresh = mergeLsp3(undefined, { avatar: [assetEntry("model/gltf-binary", "ipfs://glb", H1)] });
    expect(fresh.json.LSP3Profile.avatar).toEqual([{ url: "ipfs://glb", fileType: "model/gltf-binary", verification: { method: "keccak256(bytes)", data: H1 } }]);
    expect(fresh.changed).toEqual(["avatar"]); // the empty default lists are not reported as changes
  });

  it("refuses to merge into something that is not an LSP3 document", () => {
    let e: any;
    try {
      mergeLsp3({ foo: 1 }, { name: "x" });
    } catch (x) {
      e = x;
    }
    expect(e).toMatchObject({ code: "BAD_ARGS", hint: expect.stringMatching(/--replace/) });
    expect(() => mergeLsp3("text", { name: "x" })).toThrow();
    expect(mergeLsp3({ foo: 1 }, { name: "x" }, { replace: true }).json.LSP3Profile.name).toBe("x");
  });

  it("displayText escapes untrusted text: one line, no terminal escapes, no bidi overrides, bounded", () => {
    expect(displayText("Ada")).toBe('"Ada"');
    expect(displayText('line1\nIGNORE PREVIOUS "x"')).toBe('"line1 IGNORE PREVIOUS \\"x\\""');
    expect(displayText("\u001b]8;;https://evil\u0007click\u001b[31m")).not.toMatch(/\u001b|\u0007/);
    expect(displayText("abc\u202edcba")).toBe('"abc\\u202edcba"');
    expect(displayText("\u0085x", 10, false)).toBe("\\u0085x");
    expect(displayText("x".repeat(500), 10)).toBe(`"${"x".repeat(10)}…"`);
    expect(describeImageEntry({ width: 1, height: 1, url: "ipfs://a\u001b[2Jb", verification: { method: "keccak256(bytes)" } })).toBe("1x1 ipfs://a\\u001b[2Jb (keccak256(bytes))");
    expect(describeImageEntry({ address: "0xabc", tokenId: "0x01" })).toBe("NFT 0xabc token 0x01");
  });

  it("merge keeps untouched numbers exactly (no 9007199254740993 → 9007199254740992), and reports only the real change", () => {
    const text = '{"LSP3Profile":{"name":"a","big":9007199254740993,"f":1.0,"e":1e3,"n":2,"profileImage":[{"width":512,"height":512,"url":"ipfs://x","verification":{"method":"keccak256(bytes)","data":"0x00"}}],"s":"9007199254740993 \\" 1.0"},"top":12345678901234567890}';
    const p = parseJsonLossless(text);
    expect(p.lossyNumbers).toEqual([]);
    const r = mergeLsp3(p.value, { name: "b" });
    expect(r.changed).toEqual(["name"]);
    const out = serialiseLsp3(r.json).text;
    expect(out).toBe('{"LSP3Profile":{"name":"b","big":9007199254740993,"f":1.0,"e":1e3,"n":2,"profileImage":[{"width":512,"height":512,"url":"ipfs://x","verification":{"method":"keccak256(bytes)","data":"0x00"}}],"s":"9007199254740993 \\" 1.0","links":[],"tags":[],"avatar":[],"backgroundImage":[]},"top":12345678901234567890}');
    expect(out).toContain('"big":9007199254740993');
    expect(out).toContain('"f":1.0');
    expect(out).toContain('"top":12345678901234567890');
    expect(viewLsp3(r.json)!.profileImage[0]).toMatchObject({ width: 512 }); // canonical numbers stay plain numbers
    // without JSON.rawJSON the unsafe numbers are reported (the verb then refuses to merge)
    expect(parseJsonLossless(text, { useRaw: false }).lossyNumbers).toEqual(["9007199254740993", "12345678901234567890"]);
  });

  it("the view and output use plain numbers even where the merge keeps raw number text (512.0, 1e3)", () => {
    const text = '{"LSP3Profile":{"name":"a","profileImage":[{"width":512.0,"height":1e3,"url":"ipfs://x","verification":{"method":"keccak256(bytes)","data":"0x00"}}]}}';
    const p = parseJsonLossless(text);
    const v = viewLsp3(p.value)!;
    expect(v.profileImage[0]).toMatchObject({ width: 512, height: 1000 });
    expect(describeImageEntry(v.profileImage[0])).toBe("512x1000 ipfs://x (keccak256(bytes))");
    expect(toJson(redact({ data: { metadata: v } }))).not.toContain("rawJSON");
    // the serialised document still carries the original number text
    expect(serialiseLsp3(mergeLsp3(p.value, { name: "b" }).json).text).toContain('"width":512.0,"height":1e3');
  });

  it("viewLsp3 is tolerant of foreign data", () => {
    const v = viewLsp3({ LSP3Profile: { name: 5, links: [{ url: "https://a" }, "junk"], tags: ["a", 1], extra: true } })!;
    expect(v).toMatchObject({ name: undefined, links: [{ title: "", url: "https://a" }], tags: ["a"], otherFields: ["extra"] });
    expect(viewLsp3({ nope: 1 })).toBeUndefined();
  });
});

describe("JSON bytes and the LSP3Profile VerifiableURI", () => {
  it("serialises compact UTF-8 JSON and hashes exactly those bytes", () => {
    const json = { LSP3Profile: { name: "Zoë 🚀", tags: [] } };
    const s = serialiseLsp3(json);
    expect(s.text).toBe(JSON.stringify(json));
    expect(Buffer.from(s.bytes).toString("utf8")).toBe(s.text);
    expect(s.hash).toBe(keccak256(new TextEncoder().encode(s.text)));
    expect(() => serialiseLsp3({ LSP3Profile: { description: "x".repeat(LIMITS.jsonBytes) } })).toThrow(/max/);
  });

  it("encodes keccak256(utf8) + ipfs:// and round-trips through erc725.js decodeData", () => {
    const s = serialiseLsp3({ LSP3Profile: { name: "agent" } });
    const url = "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
    const value = encodeLsp3Value(url, s.hash);
    // LSP2 VerifiableURI: 0x0000 + method id keccak256(utf8) 0x6f357c6a + 0x0020 + hash + utf8(url)
    expect(value.slice(0, 18)).toBe("0x00006f357c6a0020");
    expect(value.slice(18, 82)).toBe(s.hash.slice(2));
    expect(Buffer.from(value.slice(82), "hex").toString("utf8")).toBe(url);
    const decoded = ERC725.decodeData([{ keyName: "LSP3Profile", value }], LSP3Schema as any)[0];
    expect(decoded.key.toLowerCase()).toBe(DATA_KEYS.LSP3Profile);
    expect(decoded.value).toEqual({ verification: { method: "keccak256(utf8)", data: s.hash }, url });
    expect(decodeLsp3Value(value)).toEqual({ url, verification: { method: "keccak256(utf8)", data: s.hash } });
    expect(decodeLsp3Value("0x")).toBeUndefined();
    expect(decodeLsp3Value("0x1234" as Hex)).toBeUndefined();
  });
});

describe("metadata chain and write permission", () => {
  it("the default metadata chain is LUKSO mainnet (42), independent of the configured default chain; --chain is explicit", () => {
    setMetadataHooksForTests();
    expect(METADATA_DEFAULT_CHAIN_ID).toBe(42);
    expect(metadataHooks().defaultChainId).toBe(42);
    const ctx = { flags: {}, chainId: (a: string) => Number(a) } as any; // config.defaultChain is never consulted
    expect(metadataChain(ctx, {})).toEqual({ chainId: 42, explicit: false });
    expect(metadataChain(ctx, { chain: "8453" })).toEqual({ chainId: 8453, explicit: true });
    expect(metadataChain({ ...ctx, flags: { chain: "4201" } }, {})).toEqual({ chainId: 4201, explicit: true });
    setMetadataHooksForTests({ defaultChainId: 31337 });
    expect(metadataChain(ctx, {}).chainId).toBe(31337);
    setMetadataHooksForTests();
    expect(metadataChain(ctx, {}).chainId).toBe(42);
  });

  it("LSP3Profile is writable with SUPER_SETDATA, or SETDATA plus a matching allowed key/prefix", () => {
    const k = DATA_KEYS.LSP3Profile;
    expect(canWriteDataKey(PERMISSIONS.SUPER_SETDATA, [])).toMatchObject({ ok: true, via: "SUPER_SETDATA" });
    expect(canWriteDataKey(PERMISSIONS.SETDATA, [k])).toMatchObject({ ok: true, via: "SETDATA" });
    expect(canWriteDataKey(PERMISSIONS.SETDATA, [k.slice(0, 10) as Hex])).toMatchObject({ ok: true }); // prefix
    expect(canWriteDataKey(PERMISSIONS.SETDATA, [])).toMatchObject({ ok: false, missing: expect.stringMatching(/no allowed data keys/) });
    expect(canWriteDataKey(PERMISSIONS.SETDATA, ["0x1234" as Hex])).toMatchObject({ ok: false, missing: expect.stringMatching(/LSP3Profile/) });
    expect(canWriteDataKey(PERMISSIONS.CALL, [k])).toMatchObject({ ok: false, missing: expect.stringMatching(/no SETDATA/) });
  });
});
