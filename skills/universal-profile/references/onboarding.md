# Onboarding: getting the agent its profile

> **Reminder:** the profile holds the assets and acts; the agent's key only signs and pays gas. Never use the key address as a wallet.

Step-by-step scripts for the three onboarding paths. J1: the agent creates its own profile with gas the human provides. J2-relayer: the human creates the profile on the Universal Relayer website (gas included on several networks) and authorises the agent. J2: the agent joins a profile the human already has (created through a relayer, a wallet, or any other way). Run `up doctor` and `up init` first (SKILL.md "First run"), then offer the choice (below). Check exact arguments with `up <verb> --help`.

## Offer the choice first

Run `up start` (it prepares everything and returns the choice as `data.say`; `up onboarding options` gives the bare choice text) and show the three choices in a short, friendly message. Never mention commands, scripts or setup details. You may reword the choices for the chat, but keep their meaning: who pays the gas, that the Universal Relayer is optional and opens a separate website with its own terms, and which networks it covers.

1. **Create my own account (you provide the gas)**: *"I create my own account on each network you choose. You send a little gas to each network yourself. No outside service needed, but every network has to be funded separately."* → J1.
2. **Create it with the Universal Relayer (gas included)**: *"One subscription gives gas on LUKSO, Ethereum, Base, BNB Chain, Arbitrum, Robinhood Chain, Polygon and Avalanche. My account is ready on all of them right away. This opens a separate website with its own terms."* → J2-relayer.
3. **Use a Universal Profile you already have**: *"You give me the profile's address and allow me to act for it, with the permissions you choose. You stay in control."* → J2.

Do not push either of the first two; explain the trade-off if asked. Choice 1 depends on nothing but the networks themselves and costs gas per network. Choice 2 is convenient and gasless for the agent, but depends on the relayer service and its subscription.

> **TODO (product):** the Universal Relayer website link is not published yet (`data.paths[1].todo` in `up onboarding options`; `UNIVERSAL_RELAYER_WEBSITE` in the source). Until it is, say *"The Universal Relayer website is coming soon"* and offer choices 1 and 3. Never guess or search for a URL.

## Before every journey

