// Local mock of the IPFS services the skill talks to (never the real ones):
//   POST /api/v0/add?cid-version=1&pin=true   Kubo RPC (NDJSON { Name, Hash, Size })
//   POST /up/api/v0/add                        Universal Profile IPFS API ({ IpfsHash })
//   POST /pinning/pinFileToIPFS                Pinata ({ IpfsHash, PinSize, Timestamp })
//   GET  /ipfs/<cid>                           gateway serving what was uploaded
// Multipart bodies are parsed with the platform's own FormData parser; every request is
// recorded (path, authorization header, fields) so tests can assert on them.
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";

export interface RecordedUpload {
  path: string;
  query: string;
  authorization?: string;
  contentType?: string;
  files: { field: string; filename: string; type: string; bytes: Uint8Array }[];
  fields: Record<string, string>;
}

export interface MockIpfs {
  url: string;
  gateway: string;
  uploads: RecordedUpload[];
  gets: string[];
  store: Map<string, Uint8Array>;
  /** Mutable behaviour switches. */
  mode: { uploadStatus?: number; uploadBody?: string; corrupt?: boolean; missingFirst?: number; badCid?: boolean; beforeUploadResponse?: (rec: RecordedUpload) => Promise<void> };
  reset(): void;
  close(): Promise<void>;
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Deterministic CIDv1-shaped id for the bytes (raw codec + sha2-256 multihash, base32). */
export function fakeCid(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest();
  return "b" + base32(Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest]));
}

export async function startMockIpfs(opts: { host?: string } = {}): Promise<MockIpfs> {
  const uploads: RecordedUpload[] = [];
  const gets: string[] = [];
  const store = new Map<string, Uint8Array>();
  const mode: MockIpfs["mode"] = {};
  let missing = 0;
  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    if (req.method === "GET" && u.pathname.startsWith("/ipfs/")) {
      const cid = u.pathname.slice("/ipfs/".length);
      gets.push(cid);
      if (mode.missingFirst && missing < mode.missingFirst) {
        missing++;
        res.writeHead(404).end("not found yet");
        return;
      }
      const b = store.get(cid);
      if (!b) {
        res.writeHead(404).end("not found");
        return;
      }
      const served = mode.corrupt ? Uint8Array.from(b, (x, i) => (i === 0 ? x ^ 0xff : x)) : b;
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(served.length) }).end(Buffer.from(served));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const rec: RecordedUpload = { path: u.pathname, query: u.search, authorization: req.headers.authorization, contentType: req.headers["content-type"], files: [], fields: {} };
    try {
      const form = await new Response(body, { headers: { "content-type": String(req.headers["content-type"] ?? "") } }).formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") rec.fields[k] = v;
        else rec.files.push({ field: k, filename: (v as File).name, type: v.type, bytes: new Uint8Array(await v.arrayBuffer()) });
      }
    } catch {
      // recorded with no parts
    }
    uploads.push(rec);
    if (mode.beforeUploadResponse) await mode.beforeUploadResponse(rec);
    if (mode.uploadStatus) {
      res.writeHead(mode.uploadStatus).end(mode.uploadBody ?? "error");
      return;
    }
    const file = rec.files[0];
    if (!file) {
      res.writeHead(400).end("no file");
      return;
    }
    const cid = mode.badCid ? "not-a-cid" : fakeCid(file.bytes);
    store.set(cid, file.bytes);
    if (mode.uploadBody !== undefined) {
      res.writeHead(200, { "content-type": "application/json" }).end(mode.uploadBody);
      return;
    }
    if (u.pathname === "/api/v0/add") {
      res.writeHead(200, { "content-type": "application/x-ndjson" }).end(`${JSON.stringify({ Name: file.filename, Hash: cid, Size: String(file.bytes.length) })}\n`);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ IpfsHash: cid, PinSize: file.bytes.length, Timestamp: new Date(0).toISOString() }));
  });
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${(server.address() as any).port}`;
  return {
    url,
    gateway: `${url}/ipfs/`,
    uploads,
    gets,
    store,
    mode,
    reset() {
      uploads.length = 0;
      gets.length = 0;
      missing = 0;
      for (const k of Object.keys(mode)) delete (mode as any)[k];
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
