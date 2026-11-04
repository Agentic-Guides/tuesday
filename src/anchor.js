/**
 * anchor.js — blockchain anchoring for the decision receipt.
 *
 * WHY (measured gap, 2026-11-04 audit by an outside reviewer):
 *   The receipt hash is verified by recomputing the ledger entry and comparing its first
 *   16 characters (64 bits) with the stamp in the PayPal order's custom_id. That proves the
 *   stamp did not change. It does NOT prove the ledger itself was not rewritten — the check
 *   trusts our own database.
 *
 *   Anchoring the 32-byte decision hash on a public chain removes exactly that assumption:
 *   anyone can read the chain and compare, without trusting us.
 *
 * DESIGN CONSTRAINTS
 *   - No new runtime dependency. A JSON-RPC POST via fetch is enough for an EVM chain.
 *   - Nothing here moves money. The anchor carries only the hash. No payment logic.
 *   - If no anchor endpoint is configured the module reports `not_configured` and the receipt
 *     says so out loud. It never pretends an anchor exists.
 *   - Anchoring is idempotent per receipt: the transaction hash is stored with the receipt so
 *     a second call does not spend gas twice.
 */

// Read the environment at call time, not at module load.
//
// Measured trap (2026-11-04): the first version captured these into consts at import time, so a
// key added to .env afterwards had no effect until the process was restarted — and the failure
// looked like "the anchor is configured but nothing happens". A function cannot go stale.
function rpcUrl() { return process.env.ANCHOR_RPC_URL || null; }
function rpcKey() { return process.env.ANCHOR_PRIVATE_KEY || null; }
function chainId() { return Number(process.env.ANCHOR_CHAIN_ID || 80002); }

/** True when anchoring can actually run. The UI must not claim otherwise. */
export function anchorConfigured() {
  return Boolean(rpcUrl() && rpcKey());
}

/**
 * Turn a receipt hash into the 32-byte payload an EVM transaction can carry.
 * A transaction's data field can hold arbitrary bytes, so we write the hash itself with a
 * short ASCII prefix that makes it findable by anyone reading the chain:
 *   "tuesday:decision:" + <64 hex chars>
 */
export function anchorPayload(receiptHashHex) {
  const clean = String(receiptHashHex || "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error("anchorPayload: expected a 32-byte hex hash");
  }
  const prefix = "tuesday:decision:";
  let hex = "";
  for (const ch of prefix) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return "0x" + hex + clean;
}

/** Decode a payload back into the receipt hash. Used by the verifier, not by the anchor. */
export function decodePayload(data) {
  const clean = String(data || "").replace(/^0x/, "");
  const prefixHex = [..."tuesday:decision:"]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  if (!clean.startsWith(prefixHex)) return null;
  const hash = clean.slice(prefixHex.length);
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

async function rpc(method, params, id = 1) {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!res.ok) throw new Error(`anchor rpc ${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`anchor rpc ${method}: ${body.error.message || "error"}`);
  return body.result;
}

/**
 * The address that does the anchoring. It is recorded on the receipt so a verifier can check
 * WHO wrote the hash, not only that some address wrote it.
 *
 * Why this matters (48k-audit-data class `signature`, 1,396 findings; `access-control`, 3,848):
 * a bare "tuesday:decision:<hash>" prefix is forgeable by anyone — any address can write the same
 * 16 bytes of prefix followed by any hash. Without recording the sender, a verifier cannot tell our
 * anchor from an impostor's. The sender address is therefore part of the record.
 */
export function anchorAddress() {
  return process.env.ANCHOR_FROM || null;
}

/**
 * Anchor a SINGLE receipt hash. Returns { status, txHash?, chainId?, from?, reason? }.
 *
 * PREFER anchor_batch.js IN PRODUCTION.
 * One transaction per receipt publishes the business's activity volume: anyone reading the
 * anchor address can count adjudications per day. A daily Merkle root (anchor_batch.js) keeps
 * per-receipt verifiability while removing the count. This single-receipt path stays because it
 * is the smallest thing that proves the mechanism end to end on a testnet, and because a batch
 * of one is a legitimate case.
 * status is one of: "anchored" | "already_anchored" | "not_configured" | "failed"
 * This function never throws — a failed anchor must not break the payment path.
 */
export async function anchorReceipt(receipt, { signer = null } = {}) {
  if (!anchorConfigured()) {
    return { status: "not_configured", reason: "ANCHOR_RPC_URL / ANCHOR_PRIVATE_KEY are not set" };
  }
  if (receipt?.anchor?.txHash) {
    return { status: "already_anchored", txHash: receipt.anchor.txHash, chainId: receipt.anchor.chainId };
  }
  if (!receipt?.hash) {
    return { status: "failed", reason: "receipt has no hash to anchor" };
  }

  try {
    const data = anchorPayload(receipt.hash);
    const from = signer || anchorAddress();
    if (!from) {
      return { status: "failed", reason: "ANCHOR_FROM is not set, so the sender cannot be recorded" };
    }
    // A zero-value self-send carries the hash in `data`. No contract, no deployment, no gas
    // beyond a plain transfer. The sender is recorded on the receipt (see anchorAddress above),
    // so the anchor is attributable and a forged anchor from another address is detectable.
    const tx = await rpc("eth_sendTransaction", [{ from, to: from, value: "0x0", data }]);
    return { status: "anchored", txHash: tx, chainId: chainId(), from };
  } catch (err) {
    return { status: "failed", reason: String(err && err.message ? err.message : err).slice(0, 200) };
  }
}

/**
 * Read a transaction back and return the receipt hash it carries, or null.
 * This is the verifier a sceptic would run: it reads the chain, not our database.
 */
export async function readAnchoredHash(txHash) {
  if (!rpcUrl()) throw new Error("readAnchoredHash: ANCHOR_RPC_URL is not set");
  const tx = await rpc("eth_getTransactionByHash", [txHash]);
  if (!tx) return null;
  return decodePayload(tx.input || tx.data);
}

/**
 * Read an anchor back AND check that the expected address wrote it.
 *
 * A hash read off the chain proves someone anchored it. It does not prove we did. This is the
 * check a sceptic actually needs: `{ hash, matches, from, expectedFrom }`.
 */
export async function verifyAnchor(txHash, expectedFrom) {
  if (!rpcUrl()) throw new Error("verifyAnchor: ANCHOR_RPC_URL is not set");
  const tx = await rpc("eth_getTransactionByHash", [txHash]);
  if (!tx) return { found: false, hash: null, matches: false, from: null, expectedFrom: expectedFrom || null };
  const hash = decodePayload(tx.input || tx.data);
  const from = (tx.from || "").toLowerCase();
  const want = (expectedFrom || "").toLowerCase();
  return {
    found: true,
    hash,
    from: tx.from || null,
    expectedFrom: expectedFrom || null,
    matches: Boolean(hash) && (!want || from === want),
  };
}
