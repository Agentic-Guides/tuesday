// Measure the purchase tribunal against docs/fixtures/tribunal-cases.json.
//
//   node tests/tribunal.fixture.mjs            # deterministic path only
//   node tests/tribunal.fixture.mjs --llm      # also run the three live models
//
// The fixture is the single source of truth for both paths. A defect in the fixture once
// read as a defect in the models: one case carried the reason "test", the models refused
// for lack of a stated reason, and the run looked like a gate disagreement. Always measure
// through this file rather than an ad-hoc list.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  adjudicate, makeAgent, ROLES, deterministicReason, deterministicJudge, DECISION,
} from '../src/triad.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', 'docs', 'fixtures', 'tribunal-cases.json');
const { cases } = JSON.parse(readFileSync(fixturePath, 'utf8'));

const wantsLlm = process.argv.includes('--llm');

function deterministicRun(c) {
  const k = {
    monthlyBudget: c.monthlyBudget,
    spentThisMonth: c.spentThisMonth,
    recentPurchases: c.recentPurchases || [],
  };
  const purchase = { category: c.item, amount: c.amount, reason: c.reason };
  const advocate = deterministicReason(makeAgent(ROLES.ADVOCATE, 'det', k), purchase);
  const auditor = deterministicReason(makeAgent(ROLES.AUDITOR, 'det', k), purchase);
  const witness = deterministicJudge(
    makeAgent(ROLES.WITNESS, 'det', k), purchase, advocate, auditor,
  );
  return adjudicate(purchase, { advocate, auditor, witness });
}

async function llmRun(c) {
  const { createTriad } = await import('../src/webmcp.js');
  const triad = createTriad({
    constraints: {
      monthlyBudget: c.monthlyBudget,
      spentThisMonth: c.spentThisMonth,
      recentPurchases: c.recentPurchases || [],
    },
  });
  return triad.triadAdjudicate({
    amount: c.amount,
    category: c.item,
    reason: c.reason,
    monthlyBudget: c.monthlyBudget,
    spentThisMonth: c.spentThisMonth,
    recentPurchases: c.recentPurchases || [],
  });
}

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\n=== Deterministic path ===');
const detResults = {};
for (const c of cases) {
  const r = deterministicRun(c);
  detResults[c.id] = r.decision;
  check(`${c.id} ${c.expect_deterministic}`, r.decision === c.expect_deterministic, r.decision);
}

if (wantsLlm) {
  console.log('\n=== Three live models ===');
  for (const c of cases) {
    const r = await llmRun(c);
    check(`${c.id} ${c.expect_llm}`, r.decision === c.expect_llm, r.decision);
  }
}

// The gate that used to manufacture a refusal must never fail a vote on its own.
console.log('\n=== G5 is a warning, not a veto ===');
const c03 = cases.find((c) => c.id === 'C03');
const k03 = { monthlyBudget: c03.monthlyBudget, spentThisMonth: c03.spentThisMonth, recentPurchases: [] };
const aud03 = deterministicReason(makeAgent(ROLES.AUDITOR, 'det', k03), {
  category: c03.item, amount: c03.amount, reason: c03.reason,
});
check('G5 is not in failedGates', !(aud03.failedGates || []).includes('G5_survives_double_cost'),
  JSON.stringify(aud03.failedGates));
check('G5 still reports warn: true',
  (aud03.gates || []).some((g) => g.id === 'G5_survives_double_cost' && g.warn === true));
check('a doubling of C03 would in fact breach the remainder',
  c03.amount * 2 > c03.monthlyBudget - c03.spentThisMonth,
  `${c03.amount * 2} vs ${c03.monthlyBudget - c03.spentThisMonth}`);

console.log(`\n${fail === 0 ? '✅' : '❌'} tribunal fixture: ${pass} passed, ${fail} failed`);
console.log('deterministic decisions:', JSON.stringify(detResults));
process.exit(fail === 0 ? 0 : 1);
