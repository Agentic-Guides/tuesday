/**
 * Fail-open guarantee: anchoring must never break the payment path.
 *
 * Measured risk: if anchorReceipt() threw on a network error, a receipt that is otherwise
 * valid could fail to finalise because a testnet was down. That would be a regression in the
 * money path caused by an optional evidence feature. This test pins the behaviour.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { anchorReceipt, anchorConfigured } from "../src/anchor.js";

const HASH = "728f5a73d918240d0b1e6f4c9a2d3e5f60718293a4b5c6d7e8f90a1b2c3d4e5f";

test("an unreachable endpoint returns failed, never throws", async () => {
  const saved = process.env.ANCHOR_RPC_URL;
  process.env.ANCHOR_RPC_URL = "https://127.0.0.1:9/definitely-not-a-chain";
  process.env.ANCHOR_PRIVATE_KEY = "0x" + "11".repeat(32);
  process.env.ANCHOR_FROM = "0x1035D7347242Ee0977b3b76Ac89c4B176845a560";
  try {
    const r = await anchorReceipt({ hash: HASH });
    assert.ok(["failed", "not_configured"].includes(r.status), r.status);
    assert.ok(r.reason);
  } finally {
    if (saved === undefined) delete process.env.ANCHOR_RPC_URL;
    else process.env.ANCHOR_RPC_URL = saved;
    delete process.env.ANCHOR_PRIVATE_KEY;
    delete process.env.ANCHOR_FROM;
  }
});

test("a receipt with no hash reports failed rather than anchoring nothing", async () => {
  const r = await anchorReceipt({});
  assert.equal(r.status, anchorConfigured() ? "failed" : "not_configured");
});
