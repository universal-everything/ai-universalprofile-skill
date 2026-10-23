// Authorization links for a human's existing profile on https://authorize.universalprofile.cloud:
// capability → LSP6 mapping, the exact link format (shared vector with the website), and every
// refusal (no capability, wrong chain, escalation, wildcards, protected keys, unsafe text, foreign hosts).
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { LINK_LIMITS, authorizeBaseUrl, buildAuthorizeRequest, parseAuthorizeUrl } from "../../../src/lsp/authorize-link.ts";
import { AUTHORIZE_WEBSITE } from "../../../src/lsp/authorize-site.ts";

const CONTROLLER = getAddress("0x5e1c0de0f9b12c2c3ab5a9c1f1b7d0d2a6e4b3c1");
const HUMAN = getAddress("0x9a3dbca554e9f6b9257aaa24010da8377c57c17e");
const FRIEND = getAddress("0x1234567890abcdef1234567890abcdef12345678");
const LSP26 = "f01103e5a9909fc0dbe8166da7085e0285daddca";
const LSP3 = "5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5";
const entry = (types: string, address: string, standard: string, selector: string) => `0020${types}${address}${standard}${selector}`;

// Shared contract vector: the website test suite parses exactly this link (src/lib/agent-request/parse.test.ts).
const VECTOR_URL =
  "https://authorize.universalprofile.cloud/authorize" +
  "?controller=0x5e1c0de0f9B12c2C3aB5a9c1f1B7D0D2A6e4B3c1" +
  "&network=mainnet" +
  "&name=Nova" +
  "&purpose=Follow%20artists%20for%20you%20%28and%20nothing%20else%29" +
  "&permissions=CALL,SETDATA,SIGN,EXECUTE_RELAY_CALL" +
  "&allowedCalls=0x" +
  entry("00000002", LSP26, "ffffffff", "4dbf27cc") +
  entry("00000002", LSP26, "ffffffff", "015a4ead") +
  entry("00000002", LSP26, "ffffffff", "cf8711c8") +
  entry("00000002", LSP26, "ffffffff", "8dd1e47e") +
  `&allowedDataKeys=0x0020${LSP3}`;

const base = { controller: CONTROLLER, chainId: 42 };

