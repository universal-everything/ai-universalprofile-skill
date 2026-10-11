// The shared sanitizer for text from outside (backup files, MCP identifiers): the shape of a private key
// is never repeated, whether or not the key is loaded.
import { describe, expect, it } from "vitest";
import { KEY_WITHHELD, canonicalDateTime, looksLikeKey, safeEcho, safeFileText } from "../../../src/core/safe-text.ts";

const KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public Anvil key 0

describe("looksLikeKey", () => {
  it("64 hex digits in any spelling", () => {
    for (const t of [KEY, `0x${KEY}`, KEY.toUpperCase(), `0X${KEY.toUpperCase()}`, `my key is ${KEY}!`, `${KEY}${KEY}`, `x${KEY}y`]) expect(looksLikeKey(t), t).toBe(true);
  });

  it("also when spread over separators or hidden by invisible characters", () => {
    const spaced = KEY.match(/.{8}/g)!.join(" ");
    for (const t of [spaced, KEY.match(/.{4}/g)!.join("-"), KEY.match(/.{16}/g)!.join("\n"), KEY.match(/.{2}/g)!.join(":"), KEY.split("").join("​"), `${KEY.slice(0, 30)}\u0000${KEY.slice(30)}`, KEY.match(/.{8}/g)!.join(" | ")]) expect(looksLikeKey(t), JSON.stringify(t)).toBe(true);
  });

  it("not for ordinary text, addresses, short hex or 63 digits", () => {
    for (const t of ["Alice's account", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", KEY.slice(0, 63), "deadbeef ".repeat(7).trim(), "2026-10-10T12:00:00Z", ""]) expect(looksLikeKey(t), t).toBe(false);
  });
});

describe("safeFileText", () => {
  it("keeps ordinary text, drops control characters and caps the length", () => {
    expect(safeFileText("Alice\nand\tBob")).toBe("Alice and Bob");
    expect(safeFileText("x".repeat(200))).toBe("x".repeat(80) + "…");
    expect(safeFileText("x".repeat(200), 255)).toHaveLength(200);
    expect(safeFileText(undefined)).toBe("");
    expect(safeFileText(12)).toBe("12");
  });

  it("replaces a key-shaped text as a whole, also one that would be cut off by the length cap", () => {
    expect(safeFileText(KEY)).toBe(KEY_WITHHELD);
    expect(safeFileText(`${"a ".repeat(30)}${KEY}`)).toBe(KEY_WITHHELD);
    expect(safeFileText(`0x${KEY}`, 255)).toBe(KEY_WITHHELD);
  });
});

describe("safeEcho", () => {
  it("elides long hex runs and caps the length", () => {
    expect(safeEcho(`up_${KEY}`)).toBe("up_<hidden>");
    expect(safeEcho(`0x${KEY.slice(0, 33)}`)).toBe("0x<hidden>");
    expect(safeEcho("x".repeat(100))).toBe("x".repeat(64) + "…");
    expect(safeEcho(undefined)).toBe("");
    expect(safeEcho({ toString: () => KEY })).toBe("[object]");
  });
});

describe("canonicalDateTime", () => {
  it("only an ISO date-time", () => {
    for (const d of ["2026-10-10T12:00:00Z", "2026-10-10T12:00:00.123Z", "2026-10-10T12:00:00+02:00"]) expect(canonicalDateTime(d)).toBe(d);
    for (const d of [KEY, "2026-10-10", "10/10/2026", "2026-13-45T99:00:00Z", "yesterday", "", undefined, 1760000000000, null]) expect(canonicalDateTime(d), String(d)).toBeUndefined();
  });
});
