// L2 suite for the opt-in ERC-4337 module on the in-process EVM:
// EntryPoint v0.6 via Nick's factory (canonical address + runtime hash),
// Extension4337 deterministic deployment, UP+KM creation, enable (link,
// EntryPoint controller, bit 23, deposit), UserOperations by self-bundling and
// through a local bundler stub, negative cases mirroring the upstream
// 4337.test.ts (bit 23 missing → AA24, wrong EntryPoint → AA23, nonce reuse →
// AA25, tampering → AA24, payload outside the EntryPoint's permissions →
// decoded UserOperationRevertReason), dry-runs, J2 scoped agent, disable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  concat,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import type { ConsentRequest } from "../../src/core/types.ts";
import { fixture, getHarness, LOCAL_CHAIN_ID, type Harness } from "./harness.ts";
import { testContext, testSigner } from "../support/context.ts";
import type { Signer, VerbContext } from "../../src/core/types.ts";
import { UpError } from "../../src/core/errors.ts";
import { DEFAULT_POLICY, savePolicy } from "../../src/core/policy.ts";
import { coerceArgs, getVerb } from "../../src/core/verbs.ts";
import { sendTx } from "../../src/chain/tx.ts";
import { availablePaths, executeAsProfile, OPERATION, registerTransport, type ExecTransport } from "../../src/exec/transport.ts";
import "../../src/erc4337/verbs.ts";
import { DUMMY_SIGNATURE, ENTRYPOINT_V06, EXTENSION_4337_KEY, KM_ABI, P, PERMISSION_4337, UP_ABI, entryPoint06Abi, extension4337Abi } from "../../src/erc4337/constants.ts";
import { entryPointAsset, extensionAsset } from "../../src/erc4337/bytecode.ts";
import {
  allowedCallsKey,
  arrayIndexKey,
  arrayLengthKey,
  decodeArrayLength,
  encodeAllowedCalls,
  encodeArrayLength,
  encodePermissions,
  getDataBatch,
  permissionsKey,
} from "../../src/erc4337/lsp6.ts";
import { depositOf } from "../../src/erc4337/entrypoint.ts";
import { status4337 } from "../../src/erc4337/extension.ts";
import { fromRpcUserOp, getUserOpHashV06, onchainUserOpHash, prepareUserOperation, selfBundle, signPreparedUserOp, validatePrepared, type UserOperationV06 } from "../../src/erc4337/userop.ts";
import type { UserOpExecOptions } from "../../src/erc4337/transport.ts";

const ALL_PERMISSIONS = 0x7f3f7fn;
const LIVE_EP_RUNTIME_HASH = "0xc93c806e738300b5357ecdc2e971d6438d34d8e4e17b99b758b1f9cac91c8e70";
// Recorder: stores msg.sender in slot 0 and msg.value in slot 1 on any call.
const RECORDER_RUNTIME = "0x336000553460015500" as Hex;
const RECORDER_INIT = ("0x6009600c60003960096000f3" + RECORDER_RUNTIME.slice(2)) as Hex;
const OWNABLE = parseAbi(["function transferOwnership(address newOwner)", "function acceptOwnership()"]);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function run(ctx: VerbContext, name: string, raw: Record<string, unknown> = {}) {
  const v = getVerb(name);
  if (!v) throw new Error(`verb ${name} not registered`);
  return v.run(ctx, coerceArgs(v, raw));
}

async function failure(p: Promise<unknown>): Promise<UpError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof UpError) return e;
    throw e;
  }
  throw new Error("expected an UpError, but the call succeeded");
}

const bn = async (h: Harness) => BigInt(await h.request("eth_blockNumber"));
const balance = async (h: Harness, a: Address) => BigInt(await h.request("eth_getBalance", [a, "latest"]));
const slot = async (h: Harness, a: Address, i: number) => BigInt(await h.request("eth_getStorageAt", [a, `0x${i.toString(16)}`, "latest"]));
const freshAddress = () => privateKeyToAddress(generatePrivateKey());

/** Wraps a signer and records every signMessage (the only way a userOpHash gets signed). */
function spySigner(inner: Signer) {
  const state = { signatures: 0, log: [] as string[] };
  const signer: Signer = {
    ...inner,
    address: inner.address,
    protection: inner.protection,
    signMessage: async (m) => {
      state.signatures++;
      state.log.push("sign");
      return inner.signMessage(m);
    },
  };
  return Object.assign(state, { signer });
}

const opFromJson = (j: Record<string, string>): UserOperationV06 => ({
  sender: getAddress(j.sender),
  nonce: BigInt(j.nonce),
  initCode: j.initCode as Hex,
  callData: j.callData as Hex,
  callGasLimit: BigInt(j.callGasLimit),
  verificationGasLimit: BigInt(j.verificationGasLimit),
  preVerificationGas: BigInt(j.preVerificationGas),
  maxFeePerGas: BigInt(j.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(j.maxPriorityFeePerGas),
  paymasterAndData: j.paymasterAndData as Hex,
  signature: j.signature as Hex,
});

/** Minimal "km" transport used only when the account-core one is not loaded (keeps this suite independent). */
const testKmTransport: ExecTransport = {
  path: "km",
  async execute(ctx, signer, req) {
    const km = getAddress(`0x${(await ctx.rpc.request<Hex>(req.chainId, "eth_call", [{ to: req.profile, data: encodeFunctionData({ abi: UP_ABI, functionName: "owner" }) }, "latest"])).slice(-40)}`);
    const calls = req.calls ?? [];
    const payload =
      req.payload ??
      (calls.length === 1
        ? encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [BigInt(calls[0].operation), calls[0].to, calls[0].value, calls[0].data] })
        : encodeFunctionData({ abi: UP_ABI, functionName: "executeBatch", args: [calls.map((c) => BigInt(c.operation)), calls.map((c) => c.to), calls.map((c) => c.value), calls.map((c) => c.data)] }));
    const verb = (req as any).verb ?? "exec send";
    await ctx.consent({ verb, risk: (req as any).risk ?? "write", chainId: req.chainId, summary: { path: "km (test)", description: req.description } });
    const tx = await sendTx(ctx, signer, { chainId: req.chainId, to: km, data: encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [payload] }) });
    return { path: "km", chainId: req.chainId, profile: req.profile, keyManager: km, gasPayer: signer.address, status: tx.status === "dry-run" ? "dry-run" : "success", txHash: tx.hash, blockNumber: tx.blockNumber, confirmation: {} };
  },
};

