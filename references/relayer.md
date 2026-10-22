# Relayers: gasless execution through LSP25 and LSP15

A relayer submits the profile's signed calls and pays the gas. The agent signs an **LSP25 relay call** with its controller key; the relayer sends `KeyManager.executeRelayCall(...)` on-chain. The HTTP API between agent and relayer is **LSP15** (Transaction Relay Service API). This is the primary execution path wherever a relayer covers the chain and quota is available (`references/execution-paths.md`).

## What a relayer can and cannot do

- It can submit your signed call, or refuse to. It cannot change it: the signature covers the Key Manager address, chain id, nonce, validity window, value and payload.
- It cannot replay the call on another chain or another profile (both are bound inside the signature).
- It can delay or drop a call. A relayer's response (including a transaction hash) is a claim; the **receipt on the chain** is the only proof. The skill always waits for the receipt on the same chain.
- It pays gas only. Value sent by the action comes from the profile's balance.
- The controller needs `EXECUTE_RELAY_CALL` (bit 22) on that chain, plus the permissions the payload needs.

## LSP15 in short

| Endpoint | Request | Response | Authorisation |
| --- | --- | --- | --- |
| `POST /execute` | `{ address: <profile>, transaction: { abi: <calldata for executeRelayCall>, signature, nonce, validityTimestamps? } }` | `{ transactionHash }` | none: the LSP25 signature is the authorisation |
| `POST /quota` | `{ address: <controller>, timestamp, signature }` | `{ quota, unit: gas \| lyx \| transactionCount, totalQuota, resetDate }` | the controller signs the quota message defined by LSP15; `timestamp` must be within ±300 seconds of the relayer's clock |

Specification: https://github.com/lukso-network/LIPs/blob/main/LSPs/LSP-15-TransactionRelayServiceAPI.md

- **No API key and no JWT** are needed for an LSP15 relayer: never ask the human for relayer credentials, never paste a key into a relayer website.
- Quota is read, never bought, by the skill. Prices, plans and allowances are described on the relayer's own website; link to it, do not quote prices.
- Units differ: `gas` is not comparable across chains. The skill shows unit and chain and never adds quotas of different chains together.
- Clock skew breaks quota signatures: if quota checks fail with an authorisation error, check that the machine's clock is synchronised.

## The multichain extension: `chainId`

Published LSP15 has no chain field; single-chain relayers use one base URL per chain. Multichain relayers (such as the Universal Relayer) need to know where to submit. The skill therefore sends a top-level `chainId` on both calls:

```jsonc
// POST /execute
{ "address": "0x<profile>", "chainId": 42, "transaction": { "abi": "0x…", "signature": "0x…", "nonce": "0x…", "validityTimestamps": "0x…" } }
// POST /quota
{ "address": "0x<controller>", "chainId": 42, "timestamp": 1760000000, "signature": "0x…" }
```

