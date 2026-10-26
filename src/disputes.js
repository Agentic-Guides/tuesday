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

function ev(id, kind, ok, detail, weight = 1, extra = null) {
  return { id, kind, ok, detail, weight, label: EVIDENCE_LABELS[kind] || kind, ...(extra || {}) };
}

/**
 * Build the evidence set for a dispute.
 *
 * `dispute` is the PayPal dispute object (or a sample shaped like one).
 * `order` is what the merchant holds for the original transaction, if anything.
 */
export const DISPUTE_GATE = {
  AUTO_LIMIT_USD: 50,
  DEADLINE_WARN_HOURS: 24,
  // The ceiling is expressed in USD, but disputes arrive in whatever the merchant sells
  // in. Comparing a JPY amount against a USD number is not a rounding error — ¥8,000 is
  // about $50, so a limit applied to the raw number would wave through roughly 150x the
  // intended exposure. These are deliberately coarse, fixed conversion rates rather than
  // a live feed: a stale rate must never move money, and a gate that cannot be asked to
  // fetch anything at decision time is a gate that cannot fail open.
  FX_TO_USD: {
    USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.65, JPY: 0.0064,
    KRW: 0.00072, CNY: 0.14, HKD: 0.128, SGD: 0.74, TWD: 0.031,
    SEK: 0.095, NOK: 0.092, DKK: 0.145, CHF: 1.12, MXN: 0.05,
    BRL: 0.18, INR: 0.012, NZD: 0.60, PHP: 0.017, THB: 0.028,
  },
};

/** Convert a dispute amount to USD for the ceiling comparison. Unknown currency = 0 trust. */
export function toUsd(amount, currency) {
  const code = String(currency || 'USD').toUpperCase();
  const rate = DISPUTE_GATE.FX_TO_USD[code];
  // An unknown currency is treated as if the amount were enormous, so it needs a human.
  if (rate == null) return { usd: Number.POSITIVE_INFINITY, known: false, code };
  // An amount that is not a number is not "small". Measured: a dispute whose amount
  // arrives as { value, currency_code } under the wrong key yields NaN, and NaN > 50
  // is false, so the ceiling check passed and the gate returned autoExecute: true with
  // the reason "D2_within_auto_limit_USD_NaNusd". A missing amount is an unknown
  // amount, and an unknown amount is a human's call — the same rule as an unknown
  // currency.
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    return { usd: Number.POSITIVE_INFINITY, known: false, code: `${code}_INVALID_AMOUNT` };
  }
  return { usd: n * rate, known: true, code };
}

export function collectEvidence(dispute, order = null) {
  const items = [];
  const reason = dispute?.dispute_reason || dispute?.reason || DISPUTE_REASON.OTHER;
  // PayPal sends the disputed sum as `dispute_amount: { value, currency_code }`. Any
  // other shape — a bare number, or `amount: { value }` written by a caller who guessed
  // the field name — used to collapse to NaN through Number({...}). Read every shape
  // that carries an amount instead of silently losing it, and let toUsd() hold the line
  // when nothing usable is present.
  const moneySrc = dispute?.dispute_amount || dispute?.amount || null;
  const rawAmount = (moneySrc && typeof moneySrc === 'object')
    ? (moneySrc.value ?? moneySrc.amount ?? null)
    : moneySrc;
  const amount = rawAmount == null ? NaN : Number(rawAmount);
  const currency = String(
    (moneySrc && typeof moneySrc === 'object' ? moneySrc.currency_code : null)
    || dispute?.currency_code
    || dispute?.currency
    || 'USD'
  ).toUpperCase();
  const fx = toUsd(amount, currency);
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

  // E3 — the audit stamp. This is the part no other project has, so it has to be true.
  //
  // The stamp existing is not the claim. The claim is that it agrees with our ledger, and
  // an earlier version asserted exactly that while comparing nothing. The comparison runs
  // here: `ledgerHash` is the hash of the decision we recorded, and the stamp in the
  // payment has to contain it. `triad1:` stamps carry the 16-character form; a `triad2:`
  // stamp would carry the full SHA-256, so the check is a prefix match on the hash that
  // the ledger holds.
  const stamp = order?.custom_id || order?.customId || null;
  const ledgerHash = order?.ledger_hash || order?.ledgerHash || null;
  const stampHash = stamp && stamp.includes(':') ? stamp.split(':').slice(1).join(':') : stamp;
  const stampVerified = Boolean(
    stamp && ledgerHash && stampHash && String(stampHash).toLowerCase().startsWith(String(ledgerHash).toLowerCase())
  );
  const stampUnchecked = Boolean(stamp && !ledgerHash);
  items.push(ev('E3', 'custom_id', stampVerified,
    stampVerified
      ? `The decision hash ${stamp} matches the ledger entry (${ledgerHash}).`
      : (stampUnchecked
          ? `A stamp ${stamp} is present, but there is no ledger entry to compare it against.`
          : (stamp
              ? `The stamp ${stamp} does NOT match the ledger entry (${ledgerHash || 'none'}).`
              : 'No decision hash was stamped into the payment record.')),
    stampVerified ? 1 : (stampUnchecked ? 0.4 : 0),
    { verified: stampVerified, unchecked: stampUnchecked }));

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
  //
  // Three states, not two. `address_match` is `true`, `false`, or absent, and absent is
  // not the same as false: an order whose address cannot be compared is unknown, and
  // treating unknown as a mismatch invented a failure the evidence did not contain. The
  // buyer advocate used to say "does NOT match" about an order nobody had compared.
  const addrMatch = order?.address_match;
  const addrKnown = addrMatch === true || addrMatch === false;
  // `ok` here means "compared, and it does not contradict the merchant", which is what
  // the required-evidence check needs. `known` stays available to the advocates so they
  // can say "could not compare" rather than "does not match".
  items.push(ev('E6', 'address', addrKnown && addrMatch !== false,
    addrMatch === true
      ? 'The delivery address matches the address on the order.'
      : (addrMatch === false
          ? 'The delivery address does NOT match the address on the order.'
          : 'The delivery address could not be compared with the order.'),
    addrMatch === true ? 1 : (addrMatch === false ? 0 : 0.4),
    // `match` must only mean "compared and different". When the address was never
    // compared, match is null so a caller cannot mistake unknown for a mismatch.
    { known: addrKnown, match: addrKnown ? addrMatch === true : null }));

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

  return { reason, amount, currency, fx, items };
}