describe("buildAuthorizeRequest: capabilities", () => {
  it("builds the shared vector link exactly (social, profile, sign)", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["social", "profile", "sign"], name: "Nova", purpose: "Follow artists for you (and nothing else)" });
    expect(r.url).toBe(VECTOR_URL);
    expect(r.permissions.names).toEqual(["CALL", "SETDATA", "SIGN", "EXECUTE_RELAY_CALL"]);
    expect(r.permissions.hex).toBe(`0x${(0x800n | 0x40000n | 0x200000n | 0x400000n).toString(16).padStart(64, "0")}`);
    expect(r.network).toBe("mainnet");
    expect(r.controller).toBe(CONTROLLER);
  });

  it("builds the second shared vector exactly (tokens, pay, a profile, an elevated read permission)", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["tokens", "pay"], payTo: [FRIEND], profile: HUMAN, name: "Nova & Co", elevated: ["SUPER_STATICCALL"] });
    expect(r.url).toBe(
      "https://authorize.universalprofile.cloud/authorize?controller=0x5e1c0de0f9B12c2C3aB5a9c1f1B7D0D2A6e4B3c1&network=mainnet&name=Nova%20%26%20Co&forProfile=0x9a3DBCa554e9f6b9257aAa24010DA8377C57c17e&permissions=TRANSFERVALUE,CALL,SUPER_STATICCALL,EXECUTE_RELAY_CALL&allowedCalls=0x002000000002ffffffffffffffffffffffffffffffffffffffffc52d6008ffffffff002000000002ffffffffffffffffffffffffffffffffffffffffb3c4928fffffffff002000000002ffffffffffffffffffffffffffffffffffffffffdaa746b7ffffffff0020000000011234567890abcdef1234567890abcdef12345678ffffffffffffffff",
    );
  });

  it("tokens: CALL to any contract reporting an LSP7 interface id, any function", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["tokens"] });
    expect(r.permissions.names).toEqual(["CALL", "EXECUTE_RELAY_CALL"]);
    expect(r.allowedCalls.entries.map((e) => [e.callTypes, e.address, e.standard, e.selector])).toEqual([
      [2, "0xffffffffffffffffffffffffffffffffffffffff", "0xc52d6008", "0xffffffff"],
      [2, "0xffffffffffffffffffffffffffffffffffffffff", "0xb3c4928f", "0xffffffff"],
      [2, "0xffffffffffffffffffffffffffffffffffffffff", "0xdaa746b7", "0xffffffff"],
    ]);
    expect(r.allowedDataKeys.encoded).toBeNull();
  });

  it("nfts: CALL to any contract reporting an LSP8 interface id", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["nfts"] });
    expect(r.allowedCalls.entries.map((e) => e.standard)).toEqual(["0x3a271706", "0xecad9f75", "0x30dc5278"]);
  });

  it("profile: SETDATA on LSP3Profile only", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["profile"] });
    expect(r.permissions.names).toEqual(["SETDATA", "EXECUTE_RELAY_CALL"]);
    expect(r.allowedDataKeys.keys).toEqual([`0x${LSP3}`]);
    expect(r.allowedCalls.encoded).toBeNull();
  });

  it("sign: SIGN alone, no relay and no lists", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["sign"] });
    expect(r.permissions.names).toEqual(["SIGN"]);
    expect(r.allowedCalls.encoded).toBeNull();
    expect(r.allowedDataKeys.encoded).toBeNull();
    expect(r.url).not.toContain("allowedCalls");
  });

  it("pay: TRANSFERVALUE only to the listed recipients", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["pay"], payTo: [HUMAN, FRIEND] });
    expect(r.permissions.names).toEqual(["TRANSFERVALUE", "EXECUTE_RELAY_CALL"]);
    expect(r.allowedCalls.entries.map((e) => [e.callTypes, e.address, e.standard, e.selector])).toEqual([
      [1, HUMAN, "0xffffffff", "0xffffffff"],
      [1, FRIEND, "0xffffffff", "0xffffffff"],
    ]);
  });

  it("pay needs recipients; recipients alone imply pay", () => {
    expect(() => buildAuthorizeRequest({ ...base, capabilities: ["pay"] })).toThrow(/--pay-to/);
    expect(buildAuthorizeRequest({ ...base, payTo: [FRIEND] }).permissions.names).toContain("TRANSFERVALUE");
  });

  it("derives only effective bits from custom targets", () => {
    const r = buildAuthorizeRequest({ ...base, allowTargets: [{ address: FRIEND, callTypes: ["CALL", "VALUE"], selector: "0xabcdef01" }] });
    expect(r.permissions.names).toEqual(["TRANSFERVALUE", "CALL", "EXECUTE_RELAY_CALL"]);
    expect(r.allowedCalls.entries[0]).toMatchObject({ callTypes: 3, address: FRIEND, selector: "0xabcdef01" });
  });

  it("adds custom data keys by name or hex", () => {
    const r = buildAuthorizeRequest({ ...base, allowedKeys: ["LSP3Profile", "0x74ac2555c10b9349e78f0000"] });
    expect(r.allowedDataKeys.keys).toEqual([`0x${LSP3}`, "0x74ac2555c10b9349e78f0000"]);
    expect(r.permissions.names).toEqual(["SETDATA", "EXECUTE_RELAY_CALL"]);
  });

  it("omits the relay permission when asked", () => {
    expect(buildAuthorizeRequest({ ...base, capabilities: ["social"], relay: false }).permissions.names).toEqual(["CALL"]);
  });

  it("lists each entry once even when capabilities overlap", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["profile"], allowedKeys: ["LSP3Profile"] });
    expect(r.allowedDataKeys.keys).toEqual([`0x${LSP3}`]);
  });
});

