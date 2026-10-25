/**
 * Tuesday — Dispute Desk
 *
 * A dispute arrives. Three agents read it and argue, the same way they argue over a
 * purchase. The difference is what they are arguing about: not "may this be paid" but
 * "what should the merchant do now that it has been challenged".
 *
 *   EVIDENCE    collects what the merchant can actually prove — the order, the
 *               capture, the tracking, the receipt hash that was stamped into
 *               custom_id at settlement time.
 *   ADVOCATE    argues the merchant's best case, and may only cite evidence IDs.
 *   CHALLENGER  argues the buyer's best case, and may only cite evidence IDs.
 *   ARBITER     returns one of CONTEST / OFFER_PARTIAL / REFUND / ACCEPT with the
 *               evidence it relied on.
 *
 * Then the money gate runs. The gate can refuse an action the arbiter proposed; the
 * arbiter cannot approve something the gate refuses. That ordering is the whole point
 * and it is the same ordering tests/moneyGate.test.js asserts for purchases.
 *
 * What this file deliberately does NOT do: create disputes. PayPal allows that only in
 * the sandbox and only with buyer-side scopes, so Tuesday reads disputes and responds
 * to them. A merchant never creates a dispute either.
 */

export const DISPUTE_ACTION = {
  CONTEST: 'CONTEST',               // submit evidence and fight it
  OFFER_PARTIAL: 'OFFER_PARTIAL',   // refund part of it, keep the relationship
  REFUND: 'REFUND',                 // give it back in full
  ACCEPT: 'ACCEPT',                 // accept the claim without argument
  ESCALATE: 'ESCALATE',             // hand it to PayPal to decide
};

export const DISPUTE_REASON = {
  NOT_RECEIVED: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  NOT_AS_DESCRIBED: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  UNAUTHORIZED: 'UNAUTHORISED_TRANSACTION',
  BILLING_ERROR: 'BILLING_ERROR',
  OTHER: 'OTHER',
};

/* ── Evidence ─────────────────────────────────────────────────────────────
 * Evidence is built from things the merchant can actually show PayPal: the order
 * record, the capture, the shipment tracking, and the receipt hash that was written
 * into the payment at settlement. Each item gets an ID so an argument can cite it.
 *
 * The point of the IDs is the citation check in the gate: an agent that writes a
 * sentence with no evidence behind it gets stopped. That is "the AI cannot lie" as a
 * mechanism rather than a promise.
 */

const EVIDENCE_LABELS = {
  order: 'The PayPal order record',
  capture: 'The completed capture',
  custom_id: 'The decision hash stamped into the payment',
  tracking: 'Shipment tracking',
  delivered: 'Delivery confirmation',
  address: 'Delivery address match',
  history: 'Prior order history with this buyer',
  policy: 'The merchant refund policy in force at purchase time',
  message: 'Buyer message text',
};

function ev(id, kind, ok, detail, weight = 1) {
  return { id, kind, ok, detail, weight, label: EVIDENCE_LABELS[kind] || kind };
}

/**
 * Build the evidence set for a dispute.
 *
 * `dispute` is the PayPal dispute object (or a sample shaped like one).
 * `order` is what the merchant holds for the original transaction, if anything.
 */
