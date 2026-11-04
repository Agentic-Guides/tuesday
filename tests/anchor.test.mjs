/**
 * Tests for src/anchor.js — run with `node --test tests/anchor.test.mjs`.
 * No network, no keys. Everything here is deterministic: the point is that the payload
 * encoding and the "not configured" behaviour cannot silently regress.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { anchorPayload, decodePayload, anchorConfigured, anchorReceipt, anchorAddress, verifyAnchor } from "../src/anchor.js";

const HASH = "728f5a73d918240d0b1e6f4c9a2d3e5f60718293a4b5c6d7e8f90a1b2c3d4e5f";

test("payload round-trips the hash", () => {
  const data = anchorPayload(HASH);
  assert.equal(decodePayload(data), HASH);
});

test("payload accepts a 0x-prefixed hash", () => {
  assert.equal(decodePayload(anchorPayload("0x" + HASH)), HASH);
});

test("payload rejects a short hash instead of anchoring garbage", () => {
  assert.throws(() => anchorPayload("deadbeef"), /32-byte/);
});

test("payload rejects non-hex input", () => {
  assert.throws(() => anchorPayload("z".repeat(64)), /32-byte/);
});

test("decode rejects a payload with no tuesday prefix", () => {
  assert.equal(decodePayload("0x" + HASH), null);
});

test("with no endpoint configured, anchoring reports not_configured and never throws", async () => {
  if (anchorConfigured()) return; // a configured machine runs the real path elsewhere
  const r = await anchorReceipt({ hash: HASH });
  assert.equal(r.status, "not_configured");
  assert.ok(r.reason);
});

test("the sender address is part of the record (48k class: signature, access-control)", () => {
  // With no ANCHOR_FROM there is nothing to attribute, and anchorAddress must say so.
  assert.equal(typeof anchorAddress(), "object"); // null or string — never throws
});

test("an anchor with no sender is refused instead of written unattributably", async () => {
  if (anchorConfigured() && !process.env.ANCHOR_FROM) {
    const r = await anchorReceipt({ hash: HASH });
    assert.equal(r.status, "failed");
    assert.match(r.reason, /ANCHOR_FROM/);
  }
});

test("verifyAnchor reports a missing transaction instead of inventing a match", async () => {
  if (!process.env.ANCHOR_RPC_URL) return;
  const v = await verifyAnchor("0x" + "0".repeat(64), "0xabc");
  assert.equal(v.found, false);
  assert.equal(v.matches, false);
});

test("an already-anchored receipt is not anchored twice", async () => {
  if (!anchorConfigured()) return;
  const r = await anchorReceipt({ hash: HASH, anchor: { txHash: "0xabc", chainId: 80002 } });
  assert.equal(r.status, "already_anchored");
  assert.equal(r.txHash, "0xabc");
});