/** Evidence strong enough that "contest" has something to stand on. */

function requiredEvidenceFor(reason) {
  if (reason === DISPUTE_REASON.NOT_RECEIVED) return ['E4', 'E5'];      // tracking + delivery
  // NOT_AS_DESCRIBED used to require E3 (the decision hash). That was wrong: the hash proves
  // a decision was made and recorded, not that what arrived matched what was described. Making
  // it compulsory implied the stamp was evidence about the goods. It stays available as
  // corroboration — an argument may cite it — but sufficiency is judged on the order itself.
  if (reason === DISPUTE_REASON.NOT_AS_DESCRIBED) return ['E1'];  // the order is what was described

  // An "I did not authorise this" claim is about the buyer's identity, and the order and
  // capture say nothing about it: a dispute only exists against a settled transaction, so
  // E1 and E2 are essentially always present. Requiring them alone let almost every
  // unauthorised-payment claim clear D1 without the desk ever examining whether the person
  // who paid was the person who owns the account. E6 (the delivery address compared with
  // the order) and E7 (prior settled orders from this buyer) are the cheap evidence of
  // identity that a merchant actually holds, so they are now required. Both must be
  // *present*, not merely cited — D1 tests `ok`, and E6 is three-state, so an address
  // that could not be compared counts as absent rather than as a mismatch.
  if (reason === DISPUTE_REASON.UNAUTHORIZED) return ['E1', 'E2', 'E6', 'E7'];

  if (reason === DISPUTE_REASON.BILLING_ERROR) return ['E1', 'E2', 'E8'];  // + the policy in force
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
    if (e6?.match === false) {
      reasons.push('The delivery address does not match the address on the order (E6).');
      cites.push('E6');
    } else if (e6 && e6.known === false) {
      reasons.push('The delivery address cannot be compared with the order (E6).');
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
    // The buyer advocate does not want the merchant to CONTEST — that is the opposite of
    // what the buyer is asking for. Its job is to argue for the claim, so its action is
    // the one the buyer would choose. It is advisory only: the arbiter decides.
    return mkArg(role, DISPUTE_ACTION.REFUND, reasons, cites, 0.55);
  }

  // arbiter
  const reasons = [];
  const cites = [];
  let action;
  let confidence;

  // E6 unknown is not E6 failed: an order nobody compared must not block a contest.
  if (missing.length === 0 && e5?.ok && e6?.match !== false) {
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
  //
  // This used to be checked only when the proposed action was CONTEST, on the theory that
  // the other actions need no proof of anything. That was wrong in a way that made the
  // rule unobservable: with the required evidence missing, the deterministic arbiter
  // proposes ESCALATE (never CONTEST), so D1 was skipped precisely in the case it exists
  // to catch. A missing-evidence condition is a fact about the dispute, not about the
  // proposed action, so it is now reported regardless of what was proposed. What the
  // action changes is only whether the missing evidence *blocks* (a contest) or merely
  // *requires a human* (anything else).
  const missing = required.filter((id) => !okIds.has(id));
  if (missing.length === 0) {
    passed.push('D1_evidence_sufficient');
  } else if (action === DISPUTE_ACTION.CONTEST) {
    failed.push(`D1_missing_${missing.join('_')}`);
  } else {
    requiresHuman = true;
    passed.push(`D1_missing_${missing.join('_')}_requires_human`);
  }

  // D2 — amount ceiling, compared in USD.
  //
  // The limit is $50, but a JPY dispute arrives as "8000". Comparing the raw number
  // would put 8,000 yen (~$51) on the wrong side of the line by a factor of about 150,
  // and an unknown currency would be silently read as dollars. Both now go to a human.
  const fx = evidence.fx || toUsd(evidence.amount, evidence.currency);
  if (!fx.known) {
    requiresHuman = true;
    passed.push(`D2_unknown_currency_${fx.code}_requires_human`);
  } else if (fx.usd > DISPUTE_GATE.AUTO_LIMIT_USD) {
    requiresHuman = true;
    passed.push(`D2_requires_human_over_${DISPUTE_GATE.AUTO_LIMIT_USD}_usd`);
  } else {
    passed.push(`D2_within_auto_limit_${fx.code}_${Math.round(fx.usd)}usd`);
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
    currency: evidence.currency || 'USD',
    amountUsd: evidence.fx ? Number(evidence.fx.usd.toFixed(2)) : null,
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
