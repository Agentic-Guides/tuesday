/**
 * Tuesday money-gate test — the mechanical proof.
 *
 * The claim on the README is strong:
 *   "A DENIED or DISSENT adjudication cannot produce a PayPal order —
 *    enforced in code, not in the UI."
 *
 * This file proves it: we spy on the PayPal client and assert that
 * createOrder is called **0 times** whenever the tribunal does not reach
 * consensus. It also proves the consensus receipt is stamped into the
 * order's custom_id and that tampering with the receipt is detected.
 *
 * Run:  node tests/moneyGate.test.js     (zero config, no API key)
 */
import { createTriad } from '../src/webmcp.js';
import { DECISION } from '../src/triad.js';
import { buildReceipt, verifyReceipt, receiptCustomId, hashFromCustomId } from '../src/receipt.js';

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  cond ? pass++ : fail++;
}

// --- A spy PayPal client: records every createOrder call, never hits network ---
function spyPayPal() {
  return {
    mode: 'SPY',
    createOrderCalls: 0,
    captured: [],
    async createOrder(purchase) {
      this.createOrderCalls++;
      this.lastPurchase = purchase;
      return {
        id: `SPY-${this.createOrderCalls}`,
        status: 'CREATED',
        mock: true,
        purchase_units: [{ custom_id: purchase.customId ?? null }],
        links: [{ rel: 'approve', href: 'https://sandbox/approve' }],
      };
    },
    async captureOrder(id) {
      this.captured.push(id);
      return { id, status: 'COMPLETED', mock: true };
    },
  };
}

// --- A stub runner: lets us force any of the four decision states ---
const a = (agent, verdict, reasons, extra = {}) => ({
  agent,
  title: agent[0].toUpperCase() + agent.slice(1),
  stance: { advocate: 'for', auditor: 'against', witness: 'neutral' }[agent],
  verdict,
  reasons,
  conditions: extra.conditions ?? null,
  confidence: 0.7,
  model: extra.model ?? 'test-model',
});

const ARGS = {
  APPROVED: {
    advocate: a('advocate', 'for', ['worth it']),
    auditor: a('auditor', 'for', ['within budget']),
    witness: a('witness', 'neutral', ['both sides agree']),
  },
  CONDITIONAL: {
    advocate: a('advocate', 'for', ['worth it']),
    auditor: a('auditor', 'against', ['borderline over budget']),
    witness: a('witness', 'neutral', ['compromise'], { conditions: 'reduce price 30%' }),
  },
  DENIED: {
    advocate: a('advocate', 'for', ['worth it']),
    auditor: a('auditor', 'against', ['over budget']),
    witness: a('witness', 'against', ['objection severe']),
  },
  DISSENT: {
    advocate: a('advocate', 'for', ['worth it']),
    auditor: a('auditor', 'against', ['risky']),
    witness: a('witness', 'neutral', ['cannot decide']), // no conditions → no consensus
  },
};

function stubRunner(args) {
  return {
    agents: { advocate: { constraints: {} }, auditor: { constraints: {} }, witness: { constraints: {} } },
    debate: async () => ({ ...args, engine: 'stub' }),
  };
}

const PURCHASE = { amount: 400, category: 'gadget', reason: 'test' };

// ===========================================================================
// 1. THE GATE — createOrder must be 0 for DENIED / DISSENT
// ===========================================================================
async function gateCase(state) {
  const paypal = spyPayPal();
  const triad = createTriad({ runner: stubRunner(ARGS[state]), paypal });
  const r = await triad.triadAdjudicate(PURCHASE);
  check(`${state}: adjudicated as ${state}`, r.decision === state, `got ${r.decision}`);

  const o = await triad.triadCreateOrder({ purchaseId: r.purchase.id });
  const shouldBlock = state === DECISION.DENIED || state === DECISION.DISSENT;
  check(`${state}: createOrder calls`, paypal.createOrderCalls === (shouldBlock ? 0 : 1),
    `called ${paypal.createOrderCalls}×, expected ${shouldBlock ? 0 : 1}`);
  if (shouldBlock) {
    check(`${state}: order rejected as not_approved`, o.ok === false && o.error === 'not_approved');
  } else {
    check(`${state}: order created`, o.ok === true && Boolean(o.orderId));
  }
  return { triad, paypal, r, o };
}

