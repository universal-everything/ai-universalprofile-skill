# Permissions: what each controller may do

A Universal Profile is owned by its LSP6 Key Manager. Every address that may act for the profile is a **controller**, and its powers are stored in the profile's own ERC725Y data **on each chain where the profile is deployed**: the same profile can have different controllers and permissions on different chains. Granting, changing or removing permissions is an **admin action**: always `--dry-run`, explain in plain words, and get the human's `--approval`. Read the current state with `up permissions list` (all controllers) and `up permissions show <address>` (one controller, decoded).

## Permission bits (LSP6)

A controller's permissions are one 32-byte value; each bit grants one power. Bits 0–22 come from `@lukso/lsp6-contracts`; bit 23 is defined only inside the `Extension4337` contract.

| Bit | Name | Plain words | Risk |
| --- | --- | --- | --- |
| 0 | `CHANGEOWNER` | Can transfer ownership of the profile, i.e. replace the Key Manager and everything it enforces. | **Total control** |
| 1 | `ADDCONTROLLER` | Can add new controllers and set their initial permissions (including powerful ones). | **Near-total control** |
| 2 | `EDITPERMISSIONS` | Can change the permissions of existing controllers, including its own and removing others. | **Near-total control** |
| 3 | `ADDEXTENSIONS` | Can add new functions to the profile by registering LSP17 extension contracts. | High |
| 4 | `CHANGEEXTENSIONS` | Can replace or remove registered extensions. | High |
| 5 | `ADDUNIVERSALRECEIVERDELEGATE` | Can set a Universal Receiver Delegate (code that reacts to incoming tokens and value). | High |
| 6 | `CHANGEUNIVERSALRECEIVERDELEGATE` | Can replace or remove Universal Receiver Delegates. | High |
| 7 | `REENTRANCY` | Can re-enter the profile while another execution is running (needed by some batch and callback flows). | Medium |
| 8 | `SUPER_TRANSFERVALUE` | Can send the profile's native coin to **any** address. | High |
| 9 | `TRANSFERVALUE` | Can send native coin only to addresses listed in its AllowedCalls. | Medium |
| 10 | `SUPER_CALL` | Can call **any** contract and function as the profile (including token transfers and approvals). | High |
| 11 | `CALL` | Can call only the contracts/functions listed in its AllowedCalls. | Medium |
| 12 | `SUPER_STATICCALL` | Can make read-only calls to any contract as the profile. | Low |
| 13 | `STATICCALL` | Can make read-only calls to listed contracts. | Low |
| 14 | `SUPER_DELEGATECALL` | Would run foreign code inside the profile. The Key Manager blocks delegate calls anyway. | **Never grant** |
| 15 | `DELEGATECALL` | Same, restricted to a list. | **Never grant** |
| 16 | `DEPLOY` | Can deploy new contracts from the profile (CREATE/CREATE2). | Medium |
| 17 | `SUPER_SETDATA` | Can write any profile data key, except permission, delegate and extension keys (those need bits 1–6). | Medium |
| 18 | `SETDATA` | Can write only the data keys listed in its AllowedERC725YDataKeys. | Low–medium |
| 19 | `ENCRYPT` | Signal for apps that the controller may encrypt on behalf of the profile. Not enforced on-chain. | Low |
| 20 | `DECRYPT` | Signal for apps that the controller may decrypt on behalf of the profile. Not enforced on-chain. | Low |
| 21 | `SIGN` | Signatures by this controller count as the profile's signature (ERC-1271): logins, CoW orders, x402 payments, permits. | Medium–high (a signature can authorise off-chain spending) |
| 22 | `EXECUTE_RELAY_CALL` | Can use signed relay calls (LSP25), so a relayer pays gas. | Low on its own (the payload still needs its own permissions) |
| 23 | 4337 (`_4337_PERMISSION`, value `0x…00800000`) | Can sign ERC-4337 UserOperations for the profile. Only meaningful when ERC-4337 is enabled. | Medium |

`ALL_PERMISSIONS` = `0x00000000000000000000000000000000000000000000000000000000007f3f7f`: every bit above except `REENTRANCY`, both `DELEGATECALL` bits and bit 23.

`SUPER_*` bits skip the allow-lists entirely. Prefer the plain bits plus allow-lists whenever the human can say what the agent should touch.

## Allow-lists

