// IPFS upload providers behind one small interface (Node fetch + FormData only):
//   universalprofile (default) — https://api.universalprofile.cloud/api/v0/add, multipart field
//                                "file", Authorization: Bearer <HS256 JWT> (see jwt.ts),
//                                response { IpfsHash }
//   pinata                     — https://api.pinata.cloud/pinning/pinFileToIPFS with the user's
//                                Pinata JWT, response { IpfsHash }
//   kubo                       — any IPFS (Kubo) RPC API: <base>/api/v0/add?cid-version=1&pin=true,
//                                optional Authorization header, response NDJSON { Hash }
// Credentials come from environment variables first, then the local config (`up config set`,
// stored like the other credentials: never printed, redacted in `config get`). They never
// appear in results, errors or logs.
import { UpError } from "../core/errors.ts";
import type { UpConfig } from "../core/types.ts";
import type { FetchLike } from "../abi/http.ts";
import { readCapped } from "../abi/http.ts";
import { universalProfileUploadToken } from "./jwt.ts";

export type IpfsProviderName = "universalprofile" | "pinata" | "kubo";
export const IPFS_PROVIDERS: readonly IpfsProviderName[] = ["universalprofile", "pinata", "kubo"];

export const UNIVERSALPROFILE_UPLOAD_URL = "https://api.universalprofile.cloud/api/v0/add";
export const PINATA_UPLOAD_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

/**
 * >>> PRODUCT-OWNER HOOK: default signing key for the Universal Profile IPFS API. <<<
 * Intentionally undefined. The skill ships NO shared secret: the HS256 key must come from
 * UP_IPFS_UPLOAD_KEY or `up config set ipfs-upload-key <key>`. If the product owner later
 * approves a key that may be distributed with the skill, it is set here (and only here);
 * env and config keep precedence over it.
 */
export const DEFAULT_UNIVERSALPROFILE_UPLOAD_KEY: string | undefined = undefined;

export interface UploadFile {
  bytes: Uint8Array;
  /** File name sent in the multipart part (does not change the CID of a single file). */
  filename: string;
  mimeType: string;
}

export interface UploadResult {
  cid: string;
  /** ipfs://<cid> */
  url: string;
  provider: IpfsProviderName;
}

export interface IpfsProvider {
  readonly name: IpfsProviderName;
  /** Safe-to-print description (host only, never credentials). */
  readonly label: string;
  upload(file: UploadFile): Promise<UploadResult>;
}

/** CIDv0 (base58btc "Qm…") or CIDv1 in base32 ("b…") / base58btc ("z…"). Anything else is refused. */
export function isCid(s: unknown): s is string {
  return typeof s === "string" && /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,120}|z[1-9A-HJ-NP-Za-km-z]{40,120})$/.test(s);
}

/** Printable, single-line, bounded excerpt of an untrusted provider response (for error messages); credentials echoed back are removed. */
function excerpt(s: string, secrets: string[] = []): string {
  let t = s;
  for (const x of secrets) if (x && x.length >= 4) t = t.split(x).join("[redacted]");
  return t.replace(/[^\x20-\x7e]+/g, " ").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").trim().slice(0, 200);
}

interface PostOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** The credential values to scrub from anything a provider (or the network stack) says back. */
function secretsOf(headers: Record<string, string>): string[] {
  return headers.authorization ? [headers.authorization, headers.authorization.replace(/^\S+\s+/, "")] : [];
}

