import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, isBlockedAddress, safeFetchBytes } from "../../../src/tokens/safe-fetch.ts";
import { fetchExternalJson } from "../../../src/tokens/metadata.ts";

const PUBLIC = async () => [{ address: "93.184.215.14", family: 4 }];

describe("address classification", () => {
  it("blocks loopback, private, link-local, CGNAT, unique-local, mapped and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "not-an-ip"]) expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.215.14", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("checks scheme, credentials, local names, IP literals and every resolved address", async () => {
    await expect(assertPublicHttpsUrl("http://example.com/x", PUBLIC)).rejects.toThrow(/only https/);
    await expect(assertPublicHttpsUrl("https://user:pw@example.com/x", PUBLIC)).rejects.toThrow(/credentials/);
    await expect(assertPublicHttpsUrl("https://localhost/x", PUBLIC)).rejects.toThrow(/local host/);
    await expect(assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data", PUBLIC)).rejects.toThrow(/non-public/);
    await expect(assertPublicHttpsUrl("https://[::1]/x", PUBLIC)).rejects.toThrow(/non-public/);
    const mixed = async () => [{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.5", family: 4 }];
    await expect(assertPublicHttpsUrl("https://rebind.example/x", mixed)).rejects.toThrow(/resolves to the non-public address 10\.0\.0\.5/);
    await expect(assertPublicHttpsUrl("https://ok.example/x", PUBLIC)).resolves.toBeInstanceOf(URL);
  });
});

describe("safeFetchBytes", () => {
  it("follows at most 3 redirects, re-checking each target", async () => {
    const seen: string[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      seen.push(url);
      expect(init?.redirect).toBe("manual");
      if (url.includes("/start")) return new Response(null, { status: 302, headers: { location: "https://internal.example/secret" } });
      return new Response("{}", { status: 200 });
    };
    const lookup = async (host: string) => [{ address: host === "internal.example" ? "192.168.0.10" : "93.184.215.14", family: 4 }];
    await expect(safeFetchBytes("https://evil.example/start", { fetch, lookup })).rejects.toThrow(/192\.168\.0\.10/);
    expect(seen).toEqual(["https://evil.example/start"]); // the internal target was never contacted
    let n = 0;
    const loop = async () => new Response(null, { status: 301, headers: { location: `https://a.example/${n++}` } });
    await expect(safeFetchBytes("https://a.example/0", { fetch: loop, lookup: PUBLIC })).rejects.toThrow(/more than 3 redirects/);
    expect(n).toBe(4);
    const hop = async (url: string) => (url.endsWith("/a") ? new Response(null, { status: 302, headers: { location: "/b" } }) : new Response('{"ok":1}', { status: 200 }));
    const r = await safeFetchBytes("https://a.example/a", { fetch: hop, lookup: PUBLIC });
    expect(r.finalUrl).toBe("https://a.example/b");
    expect(new TextDecoder().decode(r.bytes)).toBe('{"ok":1}');
  });

  it("streams the body and aborts above the cap (also without content-length)", async () => {
    let pulled = 0;
    const big = () =>
      new Response(
        new ReadableStream({
          pull(c) {
            pulled++;
            c.enqueue(new Uint8Array(64 * 1024));
            if (pulled > 1000) c.close();
          },
        }),
        { status: 200 },
      );
    await expect(safeFetchBytes("https://a.example/big", { fetch: async () => big(), lookup: PUBLIC, maxBytes: 256 * 1024 })).rejects.toThrow(/larger than 262144/);
    expect(pulled).toBeLessThan(10); // stopped early, not read to the end
    const declared = async () => new Response("x", { status: 200, headers: { "content-length": String(5 * 1024 * 1024) } });
    await expect(safeFetchBytes("https://a.example/d", { fetch: declared, lookup: PUBLIC })).rejects.toThrow(/larger than/);
  });

  it("token metadata fetch refuses a gateway or token URI that points inside the network", async () => {
    const fetch = async () => new Response("{}", { status: 200 });
    const r1 = await fetchExternalJson("https://metadata.example/x.json", { fetch, lookup: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(r1).toMatchObject({ status: "error", error: expect.stringMatching(/non-public/) });
    const r2 = await fetchExternalJson("ipfs://QmX", { fetch, gateway: "https://10.0.0.1/ipfs/", lookup: PUBLIC });
    expect(r2).toMatchObject({ status: "error", error: expect.stringMatching(/non-public/) });
  });
});
