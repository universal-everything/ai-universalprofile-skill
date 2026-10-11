# Onboarding UX: how each step looks to the human

Read this before every onboarding step. `onboarding.md` says **what** to do; this file says **how the human sees it**. The human is not technical. Every step is one short chat message they can answer in a few words, without knowing anything about blockchains.

## Rules for every onboarding message

1. **One step per message, one question per message.** End with exactly one question and say what a good answer looks like ("Reply with a number", "Send the address or say skip").
2. **Text first, then pictures.** Write the explanation, then attach the picture(s) in the same message. Never send a picture on its own, and never send a picture the text does not explain.
3. **One picture per idea.** The address choice is one labelled picture (from `up account precompute`), a funding request is one QR code. Never send a series of unlabelled images.
4. **Short addresses in lists, full address when it matters.** In lists write `0x2448…f75e` (first 4 and last 4 characters, same as the picture). Write the full address only where the human must copy, check or send to it, on its own line, never inside a sentence.
5. **Plain words only.** Say "profile", "address", "network", "my gas address", "co-owner". Never say: salt, seed, candidate, deploy, LSP, controller key, Key Manager, EOA, calldata, manifest, keystore, preset, verb, command, script, or any `up …` command.
6. **Offer a default.** Every question has a safe default the human can accept with one word ("If you don't mind, I'll take number 1").
7. **Short.** At most about 8 lines of text plus the list. No lectures. Background in SKILL.md "Why it works this way" is for you, not for them.
8. **Confirm the choice back** in one line before acting ("Got it: number 3, 0x1ab2…7d9c.").
9. **Never invent steps.** No testnet, no asking the human to sign or pay the deployment, no MetaMask contract calls, no "back up your key" (the account backup below is offered as "a backup of my account", never as the key), no "send assets to my gas address".
10. **When something fails,** say what happened in one plain sentence and what you will do next. No error codes unless they ask.

Each step below has: **Goal** · **Message** (adapt the wording, keep the content) · **Attach** · **Expected reply** · **Never**.

---

## Step 0: welcome and the three ways

- **Goal:** the human picks how the profile is created.
- **Message:** `up start` → `data.say`, shown as it is (three numbered options, LUKSO recommended).
- **Attach:** nothing.
- **Expected reply:** 1, 2 or 3. Default: 1.
- **Never:** explain keys, gas mechanics or standards here; push the relayer; mention a link that is not published (say "coming soon").

## J1 · Step 1: networks

- **Goal:** the networks the profile will exist on.
- **Message:**
  > I'll start on LUKSO. Do you also want me on other networks? Good choices are Ethereum, Base, Arbitrum, BNB Chain and Polygon. It's the same profile and the same address on each one, and you can add more any time.
  > Reply with the networks, or "just LUKSO".
- **Attach:** nothing.
- **Expected reply:** network names. Default: just LUKSO.
- **Never:** list 70 networks; mention testnets; mention chain ids.

## J1 · Step 2: co-owner (optional)

- **Goal:** optionally make the human's own wallet a co-owner from the start.
- **Message:**
  > One quick, optional choice: do you want your own wallet as a co-owner of my profile? Then you can always step in, on every network. You don't need to sign or pay anything.
  > Send your wallet's public address, or say "skip".
- **Attach:** nothing.
- **Expected reply:** a public address (0x… 42 characters) or "skip". Default: skip.
- **On reply:** check it is a valid address, confirm it back as `0xAbCd…1234 will be a co-owner.` If they send anything that looks like a private key or seed words (typed, spoken or in a screenshot): do not repeat it; tell them it has now been seen by the AI service, so they should move that wallet's funds to a new wallet, and that you only ever need the public address.
- **Never:** ask for a private key or seed phrase; explain address derivation.

## J1 · Step 3: choose the profile address