The plain `CALL`, `TRANSFERVALUE`, `STATICCALL` and `SETDATA` bits do nothing without a matching allow-list entry: the Key Manager reverts with `NoCallsAllowed` / `NoERC725YDataKeysAllowed` when the list is empty and with `NotAllowedCall` / `NotAllowedERC725YDataKey` when nothing matches. `up allowed-calls show|set` and `up allowed-keys show|set` read and write them; `up permissions encode|decode` converts between JSON and the stored bytes.

### AllowedCalls

Each entry says: *this controller may make these kinds of calls, to this address, on contracts of this standard, to this function.*

| Field | Size | Meaning | Wildcard |
| --- | --- | --- | --- |
| call types | 4 bytes | bit flags: `0x00000001` send value, `0x00000002` call, `0x00000004` static call, `0x00000008` delegate call (never) | — |
| address | 20 bytes | the target contract or recipient | `0xffffffffffffffffffffffffffffffffffffffff` = any address |
| standard | 4 bytes | ERC-165 interface id the target must support (e.g. LSP7 `0xc52d6008`) | `0xffffffff` = any |
| function | 4 bytes | function selector (e.g. `0x760d9bba` for LSP7 `transfer`) | `0xffffffff` = any |

- An entry with address, standard and function all set to wildcards is rejected (`InvalidWhitelistedCall`); use `SUPER_CALL` deliberately instead.
- A non-wildcard standard makes the Key Manager check the target with ERC-165 first. That check fails for plain wallets (EOAs), so use the wildcard standard for entries that send value to people.
- Stored under data key `AddressPermissions:AllowedCalls:<controller>` = `0x4b80742de2bf393a64c70000` + 20-byte address, as a compact bytes array: each entry is `0x0020` followed by the 32 bytes above.

Examples in words (the verb builds the bytes):
- "May transfer one specific LSP7 token": call type CALL, address = token, standard = LSP7 `0xc52d6008`, function = `0x760d9bba`.
- "May send LYX to my wallet": call type VALUE, address = the wallet, standard and function = wildcards.
- "May follow and unfollow": call type CALL, address = the LSP26 registry, function = `follow` `0x4dbf27cc` (and a second entry for `unfollow` `0x015a4ead`).

### AllowedERC725YDataKeys

A list of data keys (32 bytes) or key prefixes (1–31 bytes) the controller may write with `SETDATA`. A prefix allows every key that starts with it, e.g. the 10-byte prefix of a mapping key allows all entries of that mapping. Stored under `AddressPermissions:AllowedERC725YDataKeys:<controller>` = `0x4b80742de2bf866c29110000` + address, as a compact bytes array (`2-byte length ‖ key`) per entry. To let the agent update its public profile, allow the `LSP3Profile` key `0x5ef83ad9559033e6e941db7d7c495acdce616347d28e90c7ce47cbfcfcad3bc5`.

## Where permissions live

| Data key | Value |
| --- | --- |
| `AddressPermissions:Permissions:<controller>` = `0x4b80742de2bf82acb3630000` + address | the 32-byte permission value |
| `AddressPermissions[]` length = `0xdf30dba06db6a30e65354d9a64c609861f089545ca58c6b4dbe31a5f338cb0e3` | number of controllers |
| `AddressPermissions[]` index = `0xdf30dba06db6a30e65354d9a64c60986` + 16-byte index | controller address at that index |

The Key Manager enforces the `Permissions:<controller>` key; the array is the list apps use to enumerate controllers. `controller add|edit|remove` keep both consistent in one `setDataBatch`.

## Presets

`up permissions presets` prints each preset with its exact 32-byte value and plain-words description. Always show the value before writing it.

