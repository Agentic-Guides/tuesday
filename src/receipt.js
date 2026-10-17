/**
 * Tuesday — Consensus Receipt
 *
 * 合意（または対立）の結果を、改ざん不能な監査証跡として固定する。
 *
 * decision + 3エージェントの投票 + 各エージェントの推論本文の指紋 を
 * 正規化JSONにし、SHA-256 の先頭16桁を「合意指紋」とする。
 * この指紋を PayPal order の custom_id に刻むことで、
 * 支払い記録そのものが監査証跡になる。
 *
 *   → "an AI bought this" ではなく
 *      "どのエージェントが、どの根拠で、どう投票したか" が
 *      決済レコード（custom_id → ledger）から復元できる。
 *
 * 設計原則:
 *   - ハッシュは全フィールド（timestamp 含む）を対象にする。
 *     検証時は保存済み receipt をそのまま再ハッシュして照合するので、
 *     1文字でも書き換えれば照合が落ちる（改ざん検知）。
 *   - 依存ゼロ（node:crypto のみ）。
 */

import { createHash } from 'node:crypto';

/** custom_id の先頭に付ける名前空間（PayPal の custom_id 内で衝突回避）。 */
export const RECEIPT_PREFIX = 'triad1';

/**
 * キーを再帰的にソートした決定論的JSON文字列。
 * 同じ内容なら、キーの順序や生成経路が違っても必ず同じ文字列になる。
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

/** 任意の値の SHA-256 先頭16桁（= 64bit の合意指紋）。 */
export function fingerprint(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex').slice(0, 16);
}

function fp(value) {
  return fingerprint(value ?? null);
}

/**
 * adjudicate() の結果から consensus receipt を組み立てる。
 *
 * @param {object} result adjudicate() の戻り値（decision / purchase / arguments / threshold）
 * @param {object} [opts] { engine, at }
 * @returns {object} receipt（末尾に `hash` = 合意指紋）
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
    // 推論の「指紋」。本文そのものは ledger に残し、receipt には要約として刻む。
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

/** receipt を PayPal の custom_id に載せるための文字列を返す。 */
export function receiptCustomId(receipt) {
  if (!receipt?.hash) throw new Error('receipt.hash missing');
  return `${RECEIPT_PREFIX}:${receipt.hash}`;
}

/**
 * 改ざん検知 — 保存済み receipt を再ハッシュし、hash と一致するか検証する。
 * @returns {boolean} true = 無改ざん
 */
export function verifyReceipt(receipt) {
  if (!receipt || typeof receipt.hash !== 'string') return false;
  const { hash, customId, ...core } = receipt;
  return fingerprint(core) === hash;
}

/** custom_id（triad1:xxxx）から指紋部分を取り出す。 */
export function hashFromCustomId(customId) {
  const m = /^triad1:([0-9a-f]{16})$/.exec(String(customId || ''));
  return m ? m[1] : null;
}
