/**
 * Merkle batch tests. Deterministic, no network.
 * The point of these tests is the two properties the design depends on:
 *   1. a receipt in the batch verifies against the anchored root using only its own proof;
 *   2. a receipt NOT in the batch cannot be made to verify, and no count is recoverable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTree, proofFor, verifyReceiptInBatch, leafHash, parentHash,
  batchPayload, decodeBatchPayload,
} from "../src/anchor_batch.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const OUTSIDER = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

test("an empty batch has no root, not a fabricated one", async () => {
  const t0 = await buildTree([]);
  assert.equal(t0.root, null);
  assert.deepEqual(t0.leaves, []);
});

test("a single receipt roots to its own leaf", async () => {
  const tree = await buildTree([A]);
  assert.equal(tree.root, await leafHash(A));
});

test("every member verifies against the root with only its own proof", async () => {
  const batch = [A, B, C, D];
  const { root } = await buildTree(batch);
  for (const h of batch) {
    const proof = await proofFor(h, batch);
    const v = await verifyReceiptInBatch(h, proof, root);
    assert.equal(v.ok, true, `failed for ${h.slice(0, 8)}`);
  }
});

test("a receipt outside the batch does not verify", async () => {
  const batch = [A, B, C, D];
  const { root } = await buildTree(batch);
  assert.equal(await proofFor(OUTSIDER, batch), null);
  const bogus = await proofFor(A, batch);
  bogus.leaf = await leafHash(OUTSIDER);
  const v = await verifyReceiptInBatch(OUTSIDER, bogus, root);
  assert.equal(v.ok, false);
});

test("tampering with one receipt changes the root", async () => {
  const before = await buildTree([A, B, C]);
  const after = await buildTree([A, D, C]);
  assert.notEqual(before.root, after.root);
});

test("parentHash is order independent", async () => {
  assert.equal(await parentHash(A, B), await parentHash(B, A));
});

test("odd leaf counts still verify (node promoted)", async () => {
  for (const size of [1, 3, 5, 7]) {
    const batch = [A, B, C, D, OUTSIDER].slice(0, size);
    const { root } = await buildTree(batch);
    for (const h of batch) {
      const v = await verifyReceiptInBatch(h, await proofFor(h, batch), root);
      assert.equal(v.ok, true, `size ${size}`);
    }
  }
});

test("the on-chain payload carries the root and round-trips", async () => {
  const { root } = await buildTree([A, B]);
  assert.equal(decodeBatchPayload(batchPayload(root)), root);
});

test("the payload reveals no receipt hash", async () => {
  const { root } = await buildTree([A, B]);
  const payload = batchPayload(root);
  assert.ok(!payload.includes(A));
  assert.ok(!payload.includes(B));
});

test("a payload without the batch prefix is rejected", () => {
  assert.equal(decodeBatchPayload("0x" + A), null);
});
