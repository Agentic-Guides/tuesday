# Devpost submission — copy-paste sheet

Everything here is measured from the running demo, not estimated. Paste into the
Devpost form field by field.

---

## Project name

```
Tuesday
```

## Elevator pitch (tagline, ~200 chars)

```
Anna's skincare brand bills $42/month to 12,000 subscribers. When a renewal fails at 3 AM, three AI agents debate retry / downgrade / release — and nothing reaches PayPal unless they agree, and nothing is captured unless a human finishes the payment in PayPal.
```

---

## "Inspiration"

```
Anna's skincare brand bills $42 a month to 12,000 subscribers. On a Tuesday at 3 AM one
renewal fails — a card expires. The brand's software sends a generic "payment failed" email
and waits.

25–40% of subscription churn starts exactly there — at a failed payment, not at a lost
customer. The subscriber never chose to leave; the plumbing gave up.

Retrying is easy to automate and easy to get wrong. A fixed retry rule cannot tell a stolen
card from a flat wallet, and a single model cannot tell you why it decided. So we built the
part everybody skips: the argument, and the record of it.
```

---

## "What it does"

```
The demo opens on the story: TUESDAY, 3 AM — A $42 RENEWAL JUST FAILED.

1. Three agents take positions. Advocate argues for the customer and the revenue. Auditor
   argues against spending money the budget does not have. Witness is neutral and judges
   both arguments as written. Three different models, three different prompts.

2. They debate per candidate - then you choose. Give it a category and a monthly budget and it
   pulls candidate products; the Tribunal judges every one. Click any row to buy that one:
   Tuesday re-rules on your pick at its real price, and only an APPROVED or CONDITIONAL verdict
   raises the PayPal order. Pick a refused product and no order is created.

3. Disagreement is surfaced, never hidden. A split verdict is not rounded up to a yes. It
   comes back CONDITIONAL, and the dissent map names who voted what and why.

4. A mechanically enforced money gate. If the verdict is DENIED or DISSENT, the code returns
   `not_approved` before any network call. tests/moneyGate.test.js asserts PayPal's
   create-order is invoked zero times.

5. The decision is stamped into the payment. The verdict, the three votes and the model names
   are canonicalised and SHA-256 hashed; the hash goes into `purchase_units[0].custom_id` on a
   PayPal Orders v2 order, and is read back with a GET to prove it survived the round trip.

6. You can watch the claim get proven. The demo has a "Run the money-gate test suite" button.
   Press it and the suite runs on the machine, with its raw output printed into the page —
   31 passed, 0 failed, including `denied → createOrder NOT called`.
```

---

## "How we built it"

```
| Layer | What it is |
|---|---|
| PayPal Orders v2 REST (paypal/client.js) | OAuth2 client-credentials token → POST /v2/checkout/orders with the hash in custom_id. No SDK dependency. |
| Three independent LLMs | deepseek-v4.1-flash (Advocate), gemma4:31b (Auditor), gpt-oss:120b (Witness) — three models, three prompts, no shared state. |
| Audit gates | G1_amount_positive, G2_within_remaining, G3_share_under_half, G4_not_repeat_category, G5_survives_double_cost. The Auditor rejects with named gates, not opinions. |
| Receipts | Canonical JSON → SHA-256 → `triad1:<hash>`, carried in the order's custom_id. The receipt is the audit trail. |
| AG Grid | The governance dashboard: every decision, every vote, every hash in one ledger. |
| Bryntum | The vote timeline — one bar per agent vote, green approved / red blocked / blue neutral. |
| Channel3 | The candidate catalogue. Real products to argue about; curated fallback with no key. |
| WebMCP (navigator.modelContext) | The flow is registered as page tools, so an agent browser can drive it too. |

The whole thing is a zero-dependency Node.js server — `node demo/server.mjs`, then
http://localhost:8787
```

---

## "The part we are proudest of"

