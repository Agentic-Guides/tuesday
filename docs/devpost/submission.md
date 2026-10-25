# Tuesday — Devpost submission

## Elevator pitch

Most "AI spending" demos prove an agent can pay. Tuesday proves it usually cannot. When the
restock agent wants to spend $42 out of a $200 monthly budget, three independent LLMs —
Advocate, Auditor, Witness — argue for and against the purchase, and **no PayPal order is
created unless the gates pass and the agents agree, and nothing is captured until a human
finishes the payment in PayPal**. The vote, including the disagreement, is hashed into the
PayPal order's `custom_id`, so the reason a payment was allowed is readable from the payment
record itself.

---

## Inspiration

A skincare brand gives its restock agent a **$200/month purchasing budget**. On a Tuesday
at 3 AM the agent decides the Vitamin C serum is running low and wants to spend $42. Nobody
is awake to approve it.

Give an agent a budget and it will eventually spend all of it. **The hard part is not letting
it pay — it is giving it a defensible reason to stop.** The failure mode that costs real
money is not a rogue agent emptying an account; it is a thousand defensible-looking small
purchases that nobody audited, each one approved by a single model that was happy to help.

We wanted to know what it looks like when the decision is not "can this be paid" but
*should it be, and by whose authority*. So we built the part everybody skips: the argument,
the gate that can veto it, and the record of both.

## What it does

The demo opens on the question: **TUESDAY, 3 PM — CAN THE AGENT SPEND $42?**

1. **Three agents take positions.** Advocate argues for the customer and the revenue.
   Auditor argues against spending money the budget does not have. Witness is neutral and
   judges both arguments as written.
2. **They debate per candidate — then you choose.** Give it a category and a monthly budget; it
   pulls candidate products and the Tribunal judges every one of them. Click any row to buy that
   one: Tuesday re-rules on your pick at its real price, and only an APPROVED or CONDITIONAL
   verdict raises the PayPal order. Pick a refused product and no order is created.
3. **Disagreement is surfaced, never hidden.** A split verdict does not get rounded to a yes.
   It comes back CONDITIONAL and the dissent map names who voted what and why.
4. **A mechanically enforced money gate.** If the verdict is DENIED or DISSENT, the code
   returns `not_approved` **before any network call**. `tests/moneyGate.test.js` asserts
   PayPal's create-order is invoked **zero times**.
5. **The decision is stamped into the payment.** The verdict, the three votes and the model
   names are canonicalised and SHA-256 hashed; the hash goes into
   `purchase_units[0].custom_id` on a PayPal Orders v2 order, and is read back with a
   `GET` to prove it survived the round trip.
6. **You can watch the claim get proven.** The demo has a **Run the money-gate test suite**
   button. Press it and `tests/moneyGate.test.js` runs on the machine, with its raw output
   printed into the page — 44 passed, 0 failed, including
   `denied → createOrder NOT called`. A DENIED verdict never reaches PayPal at all.

## How we built it

| Layer | What it is |
|---|---|
| **PayPal Orders v2 REST** (`paypal/client.js`) | OAuth2 client-credentials token → `POST /v2/checkout/orders` with the decision hash in `custom_id` → `capture`, plus `GET /orders/{id}` to verify the stamp. No SDK, no `npm install`. |
| **Three independent LLMs** | `deepseek-v4.1-flash` (Advocate), `gemma4:31b` (Auditor), `gpt-oss:120b` (Witness) — three different providers, three different system prompts, and a deterministic fallback engine so the demo never fails to run. |
| **Audit gates** | `G1_amount_positive`, `G2_within_remaining`, `G3_share_under_half`, `G4_not_repeat_category`, `G5_survives_double_cost`. The Auditor rejects with named gates, not opinions — and each gate ID is translated into a sentence a human can read. |
| **Receipts** | Canonical JSON → SHA-256 → `triad1:<hash>`, carried in the order's `custom_id`. The receipt *is* the audit trail. |
| **AG Grid** | The governance dashboard: every decision, every vote, every hash in one ledger. |
| **Bryntum** | The vote timeline — one bar per agent vote, green approved / red blocked / blue neutral. |
| **Channel3** | The candidate catalogue. Real products to argue about; curated fallback when no key is present. |
| **WebMCP** (`navigator.modelContext`) | The flow is registered as page tools, so an agent browser can drive it too. |