describe("buildAuthorizeRequest: what is refused", () => {
  it("needs at least one capability (no broad default)", () => {
    expect(() => buildAuthorizeRequest(base)).toThrow(expect.objectContaining({ code: "BAD_ARGS", hint: expect.stringMatching(/tokens.*nfts.*social.*profile.*pay.*sign/s) }));
  });

  it("rejects unknown capabilities", () => {
    expect(() => buildAuthorizeRequest({ ...base, capabilities: ["everything"] })).toThrow(/unknown capability/);
  });

  it("supports LUKSO mainnet only (the website's wallet connection)", () => {
    for (const chainId of [4201, 1, 8453]) {
      expect(() => buildAuthorizeRequest({ ...base, chainId, capabilities: ["sign"] })).toThrow(expect.objectContaining({ code: "NOT_SUPPORTED", hint: expect.stringMatching(/permissions recommend/) }));
    }
  });

  it("allows elevated permissions only by explicit request and never control over the profile", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["sign"], elevated: ["SUPER_CALL"] });
    expect(r.elevated).toEqual(["SUPER_CALL"]);
    expect(r.permissions.names).toEqual(["SUPER_CALL", "SIGN", "EXECUTE_RELAY_CALL"]);
    for (const name of ["ADDCONTROLLER", "CHANGEOWNER", "EDITPERMISSIONS", "DELEGATECALL", "SUPER_DELEGATECALL", "REENTRANCY", "ADDEXTENSIONS", "CHANGEUNIVERSALRECEIVERDELEGATE", "ALL_PERMISSIONS", "4337", "CALL", "FLY"]) {
      expect(() => buildAuthorizeRequest({ ...base, capabilities: ["sign"], elevated: [name] }), name).toThrow(expect.objectContaining({ code: "BAD_ARGS" }));
    }
  });

  it("refuses delegate calls and all-wildcard entries", () => {
    expect(() => buildAuthorizeRequest({ ...base, allowTargets: [{ address: FRIEND, callTypes: ["DELEGATECALL"] }] })).toThrow(/DELEGATECALL/);
    expect(() => buildAuthorizeRequest({ ...base, allowTargets: [{ address: "*", callTypes: ["CALL"] }] })).toThrow(/wildcard/);
  });

  it("refuses data keys that belong to controllers, delegates or extensions", () => {
    for (const key of [`0x4b80742de2bf82acb3630000${CONTROLLER.slice(2)}`, "0xdf30dba06db6a30e65354d9a64c60986", "0x4b", "0xcee78b4094da860110960000", "LSP1UniversalReceiverDelegate"]) {
      expect(() => buildAuthorizeRequest({ ...base, allowedKeys: [key] }), key).toThrow(/never/);
    }
  });

  it(`refuses more than ${LINK_LIMITS.maxAllowedCalls} allowed calls`, () => {
    const many = Array.from({ length: LINK_LIMITS.maxAllowedCalls + 1 }, (_, i) => getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`));
    expect(() => buildAuthorizeRequest({ ...base, payTo: many })).toThrow(/at most/);
  });

  it.each([
    ["too long", "n".repeat(LINK_LIMITS.maxNameLength + 1)],
    ["a control character", "Nova\u0007"],
    ["a right-to-left override", "Nova‮txt"],
    ["a link", "see https://example.org"],
    ["key-like hex", `0x${"ab".repeat(32)}`],
  ])("refuses a name with %s", (_label, name) => {
    expect(() => buildAuthorizeRequest({ ...base, capabilities: ["sign"], name })).toThrow(expect.objectContaining({ code: "BAD_ARGS" }));
  });

  it("refuses an invalid or zero profile address", () => {
    expect(() => buildAuthorizeRequest({ ...base, capabilities: ["sign"], profile: "0x1234" })).toThrow(/profile/);
    expect(() => buildAuthorizeRequest({ ...base, capabilities: ["sign"], profile: "0x0000000000000000000000000000000000000000" })).toThrow(/profile/);
    expect(() => buildAuthorizeRequest({ ...base, capabilities: ["sign"], profile: CONTROLLER })).toThrow(/itself/);
  });

  it("keeps the largest allowed request under the link length limit", () => {
    const targets = Array.from({ length: 16 }, (_, i) => ({ address: getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`), callTypes: ["CALL"], selector: "0xabcdef01" }));
    const keys = Array.from({ length: 16 }, (_, i) => `0x${(i + 1).toString(16).padStart(64, "0")}`);
    const r = buildAuthorizeRequest({ ...base, allowTargets: targets, allowedKeys: keys, name: "n".repeat(48), purpose: "p".repeat(200), profile: HUMAN });
    expect(r.url.length).toBeLessThanOrEqual(LINK_LIMITS.maxUrlLength);
  });
});