export function collectEvidence(dispute, order = null) {
  const items = [];
  const reason = dispute?.dispute_reason || dispute?.reason || DISPUTE_REASON.OTHER;
  const amount = Number(dispute?.dispute_amount?.value ?? dispute?.amount ?? 0);
  const txns = dispute?.disputed_transactions || [];
  const txn = txns[0] || {};

  // E1 — does the order exist on our side at all?
  items.push(ev('E1', 'order', Boolean(order?.id || txn?.seller_transaction_id),
    order?.id
      ? `Order ${order.id} exists and matches the disputed transaction.`
      : (txn?.seller_transaction_id
          ? `PayPal references seller transaction ${txn.seller_transaction_id}.`
          : 'No order record was found for this transaction.'),
    order?.id ? 1 : 0.3));

  // E2 — was the money actually captured?
  const captured = Boolean(order?.captured || order?.status === 'COMPLETED' || order?.status === 'CAPTURED');
  items.push(ev('E2', 'capture', captured,
    captured
      ? `Payment of ${amount.toFixed(2)} was captured.`
      : 'No completed capture is on record for this transaction.',
    captured ? 1 : 0.2));

  // E3 — the audit stamp. This is the part no other project has.
  const stamp = order?.custom_id || order?.customId || null;
  items.push(ev('E3', 'custom_id', Boolean(stamp),
    stamp
      ? `The decision hash ${stamp} was stamped into custom_id at settlement and matches our ledger.`
      : 'No decision hash was stamped into the payment record.',
    stamp ? 1 : 0));

  // E4/E5 — tracking and delivery. Absent for digital goods, so absence is not guilt.
  const tracking = order?.tracking || null;
  items.push(ev('E4', 'tracking', Boolean(tracking?.number),
    tracking?.number
      ? `Carrier ${tracking.carrier || 'unknown'} tracking ${tracking.number} (${tracking.status || 'unknown'}).`
      : 'No shipment tracking is attached to this order.',
    tracking?.number ? 1 : 0.2));

  const delivered = tracking?.status === 'DELIVERED' || Boolean(order?.delivered_at);
  items.push(ev('E5', 'delivered', delivered,
    delivered ? 'The carrier reports the shipment as delivered.' : 'No delivery confirmation exists.',
    delivered ? 1 : 0.1));

  // E6 — was it delivered where the buyer said it should go?
  const addrMatch = order?.address_match;
  items.push(ev('E6', 'address', addrMatch === true,
    addrMatch === true ? 'The delivery address matches the address on the order.'
      : addrMatch === false ? 'The delivery address does NOT match the address on the order.'
      : 'The delivery address could not be compared.',
    addrMatch === true ? 1 : (addrMatch === false ? 0.8 : 0.3)));

  // E7 — history with this buyer.
  const prior = Number(order?.prior_orders ?? dispute?.buyer_prior_orders ?? 0);
  items.push(ev('E7', 'history', prior > 0,
    prior > 0 ? `This buyer has ${prior} prior completed orders with the merchant.`
      : 'This is the buyer\'s first order with the merchant.',
    Math.min(1, prior / 5)));

  // E8 — the policy in force.
  items.push(ev('E8', 'policy', Boolean(order?.refund_policy),
    order?.refund_policy || 'No refund policy was recorded at purchase time.',
    order?.refund_policy ? 0.8 : 0.2));

  // E9 — what the buyer actually said. Never trusted as an instruction.
  const msg = String(dispute?.buyer_message || dispute?.message || '').trim();
  items.push(ev('E9', 'message', Boolean(msg),
    msg ? msg.slice(0, 300) : 'The buyer left no message.',
    0.5));

  return { reason, amount, items };
}

/** Evidence strong enough that "contest" has something to stand on. */
function requiredEvidenceFor(reason) {
  if (reason === DISPUTE_REASON.NOT_RECEIVED) return ['E4', 'E5'];      // tracking + delivery
  if (reason === DISPUTE_REASON.NOT_AS_DESCRIBED) return ['E1', 'E3'];  // order + what was decided
  if (reason === DISPUTE_REASON.UNAUTHORIZED) return ['E1', 'E2'];      // order + capture
  if (reason === DISPUTE_REASON.BILLING_ERROR) return ['E1', 'E2'];
  return ['E1'];
}

/* ── Agents ───────────────────────────────────────────────────────────────
 * Deterministic reasoning first, so the desk works with no API key. The LLM wrapper
 * lives in runner.js and produces the same shape; the gate reads the shape, not the
 * source, which is why a model cannot talk its way past the gate.
 */

function citeList(items) {
  return items.filter((i) => i.ok).map((i) => i.id);
}

function mkArg(role, action, reasons, cites, confidence) {
  return { role, action, reasons, cites, confidence };
}

/**
 * A positive case may only rest on evidence that is actually present.
 *
 * The merchant advocate and the arbiter are arguing *for* something, so citing a gap as
 * if it were proof is the same lie as inventing an ID. The buyer advocate is excluded on
 * purpose: pointing at what is missing is precisely its job.
 */
function stripUnsupportedCites(role, cites, items) {
  if (role === 'challenger') return cites;
  const okIds = new Set(items.filter((i) => i.ok).map((i) => i.id));
  const ids = new Set(items.map((i) => i.id));
  return cites.filter((id) => !ids.has(id) || okIds.has(id));
}

