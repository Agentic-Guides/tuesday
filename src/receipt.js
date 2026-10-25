/**
 * Tuesday — Consensus Receipt
 *
 * Pin the outcome of a consensus (or a disagreement) as a tamper-evident audit trail.
 *
 * The decision, all three votes and a fingerprint of each agent's reasoning are
 * canonicalised into JSON and hashed with SHA-256; the leading 16 hex characters are
 * the consensus fingerprint. Stamping that fingerprint into a PayPal order's
 * custom_id makes the payment record itself the audit trail.
 *
 *   → not "an AI bought this", but
 *     "which agent voted what, and on which grounds", recoverable
 *     from the payment record itself (custom_id → ledger).
 *
 * Design rules:
 *   - The hash covers every field, including the timestamp. Verification re-hashes
 *     the stored receipt as-is, so changing a single character breaks the match.
 *   - Zero dependencies (node:crypto only).
 */

import { createHash } from 'node:crypto';

/** Namespace prefix for custom_id, so these values cannot collide inside PayPal. */
export const RECEIPT_PREFIX = 'triad1';

/**
 * Deterministic JSON with keys sorted recursively.
 * Same content in, same string out — regardless of key order or construction path.
 */
export function canonicalize(value) {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Leading 16 hex characters of SHA-256 (64-bit consensus fingerprint). */
export function fingerprint(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex').slice(0, 16);
}

function fp(value) {
  return fingerprint(value ?? null);
}

/**
 * Build a consensus receipt from the result of adjudicate().
 *
 * @param {object} result the return value of adjudicate() (decision / purchase / arguments / threshold)
 * @param {object} [opts] { engine, at }
 * @returns {object} receipt, with `hash` = the consensus fingerprint
 */
export function buildReceipt(result, { engine = null, at = null } = {}) {
  const a = result.arguments || {};
  const core = {
    v: 1,
    purchaseId: result.purchase?.id ?? null,
    amount: Number(result.purchase?.amount) || 0,
    category: result.purchase?.category ?? null,
    decision: result.decision ?? null,
    threshold: result.threshold ?? null,
    votes: {
      advocate: a.advocate?.verdict ?? null,
      auditor: a.auditor?.verdict ?? null,
      witness: a.witness?.verdict ?? null,
    },
    models: {
      advocate: a.advocate?.model ?? null,
      auditor: a.auditor?.model ?? null,
      witness: a.witness?.model ?? null,
    },
    // Fingerprint of the reasoning. The prose itself stays in the ledger; the receipt
 // carries only the fingerprint.
    reasoning: {
      advocate: fp(a.advocate?.reasons),
      auditor: fp(a.auditor?.reasons),
      witness: fp(a.witness?.reasons),
    },
    engine: engine ?? result.engine ?? 'deterministic',
    at: at ?? new Date().toISOString(),
  };
  return { ...core, hash: fingerprint(core) };
}

/** The string to carry in PayPal's custom_id for this receipt. */
export function receiptCustomId(receipt) {
  if (!receipt?.hash) throw new Error('receipt.hash missing');
  return `${RECEIPT_PREFIX}:${receipt.hash}`;
}

/**
 * Tamper detection: re-hash the stored receipt and compare against its hash.
 * @returns {boolean} true = unmodified
 */
export function verifyReceipt(receipt) {
  if (!receipt || typeof receipt.hash !== 'string') return false;
  const { hash, customId, ...core } = receipt;
  return fingerprint(core) === hash;
}

/** Extract the fingerprint out of a custom_id (triad1:xxxx). */
export function hashFromCustomId(customId) {
  const m = /^triad1:([0-9a-f]{16})$/.exec(String(customId || ''));
  return m ? m[1] : null;
}
