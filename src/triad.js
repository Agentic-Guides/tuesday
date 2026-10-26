/**
 * Tuesday — Adversarial Consensus Engine
 *
 * Three independent AI agents argue over whether the money may be spent. The
 * tribunal is the product; the receipt prefix `triad1:` is named after it.
 *
 *   ADVOCATE  — argues for the purchase (represents the want)
 *   AUDITOR   — argues against it (represents the budget and the risk)
 *   WITNESS   — the neutral judge
 *
 * Decision rule (see adjudicate() — first match wins, this is NOT plain 2-of-3):
 *   1) 2 or more votes against                        -> DENIED     no order
 *   2) 2 or more for, Witness attached a condition    -> CONDITIONAL order raised
 *   3) 2 or more for, no condition                    -> APPROVED    order raised
 *   4) 1 for, 1 against, Witness attached a condition -> CONDITIONAL order raised
 *   5) anything else                                  -> DISSENT    no order
 *
 *   DENIED / DISSENT build a dissent map: who disagreed, on what, and how far
 *   they would not move. A refusal of two always wins, so the tie-break in (4)
 *   can never release money past two objectors.
 *
 * Design principle: the agents never decide WHETHER to buy. They show the human
 * the shape of the disagreement. The final call always belongs to a person.
 */

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

/**
 * The gates are machine-checked rules with stable ids, because the receipt has to
 * survive an audit. A human reading the objection needs the sentence, not the id.
 * Keep both: gates[].id for the record, gateSentence() for the person.
 */
const GATE_SENTENCE = {
  G1_amount_positive:      'the amount is not a real number',
  G2_within_remaining:     'the money is not there any more',
  G3_share_under_half:     'one purchase should not eat over half the month',
  G4_not_repeat_category:  'this repeats something bought recently',
  G5_survives_double_cost: 'it would not fit any more if it cost twice as much',
};
function gateSentence(id) {
  if (GATE_SENTENCE[id]) return GATE_SENTENCE[id];
  return String(id).replace(/^G\d+_/, '').replace(/_/g, ' ');
}

export const ROLES = {
  ADVOCATE: 'advocate', // argues for the purchase
  AUDITOR: 'auditor',   // argues against it
  WITNESS: 'witness',   // neutral judge
};

// Each agent's interest, temperament and refusal conditions
export function makeAgent(role, modelId, constraints = {}) {
  const base = {
    advocate: {
      title: 'Advocate',
      stance: 'for',
      system:
        'You argue FOR the purchase. Make the strongest honest case for why this purchase is necessary and worth it. Cite concrete benefits. Be persuasive but never lie.',
    },
    auditor: {
      title: 'Auditor',
      stance: 'against',
      system:
        'You are the Auditor. Your duty is to protect the budget and surface real risk. ' +
        'Judge this purchase on its merits and return verdict "against" ONLY if there is a ' +
        'concrete, citable risk (over budget, redundant, unsafe, or clearly not worth it). ' +
        'If the purchase is sound and affordable, return verdict "for". Do not oppose for its own sake.',
    },
    witness: {
      title: 'Witness',
      stance: 'neutral',
      system:
        'You are the neutral judge. Read both sides, weigh them, and decide with verdict "for" or "against". ' +
        'Return "against" ONLY if a concrete, citable risk stands after weighing both sides. ' +
        'Attach conditions when the purchase should proceed only in a limited way. Be decisive and explain your reasoning.',
    },
  }[role];

  return {
    role,
    model: modelId,
    title: base.title,
    stance: base.stance,
    system: base.system,
    constraints: {
      monthlyBudget: constraints.monthlyBudget ?? null,
      spentThisMonth: constraints.spentThisMonth ?? 0,
      recentPurchases: constraints.recentPurchases ?? [],
      ...constraints,
    },
  };
}

// ---------------------------------------------------------------------------
// The argument (dissensus) model
// ---------------------------------------------------------------------------

function mkArgument(agent, verdict, reasons, options = {}) {
  return {
    agent: agent.role,
    title: agent.title,
    stance: agent.stance,
    verdict,               // 'for' | 'against' | 'neutral'
    reasons,               // string[]
    conditions: options.conditions ?? null, // the Witness's conditional approval
    confidence: options.confidence ?? 0.5,
    model: agent.model,
    // Audit gates, kept in a form that can be measured. A verdict without the NAME of
    // the gate it failed is an opinion, not an audit.
    gates: options.gates ?? null,
    failedGates: options.failedGates ?? null,
  };
}

