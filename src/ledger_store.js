/**
 * ledger_store.js — the append-only receipt ledger.
 *
 * WHY THIS EXISTS
 *   Until now a receipt lived only in the running process: the demo could adjudicate a purchase
 *   and hand back a receipt, and the moment the process restarted the receipt was gone. A daily
 *   anchor batch needs something to anchor, so the receipts have to survive the process.
 *
 * RULES (the ledger is evidence, so it is treated as evidence)
 *   - Append only. There is no update and no delete path in this module, on purpose.
 *   - One JSON object per line. A partial last line is ignored on read, never "repaired".
 *   - A batch is recorded by APPENDING a second line that names the receipt's ledger id and the
 *     transaction hash. The original receipt line is never rewritten.
 *   - The receipt's `core` is stored as-is (hash and customId excluded), so the full SHA-256 can
 *     be recomputed by anyone later.
 *   - fsync on append: a receipt that was returned to a caller must be on disk.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LEDGER_PATH = resolve(__dir, '..', 'data', 'receipts.jsonl');

/** Line kinds. A batch record points at receipt lines; it never contains them. */
export const KIND_RECEIPT = 'receipt';
export const KIND_BATCH = 'batch';

function ensure(file) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Append one receipt.
 * @param {object} receipt the buildReceipt() output (hash + core fields)
 * @param {string} [file]
 * @returns {object} { id, seq } where id is this receipt's stable ledger id
 */
export function appendReceipt(receipt, file = DEFAULT_LEDGER_PATH) {
  if (!receipt || typeof receipt !== 'object') throw new Error('appendReceipt: receipt required');
  if (typeof receipt.hash !== 'string') throw new Error('appendReceipt: receipt.hash required');
  ensure(file);

  // The core is everything the full SHA-256 is computed over: no hash, no customId.
  const { hash, customId, ...core } = receipt;
  const seq = countLines(file) + 1;
  const id = `rcpt_${String(seq).padStart(6, '0')}`;
  const line = {
    kind: KIND_RECEIPT,
    id,
    at: core.at ?? null,
    fp16: hash,
    core,
    batch: null, // filled by an appended batch record, never by rewriting this line
  };
  appendLine(file, line);
  return { id, seq };
}

/**
 * Record a batch: which receipts it covered, and the transaction that carried the root.
 * This appends; the receipt lines stay byte-identical.
 */
export function appendBatch({ txHash, block, root, receiptIds, anchoredAt }, file = DEFAULT_LEDGER_PATH) {
  if (!txHash) throw new Error('appendBatch: txHash required');
  if (!root) throw new Error('appendBatch: root required');
  if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
    throw new Error('appendBatch: receiptIds required (an empty batch must not be recorded)');
  }
  ensure(file);

  // Idempotence: the same transaction must not be recorded twice, and a receipt must not be
  // anchored by two different batches.
  const existing = readLedger(file);
  const seenTx = existing.find((l) => l.kind === KIND_BATCH && l.txHash === txHash);
  if (seenTx) return { duplicate: true, txHash };
  const already = batchedReceiptIds(existing);
  const clash = receiptIds.filter((id) => already.has(id));
  if (clash.length) throw new Error(`appendBatch: already batched: ${clash.join(', ')}`);

  appendLine(file, {
    kind: KIND_BATCH,
    txHash,
    block: block ?? null,
    root,
    receiptIds,
    anchoredAt: anchoredAt ?? new Date().toISOString(),
  });
  return { duplicate: false, txHash };
}

/** Read every well-formed line. A torn final line is skipped, not repaired. */
export function readLedger(file = DEFAULT_LEDGER_PATH) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      // a partial write is data loss, not something to guess at
    }
  }
  return out;
}

/** Receipt ids that a batch record has already covered. */
export function batchedReceiptIds(lines) {
  const ids = new Set();
  for (const l of lines) {
    if (l.kind === KIND_BATCH && Array.isArray(l.receiptIds)) l.receiptIds.forEach((id) => ids.add(id));
  }
  return ids;
}

/**
 * Receipts waiting to be anchored: those with no batch record covering them.
 * @returns {Array<{id, at, fp16, core}>}
 */
export function pendingReceipts(file = DEFAULT_LEDGER_PATH) {
  const lines = readLedger(file);
  const done = batchedReceiptIds(lines);
  return lines
    .filter((l) => l.kind === KIND_RECEIPT && !done.has(l.id))
    .map(({ id, at, fp16, core }) => ({ id, at, fp16, core }));
}

/**
 * Pending receipts whose `at` falls on the given JST calendar date (YYYY-MM-DD).
 *
 * The receipt's `at` is a UTC ISO string. Slicing the first 10 characters gives the UTC date, and
 * for anything created between 00:00 and 08:59 JST that is the PREVIOUS day — so a batch would
 * silently carry receipts from the wrong day, off by up to nine hours. The operator's day is JST
 * (the cron fires at 00:05 JST and means "yesterday in Tokyo"), so the comparison is done in JST.
 */
export function pendingForDay(day, file = DEFAULT_LEDGER_PATH) {
  return pendingReceipts(file).filter((r) => typeof r.at === 'string' && jstDate(r.at) === day);
}

/** Convert an ISO timestamp to its JST calendar date (YYYY-MM-DD). */
export function jstDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  // +9 hours, then read the UTC date of the shifted instant.
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function countLines(file) {
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
}

function appendLine(file, obj) {
  // A writer that died mid-line leaves the file without a trailing newline. Appending straight
  // onto that fragment would glue the new record to it, and BOTH would be lost on read. Terminate
  // the dangling line first so a torn tail costs exactly one record, never two.
  let prefix = '';
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    if (text.length > 0 && !text.endsWith('\n')) prefix = '\n';
  }
  const fd = openSync(file, 'a');
  try {
    appendFileSync(fd, prefix + JSON.stringify(obj) + '\n');
    fsyncSync(fd); // a receipt handed to a caller must be durable
  } finally {
    closeSync(fd);
  }
}
