/**
 * Tuesday + Channel3 integration.
 *
 * Flow: user names a category → Channel3 returns real product candidates →
 * The Advocate argues for the best one, the Auditor checks it against the
 * budget, the Witness judges. This grounds the debate in real, purchasable SKUs.
 */

import { createTriad } from './webmcp.js';
import { Channel3 } from './channel3.js';
import { adjudicate, DECISION } from './triad.js';

export function createTriadCommerce({ triad, catalog } = {}) {
  const _triad = triad || createTriad();
  const _catalog = catalog || Channel3.fromEnv();

  /**
   * Full commerce flow:
   *   1. Find candidate products (Channel3)
   *   2. Adjudicate the top candidate (the tribunal)
   *   3. Optionally create a PayPal order
   */
  async function triadShop({ category, query, monthlyBudget, spentThisMonth, recentPurchases, maxPrice } = {}) {
    // 1. Candidate discovery (don't duplicate category into query)
    const candidates = await _catalog.search({ query: query || undefined, category, maxPrice, limit: 5 });
    if (!candidates.length) {
      return { ok: false, error: 'no_candidates', category };
    }

    // 2. Adjudicate each candidate; pick the best APPROVED/CONDITIONAL one.
    // Each candidate is judged in ITS OWN context, not all five against the same
    // budget line. In a real catalogue these products are not interchangeable:
    // some are repeat purchases (the brand already bought this category, so the
    // repeat gate should fire), some are one-off. Passing identical constraints
    // to every row made every verdict come back the same colour, which reads as
    // a decorative table — the single failure this demo was fixed to avoid.
    //
    // `recentPurchases` therefore carries per-product history: a product whose
    // category the brand has bought before in this period is judged as a repeat.
    const repeatHistory = (product) => {
      const cat = String(product.category || '').toLowerCase();
      // A renewal is a repeat charge for something the brand already bought. That
      // is a property of the product, declared by the catalogue (`kind`), not
      // something to infer from the title — inferring it by keyword matched one
      // of five rows and made the grid a single colour again.
      // The repeat gate (`G4`) then fires on renewals only, which is exactly the
      // discriminator this table needs: a renewal is scrutinised, a first-time
      // purchase is not.
      if (product.kind === 'renewal') return [cat];
      return Array.isArray(recentPurchases) ? recentPurchases : [];
    };

    // Adjudicate the five candidates concurrently. Each candidate is an independent
    // tribunal with its own budget line, so nothing is shared between them and the
    // order cannot matter — but awaiting them one at a time made the grid take the
    // sum of five three-model debates. Measured both ways: serial 19-20s, concurrent
    // 4-6s. The serial version was slow enough that the demo video's Shop beat
    // expired while the page still read "Channel3 searching", so the product
    // photographs never appeared on screen even though the grid had rendered.
    const judged = await Promise.all(
      candidates.slice(0, 5).map((product) =>
        _triad.triadAdjudicate({
          amount: product.price,
          category: product.title,
          reason: `Best match for "${category}": ${product.brand} ${product.title} (★${product.rating})`,
          monthlyBudget,
          spentThisMonth,
          recentPurchases: repeatHistory(product),
        }).then((r) => ({ product, decision: r.decision, adjudication: r }))
      )
    );
    const results = judged;
    // Every candidate is adjudicated. Stopping at the first APPROVED made the
    // grid look like five identical verdicts (the first two runs measured
    // 1 and 2 evaluated out of 5), which reads as "the table is decorative".
    // The whole point of the candidate list is that the tribunal discriminates
    // between products — so let it run over all of them.

    const approved = results.find(r => r.decision === DECISION.APPROVED)
      || results.find(r => r.decision === DECISION.CONDITIONAL)
      || null;

    return {
      ok: Boolean(approved),
      category,
      candidates: candidates.length,
      evaluated: results.length,
      catalogMode: _catalog.mode,
      recommendation: approved
        ? { product: approved.product, decision: approved.decision, purchaseId: approved.adjudication.purchase.id }
        : null,
      allResults: results.map(r => ({
        // id and image are carried through so the UI can bind a thumbnail to the
        // exact row it belongs to. Dropping them here was why the candidate grid
        // had no image key to render against.
        id: r.product.id,
        image: r.product.image || null,
        title: r.product.title,
        brand: r.product.brand,
        price: r.product.price,
        rating: r.product.rating,
        decision: r.decision,
      })),
      message: approved
        ? `Consensus on "${approved.product.title}" (${approved.decision}).`
        : 'No candidate reached consensus. Widen the budget or narrow the requirements.',
    };
  }

  return { triadShop, _triad, _catalog };
}

/** Register commerce tools on WebMCP. */
export function registerTriadCommerceWebMCP(commerce = createTriadCommerce()) {
  if (typeof navigator === 'undefined' || !('modelContext' in navigator)) {
    console.warn('[Commerce] navigator.modelContext unavailable');
    return commerce;
  }
  const mc = navigator.modelContext;

  mc.registerTool({
    name: 'triadShop',
    description:
      'Shop for a real product in a category. Channel3 finds candidate products from a 50M+ catalog, then three independent AI agents (Advocate/Auditor/Witness) adjudicate each candidate against the budget. Returns the consensus recommendation, or explains why nothing was approved. No money moves here.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'e.g. headphones, laptop, office chair, watches, cameras' },
        query: { type: 'string', description: 'Optional free-text product query' },
        maxPrice: { type: 'number', description: 'Optional max price filter' },
        monthlyBudget: { type: 'number' },
        spentThisMonth: { type: 'number' },
        recentPurchases: { type: 'array', items: { type: 'string' } },
      },
      required: ['category'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    execute: async (input) => commerce.triadShop(input || {}),
  });

  console.log('[Commerce] Registered WebMCP tool: triadShop');
  return commerce;
}