// ---------------------------------------------------------------------------
// Each agent's reasoning — pluggable (an LLM call, or a deterministic rule)
// ---------------------------------------------------------------------------

/**
 * Deterministic fallback. The engine runs even where no LLM is reachable, which is
 * what lets this demo always run — and what stops a model outage from moving money.
 */
export function deterministicReason(agent, purchase) {
  const { amount, category, reason } = purchase;
  const c = agent.constraints;

  if (agent.role === ROLES.ADVOCATE) {
    const reasons = [
      `This purchase (${category}) supports the stated goal: "${reason}".`,
      `Price ${fmt(amount)} is within a reasonable range for ${category}.`,
    ];
    if (c.recentPurchases?.length) {
      reasons.push(`No overlapping purchase this month (last: ${c.recentPurchases[0]}).`);
    }
    return mkArgument(agent, 'for', reasons, { confidence: 0.72 });
  }

  if (agent.role === ROLES.AUDITOR) {
    const reasons = [];
    let verdict = 'against';

    // ★ An unquantified purchase cannot be audited. Refuse rather than approve
    //   something whose cost is unknown or zero — that is exactly the kind of
    //   silent pass an audit trail is supposed to prevent.
    if (!(amount > 0)) {
      reasons.push(`No amount to audit: price is ${fmt(amount)}. A purchase must carry a positive amount.`);
      return mkArgument(agent, 'against', reasons, { confidence: 0.9 });
    }

    if (c.monthlyBudget != null) {
      const remaining = c.monthlyBudget - (c.spentThisMonth ?? 0);
      if (amount > remaining) {
        // Hard breach: the money is simply not there.
        reasons.push(`Over budget: price ${fmt(amount)} exceeds remaining ${fmt(remaining)}.`);
      } else {
        reasons.push(`Within budget: ${fmt(amount)} vs remaining ${fmt(remaining)}.`);
        verdict = 'for';
      }
    } else {
      // No budget was supplied, so there is nothing to audit the price against. That is
      // not the same as a refusal, and it must not be silent: the auditor's verdict used
      // to default to 'against' with an empty reasons list, which meant a purchase was
      // rejected by an agent that never said why. An audit that cannot state its grounds
      // is not an audit, so the verdict here is neutral — the auditor abstains rather
      // than vetoes — and the abstention is named.
      reasons.push('No monthly budget was supplied, so the price cannot be audited against one.');
      verdict = 'neutral';
    }

    // ★ Multi-gate audit — adapted from the quant research rejection engine.
    //   Idea: it is not enough that the money exists. A single purchase should
    //   have to clear several independent gates, and the audit must say WHICH
    //   gate it failed. A verdict that cannot name its failing gate is not an
    //   audit, it is an opinion.
    //
    //   Gates (all must pass; each one is named in the reasons):
    //     G1 amount > 0            — an unquantified purchase cannot be audited
    //     G2 within remaining      — the money has to be there
    //     G3 share <= 50%          — concentration risk, not just availability
    //     G4 not a repeat          — no recent purchase of the same category
    //     G5 cost stress           — the decision must survive a doubled price
    const gates = [];
    gates.push({ id: 'G1_amount_positive', pass: amount > 0 });

    if (c.monthlyBudget != null) {
      const remaining = c.monthlyBudget - (c.spentThisMonth ?? 0);
      gates.push({ id: 'G2_within_remaining', pass: amount <= remaining });
      gates.push({ id: 'G3_share_under_half', pass: amount / c.monthlyBudget <= 0.5 });
    }

    const recentCats = (c.recentPurchases || []).map(String).map(x => x.toLowerCase());
    const repeat = recentCats.includes(String(category || '').toLowerCase());
    gates.push({ id: 'G4_not_repeat_category', pass: !repeat });

    // G5 — cost stress: the quant analogue of re-running a backtest at double
    //      fees. A purchase that only fits because of its current price has no
    //      margin for error: if it costs twice as much (fees, tax, shipping,
    //      a price change) it would breach the concentration limit. Failing
    //      this gate does not mean "don't buy" — it means "you are buying with
    //      no headroom", which is exactly what an auditor should say out loud.
    if (c.monthlyBudget != null) {
      // Cost stress: if this cost twice as much (fees, tax, shipping, a price
      // change, a currency swing), would it still fit the money that is left?
      //
      // This must be measured against the REMAINING budget, not against a fixed
      // fraction of the monthly budget. Comparing against half the monthly budget
      // made every item above 25% of the budget fail, so a perfectly ordinary
      // $42 renewal on a $60 budget was rejected for "cost stress" when a doubled
      // $84 would in fact still have fit a $60 budget only if nothing else were
      // spent — the gate was answering a different question than the one it
      // claims to answer.
      const remaining = c.monthlyBudget - (c.spentThisMonth ?? 0);
      // ★ G5 reports a WARNING, not a veto.
      //
      //   Measured: when G5 pushed `pass: false`, a $48 renewal with $80 left failed it
      //   (2x48 = 96 > 80) and came back CONDITIONAL even though the bottle had oxidised
      //   and the purchase was an ordinary replacement. Seven of ten test cases picked up
      //   a "reduce the price by 30%" condition from this one stress test, including a
      //   $12 part for a documented defect. A stress test that fires on most real
      //   purchases is not an audit, it is noise.
      //
      //   The warning still travels: `warn` is on the gate record, and deterministicJudge
      //   turns it into a condition only when the purchase really does leave no headroom
      //   (see NO_HEADROOM_SHARE below).
      gates.push({ id: 'G5_survives_double_cost', pass: true, warn: amount * 2 > remaining });
    }

    const failedGates = gates.filter(g => !g.pass).map(g => g.id);
    if (failedGates.length) {
      // Name the objection in a sentence a person can act on. The machine ids
      // (G3_share_under_half) still travel in gates[].id for the receipt, but the
      // reason a human reads should say what is wrong, not which rule caught it.
      reasons.push(`Blocked by ${failedGates.map(gateSentence).join('; ')}.`);
      // ★ Gates decide the verdict: any failed gate is an objection, and the
      //   objection has to name itself so a human can see what to fix.
      verdict = 'against';
    }

    // ★ Budget-share test — independent of any assumption about recent activity.
    //   A purchase that eats most of the month's budget deserves scrutiny even
    //   when the money happens to be available. Without this, a purchase using
    //   ~90% of the remaining budget slips through as "within budget".
    const share = c.monthlyBudget ? amount / c.monthlyBudget : null;
    if (c.monthlyBudget != null && share != null && share > 0.5) {
      reasons.push(
        `This purchase uses ${Math.round(share * 100)}% of the monthly budget ` +
        `(${fmt(amount)} of ${fmt(c.monthlyBudget)}).`
      );
      if (verdict === 'for') {
        verdict = 'against';
        reasons.push('A single purchase consuming more than half the budget needs justification.');
      }
    }

    if (c.recentPurchases?.length) {
      reasons.push(`Recent purchase detected: ${c.recentPurchases.join(', ')}. Consider need vs. want.`);
      if (verdict === 'for' && amount > (c.monthlyBudget ?? 0) * 0.25) {
        verdict = 'against';
        reasons.push('This is a large fraction of the monthly budget despite a recent purchase.');
      }
    }
    return mkArgument(agent, verdict, reasons, {
      confidence: 0.68,
      gates,               // pass/fail per gate, so the refusal keeps its name
      failedGates,
    });
  }

  // WITNESS
  return null; // witness decides after seeing both sides
}

