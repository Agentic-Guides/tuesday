/**
 * Tuesday — Adversarial Consensus Engine
 * 敵対的マルチエージェント金融統制
 *
 * 3体の独立したAIが金の使い方を議論し、閾値合意でのみ決済を承認する。
 * 「トライアド（三者審理）」がこの作品の核であり、レシートの接頭辞 `triad1:` はここに由来する。
 *
 *   ADVOCATE  — 買いたい（欲求を代表）
 *   AUDITOR   — 止めたい（予算・リスクを代表）
 *   WITNESS   — 中立の判定者
 *
 * 合意ルール:
 *   - 2-of-3 または 3-of-3 の合意でのみ APPROVED
 *   - APPROVED → PayPalで決済実行（ステージ→人間承認→コミット）
 *   - DISSENT  → 対立地図を生成（誰が何で譲らないか）
 *
 * 設計原則:
 *   エージェントは「買う/買わない」を決めない。
 *   「対立の形」を人間に見せる。最終決定権は常に人間にある。
 */

// ---------------------------------------------------------------------------
// エージェント定義
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
  ADVOCATE: 'advocate', // 買いたい
  AUDITOR: 'auditor',   // 止めたい
  WITNESS: 'witness',   // 中立判定
};

// 各エージェントの利害・性格・拒否条件を定義する
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
        'You are the neutral judge. Read both sides, weigh them, and decide: APPROVE, DENY, or CONDITIONAL (approve only under stated conditions). Be decisive and explain your reasoning.',
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
// 対立（Argument）モデル
// ---------------------------------------------------------------------------

function mkArgument(agent, verdict, reasons, options = {}) {
  return {
    agent: agent.role,
    title: agent.title,
    stance: agent.stance,
    verdict,               // 'for' | 'against' | 'neutral'
    reasons,               // string[]
    conditions: options.conditions ?? null, // WITNESSの条件付き承認
    confidence: options.confidence ?? 0.5,
    model: agent.model,
    // ★ 監査ゲート（実測できる形で残す）。
    //   失敗したゲートの【名前】が無い verdict は「意見」であって監査ではない。
    gates: options.gates ?? null,
    failedGates: options.failedGates ?? null,
  };
}

// ---------------------------------------------------------------------------
// 各エージェントの「思考」— プラガブル（LLM呼び出し or 決定論的ルール）
// ---------------------------------------------------------------------------

/**
 * 決定論的フォールバック。LLMが使えない環境でもエンジンが動く。
 * これによりデモが「必ず動く」ことを保証する。
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
      gates.push({ id: 'G5_survives_double_cost', pass: amount * 2 <= remaining });
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
      gates,               // ★各ゲートの合否（却下理由の名前が残る）
      failedGates,
    });
  }

  // WITNESS
  return null; // witness decides after seeing both sides
}

export function deterministicJudge(agent, purchase, forArg, againstArg) {
  const advocateFor = forArg?.verdict === 'for';
  const auditorAgainst = againstArg?.verdict === 'against';

  // Both agree it's sound.
  if (advocateFor && !auditorAgainst) {
    return mkArgument(agent, 'neutral', ['Both sides agree the purchase is sound.'], {
      conditions: null, confidence: 0.85,
    });
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
// 合意エンジン
// ---------------------------------------------------------------------------

export const DECISION = {
  APPROVED: 'APPROVED',
  CONDITIONAL: 'CONDITIONAL',
  DENIED: 'DENIED',
  DISSENT: 'DISSENT',
};

/**
 * 3エージェントの議論を集約する。
 * @param {object} purchase { amount, category, reason }
 * @param {object} args { advocate, auditor, witness } 各エージェントのArgument
 * @param {number} threshold 合意に必要な票数（デフォルト2）
 */
export function adjudicate(purchase, args, threshold = 2) {
  const { advocate, auditor, witness } = args;

  const votesFor = [advocate, auditor, witness].filter(a => a && a.verdict === 'for').length;
  const votesAgainst = [advocate, auditor, witness].filter(a => a && a.verdict === 'against').length;
  const hasCondition = witness?.conditions != null && String(witness.conditions).trim() !== '';

  // ★判定順序（2026-10-24 修正）
  //
  // 以前は hasCondition を最優先していたため、
  //   A=against / B=against / W=neutral(条件付き) → CONDITIONAL
  // となり、反対2票でも PayPal 注文が作れてしまった（実測で確認）。
  // 全会一致の反対（3票）でも CONDITIONAL になっていた。
  //
  // 修正後は「拒否が先、合意は後」。ただし対立1対1を条件で解く道は残す
  // （これがこの製品の物語そのものだから）。
  //
  //   1) 反対が2票以上                        → DENIED       金額を動かせない
  //   2) 賛成が threshold 以上                 → CONDITIONAL  条件があれば
  //                                             APPROVED     条件がなければ
  //   3) 賛成1 + 反対1 + Witness が条件を提示  → CONDITIONAL  対立を条件で解く
  //   4) それ以外                             → DISSENT      合意なし。人間の判断へ
  //
  // 3) を入れている理由: 「Advocate が押し、Auditor が止め、Witness が条件を
  // 付けて橋を架ける」というのが本製品の中心的な振る舞いであり、
  // これを DISSENT に落とすと製品の意味がなくなる。
  // 反対2票は 1) で先に落ちるので、この経路が金の抜け穴にはならない。
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
    // 決定とともに「なぜ」を残す。人間に結果ではなく対立の形を見せる。
    dissentMap: decision === DECISION.DISSENT || decision === DECISION.DENIED
      ? buildDissentMap(args)
      : null,
  };
}

/**
 * 対立地図 — 誰が・何で・どこまで譲らないか。
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
// ユーティリティ
// ---------------------------------------------------------------------------

function fmt(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export { fmt };
