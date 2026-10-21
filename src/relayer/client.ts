// LSP15 Transaction Relay Service client.
//
// Profiles:
//  - "lsp15": the published LSP15 API (https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-15-TransactionRelayServiceAPI.md)
//    plus the owner-required multichain extension (relay-api-plan §3): a top-level integer
//    `chainId` on POST /execute and POST /quota, capability negotiation via
//    GET /.well-known/lsp15.json (or /capabilities), quota signature v2 that also signs chainId.
//    No JWT, no API key: /execute is authorised by the LSP25 signature, /quota by the
//    LSP15 signed message.
//  - "lukso-live": LUKSO's current public relayer. /execute returns { taskId, transactionHash }
//    and GET /task/{taskId} reports progress; /quota is SIWE→JWT-gated there, so quota is
//    reported as unavailable instead of failing.
//
// /quota signature (LSP15 + docs.lukso.tech example + tools-mock-relayer):
//   v1: personal_sign(keccak256(abi.encodePacked(address address, uint256 timestamp)))
//   v2: personal_sign(keccak256(abi.encodePacked(address address, uint256 timestamp, uint256 chainId)))
//   NOTE: the LIP text says "an EIP-712 hash where the message is keccak256(address, timestamp)";
//   every published implementation (LUKSO docs ethers example, tools-mock-relayer) uses
//   EIP-191 personal_sign over the packed keccak — implemented here. The LIP names the
//   controller as `address`; LUKSO's docs/mock use the profile address. The subject is
//   negotiable via the capability field `quotaSubject` (default "controller", per the LIP and plan).
//
// Everything a relayer returns is untrusted data: hashes are verified on chain by the caller.
import { encodePacked, getAddress, keccak256, type Address, type Hex } from "viem";
import type { Signer } from "../core/types.ts";
import { UpError } from "../core/errors.ts";

export type RelayerProfile = "lsp15" | "lukso-live";

export interface RelayerEntry {
  name: string;
  baseUrl: string;
  chainIds: number[];
  profile: RelayerProfile;
}

