// Profile URL resolution with a mocked fetch (profile.link is never contacted).
import { describe, expect, it } from "vitest";
import { acceptProfileLink, resolveProfileUrl, universalEverythingUrl } from "../../../src/lsp/profile-url.ts";

const ADDR = "0xcdec110f9c255357e37f46cd2687be1f7e9b02f7";
const CHECKSUMMED = "0xCDeC110F9c255357E37f46CD2687be1f7E9B02F7";

function mockFetch(handler: (url: string) => { status?: number; body?: unknown } | Error) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    const r = handler(url);
    if (r instanceof Error) throw r;
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

describe("profile URL", () => {
  it("LUKSO mainnet: GET https://profile.link/<checksummed>/resolve and use `link` (%40 shown as @)", async () => {
    const m = mockFetch(() => ({ body: { address: ADDR, checksummed: CHECKSUMMED, name: "feindura", fullName: "feindura", resolved: "feindura", link: "https://profile.link/feindura%40cdec" } }));
    const u = await resolveProfileUrl(42, ADDR, { fetch: m.f });
    expect(m.calls).toEqual([`https://profile.link/${CHECKSUMMED}/resolve`]);
    expect(u).toMatchObject({ url: "https://profile.link/feindura@cdec", source: "profile.link", name: "feindura", showsLuksoData: false, universalEverything: `https://universaleverything.io/${CHECKSUMMED}?network=mainnet` });
  });

  it("LUKSO testnet uses t.profile.link; the fallback page is ?network=testnet", async () => {
    const m = mockFetch(() => ({ body: { address: ADDR, link: `https://t.profile.link/${ADDR}` } }));
    const u = await resolveProfileUrl(4201, ADDR, { fetch: m.f });
    expect(m.calls[0]).toBe(`https://t.profile.link/${CHECKSUMMED}/resolve`);
    expect(u.url).toBe(`https://t.profile.link/${ADDR}`);
    const failed = await resolveProfileUrl(4201, ADDR, { fetch: mockFetch(() => ({ status: 404 })).f });
    expect(failed).toMatchObject({ url: `https://universaleverything.io/${CHECKSUMMED}?network=testnet`, source: "universaleverything", resolveError: "HTTP 404" });
  });

  it("any failure falls back to https://universaleverything.io/<checksummed>?network=mainnet", async () => {
    const fallback = `https://universaleverything.io/${CHECKSUMMED}?network=mainnet`;
    for (const handler of [
      () => new Error("ECONNREFUSED"),
      () => ({ status: 500 }),
      () => ({ body: "not json" }),
      () => ({ body: { address: "0x0000000000000000000000000000000000000001", link: "https://profile.link/x" } }), // other address
      () => ({ body: { address: ADDR, link: "https://evil.example/phish" } }), // foreign host
      () => ({ body: { address: ADDR, link: "https://profile.link/a/b?c=d" } }), // not a plain name
    ]) {
      const u = await resolveProfileUrl(42, ADDR, { fetch: mockFetch(handler as any).f });
      expect(u.url, JSON.stringify(handler())).toBe(fallback);
      expect(u.source).toBe("universaleverything");
      expect(u.resolveError).toBeTruthy();
    }
    expect(universalEverythingUrl(ADDR)).toBe(fallback);
  });

  it("other chains: no profile.link call; explorer page + a note that the profile pages show LUKSO data", async () => {
    const m = mockFetch(() => ({ body: {} }));
    const registry = { chain: (id: number) => ({ chainId: id, name: "Base", explorers: [{ url: "https://basescan.org", family: "etherscan" }] }) } as any;
    const u = await resolveProfileUrl(8453, ADDR, { fetch: m.f, registry });
    expect(m.calls).toEqual([]);
    expect(u).toMatchObject({ url: `https://basescan.org/address/${CHECKSUMMED}`, source: "explorer", showsLuksoData: true });
    expect(u.note).toMatch(/LUKSO data, not what is stored on Base \(8453\)/);
    const none = await resolveProfileUrl(999999, ADDR, { fetch: m.f });
    expect(none).toMatchObject({ source: "none", explorer: undefined });
    expect(none.note).toMatch(/no block explorer/);
  });

  it("acceptProfileLink only takes https profile.link links with a plain path", () => {
    expect(acceptProfileLink("https://profile.link/ada", "mainnet")).toBe("https://profile.link/ada");
    expect(acceptProfileLink("https://profile.link/ada%40ab12", "mainnet")).toBe("https://profile.link/ada@ab12");
    expect(acceptProfileLink("http://profile.link/ada", "mainnet")).toBeUndefined();
    expect(acceptProfileLink("https://t.profile.link/ada", "mainnet")).toBeUndefined();
    expect(acceptProfileLink("https://profile.link.evil.example/ada", "mainnet")).toBeUndefined();
    expect(acceptProfileLink("https://profile.link/<script>", "mainnet")).toBeUndefined();
    expect(acceptProfileLink(42, "mainnet")).toBeUndefined();
  });
});
