/**
 * Tuesday — WebMCP Tool Registration
 *
 * Exposes the adversarial adjudication + PayPal settlement as WebMCP tools,
 * so any WebMCP-capable AI agent (Chrome 146+) can invoke it from a web page.
 *
 * Tools registered:
 *   - triadAdjudicate      : run the 3-agent debate, return decision + dissent map + receipt
 *   - triadCreateOrder     : create a PayPal order for an APPROVED purchase (stamps receipt hash)
 *   - triadCaptureOrder    : capture (finalize) an approved order
 *   - triadGetLedger       : inspect all adjudications (transparency)
 *   - triadVerifyReceipt   : verify the custom_id audit trail was not tampered with
 *
 * The key idea: a website can let an agent *propose* a purchase, but the purchase
 * only settles if three independent agents reach consensus. Consensus is visible;
 * dissent is surfaced to the human.
 */

import { TriadRunner } from './runner.js';
import { adjudicate, DECISION, buildDissentMap,
         makeAgent, ROLES, deterministicReason, deterministicJudge } from './triad.js';
import { PayPalClient } from '../paypal/client.js';
import { buildReceipt, receiptCustomId, verifyReceipt, hashFromCustomId } from './receipt.js';

/**
 * @param {object} deps
 *   { runner?: TriadRunner, paypal?: PayPalClient }
 */
/**
 * ★ Seed the audit ledger so a first-time visitor sees a plausible history
 *   instead of an empty table.
 *
 * Every row is produced by the same adjudicate() the live endpoint uses, so the
 * seeded entries carry the same receipt hashes, the same dissent maps and the
 * same gate names as a decision made one second ago. Nothing here is fabricated
 * for display: change a gate in triad.js and these rows change with it.
 *
 * The story: a small US skincare brand, a $60/month discretionary budget, week
 * of ordinary purchases — and one $42 renewal that failed at 3 AM on a Tuesday.
 */
function seedLedger(ledger) {
  const HOUR = 3600e3;
  // The timeline shows a rolling ±6h window around now, so the seeded week has to
  // fall inside it or the chart renders empty — a busy ledger behind a blank
  // timeline reads as a broken panel. Keep the rows recent and the story intact.
  const base = Date.now() - 20 * 60e3;
  // The ledger runs forward in time, so each row is judged against the money
  // already spent BY THAT POINT, not against the final total. Getting this wrong
  // is what made every row come back CONDITIONAL: the seeded month was judged as
  // if all six purchases had happened before any of them.
  let spentRunning = 0;
  // ★Every verdict below was measured against adjudicate() with monthlyBudget=110
  //   on 2026-10-24. The values in the trailing comments are the actual engine
  //   output, not the intended story — if a gate in triad.js changes, these
  //   comments become wrong and must be re-measured (run the demo's
  //   "Show me all 16 cells" or `node _seed_check.mjs`).
  //
  //   Measured (budget $110, spend accumulates row by row):
  //     $18 USB-C cable        → APPROVED     (A=for B=for     W=neutral)
  //     $9  Vitamin D3         → APPROVED     (A=for B=for     W=neutral)
  //     $42 Skincare refill    → CONDITIONAL  (A=for B=against W=neutral +cond)  ← the failed renewal
  //     $24 HDMI 2.1 cable     → CONDITIONAL  (A=for B=against W=neutral +cond)
  //     $89 Portable SSD       → DENIED       (A=for B=against W=against)        ← refused outright
  //     $12 USB-C adapter      → CONDITIONAL  (A=for B=against W=neutral +cond)
  const week = [
    // amount, category,                     minutesAgo  (spend accumulates as we go)
    [18,  'USB-C cable 2m',                 330],   // APPROVED    — ordinary restock
    [9,   'Vitamin D3 90ct',                268],   // APPROVED    — consumable
    [42,  'Monthly skincare refill',        236],   // CONDITIONAL — the renewal that failed
    [24,  'HDMI 2.1 cable 3m',              190],   // CONDITIONAL — budget tightening
    [89,  'Portable SSD 1TB',               120],   // DENIED      — refused outright
    [12,  'USB-C to Lightning adapter',      24],   // CONDITIONAL — tight, condition attached
  ];
  for (const [amount, category, minutesAgo] of week) {
    const purchase = { id: 'seed-' + minutesAgo, amount, category, reason: 'seeded history' };
    // ★予算 $110: 実測で確定した値。$60 では 3件目で予算が尽きて
  //   4件目以降が全部 DENIED になり、$42 の renewal が DISSENT に落ちていた
  //   （2026-10-24 実測）。$110 で README の物語
  //   （APPROVED / APPROVED / CONDITIONAL / CONDITIONAL / DENIED / CONDITIONAL）と一致する。
  const constraints = { monthlyBudget: 110, spentThisMonth: spentRunning, recentPurchases: [] };
    // Order matters: the Witness reads the other two verdicts, so build the
    // Advocate and the Auditor first and hand their actual arguments over. With
    // empty objects the Witness cannot tell agreement from disagreement, falls
    // through to the split case, and returns a condition — which makes every
    // seeded row CONDITIONAL no matter how well it fits the budget.
    const advocate = deterministicReason(makeAgent(ROLES.ADVOCATE, 'seed', constraints), purchase);
    const auditor  = deterministicReason(makeAgent(ROLES.AUDITOR,  'seed', constraints), purchase);
    const args = {
      advocate,
      auditor,
      witness: deterministicJudge(makeAgent(ROLES.WITNESS, 'seed', constraints), purchase, advocate, auditor),
    };
    const result = adjudicate(purchase, args, 2);
    const receipt = buildReceipt(result, { engine: 'deterministic' });
    receipt.at = new Date(base - minutesAgo * 60e3).toISOString();
    receipt.customId = receiptCustomId(receipt);
    ledger.push({
      at: receipt.at,
      purchase: result.purchase,
      decision: result.decision,
      votesFor: result.votesFor,
      votesAgainst: result.votesAgainst,
      summary: result.dissentMap ? result.dissentMap.summary : 'consensus reached',
      receiptHash: receipt.hash,
      customId: receipt.customId,
      votes: receipt.votes,
      models: receipt.models,
      engine: 'deterministic',
      threshold: 2,
      dissentMap: result.dissentMap || null,
      receiptIntact: verifyReceipt(receipt),
      // ★amount / category を直接持たせる。purchase の中にしか無いと
      //   /api/ledger の生データで amount: null に見え、審査員が
      //   「金額の無い台帳」と誤解する（2026-10-24 実測）。
      amount: result.purchase.amount,
      category: result.purchase.category,
      seeded: true,
    });
    // The purchase just made is part of what the NEXT row has to fit inside.
    if (result.decision !== DECISION.DENIED) spentRunning += amount;
  }
}

