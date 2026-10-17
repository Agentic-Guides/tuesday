# Tuesday — Devpost submission

## Elevator pitch

Most "AI spending" demos prove an agent can pay. Tuesday proves it cannot. When a $42
subscription renewal fails at 3 AM, three independent LLMs — Advocate, Auditor, Witness —
argue retry / downgrade / release, and **nothing reaches PayPal unless all three agree and a
human finishes the capture step in PayPal**. The vote, including the disagreement, is hashed into the PayPal order's
`custom_id`, so the reason a payment was allowed is readable from the payment record itself.

---

## Inspiration

Anna's skincare brand bills **$42 a month to 12,000 subscribers**. On a Tuesday at 3 AM one
renewal fails — a card expires. The brand's software sends a generic "payment failed" email
and waits.

**25–40% of subscription churn starts exactly there** — at a failed payment, not at a lost
customer. The subscriber never chose to leave; the plumbing gave up.

We wanted to know what it looks like when the decision is not "retry the charge" but
*a debate about whether to* retry. So we built the part everybody skips: the argument, and
the record of it.

## What it does

The demo opens on the story: **TUESDAY, 3 AM — A $42 RENEWAL JUST FAILED.**

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
   printed into the page — 31 passed, 0 failed, including
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

- **Real:** the PayPal Orders v2 REST path, the hash round-trip in `custom_id`, the money
  gate (asserted by 31 passing tests), the three-model debate, the gates, the ledger, the
  product catalogue flow.
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
| 1 | `01_main.png` | The demo opens on the story: a $42 renewal failed at 3 AM. Category, amount, monthly budget and what has already been spent are the only inputs. |
| 2 | `02_shop.png` | Give the agents a category and a budget. Candidate products come back with real photographs; the Tribunal judges every one of them. |
| 3 | `03_denied.png` | A $90 charge against a $60 monthly budget. The Auditor and the Witness block it, and the dissent map names who disagreed and on which gate. |
| 4 | `04_debate.png` | A $42 renewal comes back CONDITIONAL: one for, one against, one judging. The agents only ever propose. |
| 5 | `05_timeline.png` | One bar per agent vote on the Bryntum timeline — green approved, red blocked, blue neutral. Open disputes stay flagged. |
| 6 | `06_ledger.png` | Every decision, every vote, every receipt in one AG Grid dashboard. Each row carries the hash stamped into the PayPal order's `custom_id`. |
| 7 | `07_proof.png` | Three claims, three tests, all runnable in the page: the money-gate suite (31 passed, 0 failed), the 4x4 verdict grid computed live, and a receipt re-hashed against the hash stored in the PayPal order's `custom_id`. |
| 8 | `08_grid.png` | The 4×4 verdict grid from the README, reproduced live: sixteen real adjudications, computed when the button is pressed. Charge down the side, budget across the top. |

## Try it out

- **Code:** https://github.com/Agentic-Guides/triad
- **Video:** 2:33, 1080p — `devpost-media/tuesday_submission_v9_1080p.mp4` in the repo; YouTube link added at submission time.
- **Run it:** `git clone`, then `node demo/server.mjs` → <http://localhost:8787>. No keys needed.