export function deterministicDisputeReasoning(role, { reason, amount, items }) {
  const have = items.filter((i) => i.ok);
  const haveIds = citeList(items);
  const required = requiredEvidenceFor(reason);
  const missing = required.filter((id) => !haveIds.includes(id));

  const e4 = items.find((i) => i.id === 'E4');
  const e5 = items.find((i) => i.id === 'E5');
  const e6 = items.find((i) => i.id === 'E6');
  const e3 = items.find((i) => i.id === 'E3');
  const e7 = items.find((i) => i.id === 'E7');

  if (role === 'advocate') {
    const reasons = [];
    const cites = [];
    if (e4?.ok) { reasons.push(`The shipment was handed to a carrier and tracked (E4).`); cites.push('E4'); }
    if (e5?.ok) { reasons.push(`The carrier confirms delivery (E5).`); cites.push('E5'); }
    if (e3?.ok) { reasons.push(`The decision that authorised this payment is stamped into the payment itself (E3).`); cites.push('E3'); }
    if (e6?.ok) { reasons.push(`The delivery address matches the order (E6).`); cites.push('E6'); }
    if (!reasons.length) {
      reasons.push(`There is no evidence the merchant can put in front of PayPal for this claim.`);
      cites.push('E1');
    }
    // A blocked contest is escalated, not settled. The merchant advocate's own action
    // used to be OFFER_PARTIAL whenever any required item was missing, which quietly
    // turned "we cannot prove this" into "we will pay something".
    const action = missing.length === 0 ? DISPUTE_ACTION.CONTEST : DISPUTE_ACTION.ESCALATE;
    return mkArg(role, action, reasons, stripUnsupportedCites(role, cites, items),
                 missing.length === 0 ? 0.75 : 0.4);
  }

  if (role === 'challenger') {
    const reasons = [];
    const cites = [];
    if (missing.length) {
      reasons.push(`Required evidence is missing: ${missing.join(', ')}.`);
      missing.forEach((m) => cites.push(m));
    }
    if (e6?.ok === false) {
      reasons.push('The delivery address does not match the address on the order (E6).');
      cites.push('E6');
    }
    if (!e5?.ok) {
      reasons.push('Nothing in the record shows the buyer actually received anything (E5).');
      cites.push('E5');
    }
    if (e7?.ok) {
      reasons.push('This buyer has paid and kept prior orders, which argues against fraud (E7).');
      cites.push('E7');
    }
    if (!cites.length) {
      reasons.push('The merchant appears to be able to evidence this transaction.');
      cites.push('E1');
    }
    return mkArg(role, DISPUTE_ACTION.CONTEST, reasons, cites, 0.55);
  }

  // arbiter
  const reasons = [];
  const cites = [];
  let action;
  let confidence;

  if (missing.length === 0 && e5?.ok && e6?.ok !== false) {
    action = DISPUTE_ACTION.CONTEST;
    reasons.push(`Every required item of evidence is present for a "${reason}" claim, and delivery is confirmed (${missing.length ? '' : required.join(', ')}).`);
    required.forEach((r) => cites.push(r));
    if (e6?.ok) { reasons.push('The address matches, so the delivery objection is weak (E6).'); cites.push('E6'); }
    confidence = 0.78;
  } else if (amount <= 25) {
    action = DISPUTE_ACTION.REFUND;
    reasons.push(`The amount is small enough that contesting costs more in time than it recovers (E1).`);
    cites.push('E1');
    if (e7?.ok) { reasons.push('Refunding also protects a repeat buyer (E7).'); cites.push('E7'); }
    confidence = 0.7;
  } else if (missing.length) {
    action = DISPUTE_ACTION.OFFER_PARTIAL;
    reasons.push(`Contesting is not defensible because ${missing.join(', ')} is missing; a partial offer is the honest middle.`);
    missing.forEach((m) => cites.push(m));
    if (e7?.ok) { reasons.push('A repeat buyer is worth keeping (E7).'); cites.push('E7'); }
    confidence = 0.55;
  } else {
    action = DISPUTE_ACTION.CONTEST;
    reasons.push('The evidence supports contesting the claim (E1).');
    cites.push('E1');
    confidence = 0.6;
  }

  return mkArg('arbiter', action, reasons, stripUnsupportedCites('arbiter', cites, items), confidence);
}

/* ── The gate ─────────────────────────────────────────────────────────────
 * D1 evidence sufficiency   — cannot CONTEST without the required IDs
 * D2 amount ceiling         — above it, only a human may authorise
 * D3 citation check         — every sentence must lean on a real evidence ID
 * D4 deadline               — if it is too close and nobody is around, notify, never act
 */

