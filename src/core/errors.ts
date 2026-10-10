// Structured errors. `code` is stable and documented in references/errors.md;
// agents branch on it. `hint` is a one-line next step for the agent.
export type ErrorCode =
  | "BAD_ARGS"
  | "UNKNOWN_VERB"
  | "CHAIN_UNKNOWN"
  | "RPC_UNAVAILABLE"
  | "NO_SIGNER"
  | "SIGNER_BACKEND_UNAVAILABLE"
  | "SIGNER_LOCKED"
  | "CONSENT_REQUIRED"
  | "POLICY_DENIED"
  | "NOT_DEPLOYED"
  | "NOT_AUTHORISED"
  | "SIMULATION_REVERTED"
  | "TX_FAILED"
  | "RELAYER_ERROR"
  | "BUNDLER_ERROR"
  | "ABI_NOT_FOUND"
  | "ABI_UNTRUSTED"
  | "NETWORK_ERROR"
  | "NOT_SUPPORTED"
  | "INTERNAL";

export class UpError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, opts: { hint?: string; details?: unknown; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "UpError";
    this.code = code;
    this.hint = opts.hint;
    this.details = opts.details;
  }
  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details };
  }
}

export function asUpError(e: unknown): UpError {
  if (e instanceof UpError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new UpError("INTERNAL", msg, { cause: e });
}