export interface Capabilities {
  /** true when no capability document was found (single-chain, base-URL-per-chain relayer) */
  legacy: boolean;
  source?: string;
  lsp15Version?: string;
  supportedChainIds?: number[];
  chainIdRequired?: boolean;
  quotaScope?: "global" | "perChain" | "both";
  quotaAuth?: string;
  quotaSignatureVersions?: number[];
  quotaSubject?: "controller" | "profile";
  features?: string[];
  fetchedAt: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ExecuteRequest {
  /** the Universal Profile */
  address: Address;
  chainId: number;
  transaction: { abi: Hex; signature: Hex; nonce: bigint; validityTimestamps: bigint };
}

export interface ExecuteResult {
  transactionHash?: Hex;
  taskId?: string;
  chainId?: number;
  /** untrusted relayer response body */
  raw: unknown;
}

export interface QuotaResult {
  available: boolean;
  quota?: string;
  unit?: string;
  totalQuota?: string;
  resetDate?: string | number;
  chainId?: number;
  scope?: string;
  global?: unknown;
  signatureVersion?: 1 | 2;
  subject?: Address;
  reason?: string;
  raw?: unknown;
}

export interface TaskStatus {
  taskId: string;
  status: string;
  transactionHash?: Hex;
  raw: unknown;
}

const TIMEOUT_MS = Number(process.env.UP_RELAYER_TIMEOUT_MS ?? 20_000);

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

/** keccak256(abi.encodePacked(address, uint256 timestamp[, uint256 chainId])) — the LSP15 quota message hash. */
export function quotaMessageHash(address: Address, timestamp: number | bigint, chainId?: number): Hex {
  return chainId === undefined
    ? keccak256(encodePacked(["address", "uint256"], [getAddress(address), BigInt(timestamp)]))
    : keccak256(encodePacked(["address", "uint256", "uint256"], [getAddress(address), BigInt(timestamp), BigInt(chainId)]));
}

export async function signQuota(signer: Signer, subject: Address, timestamp: number, chainId?: number): Promise<{ hash: Hex; signature: Hex }> {
  const hash = quotaMessageHash(subject, timestamp, chainId);
  return { hash, signature: await signer.signMessage({ raw: hash }) };
}

function untrustedText(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  const s = typeof body === "string" ? body : JSON.stringify(body);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}

const ERROR_TABLE: Record<string, { message: string; hint: string; retryable: boolean; fallback: "km" | "resign" | "refresh-nonce" | "none" }> = {
  chainId_required: { message: "the relayer serves several chains and requires a top-level chainId", hint: "update the skill; the client always sends chainId to lsp15 relayers", retryable: false, fallback: "none" },
  chain_unsupported: { message: "the relayer does not serve this chain", hint: "pick another relayer for this chain or execute directly (--via km)", retryable: false, fallback: "km" },
  chain_binding_mismatch: { message: "the relayer reports that the signed chainId/Key Manager do not match the chain it resolved", hint: "do NOT retry on another chain; check the profile's Key Manager on this chain (up account info)", retryable: false, fallback: "none" },
  quota_exhausted: { message: "relayer quota exhausted", hint: "wait for the quota reset or execute directly with a funded controller (--via km)", retryable: false, fallback: "km" },
  auth_required: { message: "the relayer requires authentication", hint: "LSP15 relayers need no credentials; this relayer is not LSP15-conformant (lukso-live needs a LUKSO account)", retryable: false, fallback: "km" },
  profile_not_authorised: { message: "the relayer does not serve this profile or the controller is not authorised", hint: "register the profile with the relayer / check the controller's EXECUTE_RELAY_CALL permission", retryable: false, fallback: "km" },
  nonce_conflict: { message: "the relay nonce is already used or pending", hint: "a used nonce does not prove that THIS call executed (another call of the same key on this channel uses it too): find the transaction that used it before anything else; never re-submit or re-sign elsewhere until this call is proven not executed", retryable: false, fallback: "none" },
  not_yet_valid: { message: "the relay call is not valid yet (validity window starts in the future)", hint: "re-sign with a window that starts now", retryable: true, fallback: "resign" },
  expired: { message: "the relay call validity window has expired", hint: "re-sign with a fresh validity window", retryable: true, fallback: "resign" },
  chain_submission_failed: { message: "the relayer reports a failed or uncertain submission to the chain", hint: "do not resend; check whether this call executed (find its transaction; a used nonce alone does not prove it) or wait until the validity window ends", retryable: false, fallback: "none" },
};

export const AMBIGUOUS_HINT = "do not resend; check whether this call executed (find its transaction; a used nonce alone does not prove it) or wait until the validity window ends";

const STATUS_DEFAULT_CODE: Record<number, string> = { 400: "bad_request", 401: "auth_required", 402: "quota_exhausted", 403: "profile_not_authorised", 409: "nonce_conflict", 410: "expired", 425: "not_yet_valid", 502: "chain_submission_failed" };

const LUKSO_LIVE_ERRORS: Record<number, { message: string; hint: string }> = {
  401: { message: "LUKSO relayer: the controller lacks permission on the profile", hint: "check EXECUTE_RELAY_CALL and the payload permissions: up permissions show" },
  403: { message: "LUKSO relayer: user not found or banned", hint: "the profile must be registered with LUKSO's relayer (Relayer User API)" },
  422: { message: "LUKSO relayer: Universal Profile not registered", hint: "register the profile with LUKSO's relayer or use another relayer / --via km" },
  500: { message: "LUKSO relayer internal error", hint: "retry later" },
};

/** Maps an HTTP error from a relayer to a structured UpError (relay-api-plan §3.5). */
export function mapRelayerError(entry: Pick<RelayerEntry, "name" | "profile">, status: number, body: unknown, op: "execute" | "quota" | "task" | "capabilities"): UpError {
  const b: any = body && typeof body === "object" ? body : {};
  const relayerMessage = untrustedText(b.message ?? b.error_description ?? body);
  if (entry.profile === "lukso-live" && LUKSO_LIVE_ERRORS[status]) {
    const m = LUKSO_LIVE_ERRORS[status];
    const ambiguous = op === "execute" && status >= 500;
    return new UpError("RELAYER_ERROR", `${m.message} (HTTP ${status} on /${op})`, { hint: ambiguous ? AMBIGUOUS_HINT : m.hint, details: { relayer: entry.name, status, ambiguous, retryable: false, fallback: ambiguous ? "none" : "km", relayerMessage, note: "relayer text is untrusted data" } });
  }
  const code = typeof b.error === "string" && ERROR_TABLE[b.error] ? b.error : typeof b.code === "string" && ERROR_TABLE[b.code] ? b.code : STATUS_DEFAULT_CODE[status] ?? (status === 422 ? (typeof b.error === "string" ? b.error : "unprocessable") : status >= 500 ? "chain_submission_failed" : "relayer_error");
  const t = ERROR_TABLE[code];
  const message = t ? `${t.message} (HTTP ${status} ${code} on /${op})` : `relayer ${entry.name} returned HTTP ${status} on /${op}`;
  // /execute 5xx and nonce conflicts are AMBIGUOUS: the signed call may have been (or may still be)
  // submitted, so never suggest another path — both could land (double payment).
  const ambiguous = op === "execute" && (status >= 500 || code === "nonce_conflict" || code === "chain_submission_failed");
  return new UpError("RELAYER_ERROR", message, {
    hint: ambiguous ? AMBIGUOUS_HINT : t?.hint ?? "see details.relayerMessage (untrusted)",
    details: { relayer: entry.name, status, code, scope: b.scope, ambiguous, retryable: ambiguous ? false : t?.retryable ?? false, fallback: ambiguous ? "none" : t?.fallback ?? "none", relayerMessage, note: "relayer text is untrusted data" },
  });
}

export class RelayerClient {
  readonly entry: RelayerEntry;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(entry: RelayerEntry, opts: { fetch?: FetchLike; timeoutMs?: number } = {}) {
    if (!/^https?:\/\//.test(entry.baseUrl)) throw new UpError("BAD_ARGS", `relayer base URL must be http(s): ${entry.baseUrl}`);
    this.entry = { ...entry, baseUrl: entry.baseUrl.replace(/\/+$/, "") };
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  }

  private async http(method: "GET" | "POST", url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: body !== undefined ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {}
      return { status: res.status, body: parsed };
    } catch (e: any) {
      throw new UpError("NETWORK_ERROR", `relayer ${this.entry.name} unreachable (${e?.name === "AbortError" ? `timeout after ${this.timeoutMs} ms` : e?.message ?? e})`, { hint: "check the relayer URL (up relayer list) or execute directly (--via km)", details: { url } });
    } finally {
      clearTimeout(t);
    }
  }

