/**
 * anchor_batch.js — anchor many receipts with one transaction (Merkle root).
 *
 * WHY (measured concern, 2026-11-04):
 *   Anchoring one transaction per receipt publishes the business's activity volume for free:
 *   anyone reading the anchor address can count how many adjudications Tuesday handled per day.
 *   That is a real leak, and the standard fix is not to hide the chain — it is to reduce the
 *   granularity. A daily Merkle root keeps per-receipt verifiability while removing the count.
 *
 * WHAT STAYS VERIFIABLE
 *   A holder of a receipt can recompute its leaf, take the proof from the batch record, and walk
 *   up to the root. If the root is on-chain, the receipt is proven without revealing any sibling
 *   receipt, and without revealing how many siblings there are beyond the proof length.
 *
 * DESIGN NOTES
 *   - Pure functions only here; the transaction itself lives in anchor.js.
 *   - Leaf = SHA-256("tuesday:leaf:" + receiptHash). The prefix stops a leaf hash from being
 *     confused with a receipt hash elsewhere in the system.
 *   - Odd node promoted unchanged (Bitcoin-style), so the tree is deterministic for any size.
 *   - An empty batch has no root. It must return null, never a fabricated hash.
 */

/* global crypto, TextEncoder */
const enc = new TextEncoder();

async function sha256Hex(input) {
  const data = typeof input === "string" ? enc.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Leaf hash for one receipt. Deterministic and prefixed. */
export async function leafHash(receiptHash) {
  const clean = String(receiptHash || "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("leafHash: expected a 32-byte hex hash");
  return sha256Hex("tuesday:leaf:" + clean);
}

/** Hash two children. Sorted, so order does not change the parent (no second-preimage games). */
export async function parentHash(a, b) {
  const [x, y] = [a, b].sort();
  return sha256Hex(hexToBytes(x + y));
}

/**
 * Build a Merkle tree.
 * Returns { root, leaves, levels } where levels[0] is the leaf level and the last level is [root].
 * Returns { root: null, leaves: [], levels: [] } for an empty input — never a fake root.
 */
export async function buildTree(receiptHashes) {
  const hashes = (receiptHashes || []).filter(Boolean);
  if (hashes.length === 0) return { root: null, leaves: [], levels: [] };

  const leaves = [];
  for (const h of hashes) leaves.push(await leafHash(h));

  const levels = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 === current.length) next.push(current[i]); // odd node promoted
      else next.push(await parentHash(current[i], current[i + 1]));
    }
    levels.push(next);
    current = next;
  }
  return { root: current[0], leaves, levels };
}

/**
 * Merkle proof for one receipt: the sibling hashes from leaf to root.
 * Returns null if the receipt is not in the tree.
 */
export async function proofFor(receiptHash, receiptHashes) {
  const { leaves, levels, root } = await buildTree(receiptHashes);
  if (!root) return null;
  const leaf = await leafHash(receiptHash);
  let idx = leaves.indexOf(leaf);
  if (idx < 0) return null;

  const proof = [];
  for (let level = 0; level < levels.length - 1; level += 1) {
    const nodes = levels[level];
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sibling < nodes.length) proof.push({ hash: nodes[sibling], right: idx % 2 === 0 });
    idx = Math.floor(idx / 2);
  }
  return { leaf, root, proof };
}

/** Recompute the root from a leaf and its proof. This is what a verifier runs. */
export async function rootFromProof(leaf, proof) {
  let acc = leaf;
  for (const step of proof) {
    acc = step.right ? await parentHash(acc, step.hash) : await parentHash(step.hash, acc);
  }
  return acc;
}

/**
 * Verify a receipt against a claimed root.
 * Returns { ok, computedRoot, reason }.
 */
export async function verifyReceiptInBatch(receiptHash, proof, claimedRoot) {
  if (!proof || !claimedRoot) return { ok: false, computedRoot: null, reason: "missing proof or root" };
  const expectedLeaf = await leafHash(receiptHash);
  if (expectedLeaf !== proof.leaf) {
    return { ok: false, computedRoot: null, reason: "leaf does not match this receipt" };
  }
  const computed = await rootFromProof(proof.leaf, proof.proof);
  if (computed !== claimedRoot) {
    return { ok: false, computedRoot: computed, reason: "recomputed root differs from the anchored root" };
  }
  return { ok: true, computedRoot: computed, reason: null };
}

/** The payload written on-chain for a batch: the root, prefixed so it is findable. */
export function batchPayload(root) {
  const clean = String(root || "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("batchPayload: expected a 32-byte hex root");
  const prefix = "tuesday:batch:";
  let hex = "";
  for (const ch of prefix) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return "0x" + hex + clean;
}

/** Read a root back out of an on-chain payload. */
export function decodeBatchPayload(data) {
  const clean = String(data || "").replace(/^0x/, "");
  const prefixHex = [..."tuesday:batch:"]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  if (!clean.startsWith(prefixHex)) return null;
  const root = clean.slice(prefixHex.length);
  return /^[0-9a-f]{64}$/.test(root) ? root : null;
}

export { sha256Hex, bytesToHex, hexToBytes };