The whole thing is a zero-dependency Node.js server — `node demo/server.mjs`, then
<http://localhost:8787>.

## If the gates decide, are the models decoration?

A judge asked us this directly, and it is the right question. No — and the split is
deliberate:

| | Deterministic gates (`G1`–`G5`) | The three LLMs |
|---|---|---|
| **Authority** | **Veto.** Arithmetic over money is never delegated to a model. | **No veto over arithmetic.** Cannot approve what a gate failed. |
| **What they answer** | *Can* this be paid — is the amount positive, is the money there, is it under 50% of the budget, is it a repeat, does it survive a doubled price | *Should* this be paid, and under what conditions |
| **Output** | `failedGates: ["G5_survives_double_cost"]` | An argument, and from the Witness, concrete `conditions` |
| **Cannot do** | Explain itself, price a risk, write a condition | Override a failed gate |

The Witness is where the models earn their place. When the vote splits it returns
`conditions` a gate cannot produce: *"approve only if the $42 is split into two $21
orders,"* *"approve if the category has not repeated inside 30 days."* A gate can only
say pass or fail. The Witness turns a near-miss into a payment a human can actually
sign — and that condition is stamped into the receipt, so it travels with the money.

The safety property holds the other way: **the models can make a refusal more useful;
they cannot make an approval happen.** With no API key at all, the deterministic engine
returns the same verdicts, so a model outage — or a prompt injection hidden in a product
listing — cannot talk the gates into releasing money.

## After the money moves: the dispute desk

Every claim above is about money that has not left yet. Tuesday also handles the case
where it has left and the buyer objects — using PayPal's dispute surface, and adding the
part PayPal does not provide.

PayPal already ships the machinery: the Resolution Center for manual handling, and the
Disputes API for automation (`list`, `get`, `provide-evidence`, `make-offer`,
`accept-claim`, `escalate`, `appeal`). What it does not ship is the decision — which
disputes to contest, on what evidence, and who decided. So the same tribunal that audits
a purchase audits a dispute:

| Role | What it argues |
|---|---|
| **Merchant Advocate** | the strongest case the merchant can actually evidence |
| **Buyer Advocate** | the buyer's best case, from the same evidence set |
| **Arbiter** | one action: `CONTEST` / `OFFER_PARTIAL` / `REFUND` / `ACCEPT` / `ESCALATE` |

### The evidence is numbered, so every claim can be checked

`collectEvidence()` builds a numbered set from what the merchant can actually show
PayPal: the order (`E1`), the capture (`E2`), the decision hash stamped into `custom_id`
at settlement **compared against the ledger entry** (`E3`), tracking (`E4`), delivery
confirmation (`E5`), the address match (`E6`), prior orders (`E7`), the policy in force
(`E8`), and the buyer's own message (`E9` — recorded as evidence, never obeyed as an
instruction).

Two of these deserve a note, because both were wrong before they were right. `E3` used to
report "matches our ledger" whenever a stamp merely existed; it now recomputes the ledger
entry's full SHA-256, takes its first 16 characters, and compares them with the 16 stamped
into the payment. That is what "tamper-evident" means here and no more: forging a
different ledger entry that collides on those 16 characters is a second-preimage search of
about 2^64 — out of reach for this threat model, but 2^64 rather than 2^256, and the README
says so. `E6` had two states where the world has three: an address that was never compared
is not a mismatch, and reporting it as one invented a failure the evidence did not contain.

An argument may only cite these IDs. A citation to an ID that does not exist stops the
action. That is "the AI cannot lie" as a mechanism rather than a promise.

### The dispute gate