interface Profile {
  up: Address;
  km: Address;
}

/** Deploys UniversalProfile(admin) + LSP6KeyManager(up), sets controllers, hands ownership to the KM (LSP14 two-step). */
async function createProfile(h: Harness, controllers: { address: Address; permissions: bigint; allowedCalls?: Hex }[]): Promise<Profile> {
  const admin = h.accounts[0];
  const up = await h.deployRaw(concat([fixture("UniversalProfile").bytecode as Hex, encodeAbiParameters([{ type: "address" }], [admin])]), admin);
  const km = await h.deployRaw(concat([fixture("LSP6KeyManager").bytecode as Hex, encodeAbiParameters([{ type: "address" }], [up])]), admin);
  const all: { address: Address; permissions: bigint; allowedCalls?: Hex }[] = [{ address: admin, permissions: ALL_PERMISSIONS }, ...controllers];
  const keys: Hex[] = [arrayLengthKey];
  const values: Hex[] = [encodeArrayLength(BigInt(all.length))];
  all.forEach((c, i) => {
    keys.push(arrayIndexKey(i), permissionsKey(c.address));
    values.push(c.address.toLowerCase() as Hex, encodePermissions(c.permissions));
    if (c.allowedCalls) {
      keys.push(allowedCallsKey(c.address));
      values.push(c.allowedCalls);
    }
  });
  await h.sendFrom(admin, up, encodeFunctionData({ abi: UP_ABI, functionName: "setDataBatch", args: [keys, values] }));
  await h.sendFrom(admin, up, encodeFunctionData({ abi: OWNABLE, functionName: "transferOwnership", args: [km] }));
  await h.sendFrom(admin, km, encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [encodeFunctionData({ abi: OWNABLE, functionName: "acceptOwnership" })] }));
  const owner = await h.request<Hex>("eth_call", [{ to: up, data: encodeFunctionData({ abi: UP_ABI, functionName: "owner" }) }, "latest"]);
  expect(getAddress(`0x${owner.slice(-40)}`)).toBe(km);
  await h.fund(up, parseEther("10"));
  return { up, km };
}

/** The human admin (harness account 0, ALL_PERMISSIONS) applies a payload through the KM. */
async function asHuman(h: Harness, p: Profile, payload: Hex) {
  return h.sendFrom(h.accounts[0], p.km, encodeFunctionData({ abi: KM_ABI, functionName: "execute", args: [payload] }));
}

