import { describe, expect, it } from "vitest";
import { lookupSelector, rankCandidates, normalizeQuery } from "../../../src/abi/selectors.ts";
import { selectorOfSignature, topicOfSignature } from "../../../src/abi/signature.ts";
import { mockFetch } from "./support/fake.ts";

const UNKNOWN = selectorOfSignature("frobnicate(uint256,address)"); // not in any bundled ABI

describe("selector lookup order", () => {
  it("answers from the bundled data first without touching the network", async () => {
    const m = mockFetch([]);
    const r = await lookupSelector("0xa9059cbb", { fetch: m.fetch });
    expect(r.trust).toBe("bundled");
    expect(r.candidates[0]).toMatchObject({ signature: "transfer(address,uint256)", source: "bundled", hashMatches: true });
    expect(m.requests).toHaveLength(0);
  });

  it("queries Sourcify 4byte, then 4byte.directory only when Sourcify has nothing", async () => {
    const m = mockFetch([
      [/4byte\.sourcify\.dev/, () => ({ status: 200, body: { ok: true, result: { function: {}, event: {} } } })],
      [/4byte\.directory/, () => ({ status: 200, body: { count: 1, results: [{ text_signature: "frobnicate(uint256,address)" }] } })],
    ]);
    const r = await lookupSelector(UNKNOWN, { fetch: m.fetch });
    expect(m.requests.map((x) => new URL(x.url).host)).toEqual(["api.4byte.sourcify.dev", "www.4byte.directory"]);
    expect(m.requests[0].url).toContain(`function=${UNKNOWN}`);
    expect(r.trust).toBe("guessed");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ source: "4byte.directory", hashMatches: true });
    expect(r.warnings.join(" ")).toMatch(/guesses/);
  });

  it("stops after a Sourcify hit and shows every colliding candidate, hash-checked and ranked", async () => {
    const m = mockFetch([
      [
        /4byte\.sourcify\.dev/,
        () => ({
          status: 200,
          body: {
            ok: true,
            result: {
              function: {
                "0xa9059cbb": [
                  { name: "workMyDirefulOwner(uint256,uint256)", filtered: true, hasVerifiedContract: false },
                  { name: "transfer(address,uint256)", filtered: false, hasVerifiedContract: true },
                  { name: "notReallyThis(uint8)", filtered: false, hasVerifiedContract: false },
                ],
              },
            },
          },
        }),
      ],
    ]);
    // allSources skips the bundled short-circuit; 4byte.directory unreachable here → error recorded, not thrown
    const r = await lookupSelector("0xa9059cbb", { fetch: m.fetch, allSources: true });
    const remote = r.candidates.filter((c) => c.source === "sourcify-4byte");
    expect(remote.map((c) => c.signature)).toEqual(["transfer(address,uint256)", "workMyDirefulOwner(uint256,uint256)", "notReallyThis(uint8)"]);
    expect(remote.find((c) => c.signature === "notReallyThis(uint8)")!.hashMatches).toBe(false);
    expect(r.candidates[0].source).toBe("bundled");
    expect(r.warnings.join(" ")).toMatch(/collision: 2 different signatures/);
    expect(r.warnings.join(" ")).toMatch(/do not hash/);
    expect(r.sources.map((s) => s.source)).toEqual(["bundled", "sourcify-4byte", "4byte.directory"]);
    expect(r.sources[2].outcome).toMatch(/error/);
  });

  it("looks up event topics in the bundled index and remotely", async () => {
    const topic = topicOfSignature("Transfer(address,address,uint256)");
    const local = await lookupSelector(topic, { offline: true });
    expect(local.trust).toBe("bundled");
    // ERC-20 and ERC-721 variants (different indexing) are both listed
    expect(local.candidates.length).toBeGreaterThanOrEqual(2);
    const unknownTopic = topicOfSignature("Frobnicated(uint256)");
    const m = mockFetch([[/4byte\.sourcify\.dev/, (url) => ({ status: 200, body: { ok: true, result: { event: { [new URL(url).searchParams.get("event")!]: [{ name: "Frobnicated(uint256)", filtered: false, hasVerifiedContract: true }] } } } })]]);
    const r = await lookupSelector(unknownTopic, { fetch: m.fetch });
    expect(m.requests[0].url).toContain(`event=${unknownTopic}`);
    expect(r.candidates[0]).toMatchObject({ signature: "Frobnicated(uint256)", kind: "event", hashMatches: true });
  });

  it("offline mode never fetches and reports it", async () => {
    const m = mockFetch([]);
    const r = await lookupSelector(UNKNOWN, { offline: true, fetch: m.fetch });
    expect(m.requests).toHaveLength(0);
    expect(r.trust).toBe("unknown");
    expect(r.warnings[0]).toMatch(/offline/);
  });

  it("survives remote failures (429 exhausted, garbage bodies)", async () => {
    process.env.UP_HTTP_BACKOFF_MS = "1";
    const m = mockFetch([
      [/4byte\.sourcify\.dev/, () => ({ status: 429 })],
      [/4byte\.directory/, () => ({ status: 200, body: "<html>" })],
    ]);
    const r = await lookupSelector(UNKNOWN, { fetch: m.fetch });
    expect(m.requests.filter((x) => x.url.includes("sourcify")).length).toBe(3); // 1 + 2 retries
    expect(r.candidates).toHaveLength(0);
    expect(r.sources.map((s) => s.outcome).join(" ")).toMatch(/rate limited/);
    delete process.env.UP_HTTP_BACKOFF_MS;
  });

  it("validates queries and ranks bundled first", () => {
    expect(() => normalizeQuery("0x1234")).toThrow(/selector/);
    expect(normalizeQuery("0xA9059CBB").query).toBe("0xa9059cbb");
    const ranked = rankCandidates([
      { signature: "b", fragment: "b", kind: "function", source: "4byte.directory", hashMatches: false },
      { signature: "a", fragment: "a", kind: "function", source: "sourcify-4byte", hashMatches: true, filtered: false, hasVerifiedContract: true },
      { signature: "c", fragment: "c", kind: "function", source: "bundled", hashMatches: true },
    ]);
    expect(ranked.map((x) => x.signature)).toEqual(["c", "a", "b"]);
  });
});
