/**
 * anchor_daily.mjs — fire one anchor batch per day for yesterday's receipts.
 *
 * Spec (agreed 2026-11-05):
 *   1. pending == 0  -> do not send; write a local log line and exit 0 (an empty batch is banned)
 *   2. balance < 0.1 POL -> do not send; report and exit 2 (gas depletion guard)
 *   3. build the batch from the FULL SHA-256 of each receipt core; verify every proof locally
 *   4. nonce read from the chain at send time (never a stored constant)
 *   5. sign with ethers (devDependency) and send
 *   6. read back: from == ANCHOR_FROM and chain root == local root; record tx + block in the ledger
 *   7. publish the batch record so a third party can recompute without trusting this machine
 *
 * Failure policy: name the stage, stop, exit non-zero. Never "succeed" partially.
 * Double-fire protection: the ledger's batch mark plus a nonce read immediately before sending.
 *
 * Usage:
 *   node scripts/anchor_daily.mjs                 # yesterday (JST)
 *   node scripts/anchor_daily.mjs --day 2026-11-05
 *   node scripts/anchor_daily.mjs --dry-run       # everything except signing/sending
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../src/receipt.js";
import { buildTree, proofFor, verifyReceiptInBatch, batchPayload } from "../src/anchor_batch.js";
import { pendingForDay, appendBatch, readLedger, batchedReceiptIds } from "../src/ledger_store.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const LEDGER = join(ROOT, "data", "receipts.jsonl");
const RUNLOG = join(ROOT, "data", "anchor_daily.log");
const PUBLISH_DIR = join(ROOT, "docs", "devpost", "anchors");
const MIN_BALANCE_WEI = 100_000_000_000_000_000n; // 0.1 POL

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const dayArg = args.indexOf("--day");
const DAY = dayArg >= 0 ? args[dayArg + 1] : yesterdayJst();

function yesterdayJst() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  mkdirSync(dirname(RUNLOG), { recursive: true });
  appendFileSync(RUNLOG, line + "\n");
  console.log(line);
}

function die(stage, msg, code = 1) {
  log(`FAIL[${stage}] ${msg}`);
  process.exit(code);
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
  return body.result;
}

// ---- 0. configuration ------------------------------------------------
const RPC = process.env.ANCHOR_RPC_URL;
const FROM = process.env.ANCHOR_FROM;
const CHAIN_ID = Number(process.env.ANCHOR_CHAIN_ID || 80002);
const KEY = process.env.ANCHOR_PRIVATE_KEY || "";
if (!RPC) die("0-config", "ANCHOR_RPC_URL is not set");
if (!FROM) die("0-config", "ANCHOR_FROM is not set");
log(`day=${DAY} dryRun=${DRY} from=${FROM}`);

// ---- 1. pending receipts --------------------------------------------
const pending = pendingForDay(DAY, LEDGER);
if (pending.length === 0) {
  log("no pending receipts for this day — nothing sent (an empty batch is never fired)");
  process.exit(0);
}
log(`pending=${pending.length} ids=${pending.map((r) => r.id).join(",")}`);

// ---- 2. balance ------------------------------------------------------
const bal = BigInt(await rpc(RPC, "eth_getBalance", [FROM, "latest"]));
log(`balance=${bal} wei`);
if (bal < MIN_BALANCE_WEI) {
  die("2-balance", `balance ${bal} wei is below the ${MIN_BALANCE_WEI} wei floor — not sending`, 2);
}

// ---- 3. build and verify locally -------------------------------------
const fulls = pending.map((r) => createHash("sha256").update(canonicalize(r.core)).digest("hex"));
// Every fingerprint we just recomputed must match the one recorded when the receipt was made.
pending.forEach((r, i) => {
  if (r.fp16 && fulls[i].slice(0, 16) !== r.fp16) {
    die("3-build", `receipt ${r.id}: recomputed fingerprint does not match the ledger's fp16 (tampered?)`);
  }
});

const { root, leaves } = await buildTree(fulls);
if (!root) die("3-build", "empty root");
for (let i = 0; i < fulls.length; i += 1) {
  const p = await proofFor(fulls[i], fulls);
  const v = await verifyReceiptInBatch(fulls[i], p, root);
  if (!v.ok) die("3-build", `proof ${i} failed locally: ${v.reason}`);
}
log(`root=${root} leaves=${leaves.length} proofs=all ok`);

if (DRY) {
  log("dry run — not signing, not sending");
  process.exit(0);
}

// ---- 4/5. sign and send ---------------------------------------------
if (!/^[0-9a-fA-F]{64}$/.test(KEY.replace(/^0x/, ""))) die("4-key", "ANCHOR_PRIVATE_KEY missing or not 32 bytes");

const { createRequire } = await import("node:module");
const require = createRequire(join(ROOT, "package.json"));
const { Wallet, JsonRpcProvider } = require("ethers");

const wallet = new Wallet("0x" + KEY.replace(/^0x/, ""));
if (wallet.address.toLowerCase() !== FROM.toLowerCase()) {
  die("4-key", `key derives ${wallet.address}, expected ${FROM}`);
}
const provider = new JsonRpcProvider(RPC, CHAIN_ID);
const nonce = await provider.getTransactionCount(FROM, "pending"); // read at send time, never stored
log(`nonce=${nonce} (read from the chain)`);

const fees = await provider.getFeeData();
let sent;
try {
  sent = await wallet.connect(provider).sendTransaction({
    to: FROM, value: 0n, data: batchPayload(root), chainId: CHAIN_ID, nonce,
    gasLimit: 100000n,
    maxFeePerGas: fees.maxFeePerGas ?? fees.gasPrice,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n,
  });
} catch (e) {
  die("5-send", `send failed: ${e && e.message ? e.message : e}`);
}
log(`sent tx=${sent.hash}`);
const rc = await sent.wait(1);
if (!rc || rc.status !== 1) die("5-send", `transaction did not succeed (status ${rc && rc.status})`);

// ---- 6. read back ----------------------------------------------------
const tx = await rpc(RPC, "eth_getTransactionByHash", [sent.hash]);
// Read the payload by HEX, not by decoding it as text.
// batchPayload() writes the 32 raw bytes of the root after the ASCII prefix; an earlier manual
// send wrote the 64-character hex string instead. Both are legitimate, and a text decode turns the
// raw-bytes form into mojibake — which is exactly how the first automated run reported a false
// mismatch on a transaction that was actually correct.
const hexInput = (tx.input || tx.data || "").replace(/^0x/, "").toLowerCase();
const prefixHex = Buffer.from("tuesday:batch:", "utf8").toString("hex");
let chainRoot = null;
if (hexInput.startsWith(prefixHex)) {
  const rest = hexInput.slice(prefixHex.length);
  if (/^[0-9a-f]{64}$/.test(rest)) {
    chainRoot = rest; // 32 raw bytes
  } else if (/^[0-9a-f]{128}$/.test(rest)) {
    chainRoot = Buffer.from(rest, "hex").toString("utf8"); // the 64-char hex string, written as text
  }
}
if ((tx.from || "").toLowerCase() !== FROM.toLowerCase()) die("6-verify", `sender ${tx.from} != ${FROM}`);
if (chainRoot !== root) die("6-verify", `chain root ${chainRoot} != local root ${root}`);
log(`verified from=${tx.from} root=${chainRoot} block=${rc.blockNumber}`);

// record in the ledger (append-only; the receipt lines are untouched)
appendBatch({
  txHash: sent.hash,
  block: rc.blockNumber,
  root,
  receiptIds: pending.map((r) => r.id),
  anchoredAt: new Date().toISOString(),
}, LEDGER);
log(`ledger updated: ${pending.length} receipt(s) marked batched`);

// ---- 7. publish ------------------------------------------------------
mkdirSync(PUBLISH_DIR, { recursive: true });
const proofs = [];
for (let i = 0; i < fulls.length; i += 1) {
  const p = await proofFor(fulls[i], fulls);
  proofs.push({ id: pending[i].id, leaf: p.leaf, proof: p.proof });
}
const record = {
  _what: "An anchor batch: the receipt cores, the expected values, and the transaction that carries them.",
  _how_to_recompute: [
    "full = SHA-256(canonicalize(core))  — canonicalize: keys sorted recursively",
    "leaf = SHA-256('tuesday:leaf:' + full)",
    "parent(a,b) = SHA-256(bytes(min(a,b) + max(a,b)))",
    "odd node at a level is promoted unchanged",
    "root = walk up to the single remaining node",
  ],
  day: DAY,
  txHash: sent.hash,
  block: rc.blockNumber,
  chainId: CHAIN_ID,
  from: FROM,
  root,
  onChainPayload: batchPayload(root),
  receipts: pending.map(({ id, at, fp16, core }) => ({ id, at, fp16, core })),
  expected_full_sha256: fulls,
  expected_leaves: leaves,
  proofs,
  verifiedAt: new Date().toISOString(),
};
const out = join(PUBLISH_DIR, `batch-${DAY}.json`);
writeFileSync(out, JSON.stringify(record, null, 1) + "\n", "utf8");
log(`published ${out}`);

console.log(JSON.stringify({
  day: DAY, txHash: sent.hash, block: rc.blockNumber, receipts: pending.length, root,
}, null, 1));