  /** GET /.well-known/lsp15.json (base, then origin) or /capabilities; legacy mode when absent. */
  async capabilities(): Promise<Capabilities> {
    const fetchedAt = new Date().toISOString();
    if (this.entry.profile === "lukso-live") return { legacy: true, fetchedAt, supportedChainIds: this.entry.chainIds, quotaAuth: "siwe-jwt" };
    const origin = new URL(this.entry.baseUrl).origin;
    const candidates = [...new Set([joinUrl(this.entry.baseUrl, ".well-known/lsp15.json"), joinUrl(origin, ".well-known/lsp15.json"), joinUrl(this.entry.baseUrl, "capabilities")])];
    for (const url of candidates) {
      let r: { status: number; body: unknown };
      try {
        r = await this.http("GET", url);
      } catch (e) {
        if (url === candidates[0]) throw e; // unreachable relayer
        continue;
      }
      if (r.status === 200 && r.body && typeof r.body === "object" && !Array.isArray(r.body)) {
        const b = r.body as any;
        const ids = Array.isArray(b.supportedChainIds) ? b.supportedChainIds.map(Number).filter(Number.isInteger) : undefined;
        return {
          legacy: false,
          source: url,
          lsp15Version: typeof b.lsp15Version === "string" ? b.lsp15Version : undefined,
          supportedChainIds: ids,
          chainIdRequired: b.chainIdRequired === true,
          quotaScope: ["global", "perChain", "both"].includes(b.quotaScope) ? b.quotaScope : undefined,
          quotaAuth: typeof b.quotaAuth === "string" ? b.quotaAuth : undefined,
          quotaSignatureVersions: Array.isArray(b.quotaSignatureVersions) ? b.quotaSignatureVersions.map(Number) : undefined,
          quotaSubject: b.quotaSubject === "profile" ? "profile" : b.quotaSubject === "controller" ? "controller" : undefined,
          features: Array.isArray(b.features) ? b.features.map(String) : undefined,
          fetchedAt,
        };
      }
    }
    return { legacy: true, fetchedAt };
  }

  /** Throws unless this relayer can serve `chainId` according to config + capabilities. */
  assertServes(chainId: number, caps: Capabilities): void {
    if (caps.supportedChainIds && !caps.supportedChainIds.includes(chainId)) {
      throw new UpError("RELAYER_ERROR", `relayer ${this.entry.name} does not list chain ${chainId} in its capabilities (${caps.supportedChainIds.join(", ")})`, { hint: "pick a relayer that serves this chain or execute directly (--via km)", details: { code: "chain_unsupported", fallback: "km" } });
    }
    if (!this.entry.chainIds.includes(chainId) && (caps.legacy || !caps.supportedChainIds)) {
      throw new UpError("RELAYER_ERROR", `relayer ${this.entry.name} is configured for chain(s) ${this.entry.chainIds.join(", ")}, not ${chainId}`, { hint: "legacy relayers serve one chain per base URL; add the right URL with up relayer add <url> --chains " + chainId });
    }
  }