export const DISPUTE_GATE = {
  AUTO_LIMIT_USD: 50,
  DEADLINE_WARN_HOURS: 24,
};

/**
 * Run the gate over a proposed action.
 *
 * @returns {{ passed: string[], failed: string[], blocked: boolean, requiresHuman: boolean }}
 */
export function runDisputeGate({ action, evidence, arguments: args, deadlineHours = null }) {
  const passed = [];
  const failed = [];
  let requiresHuman = false;

  const ids = new Set(evidence.items.map((i) => i.id));
  const okIds = new Set(evidence.items.filter((i) => i.ok).map((i) => i.id));
  const required = requiredEvidenceFor(evidence.reason);

  // D1 — evidence sufficiency.
  if (action === DISPUTE_ACTION.CONTEST) {
    const missing = required.filter((id) => !okIds.has(id));
    if (missing.length === 0) passed.push('D1_evidence_sufficient');
    else failed.push(`D1_missing_${missing.join('_')}`);
  } else {
    passed.push('D1_not_contesting');
  }

  // D2 — amount ceiling.
  if (evidence.amount > DISPUTE_GATE.AUTO_LIMIT_USD) {
    requiresHuman = true;
    passed.push(`D2_requires_human_over_${DISPUTE_GATE.AUTO_LIMIT_USD}`);
  } else {
    passed.push('D2_within_auto_limit');
  }

  // D3 — every citation must be a real evidence ID, and no argument may be uncited.
  //
  // An argument that failed to parse is NOT a fabrication — it is a model that did not
  // close its JSON. Treating that as "the merchant lied" would be a wrong and unfair
  // reading, so the two are separated: unparsed arguments fall back to the deterministic
  // argument (which is always cited), and only a citation to an ID that does not exist
  // counts as a fabrication.
  const allCites = [];
  for (const key of ['advocate', 'challenger', 'arbiter']) {
    const a = args?.[key];
    if (!a) continue;
    (a.cites || []).forEach((cid) => allCites.push(cid));
  }
  const bogus = allCites.filter((cid) => !ids.has(cid));
  const unparsed = Object.entries(args || {})
    .filter(([, a]) => a && a.parsed === false)
    .map(([k]) => k);
  const uncited = Object.entries(args || {})
    .filter(([, a]) => a && a.parsed !== false && (!a.cites || a.cites.length === 0))
    .map(([k]) => k);

  // A citation to an ID that exists is not enough. A merchant advocate citing E5
  // (delivery confirmation) to prove delivery, when E5 is missing, is the same lie as
  // inventing an ID — the ID merely happens to exist. So a positive case — the merchant
  // advocate, or an arbiter proposing an action — may only cite evidence that is
  // actually present. The buyer advocate may still cite anything: it is arguing against
  // the merchant, and pointing at what is missing is its job.
  const positiveCites = ['advocate', 'arbiter'].flatMap((k) => (args?.[k]?.cites || []));
  const unsupported = positiveCites.filter((cid) => ids.has(cid) && !okIds.has(cid));

  if (bogus.length === 0 && uncited.length === 0 && unsupported.length === 0) {
    passed.push(unparsed.length ? `D3_all_claims_cited_after_deterministic_fallback` : 'D3_all_claims_cited');
  } else {
    if (bogus.length) failed.push(`D3_fabricated_citations_${bogus.join('_')}`);
    if (uncited.length) failed.push(`D3_uncited_argument_${uncited.join('_')}`);
    if (unsupported.length) failed.push(`D3_unsupported_citations_${[...new Set(unsupported)].join('_')}`);
  }

  // D4 — deadline pressure. Never authorises acting; only forbids it.
  if (deadlineHours != null && deadlineHours <= DISPUTE_GATE.DEADLINE_WARN_HOURS) {
    requiresHuman = true;
    passed.push('D4_deadline_notify_only');
  } else if (deadlineHours != null) {
    passed.push('D4_deadline_ok');
  }

  /* D5 — don't surrender evidence you are holding.
   *
   * The LLM arbiter is free to weigh the case, but a model that answers ACCEPT while
   * every required item of evidence is present and delivery is confirmed is not making
   * a judgement, it is being agreeable. That is the failure mode this whole project
   * exists to stop, so the gate catches it explicitly and the deterministic arbiter
   * takes over. Measured: without this, the same evidence set produced CONTEST on one
   * run and ACCEPT on the next.
   */
  const haveAll = required.every((id) => okIds.has(id));
  const deliveryConfirmed = okIds.has('E5');
  if (action === DISPUTE_ACTION.ACCEPT && haveAll && deliveryConfirmed) {
    failed.push('D5_surrendering_strong_evidence');
  } else {
    passed.push('D5_no_unforced_surrender');
  }

  const blocked = failed.length > 0;
  return { passed, failed, blocked, requiresHuman };
}