- **Goal:** the human picks one of the prepared addresses. Purely cosmetic.
- **Message:** `up account precompute` → `data.say`. It reads like:
  > My profile needs an address. It's permanent and the same on every network. I've prepared 5 options:
  > 1 · 0x2448…f75e
  > 2 · 0x863f…760e
  > 3 · 0x1ab2…7d9c
  > 4 · …
  > 5 · …
  > The picture shows each address's pattern with its number. Apps show that pattern next to an address so it's easy to recognise. Which number do you like? It's only a matter of taste. If you don't mind, I'll take number 1.
- **Attach:** the **one** picture from `media` (rows: pattern, number, short address). Nothing else.
- **Expected reply:** a number. Default: 1.
- **On reply:** confirm with the full address on its own line: "Great, number 3:" then the address (from `data.choices`; choice n is candidate n-1).
- **Never:** send the identicons as separate images; send the picture before the text; print the full addresses in the list (they wrap and become unreadable on phones); say "candidate", "salt" or "seed".

## J1 · Step 4: funding (the most important step)

- **Goal:** the human sends a small amount of gas to the agent's gas address, per network.
- **Message:** one QR (the gas address is the same on every network) and the amounts from `up funding suggest`:
  > To create my profile I need a little gas. Please send it to my gas address (QR attached, the same address on every network):
  > 0x9F3c…full address on its own line
  > · LUKSO: about <amount> LYX (≈ $1). That lasts a long time there.
  > · Base: about <amount> ETH (≈ $1)
  > Switch your wallet to each network before sending. This is only for gas. Your profile's own money goes to the profile address, which I'll give you once it exists.
- **Attach:** the one QR of the gas address.
- **Expected reply:** "sent" (or a question). Then check balances yourself before going on.
- **Never:** call it a wallet or "my account"; quote amounts without the dollar value; send several QR codes when one address covers all networks; ask on relayer-paid networks; say "running low" when the balance is fine.

## J1 · Step 5: create the profile

- **Goal:** the profile exists on each funded network.
- **Message before:** run the deployment as a dry run first and use its `data.say`: either "Everything is ready to create my profile on LUKSO. I send and pay this myself from my gas address … Shall I create it now?" or, if the gas has not arrived, the funding request of step 4 (`data.next`). Expected reply: yes. (Their "yes" is the approval.) **You** send the deployment; the human never signs, never picks a wallet app, never pays it.
- **Message after:** "Done! My profile now exists on LUKSO:" then the profile address on its own line, its profile link, and one line per network still waiting for gas.
- **Attach:** after success, the profile address QR.
- **Never:** ask the human to sign or confirm in a wallet; create before the gas has arrived; retry silently after a failure.

## J1 · Step 6: second owner (if no co-owner in step 2)

- **Message:**
  > Right now only I can control this profile. I recommend adding your own wallet as a second owner, so the profile is safe even if this computer is lost. Nothing is shared and the address stays the same.
  > Send your wallet's public address, or say "later".
- **Expected reply:** an address or "later". If "later", don't ask again unprompted.

## Backup (offer once after the first profile; again after a new key or profile)

- **Goal:** the human has a backup file and its password, kept in different places, so the account can be restored in the Universal Profile app or by the agent on a new machine.
- **Message (the question):** from `up backup list` → `data.ask.say`. It reads like:
  > Do you want a backup of my account? I'd give you a file and a password. Keep them in different safe places and you can restore it in the Universal Profile app, or with me.
  > Reply "yes" or "later".
- **Attach:** nothing yet.
- **Expected reply:** "yes" or "later". Default: later. A "yes" is the approval for `up backup export`. If they decline, record it (`up backup list --mark-asked`) and don't ask again until something changes.
- **Message (the password):** "Please choose a password for it that you will remember: at least 6 characters with a lowercase and an uppercase letter, a number and a symbol, for example `Sunny-Day7!`. Or shall I make one up for you?" Expected reply: their password, or "make one". If the skill says something is missing, tell them exactly what, in one line.
- **Message (the delivery):** `up backup export` → `data.say` (with a generated password it contains the password):
  > Here is the backup of my account. Its password is: XXXXX-XXXXX-XXXXX-XXXXX
  > Keep the file and the password in different safe places (the password in a password manager is ideal). You can restore it in the Universal Profile app or with me.
