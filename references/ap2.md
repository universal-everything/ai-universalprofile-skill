# AP2 (Agent Payments Protocol): an optional extra, never the default

AP2 is an open protocol for payments that agents make in commerce. Your profile does not need it: it is a Web3 account and does Web3 work exactly as it does today. Read this only when a counterparty explicitly asks for an AP2 mandate.

> **Do not use AP2 for ordinary Web3 actions.** Transfers, contract calls, follows, profile and data updates, direct crypto payments and x402 payments that do not ask for a mandate run exactly as today: as the profile, within the LSP6 permissions your key has on that chain. Never wrap, route or delay a normal profile action through AP2, and never add an AP2 step nobody asked for.

## What AP2 is

From the AP2 site and specification v0.2 (https://ap2-protocol.org, checked November 2026). The protocol is young: check the site before relying on details.

- **An open protocol created by Google** for payments that agents make for people, donated to the FIDO Alliance with v0.2, where the specification work continues. It works as an extension of the Agent2Agent protocol (A2A) and the Universal Commerce Protocol (UCP), and of MCP.
- **Mandates** are its core: verifiable digital credentials (SD-JWT) with which a person authorises a purchase. There are two kinds:
  - **Checkout Mandate:** authorises completing one checkout (merchant, items, price); the merchant verifies it.
  - **Payment Mandate:** authorises the payment for that checkout; the credential provider (e.g. a digital wallet), the payment network and the merchant's payment processor verify it.
- **Open or closed.** A closed mandate is bound to one transaction: the exact checkout, or the payee, amount and payment instrument. An open mandate carries constraints for purchases the agent completes later without the person present (allowed merchants and items, allowed payees and payment instruments, an amount range or budget, recurrence, dates and an expiry); the agent then binds it to one transaction with its own key.
- **The person approves on a Trusted Surface:** a secure, non-agentic interface (e.g. their wallet or their card issuer's app), never the agent's chat. The agent presents the mandate to the party that verifies it, and the merchant and the payment side return signed receipts.
- **Mostly classic commerce.** The site lists card payments first, with real-time bank transfers and digital currencies on its roadmap. Crypto appears as x402 samples and the separate a2a-x402 project (A2A with x402), which the FAQ says will be aligned with AP2 over time.

## When to consider it

Only when a counterparty **explicitly requires an AP2 mandate**: for example a merchant or merchant agent that speaks AP2 or UCP and will not take a payment without one. Then follow "If a counterparty requires a mandate" below.

Crypto-native services usually take x402 (`references/protocols.md`, "x402") or a plain transfer, with no mandate at all: pay those as today. A website or agent that merely mentions AP2 is not a reason to use it.

## How it would fit a profile (concept only: the skill has no AP2 support yet)

| AP2 idea | On a Universal Profile |
| --- | --- |
| payer and identity | the profile address; signatures made as the profile are checked with ERC-1271 `isValidSignature` on the profile (`up verify-1271`) |
| limits that are really enforced | the LSP6 permissions and AllowedCalls of your key on that chain (`references/permissions.md`), and for a token budget an LSP7 operator allowance (`up token approve`), which caps what that operator may move |
| the mandate | one more signed statement for the counterparty, made only with the human's own approval; it adds no on-chain limit |
| the payment | a normal transaction by the profile: dry run, consent and receipt as for every payment (SKILL.md, "Swaps and payments as the profile") |
| the receipt | the transaction hash and its receipt (`up exec receipt`) |

- **Ask the human every time a mandate is needed**, and say plainly what it would allow: merchant, amount or budget, time window, chain and asset. One approval covers one mandate.
- **Never issue a mandate yourself.** In AP2 the person's approval comes from the Trusted Surface; an agent key only binds a mandate the person already approved to one purchase. Never sign a mandate with your key as if it were the human's approval: a signature by your key counts as the profile's (ERC-1271), so it would look approved by the profile without the human ever seeing it. A delegated policy, an earlier approval or a counterparty's request is never consent to a mandate.

## Limits today

- **The skill has no AP2 verb.** It does not create, sign, check or send mandates, and no error code refers to AP2.
- **AllowedCalls cannot pin a token payee.** LSP6 AllowedCalls restrict the contract, its interface (standard) and the function, not who receives a token transfer. Native coin can be limited to listed recipients (`TRANSFERVALUE`); a merchant allowlist for token payments needs an extra contract between the profile and the token.
- **Crypto in AP2 is still maturing.** The specification itself does not mention x402; crypto exists as samples and the separate a2a-x402 project.
- **x402 with a Universal Profile is unverified for AP2.** A profile can pay x402 only where the facilitator accepts its ERC-1271 signature, and not on LUKSO today (`references/protocols.md`, "x402"). Whether an AP2 flow accepts a profile's smart-account signature has not been tested.
- **No published pattern for a Universal Profile.** Mandates are SD-JWT credentials, and the specification does not mention blockchain signatures, ERC-1271 or smart accounts, so how a profile would sign a mandate or appear in one is not defined.

## If a counterparty requires a mandate

1. Tell the human in plain words: this merchant asks for an AP2 mandate, the skill cannot make or sign one yet, and what the merchant wants to sell and for how much.
2. Do not improvise money movement: no workaround payment, no mandate you write or sign yourself, no other tool, wallet or website to get around it, and no payment before the human decided.
3. Offer what still works: paying the way the profile pays today (a direct payment, or x402 where the counterparty accepts it) if the counterparty allows that, or leaving the purchase to the human.

## Sources

- https://ap2-protocol.org — overview, A2A and UCP extension, v0.2 and the FIDO Alliance donation, payment methods and roadmap, x402 samples.
- https://ap2-protocol.org/ap2/specification/ — roles, Checkout and Payment Mandates, Trusted Surface, SD-JWT, receipts.
- https://ap2-protocol.org/ap2/checkout_mandate/ and https://ap2-protocol.org/ap2/payment_mandate/ — open and closed fields, receipts.
- https://ap2-protocol.org/ap2/agent_authorization/ — open and closed mandates, binding to the agent's key.
- https://ap2-protocol.org/faq/ — created by Google, specification work in FIDO, x402 and a2a-x402.
- https://github.com/google-agentic-commerce/a2a-x402 — A2A with x402.
