# AGENTS.md — triad (Tuesday)

Tuesday is an adversarial-consensus layer for autonomous commerce: three
independent agents must agree before money moves, and their disagreement is
recorded as a verifiable receipt. Entry point for a coding agent working here.

## Quickstart

```bash
npm install                 # deps (AG Grid, Bryntum are CDN-loaded in the demo)
node demo/server.mjs        # demo + JSON API on :8787
node test_triad.mjs         # end-to-end tests (deterministic engine, no API key)
```

The demo is a single HTML file at `demo/index.html` driven by `demo/server.mjs`.
The engine lives in `src/`.

## Architecture — why three agents, and why they cannot corrupt each other

This is the part reviewers ask about, so keep it true.

- **`src/triad.js`** — the kernel. Defines the three roles, the deterministic
  reasoning fallback, the vote aggregation, and the receipt.
- **`src/runner.js`** — the LLM adapter (live models when keys exist, otherwise
  the deterministic judge). The engine must run without any API key.
- **`src/receipt.js`** — hashes decision + all three votes + reasoning into a
  tamper-evident record. Its `customId` is stamped into the PayPal order.
- **`src/commerce.js` / `src/channel3.js`** — product search and budget checks.
- **`src/webmcp.js`** — the MCP tool surface (this repo is also a registered MCP
  server; M8ven scores it 89/100, grade B, Verified Publisher).

**Design rule that matters (from Cognition's "Don't Build Multi-Agents"):**

1. **Share context.** All three agents reason over the *same* purchase object and
   the *same* constraints (`monthlyBudget`, `spentThisMonth`, `recentPurchases`).
   None of them holds private state the others cannot see.
   - The Advocate argues for. The Auditor audits numbers. The Witness judges the
     split. Only the Witness may attach conditions.
2. **Actions carry implicit decisions.** The agents *read and argue*; they never
   write. Exactly one place writes the ledger (`ledger.push` in `webmcp.js`) and
   one place writes the receipt. Parallel reads are safe; parallel writes are not,
   so there are none.

If you add a fourth agent, it must obey both rules or the receipt stops meaning
what it claims.

## Consensus rules — read before changing anything

- **threshold = 2** (two votes out of three). If you change
  `adjudicate(purchase, args, 2)`, the existing tests (in-budget / over budget /
  split) must still pass.
- **Refusal is evaluated first, agreement second. Do not reorder these** — this
  order was actually broken once and produced an order for a purchase two agents
  had rejected:
  1. `votesAgainst >= 2` → **DENIED** (money cannot move)
  2. `votesFor >= threshold` → **CONDITIONAL** if the Witness attached a condition,
     otherwise **APPROVED**
  3. `votesFor === 1 && votesAgainst === 1` and the Witness attached a condition →
     **CONDITIONAL**
  4. anything else → **DISSENT**

  An earlier version checked "the Witness has a condition" first and
  unconditionally, so **two objectors still produced CONDITIONAL and a PayPal order
  was raised**. Reproduced, fixed, and `tests/moneyGate.test.js` now blocks that
  path. Test cases for `CONDITIONAL` must be built as "two votes for + condition";
  one vote for + a condition is DISSENT, not CONDITIONAL.
- Rule 3 is kept because it is the product: "the Advocate pushes, the Auditor
  blocks, the Witness bridges with a condition" is the behaviour Tuesday exists to
  show. Rule 1 runs first, so it cannot become a hole in the money gate.
- **Auditor order of checks**: (1) is the amount positive (0 / missing / negative
  is refused), (2) over budget, (3) share of budget above 50%, (4) a recent
  purchase in the same category. Check 3 must not depend on `recentPurchases` —
  when it did, a purchase using 93% of the budget came back APPROVED.
- **The deterministic engine is the source of truth.** The same verdict must come
  out with no LLM present.
- **A model cannot vote past a failed gate.** `runner.js` runs the deterministic
  gates independently of the models; if any fails, the Auditor is forced to
  `against` and the Witness may not bridge it with a condition.

## Prohibited

- Never write credentials, tokens, or private keys into a file. Read them from
  `.env` or the environment. `.env` is in `.gitignore` and must never be committed.
- **Never build a path that moves real money.** PayPal stops at MOCK or sandbox;
  no production key goes into the code.
- Never put an unmeasured number into the README, the Devpost story, or the video.

## Tests

- `node test_triad.mjs` — keep it at PASS 3 / FAIL 0. Run it after any change to
  the verdict logic.
- `npm test` — moneyGate, disputeDesk and test_triad together.
- Verdict matrix spot-check at a fixed $42 purchase: budget $40 → all DENIED;
  $45–60 → mixed CONDITIONAL; $100 → APPROVED; $200 → all APPROVED.

## The demo (demo/index.html)

- **The palette is a beige hierarchy** (page #f0eadf / card #ffffff / red #c0203c /
  ink #241f1a). Reverting to flat white reads as "no hierarchy" — measured with
  vision.
- **AG Grid stays light.** The dark theme makes text unreadable here.
- KPI contrast was fixed from 1.07 to 18.9. Never leave white text on white.
- Address tabs by `id` (`tabShop` / `tabDirect` / `tabTimeline` / `tabDisputes`).
  Matching on visible text misfires as soon as there are two similar buttons.

## Traps that were actually hit

- `#decision`'s `innerText` is empty; the verdict lives in **`#decision .big`**.
- Setting `document.body.style.zoom` **after** `scrollIntoView` re-lays out the
  page and pushes the verdict off screen (371px → 739px in an 864px viewport).
- Shrinking zoom to 0.62 **before** the debate starts keeps the verdict on screen.
- More than one tab on the CDP debug port means you record one window while
  driving another. Validate the URL at startup and fail loudly if it differs.

## Windows specifics

- The terminal is git-bash; PowerShell builtins do not apply.
- Pass `C:/Users/...` style paths to native tools (node, git).
- h264 needs **even** dimensions (an odd height writes a zero-byte file).