- **Attach:** the **one** backup file (`data.path`), by path through the chat's attachment mechanism, in the same message as the text. Never paste, print or open its contents.
- **Expected reply:** "ok" or a question. Nothing else is needed.
- **Never:** read, quote or summarise the file; say "JSON", "encrypted with AES", "keystore", "private key" or "seed phrase"; send the password anywhere but the message with the file; offer an unencrypted backup unprompted (if they insist: warn first that anyone with the file controls the account, deliver only because they asked, tell them to delete it afterwards); ask for their own wallet's key, ever; ask again after "later" without a change.

### Restore from a backup (new machine, or the human sends a file)

- **Goal:** the agent and its profiles are back.
- **Message (ask):** "Send me the backup file and its password, and I'll restore my account from it." (If the file came from the Universal Profile app, same message.)
- **Attach:** nothing.
- **Expected reply:** the file as an attachment, and the password (same message or the next).
- **Message (after `up backup verify`):** one line in plain words: "This backup restores N account(s) and M key(s). Shall I go ahead?" The "yes" is the approval for `up backup import`.
- **Message (after):** `up backup import` → `data.say`. If an account was refused, say so plainly ("one account in the file isn't really controlled by these keys, so I didn't restore it").
- **Never:** run the import without their "yes"; repeat the password back; call a wrong password anything but "that password doesn't open the file; please check it"; touch a key that is already in use.

## J1 · Step 7: name and picture (optional)

- **Message:**
  > Want to give my profile a name, a short description and a picture? All optional.
  > Send a name (and a picture if you like), or say "skip".
- **Before writing:** show a one-line preview ("Name: Nova · picture attached · public and permanent") and ask "Shall I save it?"
- **After:** share the profile link.
- **Never:** upload without the preview; ask more than once if they skipped.

## J1 · Step 8: wrap-up

- **Message:** 3–5 lines: the profile address (on its own line) with its QR, where it exists ("LUKSO ✓, Base ✓"), who controls it ("me, and you as co-owner"), and where to send money for the profile (the profile address, not the gas address). End with "What would you like me to do first?"

---

## J2-relayer · Step 1: create it on the Universal Relayer website

- **Message:**
  > Create my profile on the Universal Relayer website: <link, or "coming soon">. Choose the networks you want. When it asks which agent to add, use my address (QR attached):
  > 0x9F3c…full address
  > The relayer pays the gas within your subscription. It never controls your profile.
  > Tell me when you're done.
- **Attach:** one QR of the agent's address.
- **Never:** ask for gas on this path.

## J2-relayer · Step 2: the profile address

- **Message:** "Great! What's your new profile's address? You can paste it or send a screenshot of it." Then confirm it back short (`0xAbCd…1234`) and continue with J2 step 3.

## J2 · Step 1: which profile

- **Message:** "Which profile should I act for? Send its address." Confirm it back short, then check it on the networks.

## J2 · Step 2: allow me to act

- **Message:** what to add, where, in plain words: "In your Universal Profile app, add my address as a controller with these rights: … (one line each). I can't change owners or permissions. You can remove me any time."
- **Attach:** one QR of the agent's address.
- **Expected reply:** "done". Then check on each network yourself and report per network.

## J2 · Step 3: wrap-up

- Same as J1 step 8, per network: where you can act, whether the relayer pays the gas, and anything missing.

---

## Mistakes seen in real chats (do not repeat)

- Five identicons sent as separate pictures with no numbers and no addresses: the human cannot tell what they mean.
- A wide picture cropped by the chat app so only one option was visible: always use the one picture from `account precompute` (it is narrow, one row per option).
- Full 42-character addresses in a numbered list, broken over three lines each: use the short form in lists.
- Suggesting a testnet, a MetaMask contract call, or that the human signs the deployment.
- After a successful dry run: "You'll sign the deployment in your wallet. Which wallet app do you use?" Wrong: the agent's own key sends and pays the deployment; the human only sent gas. Use the dry run's `data.say`.
- Calling the gas address "my wallet" or "my account".
