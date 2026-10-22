# Execution paths: how an action becomes a transaction of the profile

> **Reminder:** the profile holds the assets and acts; the agent's key only signs and pays gas. Never use the key address as a wallet.

Every write verb (`exec send`, `contract call`, `token transfer`, `controller add`, `follow`, …) builds one **payload** for the profile and hands it to one of four transports. On every path the final target sees `msg.sender == profile`. The Key Manager (LSP6) checks permissions on every path. Pick the path with `--via km|lsp0|relay|userop` (a verb's default is shown in `up <verb> --help`; the path used is reported in `data.path`). `userop` is never used unless you pass it.

## The payload

The payload is profile-level calldata:

| Action | Profile function | Selector |
| --- | --- | --- |
| Call / send value / deploy | `execute(uint256 operation, address to, uint256 value, bytes data)` | `0x44c028fe` |
| Several calls, atomic | `executeBatch(uint256[],address[],uint256[],bytes[])` | `0x31858452` |
| Write data keys | `setData(bytes32,bytes)` / `setDataBatch(bytes32[],bytes[])` | `0x7f23690c` / `0x97902421` |
| Ownership (LSP14) | `transferOwnership(address)` / `acceptOwnership()` / `renounceOwnership()` | `0xf2fde38b` / `0x79ba5097` / `0x715018a6` |

Operation types: `0` CALL, `1` CREATE, `2` CREATE2, `3` STATICCALL, `4` DELEGATECALL. DELEGATECALL through the Key Manager always reverts (`DelegateCallDisallowedViaKeyManager`); the skill refuses it up front. Calling the Key Manager itself from the profile reverts (`CallingKeyManagerNotAllowed`).

## The four paths

| | `km` direct Key Manager | `lsp0` direct profile (LSP20) | `relay` LSP25 via relayer | `userop` ERC-4337 (opt-in) |
| --- | --- | --- | --- | --- |
| Entry call | `KeyManager.execute(bytes payload)` `0x09c5eabe` (batch: `executeBatch(uint256[],bytes[])` `0xbf0176ff`) | the payload sent straight to the profile; the profile asks its owner via `lsp20VerifyCall` | relayer submits `KeyManager.executeRelayCall(bytes signature, uint256 nonce, uint256 validityTimestamps, bytes payload)` `0x4c8a4e74` (a batch is one such call with an `executeBatch` payload; `executeRelayCallBatch` `0xa20856a5` is library only) | bundler → `EntryPoint.handleOps` → profile `validateUserOp` (via LSP17 `Extension4337`) → payload executed by the EntryPoint |
| What the controller signs | an ordinary EIP-1559 transaction | an ordinary EIP-1559 transaction | an LSP25 message (EIP-191 version `0x00`), no transaction | the UserOperation hash (EIP-191 `personal_sign`) |
| Who pays gas | controller address | controller address | relayer (counts against your quota) | the profile's deposit at the EntryPoint, or a paymaster |
| Value sent by the action | from the profile's balance | from the profile's balance | from the profile's balance | from the profile's balance |
| Permission checked first | the payload's permissions | the payload's permissions | `EXECUTE_RELAY_CALL` on the signer, then the payload's | bit 23 on the signer (validation), then the EntryPoint's own permissions (execution) |
| Simulation | `eth_call` from the controller to the Key Manager | `eth_call` from the controller to the profile | `eth_call` of `executeRelayCall` (anyone can be `from`) | `eth_estimateUserOperationGas` / `simulateValidation` |
| Tracking | transaction hash | transaction hash | relayer response + transaction hash; the chain receipt is the proof | UserOperation hash, then its receipt |

### When to use which

1. **`relay`** is the primary path when a relayer covers the chain (`up relayer list`) and `up relayer quota --chain <id>` shows enough quota. No gas needed at the controller. Requires `EXECUTE_RELAY_CALL` (J1 profiles have it; it is in the J2 recommendation).
2. **`km`** when no relayer covers the chain or quota is insufficient, and the controller address holds enough native coin. If it does not, the skill reports the amount needed; turn that into a funding request (`up display address <controller> --chain <id>`).
3. **`lsp0`** only when the human asks for it or a payload must reach the profile directly (every payload verb accepts `--via lsp0`: setData, controller and ownership changes). The profile must be owned by a Key Manager (LSP20 verification). Same permissions and same gas payer as `km`.
4. **`userop`** only after the human explicitly asked for ERC-4337 and `up account 4337 status --chain <id>` says it is enabled (`references/erc4337.md`). Self-bundling (no public bundler) is not gasless: the controller pays the bundle transaction.

To use a specific path, pass `--via` on every call; the policy does not pin paths.

## Native value: who pays what (example: 5 LYX into a swap router)

`up exec send --to <router> --data <calldata> --value 5lyx` builds one ERC725X call, `execute(0 CALL, router, 5000000000000000000, calldata)`: the value in base units (18 decimals for every native coin; `--value 5` would be 5 wei). `contract call --value` builds the same call. The profile sends the 5 LYX from its own balance; nothing else carries value:

| Path | Transaction on chain | Its `value` | Pays the 5 LYX | Pays gas |
| --- | --- | --- | --- | --- |
| `km` | your key → `KeyManager.execute(payload)`; batch: `executeBatch(values, payloads)` with every value 0 (their sum must equal the transaction value) | 0 | the profile | your key |
| `lsp0` | your key → `profile.execute(…)` (`executeBatch` for several calls) | 0 | the profile | your key |
| `relay` | relayer → `KeyManager.executeRelayCall(…)`; the LSP25 signed value is 0 | 0 | the profile | the relayer; your key needs no coins |
| `userop` | bundler → `EntryPoint.handleOps` → `profile.execute(…)` | 0 | the profile | the profile's EntryPoint deposit or a paymaster |

- The router sees `msg.sender` = the profile and `msg.value` = 5 LYX. The confirmation block shows it: `actor`, `calls[].value` (wei) and `valueFormatted`, `valueSource` ("profile balance"), `entry.value` (what the transaction itself sends: 0) and `gasPayer`.
- The profile's balance must cover the value (otherwise `ERC725X_InsufficientBalance`); your key's balance only pays gas. `up profile status` shows both separately. Coins sent to your key for gas are never the profile's money.
- `--fund-from-controller` (`km` and `lsp0` only) is the one exception: the transaction carries the value from your key and the Key Manager forwards it through the profile. That spends gas money, so it always needs the human's `--approval` (the delegated policy never covers it), and it is never a fallback when the profile lacks funds.
- The skill simulates exactly this entry call (from your key to the Key Manager or the profile, or the relay call). A direct `eth_call` from your key to the router proves nothing: wrong sender, wrong balance, no approvals.

## What the Key Manager checks (all paths)

| Payload | Permission needed |
| --- | --- |
| `execute` CALL with value | `TRANSFERVALUE` (needs a matching AllowedCalls entry with the VALUE call type) or `SUPER_TRANSFERVALUE` |
| `execute` CALL with data, or with neither data nor value | `CALL` (needs a matching AllowedCalls entry) or `SUPER_CALL` |
| `execute` STATICCALL | `STATICCALL` (+ AllowedCalls) or `SUPER_STATICCALL` |
| `execute` CREATE / CREATE2 | `DEPLOY` (+ `SUPER_TRANSFERVALUE` if value is sent to the constructor) |
| `setData` on `AddressPermissions…` keys | `ADDCONTROLLER` (new controller) / `EDITPERMISSIONS` (existing) |
| `setData` on `LSP1UniversalReceiverDelegate…` keys | `ADDUNIVERSALRECEIVERDELEGATE` / `CHANGEUNIVERSALRECEIVERDELEGATE` |
| `setData` on `LSP17Extension:<selector>` keys | `ADDEXTENSIONS` / `CHANGEEXTENSIONS` (`SUPER_SETDATA` does not bypass this) |
| `setData` on any other key | `SETDATA` + matching AllowedERC725YDataKeys, or `SUPER_SETDATA` |
| ownership functions | `CHANGEOWNER` |
| a nested call re-entering the profile | `REENTRANCY` on the re-entering controller |

Meaning of each permission and the allow-list encodings: `references/permissions.md`.

## Signatures (never mixed)

| Purpose | Scheme | Signed digest |
| --- | --- | --- |
| LSP25 relay call | EIP-191 version `0x00` ("intended validator" = the Key Manager) | `keccak256(0x19 ‖ 0x00 ‖ keyManager ‖ abi.encodePacked(uint256 25, uint256 chainId, uint256 nonce, uint256 validityTimestamps, uint256 value, bytes payload))` |
| ERC-4337 UserOperation | EIP-191 `personal_sign` (`0x45`) | `userOpHash = keccak256(abi.encode(hash(userOp), entryPoint, chainId))` |
| Profile signature for off-chain use (ERC-1271) | as required by the consumer (EIP-712 typed data or EIP-191) | validated by `profile.isValidSignature(hash, sig)`: the Key Manager accepts a signature from a controller holding `SIGN`; success returns `0x1626ba7e` |
| LSP15 `/quota` | controller signs the quota message defined by LSP15 | see `references/relayer.md` |
| Direct paths | EIP-1559 transaction | — |

An LSP25 signature is bound to **one Key Manager on one chain** (both are inside the digest). A relayer cannot replay it elsewhere; the HTTP `chainId` field is only a routing hint.

## Nonces and validity (relay)

- Three separate counters: the relay (LSP25) nonce below; the key's own transaction nonce (`pending` count, `km`/`lsp0`, deployments); the EntryPoint nonce (`userop`). The relay channel never applies to the other two, and neither of them is ever random.
- LSP25 nonce = `(channelId << 128) | sequence`, read with `getNonce(address signer, uint128 channel)` (`up nonce`), per chain, Key Manager, signer and channel. Calls on different channels are independent; within a channel they execute in order. The skill signs exactly the full value it reads right before signing; it never caches or counts nonces.
- **Saved relay channel.** Every relayed call uses the profile's saved channel: one random `uint128` (16 bytes from the operating system's CSPRNG; 0–3 excluded) per profile in this state folder, created at the first relayed send and kept in `profiles/<address>.json` (public, not a secret; `up nonce channel` shows it). It is the same on every chain, at a linked per-chain address and with every relayer; per-chain keys use the same number with their own counters. It is never replaced: no new channel per chat, restart, upgrade or relayer, and never one to escape a pending or conflicting call. Dry runs, `exec simulate` and `up nonce` never create it. Two agents (state folders) on one profile get different channels, so they cannot invalidate each other's signed calls (a collision is astronomically unlikely, not impossible). Reusing one channel pays the counter's first storage write (zero to non-zero) once per chain, Key Manager and key; later calls are cheaper, not free.
- `--channel <decimal|0x…>` overrides the channel for one call (advanced; the saved channel is unchanged). The earlier defaults (one hashed channel per relayer and chain, channel 0 for LUKSO's live relayer) are no longer used; `up nonce` still lists their counters so calls signed on them before can be checked.
- Key backups do not contain the channel. A profile restored from a backup gets no implicit new channel: the first relayed send stops (`relay_channel_not_created`) until `up nonce channel create --channel <earlier channel>` (continues the earlier one) or `up nonce channel create` (new random one) is run with the human's approval, after earlier relayed actions are settled. It is a write of permanent state: `--dry-run` shows what would be saved and writes nothing, and `up nonce channel` (read-only) only shows it.
- A chain address that a profile links (`profile link`) belongs to that profile: every relayed call to it on that chain uses that profile's channel, whoever asks (`--profile` or the default), also if the address relayed as itself before the link (the first such calls name that earlier channel). Two profiles linking one address on one chain, or a damaged profile record, stop the call.
- A used nonce does not prove which call used it. After an ambiguous relayer answer the skill decodes the transaction that used the nonce and reports success only when it is a direct Key Manager call carrying exactly this signed call (also as an item of `executeRelayCallBatch`); another call of the same key with this nonce is `nonce_used_by_other_call` (this call did not execute), a transaction it cannot decode (e.g. a wrapper contract) is `relay_outcome_unresolved`, and a nonce that stays unused is `relay_outcome_unknown` (the signed call may still land).
- `validityTimestamps` packs a start and an end time (two `uint128`). The skill's default window is from 60 s ago to 10 minutes ahead. `0` means valid forever; use it only when the human explicitly wants that.
- A relay call that reverts does not consume the nonce.
- Errors: `InvalidRelayNonce` (used or wrong nonce, or wrong signing scheme), `RelayCallBeforeStartTime`, `RelayCallExpired`.

## Batches

- `KeyManager.executeBatch` and `executeRelayCallBatch` are **atomic**: one failure reverts everything. No verb sends `executeRelayCallBatch` (library only: several signed calls with consecutive nonces on one channel); `exec batch --via relay` signs one `executeRelayCall` whose payload is the profile's `executeBatch`. The sum of all values must equal the value sent exactly (`LSP6BatchInsufficientValueSent` / `LSP6BatchExcessiveValueSent`).
- `profile.executeBatch` (ERC725X) is atomic as well and needs one permission check per call.
- `batchCalls(bytes[])` on the profile re-enters the profile per call and needs `REENTRANCY` for the second non-setData call from a non-owner controller. No verb sends `batchCalls`; use `exec batch` (`executeBatch`). A raw `batchCalls` payload is treated as an unknown payload and needs the human's approval.

## Before sending: the confirmation block

Every write shows (and `--dry-run` returns) the same block: chain name and id, actor (the profile), Key Manager, target, value with symbol, decoded function and arguments, path, gas payer and, for relay, relayer, nonce channel and validity window. Show it to the human when approval is needed. The skill refuses to send anything whose simulation reverts.

## After sending: receipts and finality

- The skill waits for the receipt on the **same chain** and reports `status`, block, gas used and an explorer link. A relayer's or bundler's answer is not proof; the chain receipt is.
- On failure it decodes the revert with the bundled LSP/ERC725/EntryPoint error table (`references/errors.md` lists the common ones).
- Inclusion is not finality. LUKSO and Ethereum have about 12-second blocks and finalise after roughly 13 minutes; say "included" until then for large amounts. `up exec receipt <txHash> --chain <id>` re-checks later.
- Decoded events tell what happened: `Executed`, `ContractCreated`, `DataChanged`, `UniversalReceiver`, `PermissionsVerified`, ownership events.

## Gas and funding in one sentence each

- Direct paths: the controller address pays gas in the chain's native coin; fund it per chain.
- Relay: the relayer pays gas; your quota decreases. Quota does not pay for the value you send.
- ERC-4337: the profile's EntryPoint deposit (or a paymaster) pays; the extension never pays the prefund itself, so a missing deposit fails with `AA21`.
- Value sent by any action comes from the profile's balance on that chain (only `--fund-from-controller`, with the human's approval, sends it from your key).
