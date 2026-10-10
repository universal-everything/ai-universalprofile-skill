// The "userop" ExecTransport (path d, opt-in): executes a profile action as an
// ERC-4337 v0.6 UserOperation through the profile's Extension4337. Never chosen
// automatically — only with an explicit `--via userop` / `exec userop`.
// Refuses with a precise hint when the profile is not 4337-enabled on the chain.
// Submission: the chain's configured bundler (config.bundlers[chainId]) or, if
// none, self-bundling (the controller EOA calls EntryPoint.handleOps; not gasless).
//
// Signing discipline: Extension4337 UserOperations never expire, so a signed op is a
// bearer instrument. The op is prepared and estimated with a dummy signature, the
// consent block is shown, and only then is the real userOpHash signed — exactly
// once, never in --dry-run; dry-run output never contains a signature.
import { encodeFunctionData, type Address, type Hex } from "viem";
import type { Signer, VerbContext } from "../core/types.ts";
import { UpError } from "../core/errors.ts";
import { loadPolicy, policyAllows } from "../core/policy.ts";
import { hintForRevert } from "../chain/tx.ts";
import { registerTransport, type ExecOptions, type ExecOutcome, type ExecRequest, type ExecTransport } from "../exec/transport.ts";
import { ENTRYPOINT_V06, entryPoint06Abi } from "./constants.ts";
import { BundlerClient, validateBundlerUrl } from "./bundler.ts";
import { hintForMissing, status4337 } from "./extension.ts";
import { aaUpError } from "./aa-errors.ts";
import { decodeProfilePayload, describeCalls, type DecodedProfilePayload } from "./payload.ts";
import {
  buildCallData,
  preflight,
  preflightError,
  prepareUserOperation,
  selfBundle,
  signPreparedUserOp,
  submitToBundler,
  userOpJson,
  validatePrepared,
  type GasOverrides,
  type UserOpResult,
} from "./userop.ts";

export interface UserOpExecOptions extends ExecOptions {
  userop?: {
    /** bundler URL override; null/"none" forces self-bundling */
    bundlerUrl?: string | null;
    /** ignore a configured bundler and self-bundle */
    selfBundle?: boolean;
    paymasterAndData?: Hex;
    gas?: GasOverrides;
    nonceKey?: bigint;
    /** skip the client-side permission preflight (tests of on-chain failure decoding only) */
    skipPreflight?: boolean;
  };
}

/** Bundler for a chain: explicit override > config.bundlers[chainId] > none (self-bundling). */
export async function resolveBundler(ctx: VerbContext, chainId: number, override?: string | null, forceSelf = false): Promise<BundlerClient | undefined> {
  if (forceSelf || override === null || override === "none") return undefined;
  const url = override ?? (await ctx.config()).bundlers?.[String(chainId)];
  if (!url) return undefined;
  return new BundlerClient(validateBundlerUrl(url));
}

/** What the profile will actually do: explicit calls, or the decoded raw payload. */
export function describeRequest(req: ExecRequest): DecodedProfilePayload {
  return req.payload ? decodeProfilePayload(req.payload, req.profile) : describeCalls(req.calls ?? []);
}

function decodedView(d: DecodedProfilePayload) {
  return {
    kind: d.kind,
    selector: d.selector,
    totalValue: d.totalValue.toString(),
    targets: d.targets,
    calls: d.calls.map((c, i) => ({ operation: c.operation, to: c.to, value: c.value.toString(), selector: d.innerSelectors[i], data: c.data })),
    dataKeys: d.dataKeys,
    risk: d.risk,
    reasons: d.reasons,
  };
}

/**
 * Consent with the real economic content of the op: total native value, real target(s) and inner selector(s).
 * Payloads that change control (permissions, extensions, URD, ownership) or cannot be classified are "admin".
 */
export async function consentForUserOp(ctx: VerbContext, req: ExecRequest, d: DecodedProfilePayload, summary: Record<string, unknown>, verb = "exec (via userop)"): Promise<void> {
  // A batch is only autonomous if every call is inside the delegated policy.
  if (d.risk === "write" && d.calls.length > 1 && ctx.flags.yes && !ctx.flags.approval && !ctx.flags.dryRun) {
    const policy = await loadPolicy(ctx.home);
    d.calls.forEach((c, i) => {
      const v = policyAllows(policy, { verb, risk: "write", chainId: req.chainId, summary: {}, target: c.to, selector: d.innerSelectors[i], value: c.value });
      if (!v.ok) throw new UpError("POLICY_DENIED", `outside the delegated policy: ${v.reason}`, { hint: "ask the human to approve this exact batch and pass their words with --approval", details: { confirmation: summary } });
    });
  }
  const single = d.calls.length === 1 ? { target: d.calls[0].to, selector: d.innerSelectors[0] } : d.calls.length === 0 ? { target: req.profile, selector: d.selector } : {};
  await ctx.consent({ verb, risk: d.risk, chainId: req.chainId, value: d.totalValue, ...single, calls: d.calls.map((c, i) => ({ target: c.to, selector: d.innerSelectors[i], value: c.value })), summary: { ...summary, decoded: decodedView(d) } });
}

