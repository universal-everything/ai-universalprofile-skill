// In-process LSP15 relayer for chain tests (never shipped), plus small chain
// fixtures shared by the account-core chain tests (probe contracts, agent profile setup).
//
// Implements, over real HTTP:
//   GET  /api/.well-known/lsp15.json   capability document (absent in "legacy" mode)
//   POST /api/execute                  LSP15 + top-level chainId; verifies shape (nonce and validityTimestamps
//                                      only as 0x hex uint256 strings, like the relayers the client targets),
//                                      chainId routing and the LSP25 chain binding (digest recomputed with the
//                                      KM resolved on that chain), simulates, then submits KM.executeRelayCall
//                                      from a funded relayer account (relayer pays gas)
//   POST /api/quota                    verifies the LSP15 signed message (v1/v2, ±300 s)
//   GET  /api/task/:id                 "lukso-live" mode only
import { createServer, type Server } from "node:http";
import {
  concat,
  decodeErrorResult,
  encodeFunctionData,
  encodePacked,
  getAddress,
  isAddress,
  keccak256,
  recoverAddress,
  recoverMessageAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import errors from "../../skills/universal-profile/assets/abis/errors.json" with { type: "json" };
import { KM_ABI, UP_ABI } from "../../src/lsp/abis.ts";
import { permissionsKey } from "../../src/lsp/constants.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { PRESETS, toBytes32 } from "../../src/lsp/permissions.ts";
import { manifestFromPlan, planDeployment, deployFromManifest, saveManifest, type DeploymentManifest } from "../../src/lsp/lsp23.ts";

export type RpcRequest = (method: string, params?: unknown[]) => Promise<any>;

export interface MockRelayerOptions {
  request: RpcRequest;
  chainId: number;
  relayerAccount: Address;
  mode?: "lsp15" | "legacy" | "lukso-live";
  chainIdRequired?: boolean;
  supportedChainIds?: number[];
  quota?: { quota: number; unit: string; totalQuota: number; resetDate: number };
  quotaSignatureVersions?: number[];
  quotaScope?: "global" | "perChain" | "both";
  quotaSubject?: "controller" | "profile";
  /** return a fabricated transaction hash instead of submitting (lying relayer) */
  lie?: boolean;
  /** return this (real but unrelated) transaction hash instead of submitting */
  lieWithHash?: Hex;
  /** submit the transaction, then answer 502 (ambiguous: the call DID land) */
  failAfterSubmit?: boolean;
  /** answer 502 without submitting (ambiguous: the call did NOT land) */
  failBeforeSubmit?: boolean;
  /** test hook, called with a well-formed, chain-bound /execute body: a returned [status, body] is the answer and nothing else is submitted */
  respond?: (body: any) => Promise<[number, any] | undefined>;
}

export interface MockRelayer {
  url: string;
  /** `raw` is the request body exactly as it arrived over HTTP (before JSON.parse) */
  requests: { path: string; raw: string; body: any; status: number; response: any }[];
  quotaChecks: { recovered: Address; subject: Address; version: number; ok: boolean }[];
  opts: MockRelayerOptions;
  close(): Promise<void>;
}

/** A uint256 as a 0x hex string (what the client sends); JSON numbers and decimal strings are refused. */
const isHexUint256 = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v);

const call = async (request: RpcRequest, to: Address, data: Hex, from?: Address) => request("eth_call", [{ to, data, from }, "latest"]) as Promise<Hex>;