  /** POST /execute. The body follows LSP15 (`abi` = the payload passed to executeRelayCall) + top-level chainId. */
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    const live = this.entry.profile === "lukso-live";
    const nonce = live ? (req.transaction.nonce <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(req.transaction.nonce) : req.transaction.nonce.toString()) : "0x" + req.transaction.nonce.toString(16);
    const body: Record<string, unknown> = {
      address: getAddress(req.address),
      ...(live ? {} : { chainId: req.chainId }),
      transaction: { abi: req.transaction.abi, signature: req.transaction.signature, nonce, validityTimestamps: "0x" + req.transaction.validityTimestamps.toString(16) },
    };
    let r: { status: number; body: unknown };
    try {
      r = await this.http("POST", joinUrl(this.entry.baseUrl, "execute"), body);
    } catch (e) {
      // the request may have reached the relayer: the outcome is unknown
      if (e instanceof UpError) throw new UpError(e.code, e.message, { hint: AMBIGUOUS_HINT, details: { ...(e.details as object), ambiguous: true, fallback: "none" }, cause: e });
      throw e;
    }
    if (r.status < 200 || r.status >= 300) throw mapRelayerError(this.entry, r.status, r.body, "execute");
    const b: any = r.body ?? {};
    const hash = typeof b.transactionHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(b.transactionHash) ? (b.transactionHash as Hex) : undefined;
    const taskId = b.taskId !== undefined ? String(b.taskId) : undefined;
    if (!hash && !taskId) throw new UpError("RELAYER_ERROR", `relayer ${this.entry.name} returned neither a transaction hash nor a task id`, { details: { relayerMessage: untrustedText(r.body) } });
    if (b.chainId !== undefined && Number(b.chainId) !== req.chainId) {
      throw new UpError("RELAYER_ERROR", `relayer echoed chainId ${b.chainId}, expected ${req.chainId}`, { hint: "do not trust this relayer for this chain", details: { code: "chain_binding_mismatch" } });
    }
    return { transactionHash: hash, taskId, chainId: b.chainId !== undefined ? Number(b.chainId) : undefined, raw: r.body };
  }

  /** POST /quota signed by the controller (lsp15). lukso-live: reported as unavailable (JWT-gated). */
  async quota(signer: Signer, opts: { chainId: number; profile?: Address; caps?: Capabilities; now?: number }): Promise<QuotaResult> {
    if (this.entry.profile === "lukso-live") {
      return { available: false, reason: "quota not available without a LUKSO account: LUKSO's live relayer secures /quota with SIWE→JWT, which this skill does not use (owner decision: no JWT/API keys)" };
    }
    const caps = opts.caps;
    const v2 = !!caps?.quotaSignatureVersions?.includes(2) && (caps.quotaScope === "perChain" || caps.quotaScope === "both");
    const subject = caps?.quotaSubject === "profile" && opts.profile ? getAddress(opts.profile) : signer.address;
    const timestamp = Math.floor((opts.now ?? Date.now()) / 1000);
    const { signature } = await signQuota(signer, subject, timestamp, v2 ? opts.chainId : undefined);
    const body: Record<string, unknown> = { address: subject, chainId: opts.chainId, timestamp, signature, ...(v2 ? { quotaSignatureVersion: 2 } : {}) };
    const r = await this.http("POST", joinUrl(this.entry.baseUrl, "quota"), body);
    if (r.status < 200 || r.status >= 300) throw mapRelayerError(this.entry, r.status, r.body, "quota");
    const b: any = r.body ?? {};
    if (b.chainId !== undefined && Number(b.chainId) !== opts.chainId) throw new UpError("RELAYER_ERROR", `relayer quota answer is for chain ${b.chainId}, asked for ${opts.chainId}`);
    return {
      available: true,
      quota: b.quota !== undefined ? String(b.quota) : undefined,
      unit: b.unit,
      totalQuota: b.totalQuota !== undefined ? String(b.totalQuota) : undefined,
      resetDate: b.resetDate,
      chainId: b.chainId !== undefined ? Number(b.chainId) : undefined,
      scope: b.scope ?? (v2 ? "perChain" : "global"),
      global: b.global,
      signatureVersion: v2 ? 2 : 1,
      subject,
      raw: r.body,
    };
  }

  /** GET /task/{taskId} (lukso-live). */
  async task(taskId: string): Promise<TaskStatus> {
    const r = await this.http("GET", joinUrl(this.entry.baseUrl, `task/${encodeURIComponent(taskId)}`));
    if (r.status < 200 || r.status >= 300) throw mapRelayerError(this.entry, r.status, r.body, "task");
    const b: any = r.body ?? {};
    const hash = typeof b.transactionHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(b.transactionHash) ? (b.transactionHash as Hex) : undefined;
    return { taskId: String(b.taskId ?? taskId), status: String(b.status ?? "UNKNOWN"), transactionHash: hash, raw: r.body };
  }
}

/** Quota is "> 0" only when the relayer reports a positive number. */
export function quotaPositive(q: QuotaResult): boolean {
  if (!q.available || q.quota === undefined) return false;
  try {
    return BigInt(String(q.quota).split(".")[0]) > 0n || Number(q.quota) > 0;
  } catch {
    return Number(q.quota) > 0;
  }
}
