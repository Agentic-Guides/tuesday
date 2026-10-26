/**
 * Tuesday — Agent Runner — connects the 3 agents to LLM providers.
 *
 * Provider-agnostic: works with Ollama Cloud (this repo's default), or any
 * OpenAI-compatible endpoint. Falls back to the deterministic reasoning engine
 * if no provider is configured, so the demo NEVER fails to run.
 */

import { makeAgent, ROLES, deterministicReason, deterministicJudge } from './triad.js';

const DEFAULT_ENDPOINT = 'https://ollama.com/v1/chat/completions';

// Distinct models per role → genuinely independent adversaries.
// Independent models produce genuinely independent judgments. Three copies of the
// same model share the same blind spots, which defeats the adversarial design.
// Override any of these with TRIAD_MODEL_<ROLE> env vars (the env-var prefix keeps
// its original name for compatibility).
//
// ★ Model names verified live against Ollama Cloud's /api/tags (2026-10-07).
//   Three DIFFERENT vendors on purpose: DeepSeek / Google / OpenAI-OSS.
//   Auditor=gemma4:31b was chosen by measurement: 196 tokens & 844ms per debate
//   turn, vs 365 tokens & 4466ms for glm-5.3-flash (≈54% fewer tokens, ≈81% faster,
//   no reasoning-token overhead) — and it still argues AGAINST convincingly,
//   which is what makes DISSENT real.
const DEFAULT_MODELS = {
  advocate: process.env.TRIAD_MODEL_ADVOCATE || 'deepseek-v4.1-flash', // DeepSeek
  auditor: process.env.TRIAD_MODEL_AUDITOR || 'gemma4:31b',            // Google
  witness: process.env.TRIAD_MODEL_WITNESS || 'gpt-oss:120b',          // OpenAI (OSS)
};

// Gate severity. HARD gates say the money is not there (G1: no real amount,
// G2: amount exceeds what remains) — a model vote must never approve past
// them. SOFT gates (G3 share, G4 repeat, G5 double-cost stress) are warnings
// a human should see, not votes. Exported so tests can pin the split.
export const HARD_GATES = ['G1_amount_positive', 'G2_within_remaining'];

export function classifyGates(gateCheck) {
  const failed = gateCheck?.failedGates || [];
  const hardFailed = failed.filter((g) => HARD_GATES.includes(g));
  const softFailed = failed.filter((g) => !HARD_GATES.includes(g));
  // deterministicReason returns early — before its gates list exists — when
  // the amount is not a positive number. That is a G1 failure by definition.
  if (!failed.length && (gateCheck?.reasons || []).some((x) => /^No amount to audit/.test(x))) {
    hardFailed.push('G1_amount_positive');
  }
  return { hardFailed, softFailed };
}