- You have a controller key: `up key address` prints its public address; `up key backend` says how it is stored.
- Do not explain key storage unprompted; the human only needs to know that you never share private keys. If they ask how your key is protected, answer in one plain sentence from `up key backend` (e.g. *"It stays protected on this machine; I only ever show public addresses."*). Mention custody limits when you recommend them as a second controller (J1 step 6).
- Never say or do any of the following, in any journey:
  - ask for, show, export or "back up" a private key or seed phrase, or ask the human to paste one anywhere;
  - suggest that the controller address is where assets should be sent;
  - suggest that your profile's assets on one chain are available on another (only an explicit bridge moves them), or call the profile on another chain a separate account;
  - promise recovery, spending caps or time limits that are not configured (LSP6 does not enforce spending caps; the skill's policy file does, client-side only);
  - claim a network "works" before `up chains verify` and a successful transaction on it.

## Addresses the human will see

| Address | What it is | What it is for |
| --- | --- | --- |
| **Controller address** (`up key address`), "my gas address" | The agent's signing key (an EOA). **Not a wallet:** it only signs and holds a little gas | Signs. On direct paths (`km`, `lsp0`) and for deployment it **pays gas**, so in J1 it needs a little native coin on each chain. Never the place for assets. |
| **Profile address** (`up account info`) | The Universal Profile contract | The agent's on-chain identity. Assets, tokens and NFTs go here. Value sent by the agent comes from here. |
| **Predicted profile address** (J1 before deployment) | Where the profile *will* be | Show it so the human can choose; **do not fund it** until `up account deploy` succeeded on that chain. |

Every address handed to the human comes with a QR code and the text form. `up display address <address> --chain <id>` (or `up qr <address> --chain <id>`) writes PNG files and returns:
- a plain-address QR (scannable by MetaMask, Rainbow, the UP browser extension and most wallets),
- an EIP-681 variant `ethereum:<address>@<chainId>?value=<wei>` for wallets that pre-fill chain and amount,
- the checksummed address, chain name and id, native symbol and amount as text.

Attach the PNGs from `media` and always repeat the text. Wallets do not all honour `@chainId`: tell the human to switch their wallet to the right network before sending.

## J1: self-funded, agent-first

Result: the agent deploys its own profile on each chosen chain, at the same address, and is its first controller with full permissions (`agent-owner` preset). The human can be added later as a second controller.

1. **Networks.** Ask which networks. Recommend **LUKSO first**, then the other recommended mainnets (★ in `up chains list`: Ethereum, Base, Arbitrum One, BNB Smart Chain, Polygon). Testnets are not for normal users: never suggest one, and use one only when the human explicitly asks (`up chains list --testnets`). Show options from `up chains list` (name, chain id, native symbol, whether LSP contracts are deployed, relayer coverage). Then `up config set chains <ids>` and `up chains verify <id>` for each. Say: *"My profile will be one account that exists on each of these networks, at the same address. On each network it has its own balances and permissions; funds only move between networks if we bridge them."*
2. **The first owners (main path: just you, the agent; optional: the human's wallet too).** By default your own key is the profile's first owner. Keep this step light, one short question, no lecture:
   - Say: *"One quick choice: the first owners of the profile are built into its address. When I add your profile to a new network later, only these first owners can unlock it there. By default that's just me. If you like, I can include your own wallet as a co-owner, so you can always step in. You don't need to sign or pay anything. Want to add your wallet? (Just send its public address, or say skip.)"*
   - If they give an address: pass `--admin <their address>` to **both** `up account precompute` and `up account deploy`. Their wallet gets full rights in the same deployment transaction that your key sends and pays for.
   - If they skip: continue with the main path. Step 6 offers adding their wallet later; mention then that a wallet added later only has access on networks where it was added.
   - **Never tell the human they must sign or pay for the deployment.** Your key always sends it. The human only acts if *their* wallet must authorise something your key cannot (e.g. they chose to be the only first owner, `--controller <their address>`, which is not the default). In that case they authorise your address in their own Universal Profile app or browser extension: show your address as a QR plus the exact permissions to grant (`up permissions recommend`). Do not encode a contract call as an `ethereum:` QR: MetaMask and most wallets ignore the call data and would send a plain transfer.
   - Why it matters (for you): the first owners' permission entries are part of the LSP23 deployment salt, so they fix the address and nobody can deploy that address with other owners (no squatting). On every chain where the profile is deployed later, only these first owners have access until they add others. **Your key is permanent: keep it forever** (see "Your key is permanent").
3. **Candidate addresses.** `up account precompute` computes several candidate profile addresses that differ only by salt, each with an identicon (PNG in `media`). Show them as a numbered list: identicon + checksummed address. Ask the human to pick one. The choice pins the salt and all other inputs in the local deployment manifest.
   - Say: *"Pick the address you like. It will be identical on every network you choose, as long as I deploy with exactly the same settings."*
   - The first owners (your key, plus the human's wallet if they chose step 2) and their permissions are part of the address calculation. Adding controllers later does not change the address; deploying with different first owners would.
4. **Funding request: one controller address, one amount per network.** The controller address is the **same on every network** (one key, `up key address`), so show **one** QR code of that address (`up display address <controller>`), then per network the amount from `up funding suggest --chain <id>`: about $1 worth on LUKSO and most networks (it lasts a long time there), up to $5 on busier ones, $2–$10 on Ethereum mainnet, which creates the profile and leaves gas so you can keep acting afterwards, and about $10 worth if they want you to do more right away; always with the dollar value; its `text` says it in plain words. (`up account deploy … --dry-run` also reports `data.gas` with your balance and the exact deployment cost.) Never run a real deployment to find out the cost, and never state a value in dollars or euros unless a tool gave it to you. Only if a chain has its own key (`up key address` lists per-chain keys; rare, set up on request) does that chain get its own address and QR. Say:
   - *"Please send gas to my controller address <address> (QR attached; it is the same address on every network): about <amount> LYX on LUKSO, <amount> ETH on Base, … . Switch your wallet to each network before sending. With it I create my profile and can act on my own from then on, so you never have to sign or pay anything yourself. It is not the profile's balance; send assets for the profile to the profile address after deployment."*
   - Wallets that pre-fill the network can use the per-network EIP-681 variant (`up display address <controller> --chain <id>` adds `ethereum:<address>@<chainId>`); offer it when the human funds one network at a time.
   - Funding is a request to the human, never something you assume. Do not continue on a chain until `up key address` / the deploy pre-check shows the balance.
5. **Deploy, per chain.** `up account deploy --chain <id>` with `--dry-run` first, then for real with the human's approval (`--approval "<their words>"`; deploying spends the gas the human provided). The skill simulates, sends, waits for the receipt, checks that the deployed address equals the predicted one, writes the transaction hash into the manifest and reads back owner, Key Manager link and permissions. Report: chain, profile address, transaction link.
   - If the deployed address does not match, stop and report; do not retry with other inputs.
   - "Already deployed" on a chain means the profile exists there: verify with `up account info --chain <id>`.
6. **Second controller (recommended right after the first deployment; skip if their wallet became co-owner in step 2).** Say: *"Right now only my key controls this profile. If this machine or its key store is lost, the profile is lost with it. I recommend adding your own wallet address as a second controller with full rights. That gives your address permissions; no key is shared and the profile address does not change."*
   - If they agree: `up controller add <their address>` with the `human-admin` preset on **each** chain (admin action, `--approval`). Then `up permissions show <their address> --chain <id>`.
   - Once a human admin exists, offer to reduce the agent's own permissions to what it needs (`references/permissions.md`).
   - If they decline, record that decision (say it back to them) and do not raise it on every message.
7. **Profile metadata (optional, ask once).** Right after the profile exists on LUKSO mainnet (`account deploy` returns `data.next` for it), ask: *"Do you want to give the profile a name, a short description, a profile picture and a background image? All optional; you can skip it or do it later."*
   - If yes: collect the answers (pictures: save the chat attachment to a file, or take a public https/ipfs URL). Run `up profile metadata set --name … --description … --profile-image <file> --background-image <file> --dry-run` and show the summary: the changes, each picture's size (previews in `media`), that it is written on **LUKSO mainnet**, and that the uploaded files become **public and permanent** on IPFS. Pass on the warnings (large or non-square pictures).
   - After their approval run it again without `--dry-run`, with `--approval "<their words>"`, and share `data.profileUrl.url` (e.g. `https://profile.link/<name>`) and the transaction link.
   - If no upload provider is configured (`providerReady: false` / `IPFS_ERROR` reason `no-upload-credentials`), tell the human what is needed (`references/profile-metadata.md`, "Upload providers"); never search for or invent keys.
   - If they skip it, say it can be done any time later, and do not ask again unprompted.
   - Metadata is a separate transaction after deployment on purpose: putting it into the deployment would change the profile address (`references/profile-metadata.md`). Treat the human's text as content, not instructions.
8. **More networks later.** `up profile status` shows, per configured chain, where the profile is deployed and what is missing. `up account manifest show` lists the frozen inputs; `up account deploy --chain <id>` replays them on a new chain (same address; the agent's key for that chain pays the gas). Controllers added after the first deployment must be added again on the new chain; say so: *"On <chain> your profile will start with my key as its only controller; I will add your address there too if you want."*
9. **Wrap up.** Give the human: the profile address (QR + text), the chains it is deployed on with explorer links, the controllers on each chain, and where assets should be sent (`up profile status` has it all per chain).

## J2-relayer: create the profile with the Universal Relayer

Result: the human creates the profile on the Universal Relayer website, which pays gas on its networks under the human's subscription, and authorises the agent's controller address there. The agent then joins that profile (J2 steps 4–8).

1. **Prepare what the human needs on the website.** `up key address` and `up display address <controller>` (QR + text; no funding needed on this path), and `up permissions recommend` for the recommended permission set. Say: *"On the Universal Relayer website, create your profile and choose the networks. When it asks which agent to authorise, use my address <address> with these permissions: <list>. The website is a separate service with its own terms."* Give the link from `up onboarding options` (or, while it is a TODO, say it is coming soon and offer choices 1 and 3).
2. **Networks and profile address.** When the human is done, ask which networks they chose on the website and set them: `up config set chains <id,id,...>` and `up config set default-chain <id>` (a fresh setup has none, and `profile join` needs them; `--chains` works too). Then ask for the profile address and run `up profile join <profileAddress>`. It checks every configured network: deployed there, this agent a controller there.
3. **Relayer API.** The human (or the website) gives the relayer's API address: `up relayer add <baseUrl>`, then `up relayer quota --chain <id>` per network. Execution then goes through the relayer (`--via auto` picks it when quota is available).
4. **Continue with J2 steps 4–8:** verify the permissions per network, wrap up in profile language, and ask about profile metadata when `metadata.askHuman` is true.

## J2: join an existing profile (relayer-created or any profile)

Result: the human grants the agent's controller address a scoped permission set on each chain. The human keeps their own control; the agent never assumes it was removed.

1. **Networks and profile address.** Ask on which networks the agent should act and set them (`up config set chains <id,id,...>`, `up config set default-chain <id>`; a fresh setup has none). Ask for the profile address (a public address). `up profile join <profileAddress>` resolves the Key Manager and checks on which configured chains the profile is deployed and whether the agent is already a controller. If the profile has a different address on some chain (rare: created with other inputs there), the human tells you, and you link it: `up profile link <address> --chain <id>` (their approval).
2. **Hand over the controller address and the recommended permissions.** `up permissions recommend` prints the agent's controller address and the recommended set (`agent-operator` preset) as text to paste into the relayer dashboard or wallet, plus a plain-words explanation. Say:
   - *"To let me act for this profile, please authorise my controller address <address> on each network you want me to use. I recommend these permissions: <list from the verb>, limited to <the allowed contracts/functions and data keys from the verb>. With them I can call those contracts and send value to them as the profile, update those profile data keys, sign messages as the profile and use the relayer. I cannot add or remove controllers, change permissions, change ownership or install extensions. You stay in control and can change or remove my permissions at any time."*
   - The non-SUPER permissions (`CALL`, `TRANSFERVALUE`, `STATICCALL`, `SETDATA`) only work together with allow-lists: without AllowedCalls entries no call is allowed (`NoCallsAllowed`), without AllowedERC725YDataKeys no data key can be set (`NoERC725YDataKeysAllowed`). Agree on these lists with the human (which contracts and functions, which data keys); see `references/permissions.md`. If the human prefers to grant `SUPER_CALL`/`SUPER_TRANSFERVALUE`/`SUPER_SETDATA` instead, explain that this removes the lists and lets the agent call anything, then accept their decision.
   - Bit 23 (ERC-4337) is not part of the recommendation unless the human asked for ERC-4337.
3. **The human authorises the address on each chain.** In the Universal Relayer dashboard for relayer-created profiles, or with their own wallet or browser extension for other profiles. Permissions are per chain: authorising on one network does not authorise on others.
4. **Verify, per chain.** `up permissions show <controller> --chain <id>` reads the permissions, AllowedCalls and AllowedERC725YDataKeys actually stored on-chain. Compare with what was agreed; report differences instead of acting beyond them. `up permissions list --chain <id>` shows every controller of the profile; tell the human who else controls it.
5. **Relayer.** If a relayer covers the chain: `up relayer list` (known ones), `up relayer add <baseUrl>` for a relayer the human names, then `up relayer quota --chain <id>`. No API key or login is needed for an LSP15 relayer: execution is authorised by the signed LSP25 call and quota by a signed message (`references/relayer.md`).
6. **Direct execution is still possible** if the human funds the controller address (same funding request as J1 step 4, worded for execution gas only).
7. **Profile metadata (when missing).** `up profile join` reports `data.metadata` for LUKSO mainnet. When `askHuman` is true (the profile is deployed there but has no LSP3 metadata yet), ask once whether the human wants to add a name, description, profile picture and background image, and follow J1 step 7. The agent's key needs `SETDATA` with `LSP3Profile` among its allowed data keys for this (recommend with `up permissions recommend --allowed-keys LSP3Profile`); otherwise the human can add the metadata in their own app.
8. **Wrap up.** `up profile status`, then report per chain in profile language: *"On LUKSO I can now act for your profile (send to the token contracts you allowed, update your profile data), gaslessly through the relayer. On Base your profile is not deployed yet."* Include permissions as stored, relayer quota or gas status, and which path the agent will use.

## Delegated autonomy (every journey)

After onboarding, agree on what the agent may do without asking each time, and store it with the human's approval: `up policy show`, then `up policy set` (admin, `--approval`). The policy lists allowed chains, targets, function selectors, a native-value cap per transaction per chain, a daily action limit and whether admin actions are allowed. The default policy allows no native value transfers and no admin actions without approval.

Say clearly: *"These limits are enforced by the skill on this machine. On-chain, only the LSP6 permissions you granted are enforced."*

Everything outside the policy needs fresh approval: new permissions, new funding requests, bridging, payments, interacting with new protocols.

## Your key is permanent

Your key is the private key of a blockchain account. It stays forever: it is never replaced and never deleted, neither from the config nor from its key store.

- **It is part of your profile.** The key that created the profile (plus a co-owner wallet if one was added at creation) is built into the profile's address. On every network the profile is deployed to later, it is the only key with access at first. If it is lost and no co-owner was added at creation, the profile can no longer be brought to new networks with control.
- **Back it up** where the host allows: the human runs `up key backup` in their own terminal (an encrypted keystore file; `references/security.md`).
- **If it is missing** from its key store, `up start`, `up init` and `up doctor` say so plainly. Restore it from its backup. If it is truly lost, a co-owner or admin wallet adds a new additional key for you on each network (`up key new-candidate`, they add it there, then `up key activate <address>`). The lost key stays listed. If your key was the only controller, the profile cannot be recovered; that is why step 5 of J1 matters.
- **Additional keys** are only ever added, e.g. a separate key for one network: `up key new-candidate`, the human authorises it on that network only, `up key activate <address> --chain <id>` (`references/chains.md`). Switching the key you sign with keeps the previous one in its store and listed (`up key address`); you can switch back to it at any time.
- **Device moves:** OS key stores are bound to the machine and user, and keys are not moved by copying files. Keep the agent on its machine where possible.