| Preset | Bits | For | Notes |
| --- | --- | --- | --- |
| `agent-owner` | `ALL_PERMISSIONS` | the agent on a profile it deployed itself (J1) | Full control. Add a human controller early, then consider dropping the agent to `agent-operator`. |
| `agent-operator` | `CALL`, `STATICCALL`, `TRANSFERVALUE`, `SETDATA`, `SIGN`, `EXECUTE_RELAY_CALL` + AllowedCalls + AllowedERC725YDataKeys | the agent on a relayer-created or any existing profile (J2); what `up permissions recommend` proposes | Cannot change controllers, ownership or extensions. Its reach is exactly the allow-lists the human approves. |
| `agent-reader` | `STATICCALL` (+ AllowedCalls) + `SIGN` | a read-only or quoting agent | Can still sign as the profile; drop `SIGN` if signatures are not needed. |
| `human-admin` | `ALL_PERMISSIONS` | the human's own wallet as co-controller | Recommended right after a J1 deployment as the recovery path. |
| `entrypoint-4337` | `CALL`, `TRANSFERVALUE`, `STATICCALL`, `SETDATA` (+ allow-lists mirroring the agent's scope) | the ERC-4337 EntryPoint, only when ERC-4337 is enabled | Never give the EntryPoint `CHANGEOWNER`, `ADDCONTROLLER`, `EDITPERMISSIONS` or extension bits. `SUPER_*` only on explicit request. |

What LSP6 cannot enforce: spending amounts, time limits, counts. The skill's delegated policy (`up policy show`) adds client-side limits only: a native-value cap per transaction per chain, a daily count of autonomous actions, allowed chains/targets/selectors, and whether token moves (`allowTokenMoves`, optionally limited to `tokenTargets`) and admin actions (`allowAdmin`) may run with `--yes`. There is no token amount cap and no daily value cap. Say so whenever a human asks for a "limit"; the hard limit is what LSP6 AllowedCalls permit.

## Controller lifecycle

- **Add** (`up controller add <address>`, needs `ADDCONTROLLER`): appends to `AddressPermissions[]`, writes the permission value and optional allow-lists. Explain that this grants permissions to an address; no key is shared and the profile address does not change.
- **Edit** (`up controller edit <address>`, needs `EDITPERMISSIONS`): changes bits and/or allow-lists. Always show before/after.
- **Remove** (`up controller remove <address>`, needs `EDITPERMISSIONS`): clears the permission value and allow-lists and removes the address from the array.
  - **Last-controller rule:** the verb refuses to remove the last controller that holds `CHANGEOWNER`, `ADDCONTROLLER` or `EDITPERMISSIONS`; doing so locks the profile forever. Only override when the human, after you explained that the profile can never be administered again, typed an explicit confirmation of exactly that.
  - Removing the agent's own controller ends its ability to act; confirm that is intended.
- **Per chain.** Your profile's permissions live on each chain where it is deployed: a controller added on LUKSO is not a controller on Base, and the agent may sign on some chain with its own key (`up key address` lists them). Grant and verify on every chain where the agent should act (`up permissions show <address> --chain <id>`; `up profile status` shows all chains at once).
- **Ownership (LSP14)**: `up ownership transfer <newOwner>` starts a two-step transfer; the new owner must call `acceptOwnership` (`up ownership accept`, or for a new Key Manager through that Key Manager). `up ownership renounce` is a two-call, time-windowed process that leaves the profile **without any owner, unrecoverable**; never do it without an explicit, informed human request, and say that plainly.
- **The agent's key is permanent** (never replaced or deleted; `references/security.md`). Only if it is truly lost does a co-owner or admin add a new additional key on each network; the lost key stays listed.

## Diagnosing permission errors

| Revert | Meaning | Fix |
| --- | --- | --- |
| `NoPermissionsSet(address)` | the address is not a controller on this chain | authorise it on this chain (the error hint names the chain; a grant elsewhere does not count) |
| `NotAuthorised(address, "PERMISSION")` | the controller lacks that permission on this chain | ask the human to grant exactly that bit on this chain (`up controller edit <key> --add <PERMISSION> --chain <id>`), or use a different action |
| `NoCallsAllowed(address)` | `CALL`/`TRANSFERVALUE`/`STATICCALL` without any AllowedCalls | add AllowedCalls entries |
| `NotAllowedCall(address, target, selector)` | target or function not in AllowedCalls | add an entry or use another target |
| `NoERC725YDataKeysAllowed(address)` / `NotAllowedERC725YDataKey(address, key)` | `SETDATA` without (matching) allowed keys | add the key or prefix |
| `InvalidWhitelistedCall(address)` | an AllowedCalls entry with all wildcards | rewrite the entry |
| `DelegateCallDisallowedViaKeyManager()` | delegate calls are never possible through the Key Manager | do not use DELEGATECALL |
| `CallingKeyManagerNotAllowed()` | the payload targets the Key Manager itself | target the profile functions instead |

When an action fails for lack of permissions, propose the smallest change that would allow it (one bit, or one allow-list entry), show its encoded value (`up permissions encode`), and let the human decide. Never apply it without approval, and never widen to a `SUPER_*` bit just to make an error go away.