console.log('\n=== 1. Money gate: no consensus ⇒ no order ===');
const gApproved = await gateCase(DECISION.APPROVED);
await gateCase(DECISION.CONDITIONAL);
await gateCase(DECISION.DENIED);
await gateCase(DECISION.DISSENT);

// ===========================================================================
// 2. RECEIPT STAMP — the order's custom_id carries the consensus hash
// ===========================================================================
console.log('\n=== 2. Consensus receipt stamped into PayPal custom_id ===');
{
  const { r, o } = gApproved;
  const rc = r.receipt;
  check('receipt exists on adjudication', Boolean(rc));
  check('receipt.hash is 16 hex chars', /^[0-9a-f]{16}$/.test(rc?.hash || ''), rc?.hash);
  check('receipt votes recorded', rc.votes.advocate === 'for' && rc.votes.witness === 'neutral');
  check('receipt customId format triad1:<hash>', rc.customId === `triad1:${rc.hash}`, rc.customId);
  check('order custom_id === receipt customId', o.audit.customId === rc.customId, o.audit.customId);
  check('order stamped flag', o.audit.stamped === true);
  check('custom_id on the order object itself', o.audit.customId === `triad1:${rc.hash}`);

  // verify path (what triadVerifyReceipt does)
  const v = await gApproved.triad.triadVerifyReceipt({ purchaseId: r.purchase.id });
  check('triadVerifyReceipt ok', v.ok === true);
  check('hash matches order ↔ ledger', v.hashMatches === true && v.receiptIntact === true);
  check('hashFromCustomId round-trips', hashFromCustomId(rc.customId) === rc.hash);
}

// ===========================================================================
// 3. TAMPER DETECTION — mutate the receipt ⇒ verification fails
// ===========================================================================
console.log('\n=== 3. Tamper detection ===');
{
  const rc = buildReceipt({
    decision: 'APPROVED',
    threshold: 2,
    purchase: { id: 'pur_x', amount: 400, category: 'gadget' },
    arguments: ARGS.APPROVED,
  });
  check('fresh receipt verifies', verifyReceipt(rc) === true);

  const forged = { ...rc, decision: 'APPROVED_BY_FORGERY' }; // hash left untouched
  check('forged decision detected', verifyReceipt(forged) === false);

  const forgedVotes = { ...rc, votes: { ...rc.votes, auditor: 'against' } };
  check('forged vote detected', verifyReceipt(forgedVotes) === false);

  // Canonicalization is order-independent and thus reproducible.
  const again = buildReceipt({
    decision: 'APPROVED',
    threshold: 2,
    purchase: { id: 'pur_x', amount: 400, category: 'gadget' },
    arguments: ARGS.APPROVED,
  }, { at: rc.at });
  check('receipt is deterministic (same hash)', again.hash === rc.hash, `${again.hash} vs ${rc.hash}`);
}

// ===========================================================================
// 4. INTEGRATION — real deterministic engine end-to-end through the gate
// ===========================================================================
console.log('\n=== 4. Integration: real engine (no stub) ===');
{
  const paypal = spyPayPal();
  const triad = createTriad({ paypal }); // real deterministic engine

  const ok = await triad.triadAdjudicate({ amount: 45, category: 'books', reason: 'study', monthlyBudget: 500, spentThisMonth: 50 });
  check('in-budget → APPROVED', ok.decision === DECISION.APPROVED, ok.decision);
  const o1 = await triad.triadCreateOrder({ purchaseId: ok.purchase.id });
  check('approved → order created with receipt', o1.ok && o1.audit.verify === true, o1.audit?.customId);

  const no = await triad.triadAdjudicate({ amount: 5000, category: 'luxury watch', reason: 'impulse', monthlyBudget: 1000, spentThisMonth: 900 });
  check('over-budget → DENIED', no.decision === DECISION.DENIED, no.decision);
  const before = paypal.createOrderCalls;
  const o2 = await triad.triadCreateOrder({ purchaseId: no.purchase.id });
  check('denied → createOrder NOT called', paypal.createOrderCalls === before && o2.ok === false,
    `calls=${paypal.createOrderCalls}`);

  const ledger = triad.triadGetLedger();
  check('ledger records receipt hash', ledger.entries.every(e => /^[0-9a-f]{16}$/.test(e.receiptHash)));
}

// ---------------------------------------------------------------------------
console.log(`\n${fail === 0 ? '✅' : '❌'} moneyGate: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