describe("compatibility with the website before agent links", () => {
  it("never carries both `profile` and `controller`, so an older authorize page cannot read it as a device-import link", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["sign"], profile: HUMAN });
    const params = new URL(r.url).searchParams;
    expect(params.get("forProfile")).toBe(HUMAN);
    expect(params.has("profile")).toBe(false);
    expect(() => parseAuthorizeUrl(r.url.replace("forProfile=", "profile="))).toThrow(/profile/);
  });
});

describe("authorizeBaseUrl", () => {
  it("is the official website by default", () => {
    expect(authorizeBaseUrl({})).toBe(AUTHORIZE_WEBSITE);
    expect(AUTHORIZE_WEBSITE).toBe("https://authorize.universalprofile.cloud");
  });

  it("allows only a local development server as override", () => {
    expect(authorizeBaseUrl({ UP_AUTHORIZE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(authorizeBaseUrl({ UP_AUTHORIZE_URL: "http://127.0.0.1:3000/" })).toBe("http://127.0.0.1:3000");
    for (const bad of ["https://evil.example", "http://localhost.evil.example", "https://authorize.universalprofile.cloud.evil.example", "javascript:alert(1)", "http://localhost:3000/x?y=1"]) {
      expect(() => authorizeBaseUrl({ UP_AUTHORIZE_URL: bad }), bad).toThrow(/UP_AUTHORIZE_URL/);
    }
  });
});

describe("parseAuthorizeUrl", () => {
  it("round-trips a generated link", () => {
    const r = buildAuthorizeRequest({ ...base, capabilities: ["social", "pay"], payTo: [HUMAN], profile: HUMAN, name: "Nova & co" });
    const p = parseAuthorizeUrl(r.url);
    expect(p.controller).toBe(CONTROLLER);
    expect(p.profile).toBe(HUMAN);
    expect(p.name).toBe("Nova & co");
    expect(p.permissions.hex).toBe(r.permissions.hex);
    expect(p.allowedCalls.encoded).toBe(r.allowedCalls.encoded);
    expect(p.allowedDataKeys.encoded).toBe(r.allowedDataKeys.encoded);
  });

  it("parses the shared vector", () => {
    const p = parseAuthorizeUrl(VECTOR_URL);
    expect(p.permissions.names).toEqual(["CALL", "SETDATA", "SIGN", "EXECUTE_RELAY_CALL"]);
    expect(p.allowedCalls.entries).toHaveLength(4);
    expect(p.purpose).toBe("Follow artists for you (and nothing else)");
  });

  it("refuses links to other hosts and tampered links", () => {
    expect(() => parseAuthorizeUrl(VECTOR_URL.replace("authorize.universalprofile.cloud", "authorize.universalprofile.cloud.evil.example"))).toThrow(/authorize.universalprofile.cloud/);
    expect(() => parseAuthorizeUrl(`${VECTOR_URL}&redirect=x`)).toThrow(/redirect/);
    expect(() => parseAuthorizeUrl(VECTOR_URL.replace("SIGN", "ADDCONTROLLER"))).toThrow(/ADDCONTROLLER/);
    expect(() => parseAuthorizeUrl(VECTOR_URL.replace("network=mainnet", "network=testnet"))).toThrow(/network/);
    expect(() => parseAuthorizeUrl(`${VECTOR_URL}&controller=${HUMAN}`)).toThrow(/controller/);
  });
});

describe("LSP26 selectors used by the social capability", () => {
  it("match the signatures the skill calls", async () => {
    const { toFunctionSelector } = await import("viem");
    const { LSP26_FUNCTIONS } = await import("../../../src/lsp/authorize-link.ts");
    for (const f of LSP26_FUNCTIONS) expect(toFunctionSelector(f.signature), f.signature).toBe(f.selector);
  });
});