export function deterministicJudge(agent, purchase, forArg, againstArg) {
  const advocateFor = forArg?.verdict === 'for';
  const auditorAgainst = againstArg?.verdict === 'against';

  // ★ Where a soft-gate warning becomes a condition.
  //
  //   This has to be computed BEFORE the "both sides agree" early return below.
  //   Measured: with the check placed after it, the $34-of-$42 case never reached the
  //   condition branch — the Advocate said for, the Auditor said for, the judge returned
  //   neutral with conditions null, and a purchase that consumes 81% of the month's
  //   remaining money was APPROVED with no caveat at all. Four of ten cases (81%, 93%,
  //   86%, 100% of the remainder) slipped through that way.
  //
  //   G5 (cost stress) no longer vetoes, so this is what converts its warning into
  //   something a person acts on. Thresholds measured on the tribunal's cases:
  //     $34 of $42 left  = 81%  -> condition   (C02)
  //     $65 of $70 left  = 93%  -> condition   (C07)
  //     $95 of $110 left = 86%  -> condition   (C09)
  //     $12 of $12 left  = 100% -> condition   (C10)
  //     $48 of $80 left  = 60%  -> no condition (C03, an oxidised bottle replaced)
  const jc = agent.constraints || {};
  const jBudget = jc.monthlyBudget ?? null;
  const jRemaining = jBudget != null ? jBudget - (jc.spentThisMonth ?? 0) : null;
  const jAmount = Number(purchase.amount) || 0;
  const NO_HEADROOM_SHARE = 0.80;
  const shareOfRemaining = jRemaining != null && jRemaining > 0 ? jAmount / jRemaining : null;
  const noHeadroom = shareOfRemaining != null && shareOfRemaining >= NO_HEADROOM_SHARE;
  const noHeadroomCondition =
    'Approve only as the last purchase this month: no further discretionary spend ' +
    'without a separate decision, and any unexpected essential cost must be escalated.';

  // Both agree it's sound — unless there is no headroom left, in which case the
  // agreement stands but the purchase proceeds under a stated condition.
  if (advocateFor && !auditorAgainst) {
    return mkArgument(agent, 'neutral',
      ['Both sides agree the purchase is sound.',
       ...(noHeadroom
         ? [`It uses ${Math.round(shareOfRemaining * 100)}% of the $${jRemaining} left ` +
            'this month, so no headroom remains for anything else.']
         : [])],
      { conditions: noHeadroom ? noHeadroomCondition : null, confidence: 0.85 });
  }
  // Both agree it should not proceed.
  if (!advocateFor && auditorAgainst) {
    return mkArgument(agent, 'against', ['Both sides agree the purchase should not proceed.'], {
      conditions: null, confidence: 0.85,
    });
  }

  // Split → weigh the severity of the objection.
  const c = agent.constraints || {};
  const budget = c.monthlyBudget ?? null;
  const spent = c.spentThisMonth ?? 0;
  const remaining = budget != null ? budget - spent : null;
  const amount = Number(purchase.amount) || 0;


  // Severe: price far exceeds remaining budget (≥1.5× remaining, or >budget entirely)
  const severelyOver =
    remaining != null && (amount > remaining * 1.5 || amount > budget);

  if (severelyOver) {
    return mkArgument(agent, 'against',
      ['The Advocate wants it, but the Auditor\'s budget objection is severe:',
       `the price $${amount} far exceeds the remaining budget $${Math.max(remaining, 0)}.`,
       'A full-price purchase is not justified.'],
      { conditions: null, confidence: 0.8 });
  }

  // Borderline: over remaining but not catastrophically → condition on reduction.
  const borderlineOver = remaining != null && amount > remaining;
  if (noHeadroom && !borderlineOver) {
    return mkArgument(agent, 'neutral',
      ['The Advocate argues the purchase is needed; the Auditor flags budget/risk.',
       `The price fits, but it uses ${Math.round(shareOfRemaining * 100)}% of the ` +
       `$${remaining} left this month, so no headroom remains for anything else.`],
      {
        conditions:
          'Approve only as the last purchase this month: no further discretionary spend ' +
          'without a separate decision, and any unexpected essential cost must be escalated.',
        confidence: 0.62,
        noHeadroom: true,
      });
  }

  return mkArgument(agent, 'neutral',
    ['The Advocate argues the purchase is needed; the Auditor flags budget/risk.',
     borderlineOver
       ? 'The price exceeds the remaining budget but is not extreme. A constrained purchase may be acceptable.'
       : 'The need is real but unproven. A constrained commitment is the prudent middle path.'],
    {
      conditions: borderlineOver
        ? 'Approve only if the price is reduced to fit the remaining budget (alternative, used, or split payment).'
        : 'Approve only if the price is reduced by at least 30% (alternative, used, or postponed).',
      confidence: 0.6,
    });
}