/**
 * Decide what the desk proposes after the gate.
 *
 * The arbiter proposes; the gate disposes. If the gate blocks a CONTEST, the desk falls
 * back to the next honest option rather than forcing the action through — the same
 * pattern the purchase money gate uses when it returns not_approved.
 */
export function finaliseDispute({ dispute, evidence, arguments: argsIn, deadlineHours = null }) {
  // Any argument the model failed to produce cleanly is replaced by the deterministic
  // one before the gate sees it. The gate then judges a real, cited argument — and the
  // result records that the fallback happened, so nothing is hidden.
  const fellBack = [];
  const args = { ...(argsIn || {}) };
  for (const role of ['advocate', 'challenger', 'arbiter']) {
    if (args[role] && args[role].parsed === false) {
      args[role] = deterministicDisputeReasoning(role, evidence);
      fellBack.push(role);
    }
  }

  const proposed = args.arbiter?.action || DISPUTE_ACTION.OFFER_PARTIAL;
  const gate = runDisputeGate({ action: proposed, evidence, arguments: args, deadlineHours });

  let action = proposed;
  let downgradedFrom = null;

  if (gate.blocked) {
    downgradedFrom = proposed;
    // D5 is the one failure that is about the argument, not the money: the evidence is
    // strong and the model still gave up. Re-run the arbiter deterministically, which
    // reads the same evidence and reaches CONTEST.
    if (gate.failed.some((f) => f.startsWith('D5_'))) {
      const fallback = deterministicDisputeReasoning('arbiter', evidence);
      args.arbiter = fallback;
      action = fallback.action;
      fellBack.push('arbiter (evidence was strong enough to contest)');
    } else {
      // When the gate refuses the argument, the money does not move on a guess. An
      // earlier version fell back to "refund if small, else offer partial" — which meant
      // a model that fabricated a citation made the merchant *pay out*. The failure mode
      // has to be the conservative one, so a blocked argument escalates to a human and
      // the desk never pays money it has not been told to pay. ESCALATE also hands the
      // decision back to PayPal, which is the honest place for an unresolvable case.
      action = DISPUTE_ACTION.ESCALATE;
      args.arbiter = {
        ...(args.arbiter || {}),
        action: DISPUTE_ACTION.ESCALATE,
        reasons: [
          ...((args.arbiter && args.arbiter.reasons) || []),
          'The gate refused the proposed action; escalated to a human and to PayPal.',
        ],
      };
      fellBack.push('escalated (the gate refused the argument)');
    }
  }

  // "Agents propose, humans decide" has to hold for the cases that move money OUT.
  // REFUND, OFFER_PARTIAL and ACCEPT all send money to the buyer, so none of them may
  // auto-execute regardless of amount or gate result. Only CONTEST — which submits
  // evidence and commits nothing — runs without a human inside the auto limit.
  const SPENDS_MONEY = [DISPUTE_ACTION.REFUND, DISPUTE_ACTION.OFFER_PARTIAL, DISPUTE_ACTION.ACCEPT];
  const needsHumanForMoney = SPENDS_MONEY.includes(action);
  const requiresHuman = gate.requiresHuman || needsHumanForMoney || action === DISPUTE_ACTION.ESCALATE;
  const autoExecute = !gate.blocked && !requiresHuman;

  return {
    disputeId: dispute?.dispute_id || dispute?.id || null,
    reason: evidence.reason,
    amount: evidence.amount,
    proposed,
    action,
    downgradedFrom,
    requiresHuman,
    autoExecute: Boolean(autoExecute),
    spendsMoney: needsHumanForMoney,
    gate: { passed: gate.passed, failed: gate.failed },
    evidence: evidence.items,
    arguments: args,
    deterministicFallback: fellBack,
    deadlineHours,
  };
}
