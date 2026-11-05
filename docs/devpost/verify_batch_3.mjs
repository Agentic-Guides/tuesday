/**
 * verify_batch_3.mjs — independently recompute the batch root from the receipt cores.
 *
 * Deliberately does NOT import src/receipt.js or src/anchor_batch.js. If this script agrees with
 * the committed root, that agreement is not circular: it is a second implementation of the same
 * documented rule (canonicalize → SHA-256 → leaf → sorted-parent Merkle).
 *
 * Run: node docs/devpost/verify_batch_3.mjs
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const here = new URL(".", import.meta.url);
const doc = JSON.parse(readFileSync(new URL("anchor_batch_3_receipts.json", here), "utf8"));

// JSON.stringify with recursively sorted object keys, matching src/receipt.js canonicalize().
function canon(v) {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const shaBytes = (hex) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const parent = (a, b) => shaBytes(a < b ? a + b : b + a); // sorted children, hex bytes concatenated

let ok = true;
const fulls = doc.receipts.map((c) => sha(canon(c)));
fulls.forEach((f, i) => {
  const want = doc.expected_full_sha256[i];
  if (f !== want) { ok = false; console.log(`full[${i}] MISMATCH`); }
});

const leaves = fulls.map((f) => sha("tuesday:leaf:" + f));
leaves.forEach((l, i) => {
  if (l !== doc.expected_leaves[i]) { ok = false; console.log(`leaf[${i}] MISMATCH`); }
});

// n = 3: pair 0-1, promote leaf 2 unchanged, then hash the two level-1 nodes.
const level1 = [parent(leaves[0], leaves[1]), leaves[2]];
const root = parent(level1[0], level1[1]);

console.log("canonical lengths :", doc.receipts.map((c) => canon(c).length).join(", "));
console.log("root (recomputed) :", root);
console.log("root (committed)  :", doc.expected_root);
console.log("match             :", root === doc.expected_root);
console.log("all checks        :", ok && root === doc.expected_root ? "PASS" : "FAIL");
process.exit(ok && root === doc.expected_root ? 0 : 1);