// ---------------------------------------------------------------------------
// The consensus engine
// ---------------------------------------------------------------------------

export const DECISION = {
  APPROVED: 'APPROVED',
  CONDITIONAL: 'CONDITIONAL',
  DENIED: 'DENIED',
  DISSENT: 'DISSENT',
};

/**
 * Fold the three agents' arguments into one decision.
 * @param {object} purchase { amount, category, reason }
 * @param {object} args { advocate, auditor, witness } — each agent's argument
 * @param {number} threshold votes needed for approval (default 2)
 */
export function adjudicate(purchase, args, threshold = 2) {
  const { advocate, auditor, witness } = args;

  // ★ A purchase that cannot be quantified is not a purchase, and it certainly cannot be
  //   approved. This guard lives here rather than only in the auditor's reasons because
  //   the auditor saying "against" was not enough: with two objectors abstaining on
  //   severity, a $0 or a -$50 purchase still came out CONDITIONAL — and CONDITIONAL is
  //   exactly the verdict that lets a PayPal order be raised. The demo could have minted
  //   an order for a negative amount while printing "G1: an unquantifiable purchase
  //   cannot be audited" in its own audit log.
  const amount = Number(purchase?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    const reason = `A purchase must carry a positive amount; this one is ${purchase?.amount}.`;
    const arg = (role) => ({ agent: role, verdict: 'against', reasons: [reason], conditions: null, confidence: 1 });
    return {
      decision: DECISION.DENIED,
      votesFor: 0,
      votesAgainst: 3,
      threshold,
      purchase,
      arguments: { advocate: arg('advocate'), auditor: arg('auditor'), witness: arg('witness') },
      dissentMap: { summary: 'The purchase has no auditable amount.', reasons: [reason] },
      voidedReason: 'G1_amount_positive',
    };
  }

  const votesFor = [advocate, auditor, witness].filter(a => a && a.verdict === 'for').length;
  const votesAgainst = [advocate, auditor, witness].filter(a => a && a.verdict === 'against').length;
  const hasCondition = witness?.conditions != null && String(witness.conditions).trim() !== '';

  // Decision order (fixed 2026-10-24). First match wins.
  //
  // The check used to run hasCondition FIRST, so
  //   advocate=against / auditor=against / witness=neutral-with-condition
  // came back CONDITIONAL and CREATED A PAYPAL ORDER despite two objectors. That was
  // measured, not theorised. Unanimous rejection (3 against) also came back
  // CONDITIONAL. The order below is "refusal first, agreement second", with one
  // deliberate exception: a 1-vs-1 tie may be resolved by a stated condition.
  //
  //   1) 2 or more against                      -> DENIED       no order
  //   2) threshold or more for, with condition  -> CONDITIONAL  order raised
  //      threshold or more for, no condition    -> APPROVED     order raised
  //   3) 1 for, 1 against, Witness conditions   -> CONDITIONAL  order raised
  //   4) anything else                          -> DISSENT      no order
  //
  // Why (3) exists: "the Advocate pushes, the Auditor blocks, the Witness bridges
  // with a condition" is the behaviour this product exists to demonstrate. Sending
  // that to DISSENT would delete the product. Because (1) runs first, this path can
  // never release money past two objectors.
  let decision;
  if (votesAgainst >= 2) {
    decision = DECISION.DENIED;
  } else if (votesFor >= threshold) {
    decision = hasCondition ? DECISION.CONDITIONAL : DECISION.APPROVED;
  } else if (votesFor === 1 && votesAgainst === 1 && hasCondition) {
    decision = DECISION.CONDITIONAL;
  } else {
    decision = DECISION.DISSENT;
  }

  return {
    decision,
    votesFor,
    votesAgainst,
    threshold,
    purchase,
    arguments: args,
    // Carry the WHY alongside the decision: show the human the shape of the
    // disagreement, not just the outcome.
    dissentMap: decision === DECISION.DISSENT || decision === DECISION.DENIED
      ? buildDissentMap(args)
      : null,
  };
}

/**
 * The dissent map — who disagreed, on what, and how far they would not move.
 */
export function buildDissentMap(args) {
  const map = [];
  for (const key of ['advocate', 'auditor', 'witness']) {
    const a = args[key];
    if (!a) continue;
    map.push({
      agent: a.agent,
      title: a.title,
      verdict: a.verdict,
      blockingReasons: a.reasons?.filter(r => /over budget|exceed|against|risk|recent/i.test(r)) ?? [],
      allReasons: a.reasons ?? [],
      conditions: a.conditions ?? null,
    });
  }
  return {
    summary: map.map(m =>
      `${m.title} → ${m.verdict}${m.conditions ? ' (conditional)' : ''}`
    ).join(' | '),
    entries: map,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmt(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export { fmt };