| Rule | What it stops |
|---|---|
| **D1** evidence sufficiency | the items that claim reason requires must be present. `CONTEST` is refused outright without them; any other action is forced to a human and the missing items are named. A non-receipt claim needs tracking and delivery; an unauthorised-payment claim needs order, capture, **a comparable delivery address and prior settled orders** — because a dispute only exists against a settled transaction, so order and capture prove nothing about who paid |
| **D2** amount ceiling | above $50 only a human may authorise |
| **D3** citation check | a citation must be evidence that is *present*, not merely an ID that exists. Citing the missing delivery record as proof of delivery is the same lie as inventing an ID. The buyer advocate is exempt — pointing at the gap is its job |
| **D4** deadline | a looming deadline forces a human; it never creates authority to act |
| **D5** no free surrender | `ACCEPT` while every required item is present and delivery is confirmed is a model being agreeable, not deciding |
| **D6** money waits | `REFUND`, `OFFER_PARTIAL` and `ACCEPT` send money to the buyer, so none of them ever auto-execute, at any amount. Only `CONTEST` — which submits evidence and commits nothing — runs inside the auto limit |

When the gate refuses the proposed action, the desk escalates to a human and to PayPal; it
never settles. An earlier version fell back to "refund if small, else offer partial", which
meant a model that fabricated a citation made the merchant pay out.

**D5 came from a measured failure.** The same evidence set produced `CONTEST` on one run
and `ACCEPT` on the next. A gate that only checked citations would have let the second
one through, and the merchant would have refunded a delivery it could prove. D5 catches
that shape and re-runs the arbiter deterministically.

**An unparseable model reply is not treated as a lie.** It falls back to the
deterministic argument — which is always cited — and the response records the fallback in
`deterministicFallback`, so a reader can see which arguments were a model's.

### What the hosted demo will not let you do

The public instance shows one real dispute, and a stranger must not be able to close it. If a
visitor could POST `accept-claim` against `PP-R-XBB-10194468`, the centrepiece of the demo would
be gone for every judge who arrived afterwards. So:

- **A write against a real PayPal dispute is a dry run.** The response returns the exact request
  it would have sent — method, path, body — which is more useful to a reader than a silent
  success. Set `ALLOW_LIVE_DISPUTE_WRITES=1` on a deployment you control to turn it on.
- **A write against a labelled sample is refused outright.** There is no PayPal dispute behind
  it, so there is nothing to act on.
- **Every endpoint is rate limited per IP**: 12 requests a minute for anything that spends an
  LLM call or a PayPal call, 120 a minute for reads. Measured: the 11th expensive call in a
  minute returns `429` with `Retry-After`. Without a ceiling one visitor can drain the keys and
  take the demo down for whoever comes next.

Reads stay live. The real dispute, the real list and the real verification are all reachable —
only the actions that would change the merchant's account are held back.

### What the desk will not do

- **It does not create disputes.** PayPal permits that only in the sandbox, with
  buyer-side scopes this app does not have. A merchant does not create disputes either,
  so the product matches the platform instead of fighting it.
- **It does not act on a deadline.** Six hours to respond is exactly when a system should
  slow down, not speed up.
- **It does not hide the sample set.** When PayPal returns no open disputes, the API returns
  four labelled samples and says why. Every row carries `source: sample` and the page states
  it above the list. The samples exist so the workflow can be exercised — they are not a
  substitute for the real case below.

### A real chain, end to end

This is the claim the project exists to make, so it was run rather than argued. Every
identifier was read back from the PayPal sandbox API:

| Step | What happened | The identifier |
|---|---|---|
| **1. Tribunal** | Three live models (`deepseek-v4.1-flash`, `gemma4:31b`, `gpt-oss:120b`) audited a $42 purchase against a $500 budget | `APPROVED`, receipt hash `728f5a73d918240d` |
| **2. The receipt is stamped** | The order was created with the decision hash in `custom_id` | order `21C06348JB061803G` |
| **3. A human approves** | The buyer completed the payment in PayPal; the app cannot capture without it | payer `WDCS…FVQ` |
| **4. Capture** | The money moved | capture `1N665776542931902`, `COMPLETED`, $42.00 |
| **5. Weeks later the buyer disputes it** | Filed through the Resolution Center, as a real buyer would | dispute `PP-R-XBB-10194468`, `OPEN` |
| **6. The desk reads it back** | `GET /v1/customer/disputes/{id}` returned the transaction and the stamp | `custom = triad1:728f5a73d918240d` |
| **7. E3 verifies** | The stamp in the payment record compared with the ledger entry | **`ok: true` — "The decision hash triad1:728f5a73d918240d matches the ledger entry."** |

**That is the loop closing.** The hash stamped when three models approved a payment was, weeks
later, read back out of PayPal's own dispute record and matched against the decision the desk
still holds. The receipt that authorised a payment carries a verifiable record of why it was
allowed, available exactly when someone asks whether it should have been.

The verdict on that dispute came from `gpt-oss:120b`, which proposed `REFUND` because it found
no shipment tracking or delivery confirmation (`E4`, `E5`). The gate let the proposal stand but
forced a human — `D1_missing_E4_E5_requires_human`, and `D6` because a refund spends money.
Nothing moved automatically.

**What is still not real, and why.** The merchant account cannot file disputes: PayPal permits
filing only from the buyer side, with scopes this app does not hold. The dispute above was filed
by a sandbox buyer through the Resolution Center — exactly how a real buyer files one. Tuesday
reads and answers disputes; it never files them.

### What the receipt proves, and what it does not

The receipt is the audit trail, so its limits are worth stating as precisely as its
guarantees. All of this was measured against the code:

**It proves** that the seven fields which decided the outcome — the decision, the three
votes, the three models, a fingerprint of each agent's reasoning, the amount, the threshold
and the timestamp — were hashed together. Change one and the hash changes: flipping
`decision` from `APPROVED` to `DENIED` took `e77c34c4185e9621` to `1800bfdabc44e4c0`. It
proves the stamp in PayPal's payment record agrees with the ledger entry, checked at
dispute time by evidence `E3`.

**It does not prove** those things are collision-resistant to 256 bits. The fingerprint is
the leading 16 hex characters — **64 bits** — because that is the part short enough to read
by eye. Forging a different receipt that collides on those 16 characters is a second-preimage
search of about 2^64: out of reach here, and squarely easier than 2^256, which is the honest
way to say it.

**It does not put the reasoning in the receipt.** The receipt carries
`reasoning: {advocate: "cf7ab516125e9a85", …}` — hashes, not sentences. The prose an agent
wrote stays in the ledger. The payment record therefore proves *that* a decision was made and
*which* votes it had; it does not let you read the argument out of PayPal.

**It trusts the ledger.** Verification compares the stamp against an entry Tuesday holds. If
the ledger itself were rewritten the comparison would follow it. What the hash prevents is
silent divergence between the two, not a compromised ledger.

**`custom_id` is merchant metadata.** It is visible to the merchant and to PayPal, and this
project does not claim PayPal's reviewers act on it. What it does is carry the decision with
the payment, so a dispute weeks later can be answered with a record instead of a guess.

## The part we are proudest of

**Disagreement is a first-class outcome.** A system that always reaches consensus is not
auditing anything. Tuesday has three reachable verdicts, and all three appear in the seeded
ledger:

- **APPROVED** — 2 for, 0 against. PayPal hands back an approval link.
- **CONDITIONAL** — the agents split. The purchase does not proceed on a rounded-up yes.
- **DENIED** — the Auditor and Witness block it, and the dissent map names them.

The 4×4 grid below is measured from the running demo, not estimated — budget across the top,
charge down the side. The demo recomputes it live when you press **Show me all 16 cells**:

| charge \ budget | $30 | $60 | $150 | $400 |
|---|---|---|---|---|
| **$9** | APPROVED | APPROVED | APPROVED | APPROVED |
| **$18** | CONDITIONAL | APPROVED | APPROVED | APPROVED |
| **$42** | DENIED | CONDITIONAL | APPROVED | APPROVED |
| **$90** | DENIED | DENIED | CONDITIONAL | APPROVED |

Bigger charge, stricter verdict. Bigger budget, looser verdict. Every cell moves for a reason.

## What is real and what is not

We would rather a judge trust us than be surprised.

- **Real:** the PayPal Orders v2 REST path against the sandbox, the hash round-trip in
  `custom_id`, the money gate, the dispute desk, the three-model debate, the ledger and the
  product catalogue flow. 109 tests cover it (`npm test`): 44 for the purchase gate, 65 for
  the dispute gate, plus the end-to-end flow. The refusal paths are asserted directly — a
  DENIED verdict calls `createOrder` zero times, a weak-evidence contest is refused, and a
  refund without a human is refused at any amount.
- **Product images:** real photographs, 24 of them, generated for this project with FLUX
  (Cloudflare Workers AI) and served by the demo itself — they appear in the candidate grid
  and on the recommendation card. The labels are deliberately blank, because the decision is
  about the purchase, not the branding.
- **Runs without keys:** the deterministic engine, a mock PayPal client and a mock catalogue.
  That is the default, so the demo always runs. `SETUP.md` explains how to run live.
- **What changes with no keys, precisely:** the three-agent tribunal still runs and still gates the
  order — but each vote comes from a **deterministic rule engine**, not from an LLM. The `engine`
  field on the verdict line reads `deterministic`. The three model names you see are the ones used
  when `OLLAMA_API_KEY` is set. The money gate, the SHA-256 receipts, the ledger, the 4x4 grid and
  the timeline are our code and behave identically in both modes; only the source of the three
  opinions changes. The video was recorded with the live models.
- **Not implemented:** Subscriptions v1 and the PayPal Agent Toolkit (`@paypal/mcp`). The
  settlement path here is Orders v2 REST. The Agent Toolkit is the integration point this
  design moves to in production — we say so in the README rather than implying it ships.

## Built with

`paypal` `paypal-orders-v2` `ag-grid` `bryntum-scheduler` `channel3` `webmcp` `nodejs`
`javascript` `multi-agent` `llm` `sha-256` `flux`

---

## Image gallery captions

| # | File | Caption |
|---|---|---|
| 1 | `01_main.png` | The demo opens on the question: can the agent spend $42? Category, amount, monthly budget and what has already been spent are the only inputs. |
| 2 | `02_shop.png` | Give the agents a category and a budget. Candidate products come back with real photographs; the Tribunal judges every one of them. |
| 3 | `03_denied.png` | A $90 charge against a $60 monthly budget. The Auditor and the Witness block it, and the dissent map names who disagreed and on which gate. |
| 4 | `04_debate.png` | A $42 purchase against a $60 budget comes back CONDITIONAL: one for, one against, one judging — and the Witness attaches a condition. The agents only ever propose. |
| 5 | `05_timeline.png` | One bar per agent vote on the Bryntum timeline — green approved, red blocked, blue neutral. Open disputes stay flagged. |
| 6 | `06_ledger.png` | Every decision, every vote, every receipt in one AG Grid dashboard. Each row carries the hash stamped into the PayPal order's `custom_id`. |
| 7 | `07_proof.png` | Three claims, three tests, all runnable in the page: the money-gate suite (44 passed, 0 failed), the 4x4 verdict grid computed live, and a receipt re-hashed against the hash stored in the PayPal order's `custom_id`. |
| 8 | `08_grid.png` | The 4×4 verdict grid from the README, reproduced live: sixteen real adjudications, computed when the button is pressed. Charge down the side, budget across the top. |

## Try it out

- **Code:** https://github.com/Agentic-Guides/tuesday
- **Video:** 2:50, 1080p — https://youtu.be/49eujv0VV0Y
- **Run it:** `git clone`, then `node demo/server.mjs` → <http://localhost:8787>. No keys needed.
