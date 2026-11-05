/**
 * The anchor target is the FULL SHA-256 of a receipt, not the 16-hex fingerprint.
 *
 * The 16-hex form exists so the value fits a PayPal custom_id. Truncating for transport and then
 * anchoring the truncation would have carried a 64-bit caveat into the chain. The full hash is
 * recomputable from the receipt itself, so nothing extra needs storing and the caveat disappears.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildReceipt, fingerprintFull, canonicalize, fingerprint } from "../src/receipt.js";
import { leafHash, buildTree, proofFor, verifyReceiptInBatch } from "../src/anchor_batch.js";

const EXAMPLE = {
  decision: "DENIED",
  threshold: 2,
  purchase: { id: "p1", amount: 42, category: "skincare" },
  arguments: {
    advocate: { verdict: "for", model: "deepseek", reasons: "a" },
    auditor: { verdict: "against", model: "gemma", reasons: "b" },
    witness: { verdict: "against", model: "gpt-oss", reasons: "c" },
  },
};

test("the full hash is 256 bits and its prefix is the ledger fingerprint", () => {
  const r = buildReceipt(EXAMPLE, { engine: "llm", at: "2026-11-05T03:00:16.491Z" });
  const full = fingerprintFull(r);
  assert.equal(full.length, 64);
  assert.equal(full.slice(0, 16), r.hash);
});

test("the full hash is reproducible from the receipt alone", () => {
  const r = buildReceipt(EXAMPLE, { engine: "llm", at: "2026-11-05T03:00:16.491Z" });
  assert.equal(fingerprintFull(r), fingerprintFull(r));
});

test("a tampered receipt cannot produce a full hash", () => {
  const r = buildReceipt(EXAMPLE, { engine: "llm", at: "2026-11-05T03:00:16.491Z" });
  assert.throws(() => fingerprintFull({ ...r, amount: 43 }), /does not match/);
});

test("a missing hash is refused rather than silently recomputed", () => {
  assert.throws(() => fingerprintFull({ amount: 42 }), /hash missing/);
});

test("the full hash can be anchored and verified as a batch member", async () => {
  const r1 = buildReceipt(EXAMPLE, { engine: "llm", at: "2026-11-05T03:00:16.491Z" });
  const r2 = buildReceipt(EXAMPLE, { engine: "llm", at: "2026-11-05T03:00:17.491Z" });
  const batch = [fingerprintFull(r1), fingerprintFull(r2)];
  const { root } = await buildTree(batch);
  const proof = await proofFor(batch[0], batch);
  const v = await verifyReceiptInBatch(batch[0], proof, root);
  assert.equal(v.ok, true);
  // and the leaf is not merely the full hash echoed back
  assert.notEqual(await leafHash(batch[0]), batch[0]);
});

test("canonicalize is stable across key order", () => {
  assert.equal(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
});
