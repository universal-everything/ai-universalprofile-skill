// Verb registrations of the account core (LSP module): account, permissions,
// controllers, ownership, profile join, signing. Execute verbs live in
// src/exec/verbs.ts and relayer verbs in src/relayer/verbs.ts.
import "../exec/verbs.ts";
import "./verbs-account.ts";
import "./verbs-permissions.ts";
import "./verbs-sign.ts";