/** Local ERC-7769 bundler stub: bundles by calling handleOps from harness account 1. */
async function startBundlerStub(h: Harness, ep: Address) {
  const bundlerEoa = h.accounts[1];
  const seen: string[] = [];
  const estimateSignatures: Hex[] = [];
  const sendSignatures: Hex[] = [];
  const included = new Map<string, Hex>();
  const server: Server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const msg = JSON.parse(body);
    seen.push(msg.method);
    const send = (o: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...(o as object) }, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v)));
    };
    try {
      switch (msg.method) {
        case "eth_chainId":
          return send({ result: `0x${LOCAL_CHAIN_ID.toString(16)}` });
        case "eth_supportedEntryPoints":
          return send({ result: [ep] });
        case "eth_estimateUserOperationGas": {
          const op = fromRpcUserOp(msg.params[0]);
          estimateSignatures.push(op.signature);
          if (getAddress(msg.params[1]) !== ep || op.signature.length !== 132) return send({ error: { code: -32602, message: "invalid UserOperation" } });
          return send({ result: { preVerificationGas: "0xc350", verificationGasLimit: "0x30d40", callGasLimit: "0x186a0" } });
        }
        case "eth_sendUserOperation": {
          const op = fromRpcUserOp(msg.params[0]);
          sendSignatures.push(op.signature);
          const hash = (await h.request<Hex>("eth_call", [{ to: ep, data: encodeFunctionData({ abi: entryPoint06Abi, functionName: "getUserOpHash", args: [op] }) }, "latest"])) as Hex;
          try {
            const { hash: tx } = await h.sendFrom(bundlerEoa, ep, encodeFunctionData({ abi: entryPoint06Abi, functionName: "handleOps", args: [[op], bundlerEoa] }));
            included.set(hash.toLowerCase(), tx);
          } catch (e) {
            return send({ error: { code: -32500, message: `simulation rejected: ${(e as Error).message}` } });
          }
          return send({ result: hash });
        }
        case "eth_getUserOperationReceipt": {
          const tx = included.get(String(msg.params[0]).toLowerCase());
          if (!tx) return send({ result: null });
          const r = await h.request("eth_getTransactionReceipt", [tx]);
          let ev: any;
          for (const l of r.logs) {
            try {
              const d = decodeEventLog({ abi: entryPoint06Abi, data: l.data, topics: l.topics });
              if (d.eventName === "UserOperationEvent" && (d.args as any).userOpHash.toLowerCase() === String(msg.params[0]).toLowerCase()) ev = d.args;
            } catch {}
          }
          return send({ result: { userOpHash: msg.params[0], entryPoint: ep, success: ev?.success ?? false, actualGasCost: ev?.actualGasCost ?? 0n, actualGasUsed: ev?.actualGasUsed ?? 0n, logs: r.logs, receipt: { transactionHash: tx, blockNumber: r.blockNumber } } });
        }
        default:
          return send({ error: { code: -32601, message: `method ${msg.method} not found` } });
      }
    } catch (e) {
      return send({ error: { code: -32603, message: (e as Error).message } });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return { url, seen, estimateSignatures, sendSignatures, bundlerEoa, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// ---------------------------------------------------------------------------

describe("ERC-4337 opt-in module (EntryPoint v0.6 + Extension4337) on a local EVM", () => {
  let h: Harness;
  let home: string;
  let agent: Signer;
  let ctx: VerbContext; // --yes + human --approval
  let ctxNoApproval: VerbContext; // --yes only (admin actions must be refused)
  let ctxDry: VerbContext;
  let A: Profile;
  let recorder: Address;
  const chain = String(LOCAL_CHAIN_ID);

  beforeAll(async () => {
    h = await getHarness();
    // UP_TEST_ACCOUNT_CORE=1 runs the profile-side writes through the real account-core transports (integration check).
    if (process.env.UP_TEST_ACCOUNT_CORE === "1") await import("../../src/exec/index.ts");
    if (!availablePaths().includes("km")) registerTransport(testKmTransport);
    home = h.newHome();
    agent = testSigner(generatePrivateKey());
    await h.fund(agent.address, parseEther("100"));
    ctx = testContext(home, agent, { yes: true, approval: "yes, enable 4337 for my profile (test)" });
    ctxNoApproval = testContext(home, agent, { yes: true });
    ctxDry = testContext(home, agent, { yes: true, approval: "dry run (test)", dryRun: true });
    A = await createProfile(h, [{ address: agent.address, permissions: ALL_PERMISSIONS }]);
    recorder = await h.deployRaw(RECORDER_INIT);
    expect(await h.request("eth_getCode", [recorder, "latest"])).toBe(RECORDER_RUNTIME);
  });

  it("starts without 4337: status says so and the userop transport refuses with a precise hint", async () => {
    const st = await run(ctx, "account 4337 status", { chain, profile: A.up });
    const d = st.data as any;
    expect(d.enabled).toBe(false);
    expect(d.entryPoint.deployed).toBe(false);
    expect(d.nickFactory.matches).toBe(true);
    expect(d.missing).toContain("entrypoint-deployment");
    const e = await failure(executeAsProfile(ctx, { chainId: LOCAL_CHAIN_ID, profile: A.up, calls: [{ operation: OPERATION.CALL, to: recorder, value: 0n, data: "0x" }] }, { via: "userop" }));
    expect(e.code).toBe("NOT_SUPPORTED");
    expect(e.message).toMatch(/not enabled/);
    expect(e.hint).toMatch(/account 4337 enable/);
  });

  it("deploy-entrypoint: refuses without human approval, dry-run sends nothing, then lands on the canonical address with the canonical runtime", async () => {
    const before = await bn(h);
    const denied = await failure(run(ctxNoApproval, "account 4337 deploy-entrypoint", { chain }));
    expect(denied.code).toBe("CONSENT_REQUIRED");
    const dry = await run(ctxDry, "account 4337 deploy-entrypoint", { chain });
    expect((dry.data as any).status).toBe("dry-run");
    expect(await bn(h)).toBe(before);
    expect(await h.request("eth_getCode", [ENTRYPOINT_V06, "latest"])).toBe("0x");

    const r = await run(ctx, "account 4337 deploy-entrypoint", { chain });
    const d = r.data as any;
    expect(d.status).toBe("deployed");
    expect(d.address).toBe("0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789");
    const code = await h.request<Hex>("eth_getCode", [ENTRYPOINT_V06, "latest"]);
    expect(keccak256(code)).toBe(LIVE_EP_RUNTIME_HASH);
    expect(keccak256(code)).toBe(entryPointAsset().runtimeCodeHash);
    const again = await run(ctx, "account 4337 deploy-entrypoint", { chain });
    expect((again.data as any).status).toBe("already-deployed");
  });

  it("deploy-extension: deterministic address, bound to EntryPoint v0.6, runtime equals the recorded hash", async () => {
    const r = await run(ctx, "account 4337 deploy-extension", { chain });
    const d = r.data as any;
    expect(d.status).toBe("deployed");
    expect(d.address).toBe(extensionAsset().deployment.canonical.address);
    expect(d.address).toBe("0xff49b05D73453e799cc8e402a09CcaEf78EdeB28");
    const ep = await h.request<Hex>("eth_call", [{ to: d.address, data: encodeFunctionData({ abi: extension4337Abi(), functionName: "entryPoint" }) }, "latest"]);
    expect(getAddress(`0x${ep.slice(-40)}`)).toBe(ENTRYPOINT_V06);
    expect(keccak256(await h.request<Hex>("eth_getCode", [d.address, "latest"]))).toBe(extensionAsset().deployment.canonical.runtimeCodeHash);
    expect(((await run(ctx, "account 4337 deploy-extension", { chain })).data as any).status).toBe("already-deployed");
  });

  it("enable: one consolidated admin confirmation, no implicit SUPER mirroring, dry-run sends nothing", async () => {
    const before = await bn(h);
    const nonceBefore = await h.request("eth_getTransactionCount", [agent.address, "latest"]);
    const denied = await failure(run(ctxNoApproval, "account 4337 enable", { chain, profile: A.up, "ep-scope": "super" }));
    expect(denied.code).toBe("CONSENT_REQUIRED");
    const conf = (denied.details as any).confirmation;
    expect(conf.risk).toBe("admin");
    expect(conf.trustModel).toMatch(/bounded by the EntryPoint's permissions AND by the signer's permissions/);
    expect(conf.dataChanges.map((c: any) => c.key)).toContain(EXTENSION_4337_KEY);

    const mirror = await failure(run(ctx, "account 4337 enable", { chain, profile: A.up }));
    expect(mirror.code).toBe("BAD_ARGS");
    expect(mirror.hint).toMatch(/--ep-scope super/);

    const dry = await run(ctxDry, "account 4337 enable", { chain, profile: A.up, "ep-scope": "super", deposit: "1 ether" });
    expect((dry.data as any).steps.map((s: any) => s.status)).toEqual(["skipped", "skipped", "dry-run", "dry-run"]);
    expect(await bn(h)).toBe(before);
    expect(await h.request("eth_getTransactionCount", [agent.address, "latest"])).toBe(nonceBefore);
    expect((await status4337(ctx, LOCAL_CHAIN_ID, A.up, agent.address)).enabled).toBe(false);
  });

  it("enable (super scope + deposit from the profile): links the extension, adds the EntryPoint controller, grants bit 23, verifies", async () => {
    const upBefore = await balance(h, A.up);
    const r = await run(ctx, "account 4337 enable", { chain, profile: A.up, "ep-scope": "super", deposit: "1 ether" });
    const d = r.data as any;
    expect(d.steps.map((s: any) => s.status)).toEqual(["skipped", "skipped", "done", "done"]);
    expect(d.verification.ok).toBe(true);
    expect(d.status.enabled).toBe(true);
    const [ext, epPerms, len, idx2, agentPerms] = await getDataBatch(ctx, LOCAL_CHAIN_ID, A.up, [EXTENSION_4337_KEY, permissionsKey(ENTRYPOINT_V06), arrayLengthKey, arrayIndexKey(2), permissionsKey(agent.address)]);
    expect(getAddress(ext)).toBe(extensionAsset().deployment.canonical.address);
    expect(BigInt(epPerms)).toBe(P.SUPER_CALL | P.SUPER_TRANSFERVALUE | P.SUPER_STATICCALL | P.SUPER_SETDATA);
    expect(decodeArrayLength(len)).toBe(3n);
    expect(getAddress(idx2)).toBe(ENTRYPOINT_V06);
    expect(BigInt(agentPerms)).toBe(ALL_PERMISSIONS | PERMISSION_4337);
    expect(await depositOf(ctx, LOCAL_CHAIN_ID, A.up)).toBe(parseEther("1"));
    expect(await balance(h, A.up)).toBe(upBefore - parseEther("1"));

    // idempotent: everything is skipped and nothing is sent
    const before = await bn(h);
    const again = await run(ctx, "account 4337 enable", { chain, profile: A.up });
    expect((again.data as any).steps.map((s: any) => s.status)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(await bn(h)).toBe(before);

    const st = (await run(ctx, "account 4337 status", { chain, profile: A.up })).data as any;
    expect(st.enabled).toBe(true);
    expect(st.extension.linkedIsBundled).toBe(true);
    expect(st.entryPointController.forbidden).toEqual([]);
    expect(st.signer.has4337).toBe(true);
    expect(st.bundler.mode).toMatch(/self-bundle/);
  });

  it("userOpHash equals viem's v0.6 hash and the on-chain EntryPoint.getUserOpHash", async () => {
    const prep = await prepareUserOperation(ctx, {
      chainId: LOCAL_CHAIN_ID,
      profile: A.up,
      signer: agent.address,
      callData: encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, recorder, 1n, "0xabcd"] }),
    });
    expect(prep.signed).toBe(false);
    expect(prep.op.signature).toBe("0x");
    const onchain = await onchainUserOpHash(ctx, LOCAL_CHAIN_ID, ENTRYPOINT_V06, prep.op);
    expect(prep.userOpHash).toBe(onchain);
    expect(getUserOpHashV06(prep.op, ENTRYPOINT_V06, LOCAL_CHAIN_ID)).toBe(onchain);
    expect(getUserOperationHash({ chainId: LOCAL_CHAIN_ID, entryPointAddress: ENTRYPOINT_V06, entryPointVersion: "0.6", userOperation: prep.op as any })).toBe(onchain);
    expect(prep.op.nonce >> 64n).toBe(BigInt(agent.address)); // key = controller address
    expect(prep.validation?.sigFailed).toBe(true); // measured with the dummy signature, nothing signed
    expect(prep.gasSource.verification).toBe("local:simulateValidation(dummy signature)+lsp20VerifyCall");
    const signed = await signPreparedUserOp(ctx, agent, prep);
    expect(signed.userOpHash).toBe(onchain);
    expect(await recoverMessageAddress({ message: { raw: onchain }, signature: signed.op.signature })).toBe(agent.address);
    expect((await validatePrepared(ctx, signed)).sigFailed).toBe(false);
    // the measured limits are sufficient on-chain (no AA40/AA95, op succeeds)
    expect((await selfBundle(ctx, agent, signed)).success).toBe(true);
    await expect(signPreparedUserOp(ctxDry, agent, prep)).rejects.toThrow(/dry-run/);
  });

  it("exec userop (self-bundled): native value transfer from the profile", async () => {
    const to = freshAddress();
    const upBefore = await balance(h, A.up);
    const depBefore = await depositOf(ctx, LOCAL_CHAIN_ID, A.up);
    const r = await run(ctx, "exec userop", { chain, profile: A.up, to, value: "0.01 ether" });
    const d = r.data as any;
    expect(d.path).toBe("userop");
    expect(d.status).toBe("success");
    expect(d.userOpHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(d.gasPayer).toMatch(/NOT gasless/);
    expect(d.confirmation.mode).toBe("self-bundle");
    expect(await balance(h, to)).toBe(parseEther("0.01"));
    expect(await balance(h, A.up)).toBe(upBefore - parseEther("0.01"));
    const depAfter = await depositOf(ctx, LOCAL_CHAIN_ID, A.up);
    expect(depAfter).toBeLessThan(depBefore);
    expect(BigInt(d.confirmation.actualGasCost)).toBe(depBefore - depAfter);
  });

  it("exec userop (self-bundled): contract call sees msg.sender == profile and the value", async () => {
    const r = await run(ctx, "exec userop", { chain, profile: A.up, to: recorder, value: "123", data: "0x1234" });
    expect((r.data as any).status).toBe("success");
    expect(getAddress(`0x${(await slot(h, recorder, 0)).toString(16).padStart(40, "0")}`)).toBe(A.up);
    expect(await slot(h, recorder, 1)).toBe(123n);
  });

  it("exec userop: batch → UP.executeBatch (single LSP20 verification)", async () => {
    const to = freshAddress();
    const r = await run(ctx, "exec userop", { chain, profile: A.up, calls: JSON.stringify([{ to, value: "777" }, { to: recorder, value: "7", data: "0x01" }]) });
    expect((r.data as any).confirmation.userOperation.callData.slice(0, 10)).toBe("0x31858452");
    expect(await balance(h, to)).toBe(777n);
    expect(await slot(h, recorder, 1)).toBe(7n);
  });

  it("exec userop --dry-run never signs: no signature in the output, and the output cannot be submitted by anyone", async () => {
    const before = await bn(h);
    const dep = await depositOf(ctx, LOCAL_CHAIN_ID, A.up);
    const to = freshAddress();
    const spy = spySigner(agent);
    const r = await run(testContext(home, spy.signer, { yes: true, approval: "dry run (test)", dryRun: true }), "exec userop", { chain, profile: A.up, to, value: "1000" });
    const d = r.data as any;
    expect(d.status).toBe("dry-run");
    expect(spy.signatures).toBe(0);
    expect(d.confirmation.signed).toBe(false);
    expect(d.confirmation.userOperation.signature).toBe("0x");
    expect(JSON.stringify(d)).not.toContain(DUMMY_SIGNATURE.slice(2, 40));
    expect(d.userOpHash).toBe(getUserOpHashV06(opFromJson(d.confirmation.userOperation), ENTRYPOINT_V06, LOCAL_CHAIN_ID));
    expect(await bn(h)).toBe(before);
    expect(await depositOf(ctx, LOCAL_CHAIN_ID, A.up)).toBe(dep);

    // A third party takes the dry-run output and calls handleOps itself: it reverts (no valid signature), nothing moves.
    const thirdParty = h.accounts[2];
    for (const signature of ["0x", DUMMY_SIGNATURE] as Hex[]) {
      const op = { ...opFromJson(d.confirmation.userOperation), signature };
      await expect(h.sendFrom(thirdParty, ENTRYPOINT_V06, encodeFunctionData({ abi: entryPoint06Abi, functionName: "handleOps", args: [[op], thirdParty] }))).rejects.toThrow();
      const sim = await failure(selfBundle(ctx, agent, { chainId: LOCAL_CHAIN_ID, entryPoint: ENTRYPOINT_V06, op: { ...op, signature: signature === "0x" ? ("0x" + "11".repeat(65)) as Hex : signature }, userOpHash: d.userOpHash }));
      expect(sim.code === "INTERNAL" || ["AA23", "AA24"].includes((sim.details as any)?.aa?.code)).toBe(true);
    }
    expect(await balance(h, to)).toBe(0n);
    expect(await depositOf(ctx, LOCAL_CHAIN_ID, A.up)).toBe(dep);
  });

  it("exec userop signs exactly once, only after consent", async () => {
    const spy = spySigner(agent);
    const c = testContext(home, spy.signer, { yes: true, approval: "test" });
    const consent = c.consent.bind(c);
    (c as any).consent = async (req: ConsentRequest) => {
      spy.log.push(`consent:${req.verb}`);
      return consent(req);
    };
    const r = await run(c, "exec userop", { chain, profile: A.up, to: recorder, value: "9" });
    expect((r.data as any).status).toBe("success");
    expect(spy.log).toEqual(["consent:exec (via userop)", "sign"]);
    expect(spy.signatures).toBe(1);

    // consent refused ⇒ nothing is signed
    const refused = spySigner(agent);
    const c2 = testContext(home, refused.signer, { yes: true });
    (c2 as any).consent = async () => {
      throw new UpError("CONSENT_REQUIRED", "refused (test)");
    };
    await failure(run(c2, "exec userop", { chain, profile: A.up, to: recorder, value: "9" }));
    expect(refused.signatures).toBe(0);
  });

  it("raw --payload: consent sees the decoded value, target and inner selector; control-changing or unknown payloads are admin", async () => {
    const to = freshAddress();
    const capture = async (payload: Hex) => {
      const seen: ConsentRequest[] = [];
      const c = testContext(home, agent, { yes: true, approval: "test" });
      (c as any).consent = async (req: ConsentRequest) => {
        seen.push(req);
        throw new UpError("CONSENT_REQUIRED", "captured (test)");
      };
      // skipPreflight: control-changing payloads would otherwise stop at the EntryPoint-permission preflight
      const err = await failure(executeAsProfile(c, { chainId: LOCAL_CHAIN_ID, profile: A.up, payload }, { via: "userop", userop: { skipPreflight: true, gas: { callGasLimit: 300_000n } } } as UserOpExecOptions));
      if (!seen[0]) throw err;
      return seen[0];
    };
    const exec = await capture(encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, to, parseEther("0.5"), "0xa9059cbb"] }));
    expect(exec).toMatchObject({ risk: "write", value: parseEther("0.5"), target: to, selector: "0xa9059cbb" });
    const batch = await capture(encodeFunctionData({ abi: UP_ABI, functionName: "executeBatch", args: [[0n, 0n], [to, recorder], [3n, 4n], ["0x", "0x"]] }));
    expect(batch.value).toBe(7n);
    expect(batch.risk).toBe("write");
    expect((batch.summary as any).decoded.targets).toEqual([to, recorder]);
    const perm = await capture(encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [permissionsKey(to), encodePermissions(ALL_PERMISSIONS)] }));
    expect(perm.risk).toBe("admin");
    expect(perm.target).toBe(A.up);
    expect((await capture(encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [EXTENSION_4337_KEY, "0x"] }))).risk).toBe("admin");
    expect((await capture(encodeFunctionData({ abi: UP_ABI, functionName: "transferOwnership", args: [to] }))).risk).toBe("admin");
    expect((await capture(encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [keccak256("0x01"), "0x1234"] }))).risk).toBe("write");

    // with the default policy (native cap 0), --yes alone cannot move value hidden in a raw payload
    const denied = await failure(run(ctxNoApproval, "exec userop", { chain, profile: A.up, payload: encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, to, parseEther("0.5"), "0x"] }) }));
    expect(denied.code).toBe("POLICY_DENIED");
    expect(denied.message).toMatch(/value/);
    // and a permission change through a raw payload needs a human approval
    const admin = await failure(executeAsProfile(ctxNoApproval, { chainId: LOCAL_CHAIN_ID, profile: A.up, payload: encodeFunctionData({ abi: UP_ABI, functionName: "setData", args: [permissionsKey(to), encodePermissions(ALL_PERMISSIONS)] }) }, { via: "userop", userop: { skipPreflight: true, gas: { callGasLimit: 300_000n } } } as UserOpExecOptions));
    expect(admin.code).toBe("CONSENT_REQUIRED");
    expect(await balance(h, to)).toBe(0n);
  });

  it("payload outside the EntryPoint's permissions: refused by preflight, and decoded from UserOperationRevertReason on-chain", async () => {
    // The agent may DEPLOY (ALL_PERMISSIONS) but the EntryPoint (super scope) may not.
    const req = { chainId: LOCAL_CHAIN_ID, profile: A.up, calls: [{ operation: OPERATION.CREATE, to: "0x0000000000000000000000000000000000000000" as Address, value: 0n, data: RECORDER_INIT }] };
    const pre = await failure(executeAsProfile(ctx, req, { via: "userop" }));
    expect(pre.code).toBe("NOT_AUTHORISED");
    expect(pre.message).toMatch(/EntryPoint controller/);
    expect((pre.details as any).revert.errorName).toBe("NotAuthorised");

    const dep = await depositOf(ctx, LOCAL_CHAIN_ID, A.up);
    const opts: UserOpExecOptions = { via: "userop", userop: { skipPreflight: true, gas: { callGasLimit: 300_000n } } };
    const onchain = await failure(executeAsProfile(ctx, req, opts));
    expect(onchain.code).toBe("TX_FAILED");
    expect(onchain.message).toMatch(/execution reverted: NotAuthorised/);
    const det = onchain.details as any;
    expect(det.revert.errorName).toBe("NotAuthorised");
    expect(getAddress(det.revert.args[0])).toBe(ENTRYPOINT_V06);
    expect(det.revert.args[1]).toBe("DEPLOY");
    expect(det.outcome.status).toBe("reverted");
    expect(det.outcome.txHash).toMatch(/^0x/);
    expect(await depositOf(ctx, LOCAL_CHAIN_ID, A.up)).toBeLessThan(dep); // the profile still paid
  });

  it("signer without the 4337 permission (bit 23): transport refuses; validation fails with AA24 (simulation and on-chain)", async () => {
    const noBit = testSigner(generatePrivateKey());
    await h.fund(noBit.address, parseEther("1"));
    // human adds a second controller with ALL_PERMISSIONS but without bit 23
    const [lenRaw] = await getDataBatch(ctx, LOCAL_CHAIN_ID, A.up, [arrayLengthKey]);
    const n = decodeArrayLength(lenRaw);
    await asHuman(h, A, encodeFunctionData({ abi: UP_ABI, functionName: "setDataBatch", args: [[permissionsKey(noBit.address), arrayIndexKey(n), arrayLengthKey], [encodePermissions(ALL_PERMISSIONS), noBit.address.toLowerCase() as Hex, encodeArrayLength(n + 1n)]] }));
    const ctx2 = testContext(home, noBit, { yes: true, approval: "test" });

    const refused = await failure(executeAsProfile(ctx2, { chainId: LOCAL_CHAIN_ID, profile: A.up, calls: [{ operation: OPERATION.CALL, to: recorder, value: 0n, data: "0x" }] }, { via: "userop" }));
    expect(refused.code).toBe("NOT_SUPPORTED");
    expect((refused.details as any).missing).toEqual(["signer-4337-permission"]);

    const callData = encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, recorder, 0n, "0x"] });
    const signedSim = await signPreparedUserOp(ctx2, noBit, await prepareUserOperation(ctx2, { chainId: LOCAL_CHAIN_ID, profile: A.up, signer: noBit.address, callData }));
    const sim = await failure(validatePrepared(ctx2, signedSim));
    expect((sim.details as any).aa.code).toBe("AA24");

    const prep = await signPreparedUserOp(ctx2, noBit, await prepareUserOperation(ctx2, { chainId: LOCAL_CHAIN_ID, profile: A.up, signer: noBit.address, callData, gas: { verificationGasLimit: 500_000n, callGasLimit: 200_000n } }));
    const onchain = await failure(selfBundle(ctx, agent, prep));
    expect((onchain.details as any).aa.code).toBe("AA24");
    expect(onchain.message).toMatch(/AA24 signature error/);
    expect(onchain.message).toMatch(/bit 23/);
  });

  it("controller with only the 4337 permission: refused by preflight; on-chain validation fails with AA23 and the Key Manager reason", async () => {
    const only = testSigner(generatePrivateKey());
    await h.fund(only.address, parseEther("1"));
    const [lenRaw] = await getDataBatch(ctx, LOCAL_CHAIN_ID, A.up, [arrayLengthKey]);
    const n = decodeArrayLength(lenRaw);
    await asHuman(h, A, encodeFunctionData({ abi: UP_ABI, functionName: "setDataBatch", args: [[permissionsKey(only.address), arrayIndexKey(n), arrayLengthKey], [encodePermissions(PERMISSION_4337), only.address.toLowerCase() as Hex, encodeArrayLength(n + 1n)]] }));
    const ctx4 = testContext(home, only, { yes: true, approval: "test" });
    const req = { chainId: LOCAL_CHAIN_ID, profile: A.up, calls: [{ operation: OPERATION.CALL, to: recorder, value: 1n, data: "0x" as Hex }] };
    const pre = await failure(executeAsProfile(ctx4, req, { via: "userop" }));
    expect(pre.code).toBe("NOT_AUTHORISED");
    expect(pre.message).toMatch(/signing controller/);
    expect((pre.details as any).revert.errorName).toBe("NotAuthorised");

    const callData = encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, recorder, 1n, "0x"] });
    // unsigned preparation already refuses (Key Manager validation gas measurement)
    const est = await failure(prepareUserOperation(ctx4, { chainId: LOCAL_CHAIN_ID, profile: A.up, signer: only.address, callData, gas: { callGasLimit: 200_000n } }));
    expect(est.code).toBe("NOT_AUTHORISED");
    expect((est.details as any).revert.errorName).toBe("NotAuthorised");
    const prep = await signPreparedUserOp(ctx4, only, await prepareUserOperation(ctx4, { chainId: LOCAL_CHAIN_ID, profile: A.up, signer: only.address, callData, gas: { callGasLimit: 200_000n, verificationGasLimit: 500_000n } }));
    const sim = await failure(validatePrepared(ctx4, prep));
    expect((sim.details as any).aa.code).toBe("AA23");
    expect(sim.message).toMatch(/AA23 reverted \(or OOG\)/);
    expect(sim.message).toMatch(/Key Manager: NotAuthorised/);
    const onchain = await failure(selfBundle(ctx, agent, prep));
    expect((onchain.details as any).aa.code).toBe("AA23");
    expect(onchain.code).toBe("NOT_AUTHORISED");
  });

  it("wrong EntryPoint: another EntryPoint calling the extension fails with AA23 'Only EntryPoint contract can call this'", async () => {
    const ep2 = await h.deployRaw(entryPointAsset().creationCode);
    expect(ep2).not.toBe(ENTRYPOINT_V06);
    await h.sendFrom(h.accounts[0], ep2, encodeFunctionData({ abi: entryPoint06Abi, functionName: "depositTo", args: [A.up] }), parseEther("1"));
    const callData = encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, recorder, 0n, "0x"] });
    const sim = await failure(prepareUserOperation(ctx, { chainId: LOCAL_CHAIN_ID, profile: A.up, signer: agent.address, callData, entryPoint: ep2, gas: { callGasLimit: 200_000n } }));
    expect(sim.message).toMatch(/AA23 reverted: Only EntryPoint contract can call this/);
    const prep = await signPreparedUserOp(ctx, agent, await prepareUserOperation(ctx, { chainId: LOCAL_CHAIN_ID, profile: A.up, signer: agent.address, callData, entryPoint: ep2, gas: { callGasLimit: 200_000n, verificationGasLimit: 500_000n } }));
    const e = await failure(selfBundle(ctx, agent, prep));
    expect((e.details as any).aa.code).toBe("AA23");
    expect(e.message).toMatch(/Only EntryPoint contract can call this/);
    expect(e.message).toMatch(/different EntryPoint/);
  });

  it("nonce reuse fails with AA25; tampering after signing fails with AA24", async () => {
    const callData = encodeFunctionData({ abi: UP_ABI, functionName: "execute", args: [0n, recorder, 5n, "0x"] });
    const prep = await signPreparedUserOp(ctx, agent, await prepareUserOperation(ctx, { chainId: LOCAL_CHAIN_ID, profile: A.up, signer: agent.address, callData }));
    const ok = await selfBundle(ctx, agent, prep);
    expect(ok.success).toBe(true);
    expect(await slot(h, recorder, 1)).toBe(5n);
    const replay = await failure(selfBundle(ctx, agent, prep));
    expect((replay.details as any).aa.code).toBe("AA25");
    expect(replay.message).toMatch(/AA25 invalid account nonce/);

    const fresh = await signPreparedUserOp(ctx, agent, await prepareUserOperation(ctx, { chainId: LOCAL_CHAIN_ID, profile: A.up, signer: agent.address, callData }));
    const tampered = { ...fresh, op: { ...fresh.op, callGasLimit: 1n } };
    const bad = await failure(selfBundle(ctx, agent, tampered));
    expect((bad.details as any).aa.code).toBe("AA24");
  });

  it("deposit (controller-funded) and withdraw verbs", async () => {
    const dep0 = await depositOf(ctx, LOCAL_CHAIN_ID, A.up);
    const r = await run(ctx, "account 4337 deposit", { chain, profile: A.up, amount: "0.5 ether", from: "controller" });
    expect(BigInt((r.data as any).depositAfter)).toBe(dep0 + parseEther("0.5"));
    const upBefore = await balance(h, A.up);
    const w = await run(ctx, "account 4337 withdraw", { chain, profile: A.up, amount: "0.25 ether" });
    expect(BigInt((w.data as any).depositAfter)).toBe(dep0 + parseEther("0.25"));
    expect(await balance(h, A.up)).toBe(upBefore + parseEther("0.25"));
    const tooMuch = await failure(run(ctx, "account 4337 withdraw", { chain, profile: A.up, amount: "1000 ether" }));
    expect(tooMuch.code).toBe("BAD_ARGS");

    // withdrawing to a third party moves the profile's money out: --yes alone hits the native-value cap (default 0),
    // even under a policy that allows autonomous asset moves.
    const stranger = freshAddress();
    const depBefore = await depositOf(ctx, LOCAL_CHAIN_ID, A.up);
    const homeP = h.newHome();
    await savePolicy(homeP, { ...DEFAULT_POLICY, allowTokenMoves: true } as any);
    const ctxPolicy = testContext(homeP, agent, { yes: true });
    const denied = await failure(run(ctxPolicy, "account 4337 withdraw", { chain, profile: A.up, amount: "0.1 ether", to: stranger }));
    expect(denied.code).toBe("POLICY_DENIED");
    expect(denied.message, denied.message).toMatch(/value .* exceeds policy.maxValuePerTx/);
    expect((denied.details as any).confirmation.recipient).toBe(stranger);
    expect(await depositOf(ctx, LOCAL_CHAIN_ID, A.up)).toBe(depBefore);
    // back to the profile itself stays within the policy
    await run(ctxPolicy, "account 4337 withdraw", { chain, profile: A.up, amount: "0.01 ether" });
    expect(await depositOf(ctx, LOCAL_CHAIN_ID, A.up)).toBe(depBefore - parseEther("0.01"));
    // with the human's approval the third-party withdrawal goes through
    await run(ctx, "account 4337 withdraw", { chain, profile: A.up, amount: "0.01 ether", to: stranger });
    expect(await balance(h, stranger)).toBe(parseEther("0.01"));
  });

  describe("through a bundler (ERC-7769 stub)", () => {
    let stub: Awaited<ReturnType<typeof startBundlerStub>>;
    beforeAll(async () => {
      stub = await startBundlerStub(h, ENTRYPOINT_V06);
    });
    afterAll(async () => {
      await stub?.close();
    });

    it("bundler set verifies chain + EntryPoint; exec userop goes through the bundler; bundler set none restores self-bundling", async () => {
      const drySet = await run(ctxDry, "bundler set", { chain, url: stub.url });
      expect((drySet.data as any).saved).toBe(false);
      expect((await testContext(home, agent).config()).bundlers?.[chain]).toBeUndefined();
      const set = await run(ctx, "bundler set", { chain, url: stub.url });
      expect((set.data as any).verified.supportsEntryPoint).toBe(true);
      expect((await ctx.config()).bundlers?.[chain]).toBe(`${stub.url}/`);
      // dry-run through the bundler: only a dummy-signature estimation reaches it, nothing is sent
      const dry = await run(testContext(home, agent, { yes: true, approval: "dry run (test)", dryRun: true }), "exec userop", { chain, profile: A.up, to: recorder, value: "41", data: "0x" });
      expect((dry.data as any).status).toBe("dry-run");
      expect(stub.seen).not.toContain("eth_sendUserOperation");
      expect(stub.estimateSignatures).toEqual([DUMMY_SIGNATURE]);

      const agentNonce = await h.request("eth_getTransactionCount", [agent.address, "latest"]);
      const r = await run(ctx, "exec userop", { chain, profile: A.up, to: recorder, value: "42", data: "0x" });
      const d = r.data as any;
      expect(d.status).toBe("success");
      expect(d.confirmation.mode).toBe("bundler");
      expect(d.gasPayer).toMatch(/bundler/);
      expect(stub.seen).toEqual(expect.arrayContaining(["eth_chainId", "eth_supportedEntryPoints", "eth_estimateUserOperationGas", "eth_sendUserOperation", "eth_getUserOperationReceipt"]));
      expect(await slot(h, recorder, 1)).toBe(42n);
      // estimation never carried a real signature; the single real signature only arrived with eth_sendUserOperation
      expect(stub.estimateSignatures.every((sig) => sig === DUMMY_SIGNATURE)).toBe(true);
      expect(stub.sendSignatures).toHaveLength(1);
      expect(await recoverMessageAddress({ message: { raw: d.userOpHash }, signature: stub.sendSignatures[0] })).toBe(agent.address);
      expect(await h.request("eth_getTransactionCount", [agent.address, "latest"])).toBe(agentNonce); // the agent sent nothing
      const off = await run(ctx, "bundler set", { chain, url: "none" });
      expect((off.data as any).mode).toBe("self-bundle");
      expect((await ctx.config()).bundlers?.[chain]).toBeUndefined();
    });

    it("bundler set rejects a bundler that does not serve EntryPoint v0.6", async () => {
      const wrong = await startBundlerStub(h, "0x0000000071727De22E5E9d8BAf0edAc6f37da032");
      try {
        const e = await failure(run(ctx, "bundler set", { chain, url: wrong.url }));
        expect(e.code).toBe("BUNDLER_ERROR");
        expect(e.message).toMatch(/does not support EntryPoint v0.6/);
      } finally {
        await wrong.close();
      }
    });
  });

  it("scoped agent (J2): enable needs the human, mirror copies the agent's AllowedCalls, out-of-scope calls are refused", async () => {
    const scoped = testSigner(generatePrivateKey());
    await h.fund(scoped.address, parseEther("10"));
    const allowed = encodeAllowedCalls([{ callTypes: ["CALL", "VALUE"], address: recorder }]);
    const B = await createProfile(h, [{ address: scoped.address, permissions: P.CALL | P.TRANSFERVALUE | P.SIGN | P.EXECUTE_RELAY_CALL, allowedCalls: allowed }]);
    const ctx3 = testContext(home, scoped, { yes: true, approval: "human approved (test)" });

    const e = await failure(run(ctx3, "account 4337 enable", { chain, profile: B.up }));
    expect(e.code).toBe("NOT_AUTHORISED");
    expect(e.hint).toMatch(/ask the human/);
    const plan = (e.details as any).plan;
    expect(plan.setDataBatch.calldata.slice(0, 10)).toBe("0x97902421");
    // the human applies exactly the proposed setDataBatch from their own controller
    await asHuman(h, B, plan.setDataBatch.calldata);

    const st = await status4337(ctx3, LOCAL_CHAIN_ID, B.up, scoped.address);
    expect(st.enabled).toBe(true);
    expect(BigInt(st.entryPointController.permissions)).toBe(P.CALL | P.TRANSFERVALUE);
    const [epCalls] = await getDataBatch(ctx3, LOCAL_CHAIN_ID, B.up, [allowedCallsKey(ENTRYPOINT_V06)]);
    expect(epCalls).toBe(allowed);

    await run(ctx3, "account 4337 deposit", { chain, profile: B.up, amount: "0.2 ether", from: "controller" });
    const ok = await run(ctx3, "exec userop", { chain, profile: B.up, to: recorder, value: "5" });
    expect((ok.data as any).status).toBe("success");
    expect(getAddress(`0x${(await slot(h, recorder, 0)).toString(16).padStart(40, "0")}`)).toBe(B.up);
    expect(await slot(h, recorder, 1)).toBe(5n);

    const out = await failure(run(ctx3, "exec userop", { chain, profile: B.up, to: freshAddress(), value: "5" }));
    expect(out.code).toBe("NOT_AUTHORISED");
    expect(out.message).toMatch(/signing controller/);
    expect((out.details as any).revert.errorName).toBe("NotAllowedCall");
  });

  it("disable --withdraw: withdraws the deposit, unlinks the extension, removes the EntryPoint controller (swap-with-last) and bit 23", async () => {
    const before = await status4337(ctx, LOCAL_CHAIN_ID, A.up, agent.address);
    expect(before.enabled).toBe(true);
    const n = before.raw.array.length;
    const last = before.raw.array.entries[Number(n) - 1]!;
    const epIndex = before.entryPointController.arrayIndex;
    expect(epIndex).toBe(2);
    expect(last).not.toBe(ENTRYPOINT_V06); // the no-bit-23 controller was appended after it
    const dep = before.deposit;
    const upBefore = await balance(h, A.up);

    const dry = await run(ctxDry, "account 4337 disable", { chain, profile: A.up, withdraw: true });
    expect((dry.data as any).steps.map((s: any) => s.status)).toEqual(["dry-run", "dry-run"]);
    expect((await status4337(ctx, LOCAL_CHAIN_ID, A.up, agent.address)).enabled).toBe(true);

    const r = await run(ctx, "account 4337 disable", { chain, profile: A.up, withdraw: true });
    expect((r.data as any).steps.map((s: any) => s.status)).toEqual(["done", "done"]);
    expect(await balance(h, A.up)).toBe(upBefore + dep);
    expect(await depositOf(ctx, LOCAL_CHAIN_ID, A.up)).toBe(0n);

    const after = await status4337(ctx, LOCAL_CHAIN_ID, A.up, agent.address);
    expect(after.enabled).toBe(false);
    expect(after.extension.linked).toBeNull();
    expect(after.entryPointController.isController).toBe(false);
    expect(after.entryPointController.inArray).toBe(false);
    expect(after.raw.array.length).toBe(n - 1n);
    expect(after.raw.array.entries[epIndex]).toBe(last);
    expect(after.signer.has4337).toBe(false);
    expect(BigInt(after.signer.permissions)).toBe(ALL_PERMISSIONS);

    const e = await failure(executeAsProfile(ctx, { chainId: LOCAL_CHAIN_ID, profile: A.up, calls: [{ operation: OPERATION.CALL, to: recorder, value: 0n, data: "0x" }] }, { via: "userop" }));
    expect(e.code).toBe("NOT_SUPPORTED");
    const nothing = await run(ctx, "account 4337 disable", { chain, profile: A.up });
    expect((nothing.warnings ?? []).join()).toMatch(/nothing to do/);
  });

  it("admin delegated by policy (allowAdmin, --yes, no --approval): a profile-funded deposit outside the value policy is refused before anything is sent", async () => {
    const home2 = h.newHome();
    await savePolicy(home2, { ...DEFAULT_POLICY, allowAdmin: true });
    const ctxPolicy = testContext(home2, agent, { yes: true });
    const before = await bn(h);
    const e = await failure(run(ctxPolicy, "account 4337 enable", { chain, profile: A.up, "ep-scope": "super", deposit: "1 ether" }));
    expect(e.code).toBe("POLICY_DENIED");
    expect(e.message).toMatch(/value .* exceeds policy.maxValuePerTx/);
    expect(await bn(h)).toBe(before);
    // without the deposit the policy-delegated admin flow runs through
    const ok = await run(ctxPolicy, "account 4337 enable", { chain, profile: A.up, "ep-scope": "super" });
    expect((ok.data as any).status.enabled).toBe(true);
    expect((ok.warnings ?? []).join()).toMatch(/account 4337 deposit/);
  });
});
