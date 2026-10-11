// Consent model (J5 "ongoing autonomy"):
//  - local/read verbs never need consent.
//  - write verbs pass with --yes when the action is inside the delegated policy
//    (policy.json: chains, targets, selectors, per-chain native value cap, daily
//    tx count). These limits are enforced by the skill (client side) — the only
//    on-chain limits are what LSP6 enforces (permission bits, AllowedCalls,
//    AllowedERC725YDataKeys). Outside the policy → --approval "<human text>".
//  - admin and secret verbs need --approval unless policy.allowAdmin is true.
//  - --dry-run never needs consent and never sends.
// Every consented action is appended to the local audit log (no secrets).
import { appendFile } from "node:fs/promises";
import { toFunctionSelector } from "viem";
import type { ConsentRequest, Flags } from "./types.ts";
import { UpError } from "./errors.ts";
import { paths, readJson, writeJson, ensureDir } from "./home.ts";
import { toJson } from "./json.ts";

export interface DelegationPolicy {
  version: 1;
  /** Chains on which the agent may act autonomously ("*" = all configured chains). */
  chains: (number | "*")[];
  /** Allowed targets (checksummed or lowercase) or "*" for any target. */
  targets: (string | "*")[];
  /** Allowed 4-byte selectors or "*" (native value transfers have selector "0x"). */
  selectors: (string | "*")[];
  /** Max native value per transaction per chain, in wei (decimal string). "*" key = default. */
  maxValuePerTx: Record<string, string>;
  /** Max number of write actions per UTC day (all chains). */
  maxTxPerDay: number;
  /** Allow admin actions (permissions/controllers/ownership/extensions) without a human approval string.
   *  Never covers key-lifecycle ("secret") verbs or changes to this policy itself — those always need a human. */
  allowAdmin: boolean;
  /** Allow token/asset moves and approvals (transfers, approvals, operators, permits, bridges, withdrawals)
   *  with --yes. Default false: each such call needs a human --approval. When true, optionally restrict
   *  to the token contracts listed in `tokenTargets`. */
  allowTokenMoves: boolean;
  /** Token contracts the agent may move/approve autonomously when allowTokenMoves is true ("*" = any). */
  tokenTargets: (string | "*")[];
}

/**
 * Selectors that move assets or grant spending rights. The skill-side policy treats
 * them like native value: autonomous (--yes) only when policy.allowTokenMoves allows it.
 * This is a client-side guard; the on-chain limit is the controller's LSP6 AllowedCalls.
 */
export const VALUE_MOVING_SIGNATURES = [
  // LSP7 / LSP8
  "function transfer(address,address,uint256,bool,bytes)",
  "function transfer(address,address,bytes32,bool,bytes)",
  "function transferBatch(address[],address[],uint256[],bool[],bytes[])",
  "function transferBatch(address[],address[],bytes32[],bool[],bytes[])",
  "function authorizeOperator(address,uint256,bytes)",
  "function authorizeOperator(address,bytes32,bytes)",
  "function increaseAllowance(address,uint256,bytes)",
  // ERC-20 / 721 / 1155 / 2612
  "function transfer(address,uint256)",
  "function transferFrom(address,address,uint256)",
  "function approve(address,uint256)",
  "function increaseAllowance(address,uint256)",
  "function safeTransferFrom(address,address,uint256)",
  "function safeTransferFrom(address,address,uint256,bytes)",
  "function safeTransferFrom(address,address,uint256,uint256,bytes)",
  "function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
  "function setApprovalForAll(address,bool)",
  "function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  // Permit2, WETH, EntryPoint deposit, Hyperlane, CoW
  "function approve(address,address,uint160,uint48)",
  "function transferFrom(address,address,uint160,address)",
  "function withdraw(uint256)",
  "function withdrawTo(address,uint256)",
  "function transferRemote(uint32,bytes32,uint256)",
  "function setPreSignature(bytes,bool)",
] as const;
export const VALUE_MOVING_SELECTORS: ReadonlySet<string> = new Set(VALUE_MOVING_SIGNATURES.map((s) => toFunctionSelector(s).toLowerCase()));

/**
 * Verbs that always need the human's own words, whatever the policy says (allowAdmin included):
 * the policy itself, and which contract is "your profile" on a chain (profile link / unlink),
 * because a wrong link would point the human's assets at someone else's contract.
 */
export const ALWAYS_HUMAN_VERBS: ReadonlySet<string> = new Set(["policy set", "profile link"]);

export const DEFAULT_POLICY: DelegationPolicy = {
  version: 1,
  chains: ["*"],
  targets: ["*"],
  selectors: ["*"],
  maxValuePerTx: { "*": "0" }, // no native value moves without explicit policy or approval
  maxTxPerDay: 50,
  allowAdmin: false,
  allowTokenMoves: false, // token transfers/approvals/permits need a human approval unless the human enables this
  tokenTargets: ["*"],
};