function revertCode(e: any): { code: string; status: number; message: string } {
  let data: Hex | undefined;
  for (let cur = e, i = 0; cur && i < 6; i++, cur = cur.cause) {
    const d = cur?.data?.data ?? cur?.data;
    if (typeof d === "string" && d.startsWith("0x")) {
      data = d as Hex;
      break;
    }
  }
  let name = "unknown";
  try {
    if (data) name = decodeErrorResult({ abi: errors as Abi, data }).errorName;
  } catch {}
  switch (name) {
    case "RelayCallExpired":
      return { code: "expired", status: 410, message: name };
    case "RelayCallBeforeStartTime":
      return { code: "not_yet_valid", status: 425, message: name };
    case "InvalidRelayNonce":
      return { code: "nonce_conflict", status: 409, message: name };
    case "NotAuthorised":
    case "NoPermissionsSet":
      return { code: "profile_not_authorised", status: 403, message: name };
    default:
      return { code: "chain_submission_failed", status: 502, message: `${name} ${String(e?.message ?? "").slice(0, 120)}` };
  }
}

export async function startMockRelayer(opts: MockRelayerOptions): Promise<MockRelayer> {
  const mode = opts.mode ?? "lsp15";
  const requests: MockRelayer["requests"] = [];
  const quotaChecks: MockRelayer["quotaChecks"] = [];
  const tasks = new Map<string, { status: string; transactionHash?: Hex }>();
  let quotaLeft = opts.quota?.quota ?? 1_000_000;
  const supported = opts.supportedChainIds ?? [opts.chainId];

  const handleExecute = async (b: any): Promise<[number, any]> => {
    if (!b || typeof b !== "object" || !isAddress(String(b.address ?? "")) || !b.transaction) return [400, { error: "bad_request", message: "address and transaction are required" }];
    const t = b.transaction;
    if (typeof t.abi !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(t.abi) || typeof t.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(t.signature) || t.nonce === undefined) {
      return [400, { error: "bad_request", message: "transaction.abi, signature and nonce are required" }];
    }
    if (!isHexUint256(t.nonce) || (t.validityTimestamps !== undefined && !isHexUint256(t.validityTimestamps))) {
      return [400, { error: "bad_request", message: "transaction.nonce and validityTimestamps must be uint256 values as 0x hex strings" }];
    }
    let chainId = opts.chainId;
    if (mode === "lsp15") {
      if (b.chainId === undefined) {
        if (opts.chainIdRequired) return [400, { error: "chainId_required" }];
      } else {
        if (typeof b.chainId !== "number" || !Number.isInteger(b.chainId)) return [400, { error: "bad_request", message: "chainId must be an integer" }];
        if (!supported.includes(b.chainId)) return [400, { error: "chain_unsupported", message: `chain ${b.chainId} is not served` }];
        chainId = b.chainId;
      }
    }
    if (quotaLeft <= 0) return [402, { error: "quota_exhausted", scope: "perChain" }];
    const profile = getAddress(b.address);
    const nonce = BigInt(t.nonce);
    const validity = BigInt(t.validityTimestamps ?? 0);
    // Binding check: recompute the LSP25 digest with the chain's actual id and the profile's KM on that chain.
    const actualChainId = Number(BigInt(await opts.request("eth_chainId", [])));
    if (actualChainId !== chainId) return [422, { error: "chain_binding_mismatch", message: "chain not served by this endpoint" }];
    const km = getAddress(("0x" + (await call(opts.request, profile, encodeFunctionData({ abi: UP_ABI, functionName: "owner" }))).slice(26)) as Address);
    const message = encodePacked(["uint256", "uint256", "uint256", "uint256", "uint256", "bytes"], [25n, BigInt(chainId), nonce, validity, 0n, t.abi as Hex]);
    const digest = keccak256(concat(["0x19", "0x00", km, message]));
    const signer = await recoverAddress({ hash: digest, signature: t.signature as Hex });
    const permsRaw = (await call(opts.request, profile, encodeFunctionData({ abi: UP_ABI, functionName: "getData", args: [permissionsKey(signer)] }))) as Hex;
    const perms = permsRaw.length >= 130 + 2 ? BigInt("0x" + permsRaw.slice(130, 194)) : 0n;
    if (perms === 0n) return [422, { error: "chain_binding_mismatch", message: "signature does not recover to a controller of this profile on this chain" }];
    const data = encodeFunctionData({ abi: KM_ABI, functionName: "executeRelayCall", args: [t.signature as Hex, nonce, validity, t.abi as Hex] });
    if (opts.respond) {
      const r = await opts.respond(b);
      if (r) return r;
    }
    if (opts.lieWithHash) return [200, { transactionHash: opts.lieWithHash, chainId }];
    if (opts.failBeforeSubmit) return [502, { error: "chain_submission_failed", message: "upstream timeout" }];
    if (opts.lie) {
      const fake = keccak256(concat([data, "0x01"]));
      return [200, mode === "lukso-live" ? { taskId: "task-lie", transactionHash: fake } : { transactionHash: fake, chainId }];
    }
    try {
      await opts.request("eth_call", [{ from: opts.relayerAccount, to: km, data }, "latest"]);
    } catch (e) {
      const r = revertCode(e);
      return [r.status, { error: r.code, message: r.message }];
    }
    const hash = (await opts.request("eth_sendTransaction", [{ from: opts.relayerAccount, to: km, data, gas: "0x1000000" }])) as Hex;
    quotaLeft -= 1;
    if (opts.failAfterSubmit) return [502, { error: "chain_submission_failed", message: "gateway timeout after broadcast" }];
    if (mode === "lukso-live") {
      const taskId = `task-${tasks.size + 1}`;
      tasks.set(taskId, { status: "COMPLETE", transactionHash: hash });
      return [201, { taskId, transactionHash: hash }];
    }
    return [200, { transactionHash: hash, chainId }];
  };

  const handleQuota = async (b: any): Promise<[number, any]> => {
    if (mode === "lukso-live") return [401, { message: "Unauthorized" }];
    if (!b || !isAddress(String(b.address ?? "")) || typeof b.timestamp !== "number" || typeof b.signature !== "string") return [400, { error: "bad_request" }];
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - b.timestamp) > 300) return [401, { error: "auth_required", message: "stale timestamp" }];
    const v2 = b.quotaSignatureVersion === 2;
    if (v2 && typeof b.chainId !== "number") return [400, { error: "chainId_required" }];
    if (b.chainId !== undefined && !supported.includes(b.chainId)) return [400, { error: "chain_unsupported" }];
    const hash = v2
      ? keccak256(encodePacked(["address", "uint256", "uint256"], [getAddress(b.address), BigInt(b.timestamp), BigInt(b.chainId)]))
      : keccak256(encodePacked(["address", "uint256"], [getAddress(b.address), BigInt(b.timestamp)]));
    const recovered = await recoverMessageAddress({ message: { raw: hash }, signature: b.signature as Hex });
    const subjectMode = opts.quotaSubject ?? "controller";
    const ok = subjectMode === "controller" ? recovered === getAddress(b.address) : true;
    quotaChecks.push({ recovered, subject: getAddress(b.address), version: v2 ? 2 : 1, ok });
    if (!ok) return [401, { error: "auth_required", message: "invalid signature" }];
    const q = opts.quota ?? { quota: quotaLeft, unit: "transactionCount", totalQuota: 1_000_000, resetDate: now + 86400 };
    return [200, { quota: opts.quota ? quotaLeft : q.quota, unit: q.unit, totalQuota: q.totalQuota, resetDate: q.resetDate, ...(b.chainId !== undefined ? { chainId: b.chainId } : {}) }];
  };

  const server: Server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed: any;
    try {
      parsed = body ? JSON.parse(body) : undefined;
    } catch {
      parsed = undefined;
    }
    const path = (req.url ?? "").split("?")[0];
    let status = 404;
    let response: any = { error: "not_found" };
    try {
      if (req.method === "GET" && path === "/api/.well-known/lsp15.json" && mode === "lsp15") {
        status = 200;
        response = {
          lsp15Version: "1.1",
          supportedChainIds: supported,
          chainIdRequired: opts.chainIdRequired ?? true,
          quotaScope: opts.quotaScope ?? "both",
          quotaAuth: "lsp15-signature",
          quotaSignatureVersions: opts.quotaSignatureVersions ?? [1, 2],
          ...(opts.quotaSubject ? { quotaSubject: opts.quotaSubject } : {}),
          features: [],
        };
      } else if (req.method === "POST" && path === "/api/execute") [status, response] = await handleExecute(parsed);
      else if (req.method === "POST" && path === "/api/quota") [status, response] = await handleQuota(parsed);
      else if (req.method === "GET" && path.startsWith("/api/task/") && mode === "lukso-live") {
        const t = tasks.get(decodeURIComponent(path.slice("/api/task/".length)));
        if (t) [status, response] = [200, { taskId: path.slice("/api/task/".length), ...t }];
      }
    } catch (e: any) {
      status = 500;
      response = { error: "internal", message: String(e?.message ?? e).slice(0, 200) };
    }
    requests.push({ path: `${req.method} ${path}`, raw: body, body: parsed, status, response });
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  return {
    url: `http://127.0.0.1:${port}/api`,
    requests,
    quotaChecks,
    opts,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ---------------------------------------------------------------------------
// Chain fixtures shared by the account-core chain tests
// ---------------------------------------------------------------------------

/** Runtime: slot0 = msg.sender, slot1 = msg.value, slot2 += 1. Accepts any calldata and value. */
export const RECORDER_RUNTIME: Hex = "0x336000553460015560025460010160025500";
/** Runtime: returns abi.encode(msg.sender) — usable in STATICCALL. */
export const WHOAMI_RUNTIME: Hex = "0x3360005260206000f3";

export function initCodeFor(runtime: Hex): Hex {
  const len = (runtime.length - 2) / 2;
  const l = len.toString(16).padStart(2, "0");
  return (`0x60${l}600c60003960${l}6000f3` + runtime.slice(2)) as Hex;
}

export async function readRecorder(request: RpcRequest, addr: Address): Promise<{ sender: Address; value: bigint; count: bigint }> {
  const s0 = (await request("eth_getStorageAt", [addr, "0x0", "latest"])) as Hex;
  const s1 = (await request("eth_getStorageAt", [addr, "0x1", "latest"])) as Hex;
  const s2 = (await request("eth_getStorageAt", [addr, "0x2", "latest"])) as Hex;
  return { sender: getAddress("0x" + BigInt(s0).toString(16).padStart(40, "0")), value: BigInt(s1), count: BigInt(s2) };
}

/** Deploys a Universal Profile via LSP23 with `controller` as sole controller (preset agent-owner by default). */
export async function deployProfileFor(ctx: VerbContext, signer: Signer, chainId: number, opts: { salt?: Hex; permissions?: bigint; controller?: Address } = {}): Promise<DeploymentManifest> {
  const salt = opts.salt ?? keccak256(concat([signer.address, ("0x" + Date.now().toString(16).padStart(16, "0")) as Hex, ("0x" + Math.floor(Math.random() * 1e9).toString(16).padStart(8, "0")) as Hex]));
  const inputs = { salt, controller: opts.controller ?? signer.address, permissions: toBytes32(opts.permissions ?? PRESETS["agent-owner"].permissions), preset: opts.permissions ? undefined : "agent-owner" };
  const plan = planDeployment(inputs);
  const m = manifestFromPlan(inputs, plan);
  await saveManifest(ctx.home, m);
  await deployFromManifest(ctx, signer, m, chainId);
  return m;
}

/** runCli-equivalent: getVerb(name).run(ctx, coerceArgs(verb, raw)). */
export async function runVerb(ctx: VerbContext, name: string, raw: Record<string, unknown> = {}): Promise<{ data: any; text?: string; warnings?: string[] }> {
  const { getVerb, coerceArgs } = await import("../../src/core/verbs.ts");
  const v = getVerb(name);
  if (!v) throw new Error(`verb ${name} not registered`);
  return (await v.run(ctx, coerceArgs(v, raw))) as any;
}