export class TriadRunner {
  constructor({
    endpoint = process.env.LLM_ENDPOINT || DEFAULT_ENDPOINT,
    apiKey = process.env.OLLAMA_API_KEY || process.env.OPENAI_API_KEY,
    models = DEFAULT_MODELS,
    constraints = {},
  } = {}) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.agents = {
      advocate: makeAgent(ROLES.ADVOCATE, models.advocate, constraints),
      auditor: makeAgent(ROLES.AUDITOR, models.auditor, constraints),
      witness: makeAgent(ROLES.WITNESS, models.witness, constraints),
    };
  }

  get live() {
    return Boolean(this.apiKey);
  }

  async _chat(agent, userPrompt, maxTokens = 400) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: agent.model,
        messages: [
          { role: 'system', content: agent.system },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        // ★ A dispute argument is longer than a purchase vote: it has to cite evidence
        //   and still close its JSON. At 400 tokens the reply was truncated mid-object,
        //   _parse saw an unbalanced brace, and the argument came back parsed:false with
        //   empty cites — which the gate then (correctly) refused. The truncation was the
        //   bug; the refusal was the gate doing its job.
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const data = await res.json();
    // ★ Keep the token accounting. Before this, the reply text was returned and `usage`
    //   was dropped, so there was no way to answer "how many tokens does one adjudication
    //   cost?" from measurement — only by guessing. Every call now appends to `this.usage`
    //   so a single tribunal or a five-product Shop run can be priced exactly.
    const u = data.usage || {};
    if (!this.usage) this.usage = [];
    this.usage.push({
      agent: agent.name || agent.role || 'agent',
      model: agent.model,
      prompt_tokens: u.prompt_tokens || 0,
      completion_tokens: u.completion_tokens || 0,
      total_tokens: u.total_tokens || 0,
      cached_tokens: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0,
    });
    return data.choices?.[0]?.message?.content ?? '';
  }

  /** Reset the token meter before a measured run. */
  resetUsage() { this.usage = []; }

  /** Totals for everything since the last resetUsage(). */
  usageTotals() {
    const list = this.usage || [];
    return {
      calls: list.length,
      prompt_tokens: list.reduce((a, x) => a + x.prompt_tokens, 0),
      completion_tokens: list.reduce((a, x) => a + x.completion_tokens, 0),
      total_tokens: list.reduce((a, x) => a + x.total_tokens, 0),
      cached_tokens: list.reduce((a, x) => a + x.cached_tokens, 0),
      per_call: list,
    };
  }

  /**
   * Run the full adversarial debate for a purchase.
   * @returns {object} { advocate, auditor, witness } Arguments
   */
  async debate(purchase) {
    if (!this.live) {
      // Deterministic fallback — always works.
      const advocate = deterministicReason(this.agents.advocate, purchase);
      const auditor = deterministicReason(this.agents.auditor, purchase);
      const witness = deterministicJudge(this.agents.witness, purchase, advocate, auditor);
      return { advocate, auditor, witness, engine: 'deterministic' };
    }

    const context = this._purchaseContext(purchase);

    // ★ An "against" verdict must name its risk. Both judging prompts carry a
    //   risk_code field so the consistency check below can tell a grounded
    //   objection (risk_code set, reason cites the risk) from a verdict that
    //   contradicts its own reasons — measured live: gemma4:31b and
    //   gpt-oss:120b returned "against" with reasons saying the purchase was
    //   well within budget and no risk existed.
    const advocatePrompt = `${context}\n\nArgue FOR this purchase. Output JSON: {"verdict":"for","reasons":["..."],"confidence":0.0-1.0}`;
    const auditorPrompt = `${context}\n\nJudge this purchase as the Auditor. Return verdict "against" ONLY if there is a concrete, citable risk; otherwise return "for" if it is sound and affordable. If you return "against", you MUST set risk_code to the risk that stands. Output JSON: {"verdict":"for"|"against","risk_code":"OVER_BUDGET"|"REDUNDANT"|"UNSAFE"|"NOT_WORTH_IT"|null,"reasons":["..."],"confidence":0.0-1.0}`;

    // Advocate & Auditor argue in parallel.
    const [advocateRaw, auditorRaw] = await Promise.all([
      this._chat(this.agents.advocate, advocatePrompt),
      this._chat(this.agents.auditor, auditorPrompt),
    ]);

    let advocate = this._parse(this.agents.advocate, advocateRaw, purchase);
    let auditor = this._parse(this.agents.auditor, auditorRaw, purchase);

    // Consistency pass: an "against" whose own reasons cite no concrete risk
    // is not a vote, it is a contradiction. Retry once with the contradiction
    // named; if it persists, the vote is discarded to neutral (INVALID) rather
    // than counted — a broken output must not become a refusal.
    auditor = await this._enforceConsistency(this.agents.auditor, auditor, auditorPrompt, purchase);

    // Witness judges after seeing both.
    // ★ The two sides are labelled with the verdict each agent ACTUALLY
    //   returned. The old labels were fixed by role — "Auditor (AGAINST):" —
    //   so when the Auditor had voted "for" with reasons like "well within
    //   budget", the Witness still read those reasons as the case AGAINST and
    //   was structurally pushed toward "against" itself. The Witness also gets
    //   the same standard the Auditor got: "against" only for a concrete,
    //   citable risk that survives weighing both sides.
    const witnessPrompt = `${context}

Advocate (verdict: ${advocate.verdict}): ${JSON.stringify(advocate.reasons)}
Auditor (verdict: ${auditor.verdict}): ${JSON.stringify(auditor.reasons)}

As the neutral judge, decide. Return verdict "against" ONLY if a concrete, citable risk stands after weighing both sides; if you return "against", set risk_code to the risk that stands. Output JSON: {"verdict":"for"|"against","risk_code":"OVER_BUDGET"|"REDUNDANT"|"UNSAFE"|"NOT_WORTH_IT"|null,"reasons":["..."],"conditions":"... or null","confidence":0.0-1.0}`;
    // ★ 900, not the 400 default.
    //
    //   The Witness prompt is the longest of the three (it carries both sides' verdicts
    //   and reasons) and gpt-oss spends completion tokens on reasoning before it writes
    //   the JSON. At 400 the reply was cut mid-object, _parse could not read it, and the
    //   witness fell back to a bare {verdict:'neutral', reasons:[], conditions:null} —
    //   an empty judge. The purchase side never got the raise the dispute side did, whose
    //   comment records the same truncation.
    const witnessRaw = await this._chat(this.agents.witness, witnessPrompt, 900);
    let witness = this._parse(this.agents.witness, witnessRaw, purchase);
    witness = await this._enforceConsistency(this.agents.witness, witness, witnessPrompt, purchase);

    // ★ A silent Witness must not become an approval.
    //
    //   _parse falls back to deterministicReason(), which returns null for the witness by
    //   design ("witness decides after seeing both sides"). The result was a bare
    //   {verdict:'neutral', reasons:[], conditions:null} — measured on C07 and C10, where
    //   the reply could not be parsed. With two 'for' votes from the Advocate and Auditor,
    //   a neutral empty witness is enough for threshold 2, so the purchase was APPROVED
    //   with an absent judge and with no condition attached.
    //
    //   The deterministic judge is the right stand-in: it is the same code the offline path
    //   uses, it reads both sides, and it computes headroom. The substitution is recorded
    //   (witnessFallback) so the receipt says the judgement was not made by a model.
    if (witness && witness.parsed === false) {
      const dj = deterministicJudge(this.agents.witness, purchase, advocate, auditor);
      witness = {
        ...dj,
        fallbackReason: 'The model reply could not be parsed; the deterministic judge ruled.',
        witnessFallback: true,
      };
    }

    // ★ Soft-gate warnings have to reach the LLM path too.
    //
    //   Measured: deterministicJudge() is only called when `this.live` is false (the
    //   deterministic fallback). With three live models the witness comes from _parse,
    //   so the noHeadroom condition added to deterministicJudge never ran and a purchase
    //   consuming 93% of the month's remaining money was APPROVED with no caveat. The
    //   deterministic path scored 10/10 on the tribunal's cases; the LLM path scored 6/10
    //   on exactly the four cases that need this condition.
    //
    //   The condition describes the purchase's effect on the money left, not on the
    //   models' reasoning, so it is computed here from the same arithmetic the gates use.
    //   It describes headroom, never a price reduction — attaching the split-payment
    //   wording here would make the reason and the condition disagree, which is the same
    //   defect as a verdict that contradicts its own reasons.
    const hc = this.agents.witness.constraints || {};
    const hRemaining = hc.monthlyBudget != null ? hc.monthlyBudget - (hc.spentThisMonth ?? 0) : null;
    const hAmount = Number(purchase.amount) || 0;
    const NO_HEADROOM_SHARE = 0.80;
    const headroomShare = hRemaining != null && hRemaining > 0 ? hAmount / hRemaining : null;
    if (headroomShare != null && headroomShare >= NO_HEADROOM_SHARE && witness.verdict !== 'against') {
      const headroomCondition =
        'Approve only as the last purchase this month: no further discretionary spend ' +
        'without a separate decision, and any unexpected essential cost must be escalated.';
      witness = {
        ...witness,
        conditions: witness.conditions || headroomCondition,
        noHeadroom: true,
        reasons: [
          ...((witness.reasons || []).slice(0, 3)),
          `It uses ${Math.round(headroomShare * 100)}% of the $${hRemaining} left this month, ` +
          'so no headroom remains for anything else.',
        ],
      };
    }

    // ★ The deterministic gates always run, and a model cannot vote past them.
    //
    //   Before this, `debate()` handed the three model verdicts straight to adjudicate(),
    //   so the arithmetic of the budget was only ever applied by the model that was asked
    //   to apply it. A model returning "for" on an over-budget purchase produced APPROVED
    //   — and an order. The README claimed "no LLM can overturn a failed gate", which was
    //   not true of the code.
    //
    //   The gates now run independently of the models. If any gate fails, the Auditor is
    //   forced to 'against' with the failing gate named, and the Witness may no longer
    //   bridge the gap with a condition — a condition cannot buy back money that is not
    //   there. What the models still own is *why*: they explain, they argue, and the
    //   Witness can add a legitimate condition on top of gates that actually passed.
    // ★ Patch (2026-10-26): gates are split HARD / SOFT, because the block
    //   above turned ANY deterministic 'against' into two forced votes.
    //
    //   HARD gates — G1 (amount is real) and G2 (the money is there) — are
    //   the ones the paragraph above is about: no model vote may approve
    //   past them, so the override stays, for these two only.
    //
    //   SOFT gates — G3 (share), G4 (repeat), G5 (double-cost stress) — are
    //   warnings. triad.js says so itself for G5: failing it "does not mean
    //   don't buy", it means "buying with no headroom". The old code still
    //   forced BOTH the Auditor and the Witness to 'against' when only a
    //   soft gate failed, manufacturing the two objectors adjudicate()
    //   needs for DENIED out of a single warning. Measured: a $48 purchase
    //   with $80 remaining passes G1–G4, fails only G5 (2×$48 > $80), and
    //   came back DENIED 5/5 no matter what the models said — while the
    //   deterministic-only path calls the same case CONDITIONAL.
    //
    //   Soft failures now travel as gateWarnings for the human and the
    //   receipt. They never touch a vote.
    const gateCheck = deterministicReason(this.agents.auditor, purchase);
    const { hardFailed, softFailed } = classifyGates(gateCheck);

    if (hardFailed.length) {
      const merged = {
        ...auditor,
        verdict: 'against',
        reasons: [
          ...((auditor.reasons || []).slice(0, 3)),
          ...gateCheck.reasons,
          'The deterministic hard gates failed, so no model vote can approve this purchase.',
        ],
        gateOverridden: true,
      };
      return {
        advocate,
        auditor: merged,
        witness: {
          ...witness,
          verdict: 'against',
          conditions: null,
          reasons: [
            ...((witness.reasons || []).slice(0, 2)),
            'A failed hard gate cannot be bridged by a condition.',
          ],
          gateOverridden: true,
        },
        engine: 'llm',
        gateOverride: true,
        hardGatesFailed: hardFailed,
        softGatesFailed: softFailed,
      };
    }

    return {
      advocate,
      auditor,
      witness,
      engine: 'llm',
      gateWarnings: softFailed.length
        ? { failedGates: softFailed, reasons: gateCheck.reasons }
        : null,
    };
  }

  /**
   * The three agents argue about a dispute instead of a purchase.
   *
   * Same rule as debate(): each agent may only cite evidence IDs, and the arbiter must
   * return one of the four actions. If a model returns prose, _parse marks it
   * parsed:false and the deterministic argument stands in — the gate refuses an
   * uncited argument either way, so a chatty model cannot quietly authorise a refund.
   */
  async debateDispute({ dispute, evidence }) {
    if (!this.live) return null;

    const ctx = [
      'DISPUTE',
      `- Dispute ID: ${dispute?.dispute_id || dispute?.id || 'unknown'}`,
      `- Reason: ${evidence.reason}`,
      `- Amount: $${Number(evidence.amount).toFixed(2)}`,
      `- Buyer says: "${String(dispute?.buyer_message || dispute?.message || '').slice(0, 400)}"`,
      '',
      'EVIDENCE (cite these IDs, never invent one):',
      ...evidence.items.map((i) => `- ${i.id} [${i.ok ? 'AVAILABLE' : 'MISSING'}] ${i.label}: ${i.detail}`),
    ].join('\n');

    const schema = '{"action":"CONTEST|OFFER_PARTIAL|REFUND|ACCEPT|ESCALATE","reasons":["..."],"cites":["E1"],"confidence":0.0-1.0}';

    const [advRaw, chRaw] = await Promise.all([
      this._chat(this.agents.advocate,
        `${ctx}\n\nYou represent the MERCHANT. Give at most 3 reasons, one sentence each, and cite evidence IDs only. ` +
        `Reply with the JSON object and nothing else — no preamble, no markdown fence, no closing remark. Schema: ${schema}`, 700),
      this._chat(this.agents.auditor,
        `${ctx}\n\nYou represent the BUYER. Give at most 3 reasons, one sentence each, and cite evidence IDs only. ` +
        `Reply with the JSON object and nothing else — no preamble, no markdown fence, no closing remark. Schema: ${schema}`, 700),
    ]);

    const advocate = this._parseDispute(this.agents.advocate, advRaw);
    const challenger = this._parseDispute(this.agents.auditor, chRaw);

    const arbiterRaw = await this._chat(this.agents.witness,
      `${ctx}\n\nMERCHANT argued: ${JSON.stringify(advocate.reasons)}\nBUYER argued: ${JSON.stringify(challenger.reasons)}\n\n` +
      `As the neutral arbiter, decide what the merchant should do. CONTEST only if the required evidence for this reason is present. ` +
      `Give at most 3 reasons, one sentence each. Reply with the JSON object and nothing else. Schema: ${schema}`, 700);

    const arbiter = this._parseDispute(this.agents.witness, arbiterRaw);
    return { advocate, challenger, arbiter, engine: 'llm' };
  }

  _parseDispute(agent, raw) {
    const j = this._extractJson(raw);
    const ACTIONS = ['CONTEST', 'OFFER_PARTIAL', 'REFUND', 'ACCEPT', 'ESCALATE'];
    if (j && ACTIONS.includes(String(j.action || '').toUpperCase())) {
      return {
        role: agent.role,
        action: String(j.action).toUpperCase(),
        reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [String(j.reasons ?? '')],
        cites: Array.isArray(j.cites) ? j.cites.map(String) : [],
        confidence: typeof j.confidence === 'number' ? j.confidence : 0.5,
        model: agent.model,
        parsed: true,
      };
    }
    // Unparseable: mark it, so the gate sees an uncited argument and refuses it.
    return {
      role: agent.role, action: 'OFFER_PARTIAL', reasons: [], cites: [],
      confidence: 0.3, model: agent.model, parsed: false,
      rawExcerpt: String(raw || '').slice(0, 200),
    };
  }

  /**
   * A verdict of 'against' is consistent only if it names its risk: either a
   * risk_code, or a reason that actually cites one. Reasons that say the
   * purchase is within budget, or that no risk exists, make an 'against' a
   * contradiction — however confident the model sounded when it returned it.
   */
  _isInconsistent(arg) {
    if (!arg || arg.verdict !== 'against') return false;
    if (arg.riskCode) return false;
    const text = (arg.reasons || []).join(' ');
    const citesRisk = /over budget|exceeds|redundan|duplicate|already (bought|purchased)|unsafe|not worth|blocked by|too expensive/i.test(text);
    const deniesRisk = /no concrete risk|no evidence|within[^.]{0,40}budget|no problem|is sound|affordable/i.test(text);
    return deniesRisk || !citesRisk;
  }

  /**
   * Retry an inconsistent verdict once, with the contradiction named. If the
   * retry is still inconsistent, the vote is discarded to 'neutral' and
   * flagged invalid — a broken output is an abstention, never a refusal.
   */
  async _enforceConsistency(agent, arg, originalPrompt, purchase) {
    if (!this._isInconsistent(arg)) return arg;
    const retryPrompt = `${originalPrompt}

Your previous answer returned verdict "against", but its reasons cite no concrete risk — they say the purchase is within budget, or that no risk was found. That verdict contradicts its own reasons. Decide again: return verdict "for", OR return "against" WITH a risk_code and a reason that cites the concrete risk. Reply with the JSON object only.`;
    const raw = await this._chat(agent, retryPrompt);
    const second = this._parse(agent, raw, purchase);
    if (!this._isInconsistent(second)) return { ...second, consistencyRetried: true };
    return {
      ...second,
      verdict: 'neutral',
      invalid: true,
      rawVerdict: second.verdict,
      consistencyRetried: true,
      reasons: [
        ...(second.reasons || []),
        'Vote discarded as INVALID: "against" was returned twice without a cited concrete risk.',
      ],
    };
  }

  _purchaseContext(p) {
    const c = this.agents.auditor.constraints;
    const lines = [
      `PURCHASE REQUEST`,
      `- Item/category: ${p.category}`,
      `- Amount: $${p.amount}`,
      `- Stated reason: "${p.reason}"`,
      c.monthlyBudget != null ? `- Monthly budget: $${c.monthlyBudget}` : '',
      c.spentThisMonth ? `- Already spent this month: $${c.spentThisMonth}` : '',
      c.recentPurchases?.length ? `- Recent purchases: ${c.recentPurchases.join(', ')}` : '',
    ];
    // ★ Computed facts, stated once by code. The measured failure mode was a
    //   model doing this arithmetic correctly in its reasons ("$48 is well
    //   within the remaining $80") and then returning the opposite verdict —
    //   so the numbers are fixed here as facts, and the models are left to
    //   judge only what arithmetic cannot: redundancy, safety, worth.
    if (c.monthlyBudget != null) {
      const remaining = c.monthlyBudget - (c.spentThisMonth ?? 0);
      lines.push(`- Remaining budget: $${remaining} (computed)`);
      if (remaining > 0 && Number(p.amount) > 0) {
        lines.push(`- This amount is ${Math.round((p.amount / c.monthlyBudget) * 100)}% of the monthly budget and ${Math.round((p.amount / remaining) * 100)}% of the remaining budget (computed)`);
      }
    }
    return lines.filter(Boolean).join('\n');
  }

  _parse(agent, raw, purchase) {
    const j = this._extractJson(raw);
    if (j) {
      // ★ A missing verdict is a missing verdict — not a vote. The old default
      //   manufactured one by role (Auditor → 'against', others → 'for'), so a
      //   reply that omitted the field still moved the consensus. Fail-closed
      //   belongs to the gates, not to a parser default. A verdict that is
      //   absent or not 'for'/'against' now lands as 'neutral' and is flagged
      //   verdictMissing so the receipt can tell an abstention from a vote.
      const rawVerdict = typeof j.verdict === 'string' ? j.verdict.toLowerCase() : null;
      const verdictMissing = rawVerdict !== 'for' && rawVerdict !== 'against';
      return {
        agent: agent.role,
        title: agent.title,
        stance: agent.stance,
        verdict: verdictMissing ? 'neutral' : rawVerdict,
        verdictMissing,
        riskCode: typeof j.risk_code === 'string' ? j.risk_code : null,
        reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [String(j.reasons ?? '')],
        conditions: j.conditions && j.conditions !== 'null' ? j.conditions : null,
        confidence: typeof j.confidence === 'number' ? j.confidence : 0.5,
        model: agent.model,
        parsed: true,
      };
    }

    // ★ The model answered, but not in JSON. Fall back to the deterministic argument —
    //   and SAY SO. The old code put the raw completion into `reasons`, so a witness that
    //   replied with prose showed up on screen as a vote whose first "reason" was its own
    //   source text. A reader cannot tell a parse failure from an argument that way.
    const fallback = deterministicReason(agent, purchase) || {
      agent: agent.role, title: agent.title, stance: agent.stance,
      verdict: 'neutral', reasons: [], conditions: null, confidence: 0.4,
    };
    return {
      ...fallback,
      model: agent.model,
      parsed: false,
      rawExcerpt: String(raw || '').slice(0, 240),
    };
  }

  /**
   * Pull a JSON object out of a model response.
   *
   * Models wrap JSON in ```json fences, prepend "Here is my verdict:", or emit a
   * trailing sentence. The previous regex grabbed from the first "{" to the LAST "}",
   * which breaks as soon as the reply contains two objects or a brace inside a string.
   * This walks the text and returns the first balanced object that actually parses.
   */
  _extractJson(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;

    // 1. Straight parse, in case the model behaved.
    try { return JSON.parse(s); } catch { /* keep going */ }

    // 2. Strip a markdown fence if there is one.
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try { return JSON.parse(fence[1].trim()); } catch { /* keep going */ }
    }

    // 3. Balanced-brace scan, respecting strings and escapes.
    for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(s.slice(start, i + 1));
              if (obj && typeof obj === 'object') return obj;
            } catch { break; }
          }
        }
      }
    }
    return null;
  }
}