export const userOpTransport: ExecTransport = {
  path: "userop",
  async execute(ctx: VerbContext, signer: Signer, req: ExecRequest, options: ExecOptions): Promise<ExecOutcome> {
    const opts = (options as UserOpExecOptions).userop ?? {};
    const chainId = req.chainId;
    const entryPoint: Address = ENTRYPOINT_V06;
    const decoded = describeRequest(req);
    const s = await status4337(ctx, chainId, req.profile, signer.address, entryPoint);
    if (!s.enabled) {
      throw new UpError("NOT_SUPPORTED", `ERC-4337 is not enabled for profile ${s.profile} on chain ${chainId} (missing: ${s.missing.join(", ")})`, {
        hint: hintForMissing(s),
        details: { missing: s.missing, entryPoint: s.entryPoint, extension: s.extension, signer: s.signer },
      });
    }
    const callData = buildCallData(req);
    if (!opts.skipPreflight) {
      const pf = await preflight(ctx, chainId, { entryPoint, profile: s.profile, keyManager: s.keyManager, signer: signer.address, callData });
      const err = preflightError(pf, { entryPoint, signer: signer.address, chainId });
      if (err) throw err;
    }
    const bundler = await resolveBundler(ctx, chainId, opts.bundlerUrl, opts.selfBundle);
    if (bundler) await bundler.verify(chainId, entryPoint);
    const mode = bundler ? "bundler" : "self-bundle";
    const gasPayer = bundler
      ? `bundler ${bundler.label} fronts gas; charged to the profile's EntryPoint deposit${opts.paymasterAndData ? " / paymaster" : ""}`
      : `controller EOA ${signer.address} fronts gas (self-bundled, NOT gasless); refunded from the profile's EntryPoint deposit`;

    // Unsigned preparation (dummy signature for every estimation/simulation, including the bundler's).
    const prep = await prepareUserOperation(ctx, {
      chainId,
      profile: s.profile,
      callData,
      signer: signer.address,
      entryPoint,
      bundler,
      paymasterAndData: opts.paymasterAndData,
      nonceKey: opts.nonceKey,
      gas: opts.gas,
    });
    const warnings = [...prep.warnings, ...decoded.reasons];
    const summary: Record<string, unknown> = {
      path: "userop (ERC-4337, EntryPoint v0.6, Extension4337)",
      profile: s.profile,
      signer: signer.address,
      entryPoint,
      extension: s.extension.linked,
      mode,
      gasPayer,
      description: req.description,
      deposit: prep.deposit.toString(),
      requiredPrefund: prep.requiredPrefund.toString(),
      userOpHash: prep.userOpHash,
      userOperation: { ...userOpJson(prep.op), signature: "0x" },
      signed: false,
      gasSource: prep.gasSource,
    };
    const underfunded = prep.op.paymasterAndData === "0x" && prep.deposit < prep.requiredPrefund;
    if (underfunded && !ctx.flags.dryRun) {
      throw aaUpError("AA21 didn't pay prefund", "pre-submission check", { deposit: prep.deposit, requiredPrefund: prep.requiredPrefund }, `top up the profile's EntryPoint deposit by at least ${prep.requiredPrefund - prep.deposit} wei: up account 4337 deposit --chain ${chainId} --amount ${prep.requiredPrefund - prep.deposit}`);
    }

    await consentForUserOp(ctx, req, decoded, summary);

    const base = { path: "userop" as const, chainId, profile: s.profile, keyManager: s.keyManager, gasPayer, userOpHash: prep.userOpHash, confirmation: summary, warnings };
    // Dry-run: never sign. The output carries the unsigned op only (it cannot pass validation).
    if (ctx.flags.dryRun) return { ...base, status: "dry-run" };

    // Consent passed: sign exactly once, re-validate with the real signature, submit.
    const signed = await signPreparedUserOp(ctx, signer, prep);
    await validatePrepared(ctx, signed);
    const entryCalldata = bundler ? undefined : encodeFunctionData({ abi: entryPoint06Abi, functionName: "handleOps", args: [[signed.op], signer.address] });
    const result: UserOpResult = bundler ? await submitToBundler(ctx, bundler, signed) : await selfBundle(ctx, signer, signed);
    const outcome: ExecOutcome = {
      ...base,
      status: result.success ? "success" : "reverted",
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      gasUsed: result.actualGasUsed?.toString(),
      explorerUrl: result.explorerUrl,
      entryCalldata,
      confirmation: { ...summary, signed: true, actualGasCost: result.actualGasCost?.toString(), mode: result.mode },
    };
    if (!result.success) {
      throw new UpError("TX_FAILED", `UserOperation ${prep.userOpHash} was included${result.txHash ? ` in ${result.txHash}` : ""} but its execution reverted: ${result.revert?.message ?? "unknown reason"} (the profile still paid ${result.actualGasCost ?? "?"} wei gas from its deposit)`, {
        hint: hintForRevert(result.revert ?? { message: "" }),
        details: { outcome, revert: result.revert },
      });
    }
    return outcome;
  },
};

registerTransport(userOpTransport);
