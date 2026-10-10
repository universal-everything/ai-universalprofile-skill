# Errors: every code, what it means, what to do next

Failures come back as `{ "ok": false, "verb": "…", "error": { "code", "message", "hint", "details" } }` (exit code `1`, or `2` for `BAD_ARGS`/`UNKNOWN_VERB`; over MCP `isError: true` with the same object in `structuredContent`). Branch on `code`; follow `hint`; show the human `message` in plain words. Never retry a failed write blindly and never work around a refusal.

## Skill error codes

| Code | Meaning | Next step |
| --- | --- | --- |
| `BAD_ARGS` | Missing, unknown or malformed argument (address, amount, chain, JSON). | Run `up <verb> --help` and fix the call. Do not guess values the human did not give (ask instead). |
| `UNKNOWN_VERB` | No such verb. | `up help`; verb names are in `SKILL.md` and `references/verbs.md`. |
| `CHAIN_UNKNOWN` | The chain is not in the registry or overlay, or has no RPC known. | `up chains list`; `up chains refresh` for newer upstream deployments; `up chains add <chainId>` for other EVM chains, then `up chains verify`. |
| `RPC_UNAVAILABLE` | Every RPC endpoint for the chain failed (timeout, error, wrong chain id, stale head). | `up chains rpc find <chainId>`, then retry. Still failing: ask the human for an RPC URL and `up chains rpc set <chain> <url>`. |
| `NETWORK_ERROR` | An HTTP request other than RPC failed (Chainlist, explorer, registry refresh). | Check connectivity / egress approvals (`assets/registry/egress.json`); retry later; continue with bundled data where possible. |
| `NO_SIGNER` | No controller key is configured, or the configured key is missing from its store. | First run: `up init`. If a key existed before: tell the human plainly it is missing; it is permanent and is never replaced. Restore it from its backup; if it is truly lost, a co-owner or admin wallet adds a new additional key for the agent on each network (`up key new-candidate`, then `up key activate <address>`); the lost key stays listed. Never invent or import a key. |
| `SIGNER_BACKEND_UNAVAILABLE` | The requested or every suitable key store is unavailable here. | `up key backend` shows why per store. Report it; a plain key file (`--backend protected-file`) only with the human's explicit acceptance; in a cloud agent VM set `UP_AGENT_HOST`. |
| `SIGNER_LOCKED` | The key store is locked or refused access (keychain locked, keyring locked, DPAPI unavailable in this session, file permissions too open, key does not match its address). | Relay the hint exactly (e.g. "log in to the Mac once", "fix permissions of the keys directory"). Never ask for a password, never prompt, never switch stores. Retry after the human fixed it. |
| `CONSENT_REQUIRED` | The action writes, is admin or touches keys, and neither a matching policy (`--yes`) nor a human approval (`--approval`) was given. | Show `details.confirmation` to the human in plain words, ask, then re-run with `--approval "<their exact words>"` (or `--yes` if it is inside the policy). |
| `POLICY_DENIED` | `--yes` was given but the action is outside the delegated policy (chain, target, selector, value cap, daily limit). `message` says which rule. | Ask the human for this specific action (`--approval`), or ask whether they want to change the policy (`up policy set`, admin). |
| `NOT_DEPLOYED` | Your profile (or a required contract: factory, EntryPoint, extension, protocol) has no code on that chain. For the profile, the per-chain preflight of every write raises it before anything is signed; `details.manifest` says whether this agent can replay the deployment, `details.next` lists the steps. | Tell the human the profile is not on that chain yet. With a manifest: `up account deploy --chain <id>` (same address); without: the human deploys it there, or links the address it has there (`up profile link`). For infrastructure: `up chains verify`; ERC-4337: `up account 4337 status`. Never send funds to the undeployed address. |
| `NOT_AUTHORISED` | The agent's key for that chain is not allowed to do this there (not a controller there — `details.errorName` `NoPermissionsSet` — or a missing permission bit, AllowedCalls entry or allowed data key). | Read `details` and the hint (it names the chain and the fix). Not a controller: hand the human `up permissions recommend --chain <id>`; if `details.otherLocalController` is set, another key of the agent already is one there. Missing permission: propose the smallest change on that chain (`references/permissions.md`); the human decides. |
| `SIMULATION_REVERTED` | Simulation of the exact transaction/relay call/UserOperation reverted; nothing was sent. `message` has the decoded reason. | Explain the decoded reason (table below). Fix the cause; do not send anyway. |
| `TX_FAILED` | Sending failed or the transaction reverted on-chain (or the agent's key lacks gas on that chain: the message says how much is needed). `details.reason` `concurrent-change`: the profile metadata changed on-chain while `profile metadata set` was preparing a merge; nothing was written. | Insufficient gas: funding request for that chain with `up display address <key> --chain <id>` (the hint has the exact command). Reverted: `up exec receipt <hash> --chain <id>` and explain. Re-sending needs the same consent again. |
| `RELAYER_ERROR` | The relayer refused or failed (coverage, quota, authorisation, nonce, validity, submission). `details` has its status and message. | See the error table in `references/relayer.md`. Fall back to `--via km` only if the controller is funded and the action is still approved; never send the same signed call to a second relayer until the first is proven dropped. |
| `BUNDLER_ERROR` | The ERC-4337 bundler or EntryPoint rejected the UserOperation (`AAxx` codes, JSON-RPC errors). | See `references/erc4337.md`. Common: `AA21` deposit missing, `AA24` signer lacks bit 23 or bad signature. |
| `ABI_NOT_FOUND` | No ABI could be found for the contract on any rung of the discovery ladder. | `references/discovery.md`: try `up abi resolve-proxy`, `up abi selector`; ask the human for the ABI or the protocol's documentation. |
| `ABI_UNTRUSTED` | The only ABI is a selector-database guess (or unverified), and the call would move value or authority. | Show the human the raw calldata, the trust label and all candidate decodings; continue only with their `--approval`. |
| `IPFS_ERROR` | Profile metadata: an IPFS upload or verification failed, or no upload provider is configured. `details.reason`: `no-upload-credentials`, `unauthorized`, `upload-failed`, `invalid-response`, `verification-failed` (the gateway served other bytes), `gateway-unavailable`, `gateway-error`, `existing-unverified` (the current metadata does not match its on-chain hash or cannot be fetched). Nothing was written on-chain. | No credentials: ask the human to configure a provider (`references/profile-metadata.md`); never look for keys. Upload/gateway problems: retry later or switch provider. `existing-unverified`: show `up profile metadata show`; write a fresh document with `--replace` only with the human's approval. If the files were uploaded but the write failed (`details.uploaded`), re-running the same command reuses the same IPFS addresses. |
| `NOT_SUPPORTED` | The feature is not available here or in this version (e.g. remote signer, a path not enabled on this chain, ERC-4337 not enabled). | Explain the limitation honestly; offer the supported alternative named in `hint`. |
| `INTERNAL` | Unexpected error in the skill. | Report the message to the human; do not retry writes in a loop. Read-only commands may be retried once. |

## Decoded on-chain errors you will meet

The skill decodes reverts with the bundled LSP, ERC725 and EntryPoint error tables (`details` / `message`). The most common:

| Error | Meaning | What to do |
| --- | --- | --- |
| `NotAuthorised(address controller, string permission)` | the controller lacks that permission on this chain | ask for exactly that permission or change the action |
| `NoPermissionsSet(address)` | not a controller of this profile on this chain | authorise it on this chain (`references/onboarding.md` J2) |
| `NoCallsAllowed(address)` / `NotAllowedCall(address, target, selector)` | AllowedCalls missing / no matching entry | add an entry or use another target |
| `NoERC725YDataKeysAllowed(address)` / `NotAllowedERC725YDataKey(address, key)` | allowed data keys missing / not matching | add the key or prefix |
| `InvalidRelayNonce(address, uint256, bytes)` | relay nonce used or wrong, or the signature does not match | re-read the nonce (`up nonce`) and re-sign |
| `RelayCallBeforeStartTime()` / `RelayCallExpired()` | outside the validity window | re-sign with a fresh window |
| `LSP6BatchInsufficientValueSent` / `LSP6BatchExcessiveValueSent` | batch values do not sum to the value sent | fix the batch |
| `DelegateCallDisallowedViaKeyManager()` | delegate calls are never allowed via the Key Manager | do not use DELEGATECALL |
| `CallingKeyManagerNotAllowed()` | the payload calls the Key Manager itself | call profile functions instead |
| `InvalidWhitelistedCall(address)` | an all-wildcard AllowedCalls entry | rewrite the entry |
| `ERC725X_InsufficientBalance(uint256 balance, uint256 value)` | the profile does not hold enough native coin on this chain | ask the human to fund the **profile** (not the controller) or reduce the amount |
| `LSP20CallVerificationFailed(bool, bytes4)` | the Key Manager rejected a direct (lsp0) call | read the inner error; check permissions |
| `NoExtensionFoundForFunctionSelector(bytes4)` | the profile has no LSP17 extension for that function | e.g. ERC-721/1155 callbacks or ERC-4337 not registered |
| `LSP14CallerNotPendingOwner(address)` / `LSP14NotInRenounceOwnershipInterval(…)` | ownership step out of order / outside the time window | follow the two-step order (`references/permissions.md`) |
| `LSP7NotifyTokenReceiverIsEOA(address)` / `LSP7NotifyTokenReceiverContractMissingLSP1Interface(address)` (and LSP8) | `force = false` to a recipient without LSP1 | confirm the recipient; use `force = true` only with the human's agreement (`references/tokens.md`) |
| `LSP7AmountExceedsBalance(…)` / `LSP8NotTokenOwner(…)` | not enough tokens / not the owner of that token id | check balance on this chain |
| `LSP7AmountExceedsAuthorizedAmount(…)` / `LSP8NotTokenOperator(…)` | operator allowance too low / not an operator | adjust the allowance (approval needed) |
| `LSP7TransferDisabled()` / `LSP8TransferDisabled()` | the token is non-transferable (now or during a lock period) | report; no workaround |
| `LSP26CannotSelfFollow()` / `LSP26AlreadyFollowing(address)` / `LSP26NotFollowing(address)` | follow-state errors | nothing to do, report the state |
| `FailedOp(uint256, string)` with `AAxx` | ERC-4337 EntryPoint rejection | `references/erc4337.md` |
| `Error(string)` / `Panic(uint256)` | generic Solidity revert / assertion | explain the message; the target contract decided this |

Unknown error selectors are shown raw; look them up with `up abi selector <0x…>` and the contract's ABI (`up abi fetch`), and say that a selector-database match is a guess.
