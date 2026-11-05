/**
 * The ledger is evidence, so its properties are tested as evidence properties:
 * append-only, torn tail tolerated, no double-anchoring, and pending selection is exact.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendReceipt, appendBatch, readLedger, pendingReceipts, pendingForDay, batchedReceiptIds,
} from "../src/ledger_store.js";

const rec = (at, fp) => ({ hash: fp, customId: `triad1:${fp}`, v: 1, amount: 42, at, decision: "DENIED" });
const tmp = () => join(mkdtempSync(join(tmpdir(), "ledger-")), "receipts.jsonl");

test("receipts survive a write and read back with their core intact", () => {
  const f = tmp();
  appendReceipt(rec("2026-11-05T01:00:00Z", "aaaaaaaaaaaaaaaa"), f);
  const lines = readLedger(f);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "receipt");
  assert.equal(lines[0].core.amount, 42);
  assert.equal(lines[0].hash, undefined, "hash must not be duplicated into the record");
  assert.equal(lines[0].core.hash, undefined, "core must not carry the hash");
});

test("ids are sequential and stable", () => {
  const f = tmp();
  const a = appendReceipt(rec("2026-11-05T01:00:00Z", "a".repeat(16)), f);
  const b = appendReceipt(rec("2026-11-05T02:00:00Z", "b".repeat(16)), f);
  assert.equal(a.id, "rcpt_000001");
  assert.equal(b.id, "rcpt_000002");
});

test("pending excludes batched receipts and includes the rest", () => {
  const f = tmp();
  const a = appendReceipt(rec("2026-11-05T01:00:00Z", "a".repeat(16)), f);
  appendReceipt(rec("2026-11-05T02:00:00Z", "b".repeat(16)), f);
  assert.equal(pendingReceipts(f).length, 2);
  appendBatch({ txHash: "0xdead", block: 1, root: "f".repeat(64), receiptIds: [a.id] }, f);
  const left = pendingReceipts(f);
  assert.equal(left.length, 1);
  assert.equal(left[0].id, "rcpt_000002");
});

test("the receipt line is byte-identical after a batch is recorded", () => {
  const f = tmp();
  appendReceipt(rec("2026-11-05T01:00:00Z", "a".repeat(16)), f);
  const before = readFileSync(f, "utf8").split("\n")[0];
  appendBatch({ txHash: "0xdead", root: "f".repeat(64), receiptIds: ["rcpt_000001"] }, f);
  const after = readFileSync(f, "utf8").split("\n")[0];
  assert.equal(before, after, "append-only means the original line cannot change");
});

test("an empty batch is refused", () => {
  const f = tmp();
  assert.throws(() => appendBatch({ txHash: "0x1", root: "f".repeat(64), receiptIds: [] }, f), /empty batch|required/);
});

test("the same transaction is not recorded twice", () => {
  const f = tmp();
  appendReceipt(rec("2026-11-05T01:00:00Z", "a".repeat(16)), f);
  appendBatch({ txHash: "0xabc", root: "f".repeat(64), receiptIds: ["rcpt_000001"] }, f);
  const again = appendBatch({ txHash: "0xabc", root: "f".repeat(64), receiptIds: ["rcpt_000001"] }, f);
  assert.equal(again.duplicate, true);
  assert.equal(readLedger(f).filter((l) => l.kind === "batch").length, 1);
});

test("a receipt cannot be anchored by two different batches", () => {
  const f = tmp();
  appendReceipt(rec("2026-11-05T01:00:00Z", "a".repeat(16)), f);
  appendBatch({ txHash: "0x1", root: "f".repeat(64), receiptIds: ["rcpt_000001"] }, f);
  assert.throws(
    () => appendBatch({ txHash: "0x2", root: "e".repeat(64), receiptIds: ["rcpt_000001"] }, f),
    /already batched/,
  );
});

test("a torn final line is skipped, not repaired", () => {
  const f = tmp();
  appendReceipt(rec("2026-11-05T01:00:00Z", "a".repeat(16)), f);
  // Simulate a write that died mid-line: the file ends without a newline and the JSON is truncated.
  const before = readFileSync(f, "utf8");
  // Append only the truncated fragment. (Passing `before + fragment` with flag "a" would write the
  // whole file twice and turn a code test into a test of the test.)
  writeFileSync(f, '{"kind":"receipt","id":"rcpt_0000', { flag: "a" });
  const lines = readLedger(f);
  assert.equal(lines.length, 1, "the partial line is ignored, the complete one is kept");
  // And appending after a torn line must not swallow the new record: the writer has to terminate
  // the dangling line first, otherwise the new receipt is glued onto the fragment and lost too.
  appendReceipt(rec("2026-11-05T03:00:00Z", "c".repeat(16)), f);
  const after = readLedger(f);
  assert.equal(after.filter((l) => l.kind === "receipt").length, 2, "the new receipt must survive a torn tail");
});

test("pendingForDay selects by the receipt's own date", () => {
  const f = tmp();
  appendReceipt(rec("2026-11-05T01:00:00Z", "a".repeat(16)), f);
  appendReceipt(rec("2026-11-06T01:00:00Z", "b".repeat(16)), f);
  assert.equal(pendingForDay("2026-11-05", f).length, 1);
  assert.equal(pendingForDay("2026-11-06", f).length, 1);
  assert.equal(pendingForDay("2026-11-07", f).length, 0);
});

test("batchedReceiptIds is a set of ids, not of hashes", () => {
  const f = tmp();
  appendReceipt(rec("2026-11-05T01:00:00Z", "a".repeat(16)), f);
  appendBatch({ txHash: "0x1", root: "f".repeat(64), receiptIds: ["rcpt_000001"] }, f);
  const ids = batchedReceiptIds(readLedger(f));
  assert.ok(ids.has("rcpt_000001"));
  assert.equal(ids.size, 1);
});
