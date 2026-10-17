/**
 * Tuesday end-to-end test (deterministic engine — no API key needed).
 * Proves the adjudication + PayPal mock flow works.
 */
import { createTriad } from './src/webmcp.js';
import { adjudicate, makeAgent, ROLES, deterministicReason, deterministicJudge, DECISION } from './src/triad.js';

function show(label, v) { console.log(`\n=== ${label} ===\n${JSON.stringify(v, null, 2)}`); }

// --- Test 1: in-budget purchase → APPROVED ---
{
  const advocate = makeAgent(ROLES.ADVOCATE, 'x', { monthlyBudget: 2000, spentThisMonth: 300 });
  const auditor = makeAgent(ROLES.AUDITOR, 'x', { monthlyBudget: 2000, spentThisMonth: 300, recentPurchases: [] });
  const witness = makeAgent(ROLES.WITNESS, 'x', {});
  const p = { amount: 120, category: 'mechanical keyboard', reason: 'typing comfort for work' };
  const a = deterministicReason(advocate, p);
  const au = deterministicReason(auditor, p);
  const w = deterministicJudge(witness, p, a, au);
  const r = adjudicate(p, { advocate: a, auditor: au, witness: w });
  show('Test 1: in-budget → expect APPROVED', { decision: r.decision, votesFor: r.votesFor, votesAgainst: r.votesAgainst });
  console.log(r.decision === DECISION.APPROVED ? '  PASS' : '  FAIL');
}

// --- Test 2: over budget → DENIED with dissent map ---
{
  const advocate = makeAgent(ROLES.ADVOCATE, 'x', {});
  const auditor = makeAgent(ROLES.AUDITOR, 'x', { monthlyBudget: 1000, spentThisMonth: 950, recentPurchases: ['MacBook Pro'] });
  const witness = makeAgent(ROLES.WITNESS, 'x', { monthlyBudget: 1000, spentThisMonth: 950, recentPurchases: ['MacBook Pro'] });
  const p = { amount: 800, category: 'gaming PC', reason: 'want faster games' };
  const a = deterministicReason(advocate, p);
  const au = deterministicReason(auditor, p);
  const w = deterministicJudge(witness, p, a, au);
  const r = adjudicate(p, { advocate: a, auditor: au, witness: w });
  show('Test 2: over budget → expect DENIED + dissentMap', { decision: r.decision, votesAgainst: r.votesAgainst, summary: r.dissentMap?.summary });
  console.log(r.decision === DECISION.DENIED ? '  PASS' : '  FAIL');
}

// --- Test 3: split → CONDITIONAL ---
{
  const advocate = makeAgent(ROLES.ADVOCATE, 'x', {});
  const auditor = makeAgent(ROLES.AUDITOR, 'x', { monthlyBudget: 1000, spentThisMonth: 700, recentPurchases: ['iPad'] });
  const witness = makeAgent(ROLES.WITNESS, 'x', {});
  const p = { amount: 500, category: 'camera lens', reason: 'photography hobby' };
  const a = deterministicReason(advocate, p);
  const au = deterministicReason(auditor, p);
  const w = deterministicJudge(witness, p, a, au);
  const r = adjudicate(p, { advocate: a, auditor: au, witness: w });
  show('Test 3: split → expect CONDITIONAL', { decision: r.decision, conditions: w.conditions });
  console.log(r.decision === DECISION.CONDITIONAL ? '  PASS' : '  FAIL');
}

// --- Test 4: full flow with mock PayPal ---
// This test exercises the money gate and the order lifecycle MECHANICALLY, so it
// deliberately forces MOCK mode. Pointing it at the live sandbox would (correctly)
// fail at capture with 422 ORDER_NOT_APPROVED, because PayPal requires a human to
// approve the order first. That behaviour is verified separately, on purpose, by
// tests/paypalSandbox.live.mjs.
console.log('\n\n########## Test 4: Full flow with mock PayPal ##########');
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;
const triad = createTriad();

(async () => {
  // Approve a small purchase
  const r1 = await triad.triadAdjudicate({ amount: 45, category: 'books', reason: 'study', monthlyBudget: 500, spentThisMonth: 50 });
  show('Adjudication result', { decision: r1.decision, engine: r1.engine, paypalMode: r1.paypalMode, summary: r1.dissentMap?.summary ?? 'consensus' });

  // If approved, create + capture order
  if (r1.decision === DECISION.APPROVED || r1.decision === DECISION.CONDITIONAL) {
    const o = await triad.triadCreateOrder({ purchaseId: r1.purchase.id, returnUrl: 'https://example.com/return' });
    show('PayPal order created', o);
    const c = await triad.triadCaptureOrder({ orderId: o.orderId });
    show('PayPal capture', { ok: c.ok, status: c.capture?.status, mode: c.mode });
  }

  // Deny test — no order should be creatable
  const r2 = await triad.triadAdjudicate({ amount: 5000, category: 'luxury watch', reason: 'impulse', monthlyBudget: 1000, spentThisMonth: 900 });
  show('Denied adjudication', { decision: r2.decision });
  const o2 = await triad.triadCreateOrder({ purchaseId: r2.purchase.id });
  show('Order on denied purchase (expect not_approved)', o2);

  // Ledger
  const ledger = triad.triadGetLedger();
  show('Ledger', { count: ledger.count, entries: ledger.entries.map(e => ({ decision: e.decision, summary: e.summary })) });

  console.log('\n✅ All Tuesday tests complete');
})();
