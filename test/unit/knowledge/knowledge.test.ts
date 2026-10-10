import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getVerb, mcpToolName } from "../../../src/core/verbs.ts";
import { UpError } from "../../../src/core/errors.ts";
import { STANDARDS, findStandards } from "../../../src/knowledge/standards.ts";
import { listDocTopics, normaliseTopic, readDoc } from "../../../src/knowledge/verbs.ts";
import { testContext } from "../../support/context.ts";
import type { VerbContext, VerbDef } from "../../../src/core/types.ts";

let ctx: VerbContext;
let docs: VerbDef;
let standards: VerbDef;

beforeAll(() => {
  ctx = testContext(mkdtempSync(join(tmpdir(), "up-knowledge-")));
  docs = getVerb("docs")!;
  standards = getVerb("standards list")!;
});

describe("standards table", () => {
  it("covers every LSP from 0 to 26 that exists in the LIPs repository", () => {
    const ids = new Set(STANDARDS.map((s) => s.id));
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 20, 23, 25, 26]) expect(ids.has(`LSP${n}`)).toBe(true);
    for (const n of [13, 19, 21, 22, 24]) expect(ids.has(`LSP${n}`)).toBe(false);
  });

  it("covers the ERC standards the skill uses", () => {
    const ids = STANDARDS.map((s) => s.id);
    for (const e of ["ERC-20", "ERC-165", "ERC-721", "ERC-725", "ERC-1155", "ERC-1271", "ERC-4337"]) expect(ids).toContain(e);
  });

  it("has unique ids, https spec URLs, one-line summaries and well-formed interface ids", () => {
    expect(new Set(STANDARDS.map((s) => s.id)).size).toBe(STANDARDS.length);
    for (const s of STANDARDS) {
      expect(s.url).toMatch(/^https:\/\/(github\.com\/lukso-network\/LIPs\/blob\/main\/LSPs\/LSP-\d+-[A-Za-z0-9-]+\.md|eips\.ethereum\.org\/EIPS\/eip-\d+)$/);
      expect(s.summary.length).toBeGreaterThan(20);
      expect(s.summary).not.toMatch(/\n/);
      for (const id of Object.values(s.interfaceIds ?? {})) expect(id).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });

  it("uses the interface ids from the pinned lsp-smart-contracts constants", () => {
    const byId = Object.fromEntries(STANDARDS.map((s) => [s.id, s.interfaceIds ?? {}]));
    expect(byId.LSP0.LSP0).toBe("0x24871b3d");
    expect(byId.LSP6.LSP6).toBe("0x23f34c62");
    expect(byId.LSP7.LSP7).toBe("0xc52d6008");
    expect(byId.LSP8.LSP8).toBe("0x3a271706");
    expect(byId.LSP25.LSP25).toBe("0x5ac79908");
    expect(byId["ERC-1271"].ERC1271).toBe("0x1626ba7e");
  });

  it("filters by exact id, by kind and by word", () => {
    expect(findStandards("lsp25").map((s) => s.id)).toEqual(["LSP25"]);
    expect(findStandards("ERC-4337").map((s) => s.id)).toEqual(["ERC-4337"]);
    expect(findStandards("erc4337").map((s) => s.id)).toEqual(["ERC-4337"]);
    expect(findStandards("token").map((s) => s.id)).toEqual(["LSP7", "LSP8"]);
    expect(findStandards("follow").map((s) => s.id)).toContain("LSP26");
    expect(findStandards("no-such-standard-anywhere")).toEqual([]);
    expect(findStandards().length).toBe(STANDARDS.length);
  });
});

describe("standards list verb", () => {
  it("is a local verb exposed as up_standards_list", () => {
    expect(standards.risk).toBe("local");
    expect(mcpToolName(standards.name)).toBe("up_standards_list");
  });

  it("returns the table and a readable text", async () => {
    const r = await standards.run(ctx, {});
    const data = r.data as { count: number; standards: { id: string }[] };
    expect(data.count).toBe(STANDARDS.length);
    expect(r.text).toContain("LSP6");
    expect(r.text).toContain("https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-6-KeyManager.md");
  });

  it("applies the filter", async () => {
    const r = await standards.run(ctx, { filter: "lsp6" });
    expect((r.data as { standards: { id: string }[] }).standards.map((s) => s.id)).toEqual(["LSP6"]);
    const none = await standards.run(ctx, { filter: "zzzz-nothing" });
    expect((none.data as { count: number }).count).toBe(0);
  });
});

describe("docs verb", () => {
  it("is a local verb exposed as up_docs", () => {
    expect(docs.risk).toBe("local");
    expect(mcpToolName(docs.name)).toBe("up_docs");
  });

  it("lists the bundled references with titles", async () => {
    const topics = listDocTopics();
    const names = topics.map((t) => t.topic);
    for (const t of ["onboarding", "execution-paths", "permissions", "relayer", "erc4337", "chains", "discovery", "protocols", "tokens", "security", "platforms", "standards", "errors"]) {
      expect(names).toContain(t);
    }
    for (const t of topics) {
      expect(t.file).toBe(`references/${t.topic}.md`);
      expect(t.title.length).toBeGreaterThan(0);
    }
    const r = await docs.run(ctx, {});
    expect((r.data as { count: number }).count).toBe(topics.length);
    expect(r.text).toContain("security");
  });

  it("prints one reference in text and metadata in data", async () => {
    const r = await docs.run(ctx, { topic: "security" });
    const data = r.data as { topic: string; file: string; bytes: number };
    expect(data.topic).toBe("security");
    expect(data.file).toBe("references/security.md");
    expect(data.bytes).toBeGreaterThan(500);
    expect(r.text).toMatch(/private key/i);
  });

  it("accepts file-name spellings of a topic", () => {
    expect(normaliseTopic("Security.md")).toBe("security");
    expect(normaliseTopic("references/errors.md")).toBe("errors");
    expect(readDoc("ERRORS").doc.topic).toBe("errors");
  });

  it("rejects unknown and path-like topics with BAD_ARGS", async () => {
    await expect(docs.run(ctx, { topic: "no-such-topic" })).rejects.toMatchObject({ code: "BAD_ARGS" });
    for (const bad of ["../SKILL", "../../package.json", "/etc/passwd", "a/b", ".hidden", "x y"]) {
      let err: unknown;
      try {
        normaliseTopic(bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UpError);
      expect((err as UpError).code).toBe("BAD_ARGS");
    }
  });
});