export async function loadPolicy(home: string): Promise<DelegationPolicy> {
  return { ...DEFAULT_POLICY, ...(await readJson<Partial<DelegationPolicy>>(paths.policy(home), {})) };
}

export async function savePolicy(home: string, p: DelegationPolicy): Promise<void> {
  await writeJson(paths.policy(home), p);
}

interface DailyCounter {
  day: string;
  count: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function policyAllows(p: DelegationPolicy, req: ConsentRequest): { ok: boolean; reason?: string } {
  if (req.chainId !== undefined && !p.chains.includes("*") && !p.chains.includes(req.chainId)) return { ok: false, reason: `chain ${req.chainId} is not in policy.chains` };
  if (req.target && !p.targets.includes("*") && !p.targets.map((t) => t.toLowerCase()).includes(req.target.toLowerCase())) return { ok: false, reason: `target ${req.target} is not in policy.targets` };
  if (req.selector !== undefined && !p.selectors.includes("*") && !p.selectors.map((s) => s.toLowerCase()).includes(req.selector.toLowerCase())) return { ok: false, reason: `selector ${req.selector} is not in policy.selectors` };
  if (req.selector && VALUE_MOVING_SELECTORS.has(req.selector.toLowerCase())) {
    if (!p.allowTokenMoves) return { ok: false, reason: `function ${req.selector} moves assets or grants spending rights; policy.allowTokenMoves is false` };
    if (req.target && !p.tokenTargets.includes("*") && !p.tokenTargets.map((t) => t.toLowerCase()).includes(req.target.toLowerCase())) return { ok: false, reason: `token ${req.target} is not in policy.tokenTargets` };
  }
  if (req.value !== undefined && req.value > 0n) {
    const cap = BigInt(p.maxValuePerTx[String(req.chainId)] ?? p.maxValuePerTx["*"] ?? "0");
    if (req.value > cap) return { ok: false, reason: `value ${req.value} wei exceeds policy.maxValuePerTx (${cap} wei) on chain ${req.chainId}` };
  }
  return { ok: true };
}

export async function requireConsent(home: string, flags: Flags, req: ConsentRequest): Promise<void> {
  if (req.risk === "local" || req.risk === "read") return;
  if (flags.dryRun) return; // caller must not send in dry-run mode
  const policy = await loadPolicy(home);
  const block = { action: req.verb, risk: req.risk, chainId: req.chainId, ...req.summary };

  // secret (key lifecycle) and policy changes always need the human; admin needs the human unless delegated.
  const needsHuman = req.risk === "secret" || ALWAYS_HUMAN_VERBS.has(req.verb) || (req.risk === "admin" && !policy.allowAdmin);
  let decision: "approval" | "policy" | undefined;
  if (flags.approval && flags.approval.trim().length >= 3) decision = "approval";
  else if (!needsHuman && flags.yes) {
    const verdict = policyAllows(policy, req);
    if (!verdict.ok) {
      throw new UpError("POLICY_DENIED", `outside the delegated policy: ${verdict.reason}`, {
        hint: "ask the human to approve this exact action and pass their words with --approval, or ask them to widen policy.json",
        details: { confirmation: block },
      });
    }
    const counterFile = paths.cache(home, "daily-counter.json");
    const c = await readJson<DailyCounter>(counterFile, { day: today(), count: 0 });
    const cur = c.day === today() ? c : { day: today(), count: 0 };
    if (cur.count >= policy.maxTxPerDay) throw new UpError("POLICY_DENIED", `daily limit of ${policy.maxTxPerDay} autonomous actions reached`, { details: { confirmation: block } });
    await writeJson(counterFile, { day: cur.day, count: cur.count + 1 });
    decision = "policy";
  }
  if (!decision) {
    throw new UpError("CONSENT_REQUIRED", needsHuman ? `"${req.verb}" changes control of the profile and needs a human approval` : `"${req.verb}" needs --yes (within policy) or a human --approval`, {
      hint: needsHuman
        ? "show the confirmation block to the human, then re-run with --approval \"<their exact words>\""
        : "re-run with --yes if this is inside the delegated policy, otherwise ask the human and pass --approval",
      details: { confirmation: block },
    });
  }
  await ensureDir(home);
  const line = toJson({ at: new Date().toISOString(), decision, approval: flags.approval, ...block }, false) + "\n";
  (await import("./secret-guard.ts")).assertNothingSecretToWrite(line, "the audit log");
  await appendFile(paths.audit(home), line, { mode: 0o600 });
}