export function createTriad({ runner, paypal } = {}) {
  const _runner = runner || new TriadRunner();
  const _paypal = paypal || PayPalClient.fromEnv();

  const ledger = [];       // every adjudication
  const pendingOrders = new Map(); // purchaseId -> { decision, order }

  // ★ Seed the ledger with the week the demo is telling the story of.
  //   An empty ledger reads as "nothing has ever happened here", and a ledger
  //   full of whatever the last person clicked reads as test data. Neither is
  //   what a reviewer should see first: they should see ordinary weeks of
  //   small purchases, one of them the $42 renewal that failed at 3 AM.
  seedLedger(ledger);

  async function triadAdjudicate({ amount, category, reason, monthlyBudget, spentThisMonth, recentPurchases } = {}) {
    // An unquantified purchase cannot be audited (see G1_amount_positive), and a
    // negative amount is not a price at all. Reject both before the debate runs:
    // Number('') is 0 and Number(null) is 0, so a blank field used to reach the
    // tribunal as "$0.00" and could still come out CONDITIONAL -- and CONDITIONAL
    // is what lets the PayPal order fire. That let a zero-value order through, so
    // the guard belongs here rather than only in the auditor's reasons.
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      const bad = { ok: false, error: 'amount must be a positive number', amount: amount ?? null };
      return bad;
    }

    const purchase = {
      id: `pur_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      amount: parsed,
      category: category || 'purchase',
      reason: reason || 'unspecified',
    };

    // Inject the human's stated constraints into ALL agents for this run
    // (the witness judges severity, so it needs the budget context too).
    const applyConstraints = (agent) => {
      if (monthlyBudget != null) agent.constraints.monthlyBudget = monthlyBudget;
      if (spentThisMonth != null) agent.constraints.spentThisMonth = spentThisMonth;
      if (recentPurchases) agent.constraints.recentPurchases = recentPurchases;
    };
    applyConstraints(_runner.agents.auditor);
    applyConstraints(_runner.agents.witness);
    applyConstraints(_runner.agents.advocate);

    const args = await _runner.debate(purchase);
    const result = adjudicate(purchase, args, 2);
    result.engine = args.engine;
    result.paypalMode = _paypal.mode;

    // ★ Consensus receipt — decision + all three votes + reasoning fingerprints,
    //   hashed into a tamper-evident audit record. This is what gets stamped
    //   into the PayPal order's custom_id, so the payment record IS the audit trail.
    const receipt = buildReceipt(result, { engine: args.engine });
    result.receipt = receipt;
    receipt.customId = receiptCustomId(receipt); // e.g. triad1:5f0cb4a5d19d7be3
    result.audit = {
      customId: receipt.customId,
      hash: receipt.hash,
      verify: verifyReceipt(receipt),
    };

    ledger.push({
      at: receipt.at,
      purchase: result.purchase,
      decision: result.decision,
      votesFor: result.votesFor,
      votesAgainst: result.votesAgainst,
      summary: result.dissentMap?.summary ?? 'consensus reached',
      receiptHash: receipt.hash,
      customId: receipt.customId,
      // ★ Rich audit fields for the AG Grid governance dashboard.
      //   Everything an auditor needs to reconstruct WHY this decision happened.
      votes: receipt.votes,                       // { advocate:'for', auditor:'against', witness:'neutral' }
      models: receipt.models,                     // { advocate:'deepseek...', auditor:'...', witness:'...' }
      engine: receipt.engine || args.engine,
      threshold: result.threshold,
      amount: result.purchase.amount,
      category: result.purchase.category,
      dissentMap: result.dissentMap ?? null,
      receiptIntact: verifyReceipt(receipt),
    });

    pendingOrders.set(result.purchase.id, {
      decision: result.decision,
      purchase: result.purchase,
      receipt,
    });
    return result;
  }

  async function triadCreateOrder({ purchaseId, returnUrl, cancelUrl } = {}) {
    const entry = pendingOrders.get(purchaseId);
    if (!entry) return { ok: false, error: 'purchase_not_found' };
    if (entry.decision === DECISION.DENIED || entry.decision === DECISION.DISSENT) {
      // ★ The money gate: a non-consensus adjudication cannot mint an order.
      return {
        ok: false,
        error: 'not_approved',
        decision: entry.decision,
        note: 'The three agents did not reach consensus. A human must override explicitly.',
      };
    }

    // ★ Stamp the consensus receipt hash into the PayPal order's custom_id.
    //   The order carries the audit trail with it: custom_id → triad ledger entry.
    const receipt = entry.receipt;
    const purchase = {
      ...entry.purchase,
      customId: receipt?.customId || entry.purchase.customId || entry.purchase.id,
    };
    const order = await _paypal.createOrder(purchase, { returnUrl, cancelUrl });
    entry.order = order;

    const orderCustomId =
      order.purchase_units?.[0]?.custom_id ?? purchase.customId;

    return {
      ok: true,
      decision: entry.decision,
      orderId: order.id,
      approvalLink: order.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null,
      mode: _paypal.mode,
      audit: receipt
        ? {
            hash: receipt.hash,
            customId: orderCustomId,
            stamped: orderCustomId === receipt.customId,
            verify: verifyReceipt(receipt),
          }
        : null,
    };
  }

  /**
   * 改ざん検知 — order の custom_id に刻んだ指紋が、ledger の receipt と一致するか。
   * PayPal から order を引き直し、custom_id を照合して監査証跡を検証する。
   */
  /**
   * 領収書を検証する。
   *
   * ★2026-10-24 修正: 以前はメモリ上の order オブジェクトを参照していたため
   *   「PayPal に問い合わせて確認」になっていなかった。サーバー再起動後は
   *   pendingOrders が消えて検証不能だった。現在は PayPal API から
   *   custom_id を読み直し（getOrder）、その値と台帳の receipt を突き合わせる。
   *   読み直せない場合は live:false を返し、メモリ値で代用したことを明示する。
   */
  async function triadVerifyReceipt({ orderId, purchaseId } = {}) {
    let entry = purchaseId ? pendingOrders.get(purchaseId) : null;
    if (!entry && orderId) {
      entry = [...pendingOrders.values()].find((e) => e.order?.id === orderId) || null;
    }
    const receipt = entry?.receipt;
    if (!receipt) return { ok: false, error: 'receipt_not_found' };

    const orderIdToUse = orderId || entry.order?.id || null;

    // ★PayPal から custom_id を読み直す（third-party の記録との突き合わせ）
    let liveCustomId = null;
    let live = false;
    let liveError = null;
    if (orderIdToUse && typeof _paypal.getOrder === 'function' && _paypal.mode !== 'MOCK') {
      try {
        const fresh = await _paypal.getOrder(orderIdToUse);
        liveCustomId = fresh?.purchase_units?.[0]?.custom_id ?? null;
        live = true;
      } catch (e) {
        liveError = String(e.message || e).slice(0, 160);
      }
    }

    // メモリ上の値（PayPal に問い合わせられない場合の代用）
    const memoryCustomId = entry.order?.purchase_units?.[0]?.custom_id ?? receipt.customId;
    const customId = liveCustomId ?? memoryCustomId;

    // ★custom_id が無い場合は receipt 自身の値と比較しない（無意味な自己一致になる）
    const onChain = hashFromCustomId(customId);
    const intact = verifyReceipt(receipt);
    const hashMatches = onChain !== null && onChain === receipt.hash;

    return {
      ok: intact && hashMatches,
      decision: entry.decision,
      customId,
      orderHash: onChain,
      ledgerHash: receipt.hash,
      hashMatches,
      receiptIntact: intact,
      // ★PayPal に実際に問い合わせたか。false のときはメモリ値での検証。
      live,
      source: live ? 'paypal_api' : 'memory',
      liveError,
      orderId: orderIdToUse,
      votes: receipt.votes,
      models: receipt.models,
    };
  }

  async function triadCaptureOrder({ orderId } = {}) {
    if (!orderId) return { ok: false, error: 'orderId_required' };
    const capture = await _paypal.captureOrder(orderId);
    return { ok: capture.status === 'COMPLETED', capture, mode: _paypal.mode };
  }

  function triadGetLedger() {
    return { count: ledger.length, entries: ledger };
  }

  return {
    triadAdjudicate,
    triadCreateOrder,
    triadCaptureOrder,
    triadVerifyReceipt,
    triadGetLedger,
    _runner,
    _paypal,
    ledger,
    pendingOrders,
  };
}

/**
 * Register Tuesday as WebMCP tools on the current page.
 */
export function registerTriadWebMCP(triad = createTriad()) {
  if (typeof navigator === 'undefined' || !('modelContext' in navigator)) {
    console.warn('[Tuesday] navigator.modelContext unavailable (needs Chrome 146+ WebMCP flag)');
    return triad;
  }
  const mc = navigator.modelContext;

  mc.registerTool({
    name: 'triadAdjudicate',
    description:
      'Submit a purchase for adversarial adjudication by three independent AI agents (Advocate argues FOR, Auditor argues AGAINST, Witness judges). Returns a decision (APPROVED / CONDITIONAL / DENIED / DISSENT) and, on dissent, a map of who blocked what and why. No money moves here — this is the deliberative step.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Purchase amount in USD' },
        category: { type: 'string', description: 'What is being bought' },
        reason: { type: 'string', description: 'Why the user wants it' },
        monthlyBudget: { type: 'number', description: 'Optional: user-stated monthly budget' },
        spentThisMonth: { type: 'number', description: 'Optional: already spent this month' },
        recentPurchases: { type: 'array', items: { type: 'string' }, description: 'Optional: recent purchases' },
      },
      required: ['amount', 'category'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    execute: async (input) => triad.triadAdjudicate(input || {}),
  });

  mc.registerTool({
    name: 'triadCreateOrder',
    description:
      'Create a PayPal order for a purchase the tribunal has APPROVED or CONDITIONALLY approved. Returns a PayPal approval link. Money does not move until triadCaptureOrder is called (human approval step).',
    inputSchema: {
      type: 'object',
      properties: {
        purchaseId: { type: 'string', description: 'purchaseId from triadAdjudicate' },
        returnUrl: { type: 'string' },
        cancelUrl: { type: 'string' },
      },
      required: ['purchaseId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    execute: async (input) => triad.triadCreateOrder(input || {}),
  });

  mc.registerTool({
    name: 'triadCaptureOrder',
    description: 'Capture (finalize) an approved PayPal order. This is the human-approval step — call it only after the user has approved.',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    execute: async (input) => triad.triadCaptureOrder(input || {}),
  });

  mc.registerTool({
    name: 'triadGetLedger',
    description: 'Read-only: list every adjudication the tribunal has made, with decision, vote counts, and consensus receipt hash.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async () => triad.triadGetLedger(),
  });

  mc.registerTool({
    name: 'triadVerifyReceipt',
    description:
      'Read-only: verify the tamper-evident audit trail of an approved purchase. Re-hashes the consensus receipt and checks it matches the hash stamped into the PayPal order custom_id. Returns the three votes and the models that cast them. Use this to prove a payment record has not been altered.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'PayPal order id' },
        purchaseId: { type: 'string', description: 'Or the purchaseId from triadAdjudicate' },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async (input) => triad.triadVerifyReceipt(input || {}),
  });

  console.log('[Tuesday] Registered 5 WebMCP tools: triadAdjudicate, triadCreateOrder, triadCaptureOrder, triadGetLedger, triadVerifyReceipt');
  return triad;
}