```
Disagreement is a first-class outcome. A system that always reaches consensus is not auditing
anything. Tuesday has three reachable verdicts, and all three appear in the live ledger:

  APPROVED    — 2 for, 0 against. PayPal hands back an approval link.
  CONDITIONAL — the agents split. The purchase does not proceed on a rounded-up yes.
  DENIED      — the Auditor and Witness block it, and the dissent map names them.

The 4x4 grid is measured from the running demo, not estimated. The demo recomputes it live
when you press "Show me all 16 cells":

  charge \ budget | $30        | $60         | $150        | $400
  $9              | CONDITIONAL| APPROVED    | APPROVED    | APPROVED
  $18             | CONDITIONAL| CONDITIONAL | APPROVED    | APPROVED
  $42             | DENIED     | CONDITIONAL | CONDITIONAL | APPROVED
  $90             | DENIED     | DENIED      | CONDITIONAL | APPROVED

Bigger charge, stricter verdict. Bigger budget, looser verdict. Every cell moves for a reason.
```

---

## "What is real and what is not"

```
We would rather a judge trust us than be surprised.

Real: the PayPal Orders v2 REST path, the hash round-trip in custom_id, the money gate
(asserted by 31 passing tests), the three-model debate, the gates, the ledger, the product
catalogue flow.

Product images: real photographs, 24 of them, generated for this project with FLUX (Cloudflare
Workers AI) and served by the demo itself — they appear in the candidate grid and on the
recommendation card. The labels are deliberately blank, because the decision is about the
purchase, not the branding.

Runs without keys: the deterministic engine, a mock PayPal client and a mock catalogue. That is
the default, so the demo always runs. SETUP.md explains how to run live.

What changes with no keys, precisely: the tribunal still runs and still gates the order, but each
vote comes from a deterministic rule engine rather than an LLM -- the `engine` field on the verdict
line reads `deterministic`. The money gate, the SHA-256 receipts, the ledger, the grid and the
timeline are our code and behave identically in both modes. The video was recorded with live models.

Not implemented: Subscriptions v1 and the PayPal Agent Toolkit (@paypal/mcp). The settlement
path here is Orders v2 REST. The Agent Toolkit is the integration point this design moves to in
production — we say so in the README rather than implying it ships.
```

---

## "Challenges we ran into" (optional but strong)

```
The money gate is the claim that matters, so we made the demo run it in the page. During the
final video shoot the button reported "0 passed, 0 failed" — which looks exactly like a broken
product. The suite passed 31/31 from a terminal in the same minute.

The cause was not the test. The machine's PATH had no nodejs entry, so the server's child
spawn could not start an interpreter and died with STATUS_DLL_INIT_FAILED. The fix is to resolve
node by absolute path and hand it to the spawn. We only found it because we insisted on
running every button before recording, rather than assuming the earlier run still held.
```

---

## "Built with"

```
paypal, paypal-orders-v2, ag-grid, bryntum-scheduler, channel3, webmcp, nodejs, javascript,
multi-agent, llm, sha-256, flux
```

---

## Image gallery captions

```
01_main.png     — The demo opens on the story: a $42 renewal failed at 3 AM. Category, amount, monthly budget and why.
02_shop.png     — Give the agents a category and a budget. Candidate products come back with real photographs; the Tribunal judges each one.
03_denied.png   — A $90 charge against a $60 monthly budget. The Auditor and the Witness block it.
04_debate.png   — A $42 renewal comes back CONDITIONAL: one for, one against, one judging.
05_timeline.png — One bar per agent vote on the Bryntum timeline — green approved, red blocked, blue neutral.
06_ledger.png   — Every decision, every vote, every receipt in one AG Grid dashboard.
07_proof.png   — Three claims, three tests, all runnable in the page: the money-gate suite returns 31 passed, 0 failed.
08_grid.png    — The 4x4 verdict grid from the README, reproduced live: sixteen real adjudications.
```

---

## Try it out

```
Code:  https://github.com/Agentic-Guides/triad
Video: <YouTube link — added at submission time>
Run:   git clone https://github.com/Agentic-Guides/triad.git && cd triad && node demo/server.mjs
       → http://localhost:8787   (no API keys needed)
```