async function postFile(provider: IpfsProviderName, label: string, url: string, headers: Record<string, string>, file: UploadFile, opts: PostOptions, extra?: (form: FormData) => void): Promise<string> {
  const secrets = secretsOf(headers);
  const form = new FormData();
  form.append("file", new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.mimeType }), file.filename);
  extra?.(form);
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  let res: Response;
  try {
    // never follow redirects: a redirected upload would replay the file and the credentials elsewhere
    res = await f(url, { method: "POST", redirect: "error", headers: { accept: "application/json", "user-agent": "universal-profile-skill", ...headers }, body: form, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    const why = (e as Error)?.name === "AbortError" ? "timeout" : excerpt(String((e as Error)?.message ?? e), secrets);
    throw new UpError("IPFS_ERROR", `upload to ${label} failed: ${why}`, { hint: "check the connection (egress to the upload host must be allowed) and retry; nothing was written on-chain", details: { reason: "upload-failed", provider } });
  }
  try {
    const text = new TextDecoder().decode(await readCapped(res, 256 * 1024, ctrl).catch(() => new Uint8Array(0)));
    if (res.status === 401 || res.status === 403) {
      throw new UpError("IPFS_ERROR", `${label} refused the upload credentials (HTTP ${res.status})`, {
        hint: provider === "universalprofile" ? "the upload key (UP_IPFS_UPLOAD_KEY / ipfs-upload-key) is wrong or not accepted; ask the human to check it, or use another provider (up config set ipfs-provider pinata|kubo)" : provider === "pinata" ? "the Pinata JWT (UP_PINATA_JWT / pinata-jwt) is wrong or lacks the pinFileToIPFS scope" : "the Kubo API needs other credentials (UP_KUBO_AUTH / kubo-auth)",
        details: { reason: "unauthorized", provider, status: res.status },
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new UpError("IPFS_ERROR", `upload to ${label} failed with HTTP ${res.status}${text ? `: ${excerpt(text, secrets)}` : ""}`, { hint: "retry later or choose another provider (up config set ipfs-provider …); nothing was written on-chain", details: { reason: "upload-failed", provider, status: res.status } });
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function cidFrom(provider: IpfsProviderName, label: string, value: unknown): UploadResult {
  if (!isCid(value)) throw new UpError("IPFS_ERROR", `${label} returned no valid CID`, { hint: "the provider answered unexpectedly; retry or choose another provider", details: { reason: "invalid-response", provider } });
  return { cid: value, url: `ipfs://${value}`, provider };
}

function parseJson(provider: IpfsProviderName, label: string, text: string, secrets: string[]): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new UpError("IPFS_ERROR", `${label} returned no JSON: ${excerpt(text, secrets).slice(0, 80)}`, { hint: "retry or choose another provider", details: { reason: "invalid-response", provider } });
  }
}

export function universalProfileProvider(o: { key: string; endpoint?: string; fetch?: FetchLike; now?: () => number; timeoutMs?: number }): IpfsProvider {
  const url = o.endpoint ?? UNIVERSALPROFILE_UPLOAD_URL;
  const label = `the Universal Profile IPFS API (${new URL(url).host})`;
  return {
    name: "universalprofile",
    label,
    async upload(file) {
      // a fresh token per request: it is valid for 120 s only
      const token = universalProfileUploadToken(o.key, o.now?.() ?? Date.now());
      const headers = { authorization: `Bearer ${token}` };
      const text = await postFile("universalprofile", label, url, headers, file, o);
      return cidFrom("universalprofile", label, parseJson("universalprofile", label, text, [...secretsOf(headers), o.key])?.IpfsHash);
    },
  };
}

export function pinataProvider(o: { jwt: string; endpoint?: string; fetch?: FetchLike; timeoutMs?: number }): IpfsProvider {
  const url = o.endpoint ?? PINATA_UPLOAD_URL;
  const label = `Pinata (${new URL(url).host})`;
  return {
    name: "pinata",
    label,
    async upload(file) {
      const headers = { authorization: `Bearer ${o.jwt}` };
      const text = await postFile("pinata", label, url, headers, file, o, (form) => form.append("pinataMetadata", JSON.stringify({ name: file.filename })));
      return cidFrom("pinata", label, parseJson("pinata", label, text, secretsOf(headers))?.IpfsHash);
    },
  };
}

/** Kubo base URL: https, or http only on a loopback host (credentials must not travel in clear text); no credentials in the URL, no query; trailing slash removed. */
export function normaliseKuboUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // the raw value is never echoed: it may contain a password or a token
    throw new UpError("BAD_ARGS", "kubo-url is not a valid URL", { hint: "e.g. http://127.0.0.1:5001 (the IPFS RPC API, not the gateway)" });
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UpError("BAD_ARGS", "kubo-url must be an http(s) URL", { hint: "e.g. http://127.0.0.1:5001" });
  if (u.protocol === "http:" && !/^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i.test(u.hostname)) throw new UpError("BAD_ARGS", "kubo-url must use https unless the node runs on this machine (127.0.0.1 / localhost)", { hint: "put a remote Kubo API behind https (e.g. a reverse proxy) so uploads and credentials are encrypted" });
  if (u.username || u.password) throw new UpError("BAD_ARGS", "kubo-url must not contain credentials", { hint: "put the Authorization header value into UP_KUBO_AUTH or up config set kubo-auth" });
  if (u.search || u.hash) throw new UpError("BAD_ARGS", "kubo-url must not contain a query or fragment");
  return u.toString().replace(/\/+$/, "");
}

export function kuboProvider(o: { url: string; auth?: string; fetch?: FetchLike; timeoutMs?: number }): IpfsProvider {
  const base = normaliseKuboUrl(o.url);
  const host = new URL(base).host;
  const label = `the Kubo IPFS API at ${host}`;
  const headers: Record<string, string> = {};
  if (o.auth) headers.authorization = /\s/.test(o.auth.trim()) ? o.auth.trim() : `Bearer ${o.auth.trim()}`;
  return {
    name: "kubo",
    label,
    async upload(file) {
      const text = await postFile("kubo", label, `${base}/api/v0/add?cid-version=1&pin=true`, headers, file, o);
      // NDJSON: one object per added entry; for a single file the last line carries its Hash
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) throw new UpError("IPFS_ERROR", `${label} returned an empty response`, { hint: "is kubo-url the RPC API (port 5001), not the gateway?", details: { reason: "invalid-response", provider: "kubo" } });
      return cidFrom("kubo", label, parseJson("kubo", label, lines[lines.length - 1], secretsOf(headers))?.Hash);
    },
  };
}

export interface ProviderSelection {
  provider?: IpfsProvider;
  name: IpfsProviderName;
  /** Where the credential came from (never the value). */
  credentialSource?: "env" | "config" | "default" | "none";
  /** Why no provider could be built. */
  missing?: string;
}

const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** Builds the configured provider (default universalprofile) from env + config. Never throws for missing credentials: see `missing`. */
export function selectProvider(cfg: UpConfig, env: NodeJS.ProcessEnv = process.env, opts: { fetch?: FetchLike } = {}): ProviderSelection {
  const name = (cfg.ipfs?.provider ?? "universalprofile") as IpfsProviderName;
  if (name === "universalprofile") {
    const fromEnv = nonEmpty(env.UP_IPFS_UPLOAD_KEY);
    const fromCfg = nonEmpty(cfg.ipfsKeys?.universalprofile);
    const key = fromEnv ?? fromCfg ?? DEFAULT_UNIVERSALPROFILE_UPLOAD_KEY;
    if (!key) return { name, credentialSource: "none", missing: "no upload key for the Universal Profile IPFS API" };
    return { name, provider: universalProfileProvider({ key, fetch: opts.fetch }), credentialSource: fromEnv ? "env" : fromCfg ? "config" : "default" };
  }
  if (name === "pinata") {
    const fromEnv = nonEmpty(env.UP_PINATA_JWT);
    const jwt = fromEnv ?? nonEmpty(cfg.ipfsKeys?.pinata);
    if (!jwt) return { name, credentialSource: "none", missing: "no Pinata JWT" };
    return { name, provider: pinataProvider({ jwt, fetch: opts.fetch }), credentialSource: fromEnv ? "env" : "config" };
  }
  if (name === "kubo") {
    const url = nonEmpty(env.UP_KUBO_URL) ?? nonEmpty(cfg.ipfs?.kuboUrl);
    if (!url) return { name, credentialSource: "none", missing: "no Kubo API URL" };
    const fromEnv = nonEmpty(env.UP_KUBO_AUTH);
    const auth = fromEnv ?? nonEmpty(cfg.ipfsKeys?.kuboAuth);
    return { name, provider: kuboProvider({ url, auth, fetch: opts.fetch }), credentialSource: auth ? (fromEnv ? "env" : "config") : "none" };
  }
  return { name, missing: `unknown IPFS provider "${name}"` };
}

/** The provider, or IPFS_ERROR naming every way to configure one. */
export function requireProvider(sel: ProviderSelection): IpfsProvider {
  if (sel.provider) return sel.provider;
  const options = [
    "universalprofile (default): set the upload key in the environment variable UP_IPFS_UPLOAD_KEY, or once with: up config set ipfs-upload-key <key>",
    "pinata: up config set ipfs-provider pinata, plus UP_PINATA_JWT or up config set pinata-jwt <jwt>",
    "kubo (your own IPFS node): up config set ipfs-provider kubo, up config set kubo-url http://127.0.0.1:5001 (optional UP_KUBO_AUTH / kubo-auth)",
  ];
  throw new UpError("IPFS_ERROR", `cannot upload to IPFS: ${sel.missing} (provider ${sel.name})`, {
    hint: `ask the human to configure an IPFS upload provider — ${options.join("; ")}. Credentials are never shown back; prefer the environment variables.`,
    details: { reason: "no-upload-credentials", provider: sel.name, options },
  });
}
