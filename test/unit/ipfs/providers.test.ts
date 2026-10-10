// Upload providers and gateway verification against a local mock HTTP server (never the real services).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { keccak256 } from "viem";
import { DEFAULT_UNIVERSALPROFILE_UPLOAD_KEY, isCid, kuboProvider, normaliseKuboUrl, pinataProvider, requireProvider, selectProvider, universalProfileProvider } from "../../../src/ipfs/providers.ts";
import { fetchFromGateway, fetchVerifiable, gatewayFrom, normaliseGateway, parseIpfsUrl, verifyUpload } from "../../../src/ipfs/gateway.ts";
import { UpError } from "../../../src/core/errors.ts";
import { startMockIpfs, type MockIpfs } from "../../support/mock-ipfs.ts";
import { pngBytes } from "../../support/images.ts";

let ipfs: MockIpfs;
const KEY = "unit-test-signing-key";
const file = { bytes: pngBytes(8, 8), filename: "profileImage.png", mimeType: "image/png" };

beforeAll(async () => {
  ipfs = await startMockIpfs();
  process.env.UP_IPFS_BACKOFF_MS = "1";
});
afterAll(async () => {
  delete process.env.UP_IPFS_BACKOFF_MS;
  await ipfs.close();
});
beforeEach(() => ipfs.reset());

const caught = async (p: Promise<unknown>) => p.then(() => { throw new Error("expected a rejection"); }, (e) => e as UpError);

