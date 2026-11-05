/**
 * The anchor has to work with the ledger's actual receipt format.
 *
 * The ledger stores a 16-hex (64-bit) fingerprint because that is what fits a PayPal
 * custom_id. The anchor must accept it — but the anchored leaf is 256 bits, so the on-chain
 * value is not itself a 64-bit target. This test pins both facts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildTree, proofFor, verifyReceiptInBatch, leafHash, expandFingerprint } from "../src/anchor_batch.js";

// A real fingerprint from the local demo, measured 2026-11-05.
const REAL = "53d01de9cebfa289";
const OTHER = "728f5a73d918240d";

test("a 16-hex ledger fingerprint is accepted and produces a 256-bit leaf", async () => {
  const leaf = await leafHash(REAL);
  assert.match(leaf, /^[0-9a-f]{64}$/);
  assert.notEqual(leaf.slice(0, 16), REAL); // the leaf is not the fingerprint truncated
});

test("expandFingerprint validates the ledger format", () => {
  assert.equal(expandFingerprint(REAL), REAL);
  assert.throws(() => expandFingerprint("xyz"), /16-hex/);
  assert.throws(() => expandFingerprint(""), /16-hex/);
});

test("a batch of real ledger fingerprints verifies end to end", async () => {
  const batch = [REAL, OTHER];
  const { root } = await buildTree(batch);
  assert.match(root, /^[0-9a-f]{64}$/);
  const proof = await proofFor(REAL, batch);
  const v = await verifyReceiptInBatch(REAL, proof, root);
  assert.equal(v.ok, true);
});

test("two different fingerprints cannot produce the same leaf", async () => {
  assert.notEqual(await leafHash(REAL), await leafHash(OTHER));
});