Rules the skill follows:
1. `chainId` is a routing hint only. The relayer must check that it equals the chain id inside the LSP25 signature and that the profile's Key Manager on that chain is the one in the signature; otherwise `422 chain_binding_mismatch`. The skill checks the same before sending.
2. Responses echo `chainId`; the skill rejects a response for another chain.
3. Per-chain quota signatures include the chain id (`quotaSignatureVersion: 2`); version 1 (no chain id) remains valid for a global quota.
4. Relayers may describe themselves at `GET /.well-known/lsp15.json` or `GET /capabilities` (supported chain ids, whether `chainId` is required, quota scope global/per-chain, signature versions). Without that document the skill uses legacy mode: one base URL per chain (the relayer's configured chain list must include the chain). The top-level `chainId` is still sent, which relayers that ignore unknown fields accept; only the `lukso-live` profile omits it.

This extension is a proposal for an LSP15 revision, implemented by the skill and intended for the Universal Relayer. It is not part of the published LSP15 text; a relayer that ignores unknown fields still works in legacy mode.

## Relayers the skill knows

- `up relayer list` shows configured relayers and the ones in the registry. The bundled registry lists **LUKSO's public relayer** for LUKSO Mainnet (42, `https://relayer.mainnet.lukso.network/api`) and LUKSO Testnet (4201, `https://relayer.testnet.lukso.network/api`).
- The **Universal Relayer** (the multichain relayer the universalprofile.ai website links to) is configured by URL when the human has it: `up relayer add <baseUrl>`. Its intended initial coverage is LUKSO, Ethereum, Base, BNB Smart Chain, Arbitrum One, Robinhood Chain, Polygon, Avalanche C-Chain, LUKSO Testnet and Ethereum Sepolia; treat that as a statement of intent until `up relayer quota --chain <id>` works.
- Any other LSP15-conformant relayer the human names can be added the same way. Adding a relayer sends it nothing secret.

### LUKSO's public relayer differs from LSP15

The live LUKSO relayer API (documented at https://docs.lukso.tech) differs from the LSP15 text: `POST /execute` returns `{ taskId, transactionHash }` and the task status is read with `GET /task/{taskId}` (CREATED, PROCESSING, COMPLETE, FAILED); its quota endpoint uses a Sign-In-With-Ethereum login that returns a bearer token instead of the signed quota message; profiles must be registered with it to get an allowance. The skill talks to it through a separate client profile (`lukso-live`) behind the same verbs; the task id is tracked until the chain receipt arrives, because a re-submitted task can get a new transaction hash. Chains are separated by base URL (no `chainId` field).

The nonce goes to it exactly as to every other relayer: a `0x` hex uint256 (see "Nonce on the wire" below). The examples in its documentation show a small JSON number (`0`, `Number(nonce)`); that is exact only below 2^53 and cannot carry the nonce of the profile's saved relay channel (channel × 2^128 + counter), so the skill never sends a JSON number or a decimal string, and never falls back to channel 0.

### Nonce on the wire

The skill builds the `/execute` body itself; agents never compute, split, pack or format a nonce. `transaction.nonce` is the full value `getNonce(controller, channel)` returns (the channel in the high 128 bits, the counter in the low 128 bits), sent unchanged as an exact `0x` hex uint256 in minimal form (`"0x0"`, `"0x7e57…0001"`), to every relayer profile; `validityTimestamps` likewise. The LSP25 signature packs the same value as a 32-byte uint256, so the hex form changes neither the nonce nor the signed digest. If a relayer refuses a call, the skill passes on its error as is: it does not switch channel, relayer or path for you.

## Flow of a relayed action

1. `up relayer quota --chain <id>`: enough quota for the estimated gas? If not, stop or fall back to `--via km` only if the controller is funded and the action is still approved.
2. The skill builds the payload, reads the full nonce of the profile's saved relay channel (`getNonce(controller, channel)`; `up nonce channel`), sets the validity window (default: 60 s ago → 10 min ahead), signs the LSP25 digest locally, and simulates `executeRelayCall` against the chain.
3. It shows the confirmation block: relayer, chain, profile, Key Manager, nonce channel, validity window, decoded payload.
4. `POST /execute` (with `chainId` where supported; nonce and validity window as `0x` hex).
5. It waits for the receipt on the same chain, checks that the transaction carries exactly this signed call (decoded from its calldata; a used nonce alone is no proof), and decodes events or the revert.

Never re-send the same signed call (same nonce) to a different relayer until the first relayer's submission is proven dropped (validity window passed, or nonce still unused after it); otherwise both could land.

## Relayer errors and what to do

| Relayer answer | Meaning | Next step |
| --- | --- | --- |
| `400 chainId_required` / `400 chain_unsupported` | multichain relayer needs `chainId`, or does not serve this chain | check `up relayer list`; use another relayer or `--via km` |
| `422 chain_binding_mismatch` | the `chainId` field does not match the signed call | bug or wrong chain selection; do not retry blindly, report |
| `402 quota_exhausted` | no quota left (scope given) | tell the human; wait for the reset date, use direct execution if funded |
| `401` (LSP15 relayers: `auth_required`; LUKSO live: controller lacks permission) | quota signature invalid, or the controller lacks `EXECUTE_RELAY_CALL` / payload permissions | check the system clock, then `up permissions show <controller>` |
| `403 profile_not_authorised` / LUKSO live `403` | profile unknown to or banned by the relayer | the human registers the profile with that relayer |
| LUKSO live `422` | profile not registered with the LUKSO relayer | the human registers it, or use another path |
| `409 nonce_conflict` | nonce already used or pending | find the transaction that used it (`up exec receipt <hash>`); never re-sign or switch channel until this call is proven not executed |
| `425 not_yet_valid` / `410 expired` | validity window not started / passed | re-sign with a fresh window |
| `502 chain_submission_failed` / `5xx` | the relayer could not submit, or submitted and could not say so | do not resend, re-sign or switch path: the skill watches the chain and reports `relay_outcome_unknown` (may still land), `relay_outcome_unresolved` or `nonce_used_by_other_call` |

The skill reports these as `RELAYER_ERROR` with the relayer's status and message in `details`. On-chain reverts of a relayed call are decoded like any other (`InvalidRelayNonce`, `RelayCallExpired`, `RelayCallBeforeStartTime`, `NotAuthorised(…, "EXECUTE_RELAY_CALL")`, …; see `references/errors.md`).