describe("universalprofile provider", () => {
  it("POSTs multipart field 'file' with Authorization: Bearer <HS256 JWT signed with the configured key>; returns ipfs://<IpfsHash>", async () => {
    const now = 1_700_000_000_000;
    const p = universalProfileProvider({ key: KEY, endpoint: `${ipfs.url}/up/api/v0/add`, now: () => now });
    const r = await p.upload(file);
    expect(r.provider).toBe("universalprofile");
    expect(isCid(r.cid)).toBe(true);
    expect(r.url).toBe(`ipfs://${r.cid}`);
    const rec = ipfs.uploads[0];
    expect(rec.path).toBe("/up/api/v0/add");
    expect(rec.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(rec.files).toHaveLength(1);
    expect(rec.files[0]).toMatchObject({ field: "file", filename: "profileImage.png", type: "image/png" });
    expect(Buffer.from(rec.files[0].bytes).equals(Buffer.from(file.bytes))).toBe(true);
    const token = rec.authorization!.replace(/^Bearer /, "");
    const [h, pl, sig] = token.split(".");
    expect(sig).toBe(createHmac("sha256", KEY).update(`${h}.${pl}`).digest("base64url"));
    expect(JSON.parse(Buffer.from(pl, "base64url").toString())).toEqual({ iss: "extension", iat: now / 1000, exp: (now + 120_000) / 1000 });
    expect(p.label).not.toContain(KEY);
  });

  it("401 → IPFS_ERROR unauthorized (hint names the key settings, never the key); 500 → upload-failed; bad JSON / bad CID → invalid-response", async () => {
    const p = universalProfileProvider({ key: KEY, endpoint: `${ipfs.url}/up/api/v0/add` });
    ipfs.mode.uploadStatus = 401;
    const e1 = await caught(p.upload(file));
    expect(e1).toMatchObject({ code: "IPFS_ERROR", details: { reason: "unauthorized", status: 401 } });
    expect(e1.hint).toMatch(/UP_IPFS_UPLOAD_KEY/);
    expect(JSON.stringify(e1)).not.toContain(KEY);
    ipfs.mode.uploadStatus = 500;
    ipfs.mode.uploadBody = "boom\u0000\u0007 internal";
    const e2 = await caught(p.upload(file));
    expect(e2).toMatchObject({ code: "IPFS_ERROR", details: { reason: "upload-failed", status: 500 } });
    expect(e2.message).toContain("boom");
    expect(e2.message).not.toMatch(/[\u0000\u0007]/);
    ipfs.reset();
    ipfs.mode.uploadBody = "<html>not json</html>";
    expect(await caught(p.upload(file))).toMatchObject({ details: { reason: "invalid-response" } });
    ipfs.reset();
    ipfs.mode.badCid = true;
    expect(await caught(p.upload(file))).toMatchObject({ details: { reason: "invalid-response" } });
  });

  it("network failure → IPFS_ERROR upload-failed", async () => {
    const p = universalProfileProvider({ key: KEY, endpoint: "http://127.0.0.1:1/api/v0/add", timeoutMs: 2000 });
    expect(await caught(p.upload(file))).toMatchObject({ code: "IPFS_ERROR", details: { reason: "upload-failed" } });
  });
});

describe("pinata and kubo providers", () => {
  it("pinata: Bearer <user JWT>, field 'file' + pinataMetadata, returns IpfsHash", async () => {
    const p = pinataProvider({ jwt: "pinata.jwt.value", endpoint: `${ipfs.url}/pinning/pinFileToIPFS` });
    const r = await p.upload(file);
    const rec = ipfs.uploads[0];
    expect(rec.authorization).toBe("Bearer pinata.jwt.value");
    expect(rec.files[0].field).toBe("file");
    expect(JSON.parse(rec.fields.pinataMetadata)).toEqual({ name: "profileImage.png" });
    expect(ipfs.store.has(r.cid)).toBe(true);
  });

  it("an error body that echoes the credential never puts it into the error", async () => {
    ipfs.mode.uploadStatus = 500;
    ipfs.mode.uploadBody = "bad token pinata.jwt.value in Authorization: Bearer pinata.jwt.value";
    const e = await caught(pinataProvider({ jwt: "pinata.jwt.value", endpoint: `${ipfs.url}/pinning/pinFileToIPFS` }).upload(file));
    expect(e.code).toBe("IPFS_ERROR");
    expect(JSON.stringify(e) + e.message).not.toContain("pinata.jwt.value");
  });

  it("kubo: <base>/api/v0/add?cid-version=1&pin=true, optional auth header, NDJSON Hash", async () => {
    const plain = await kuboProvider({ url: ipfs.url + "/" }).upload(file);
    expect(ipfs.uploads[0].query).toBe("?cid-version=1&pin=true");
    expect(ipfs.uploads[0].authorization).toBeUndefined();
    expect(ipfs.store.get(plain.cid)).toBeDefined();
    await kuboProvider({ url: ipfs.url, auth: "Basic dXNlcjpwYXNz" }).upload(file);
    expect(ipfs.uploads[1].authorization).toBe("Basic dXNlcjpwYXNz");
    await kuboProvider({ url: ipfs.url, auth: "tokenvalue" }).upload(file);
    expect(ipfs.uploads[2].authorization).toBe("Bearer tokenvalue");
    ipfs.mode.uploadBody = "";
    expect(await caught(kuboProvider({ url: ipfs.url }).upload(file))).toMatchObject({ code: "IPFS_ERROR", details: { reason: "invalid-response" } });
  });

  it("kubo-url validation", () => {
    expect(normaliseKuboUrl("http://127.0.0.1:5001/")).toBe("http://127.0.0.1:5001");
    expect(normaliseKuboUrl("https://ipfs.example.org:5001")).toBe("https://ipfs.example.org:5001");
    for (const bad of ["ftp://x", "http://u:p@host:5001", "https://host:5001/?x=1", "not a url", "http://192.168.1.5:5001", "http://ipfs.example.org:5001"]) expect(() => normaliseKuboUrl(bad)).toThrow();
  });
});

describe("provider selection from env + config", () => {
  it("default universalprofile; env key wins over config; no key → IPFS_ERROR naming every option, no default key shipped", () => {
    expect(DEFAULT_UNIVERSALPROFILE_UPLOAD_KEY).toBeUndefined();
    const none = selectProvider({ version: 1 }, {});
    expect(none).toMatchObject({ name: "universalprofile", credentialSource: "none" });
    let err: UpError | undefined;
    try {
      requireProvider(none);
    } catch (e) {
      err = e as UpError;
    }
    expect(err).toMatchObject({ code: "IPFS_ERROR", details: { reason: "no-upload-credentials" } });
    expect(err!.hint).toMatch(/UP_IPFS_UPLOAD_KEY/);
    expect(err!.hint).toMatch(/ipfs-upload-key/);
    expect(err!.hint).toMatch(/pinata/);
    expect(err!.hint).toMatch(/kubo/);
    expect(selectProvider({ version: 1, ipfsKeys: { universalprofile: "cfg" } }, {}).credentialSource).toBe("config");
    expect(selectProvider({ version: 1, ipfsKeys: { universalprofile: "cfg" } }, { UP_IPFS_UPLOAD_KEY: "env" }).credentialSource).toBe("env");
  });

  it("pinata and kubo need their settings", () => {
    expect(selectProvider({ version: 1, ipfs: { provider: "pinata" } }, {}).missing).toMatch(/Pinata JWT/);
    expect(selectProvider({ version: 1, ipfs: { provider: "pinata" } }, { UP_PINATA_JWT: "j" }).provider?.name).toBe("pinata");
    expect(selectProvider({ version: 1, ipfs: { provider: "kubo" } }, {}).missing).toMatch(/Kubo API URL/);
    const k = selectProvider({ version: 1, ipfs: { provider: "kubo", kuboUrl: "http://127.0.0.1:5001" }, ipfsKeys: { kuboAuth: "Basic x" } }, {});
    expect(k).toMatchObject({ name: "kubo", credentialSource: "config" });
    expect(k.provider!.label).toBe("the Kubo IPFS API at 127.0.0.1:5001");
  });
});

describe("gateway fetch-back verification", () => {
  it("verifyUpload re-hashes the bytes served by the gateway (match)", async () => {
    const r = await kuboProvider({ url: ipfs.url }).upload(file);
    const v = await verifyUpload(r.cid, keccak256(file.bytes), { gateway: ipfs.gateway, what: "profile image" });
    expect(v).toMatchObject({ cid: r.cid, hash: keccak256(file.bytes), verifiedVia: `${ipfs.gateway}${r.cid}` });
  });

  it("fails closed when the gateway serves different bytes", async () => {
    const r = await kuboProvider({ url: ipfs.url }).upload(file);
    ipfs.mode.corrupt = true;
    const e = await caught(verifyUpload(r.cid, keccak256(file.bytes), { gateway: ipfs.gateway, what: "metadata JSON" }));
    expect(e).toMatchObject({ code: "IPFS_ERROR", details: { reason: "verification-failed", cid: r.cid } });
    expect(e.hint).toMatch(/nothing was written on-chain/);
  });

  it("retries while a fresh CID is not served yet (404), then gives up with gateway-unavailable", async () => {
    const r = await kuboProvider({ url: ipfs.url }).upload(file);
    ipfs.mode.missingFirst = 2;
    expect((await fetchFromGateway(r.cid, { gateway: ipfs.gateway, attempts: 3 })).length).toBe(file.bytes.length);
    ipfs.reset();
    ipfs.mode.missingFirst = 5;
    ipfs.store.set(r.cid, file.bytes);
    expect(await caught(fetchFromGateway(r.cid, { gateway: ipfs.gateway, attempts: 2 }))).toMatchObject({ details: { reason: "gateway-unavailable" } });
  });

  it("fetchVerifiable reports match / mismatch / not-verifiable and never throws", async () => {
    const r = await kuboProvider({ url: ipfs.url }).upload(file);
    const h = keccak256(file.bytes);
    expect((await fetchVerifiable(r.url, { method: "keccak256(bytes)", data: h }, { gateway: ipfs.gateway })).hashCheck).toBe("match");
    expect((await fetchVerifiable(r.url, { method: "keccak256(utf8)", data: "0x" + "00".repeat(32) }, { gateway: ipfs.gateway })).hashCheck).toBe("mismatch");
    expect((await fetchVerifiable(r.url, undefined, { gateway: ipfs.gateway })).hashCheck).toBe("not-verifiable");
    expect((await fetchVerifiable("ftp://x/y", undefined, { gateway: ipfs.gateway })).error).toMatch(/only ipfs/);
    expect((await fetchVerifiable("https://127.0.0.1/x.json", undefined, { gateway: ipfs.gateway })).error).toMatch(/non-public/);
  });

  it("gateway and ipfs:// URL validation", () => {
    expect(normaliseGateway("https://api.universalprofile.cloud/ipfs")).toBe("https://api.universalprofile.cloud/ipfs/");
    expect(normaliseGateway("http://127.0.0.1:8080/ipfs/")).toBe("http://127.0.0.1:8080/ipfs/");
    expect(() => normaliseGateway("http://gateway.example.com/ipfs/")).toThrow(/https/);
    expect(gatewayFrom({}, {})).toBe("https://api.universalprofile.cloud/ipfs/");
    expect(gatewayFrom({ ipfs: { gateway: "https://g.example/ipfs/" } }, { UP_IPFS_GATEWAY: "https://other.example/ipfs/" })).toBe("https://g.example/ipfs/");
    const cid = "QmPJESHbVkPtSaHntNVY5F6JDLW8v69M2d6khXEYGUMn7N";
    expect(parseIpfsUrl(`ipfs://${cid}`)).toEqual({ cid, path: "" });
    expect(parseIpfsUrl(`ipfs://${cid}/images/1.png`)).toEqual({ cid, path: "/images/1.png" });
    expect(parseIpfsUrl("ipfs://not-a-cid")).toBeUndefined();
    expect(parseIpfsUrl(`ipfs://${cid}/../../etc?x=1`)).toBeUndefined();
    expect(parseIpfsUrl(`ipfs://${cid}/../../admin`)).toBeUndefined();
  });
});
