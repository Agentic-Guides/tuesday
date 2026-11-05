/**
 * The on-chain payload must be readable in both forms that exist in the wild.
 *
 * History: the manual send wrote "tuesday:batch:" + the 64-char hex string as TEXT.
 * batchPayload() writes "tuesday:batch:" + the 32 raw bytes. When the first automated run decoded
 * the transaction as text, the raw-bytes form turned into mojibake and the run reported a false
 * mismatch on a transaction that was correct. This test pins both decodings.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { batchPayload } from "../src/anchor_batch.js";

const ROOT = "25ee365c3f735354197ae49a6337d5f920965ba8f4775b51d993d51b5286bd43";
const PREFIX = Buffer.from("tuesday:batch:", "utf8").toString("hex");

// The same logic the cron uses, kept here so a regression fails a test instead of a batch.
function decodeRoot(hexInput) {
  const h = String(hexInput).replace(/^0x/, "").toLowerCase();
  if (!h.startsWith(PREFIX)) return null;
  const rest = h.slice(PREFIX.length);
  if (/^[0-9a-f]{64}$/.test(rest)) return rest;
  if (/^[0-9a-f]{128}$/.test(rest)) return Buffer.from(rest, "hex").toString("utf8");
  return null;
}

test("batchPayload writes the 32 raw bytes of the root", () => {
  const p = batchPayload(ROOT);
  const body = p.replace(/^0x/, "").slice(PREFIX.length);
  assert.equal(body.length, 64, "32 bytes = 64 hex chars");
  assert.equal(body, ROOT);
});

test("the raw-bytes form decodes to the root", () => {
  assert.equal(decodeRoot(batchPayload(ROOT)), ROOT);
});

test("the text form written by the manual send also decodes", () => {
  const textForm = "0x" + PREFIX + Buffer.from(ROOT, "utf8").toString("hex");
  assert.equal(decodeRoot(textForm), ROOT);
});

test("a payload without the prefix is rejected", () => {
  assert.equal(decodeRoot("0x" + ROOT), null);
});

test("decoding the raw form as text produces mojibake — the bug this test exists for", () => {
  const raw = Buffer.from(ROOT, "hex");
  const asText = raw.toString("utf8");
  assert.notEqual(asText, ROOT, "a text decode of 32 raw bytes cannot equal the hex string");
});
