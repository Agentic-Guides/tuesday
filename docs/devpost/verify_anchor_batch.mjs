/**
 * verify_anchor_batch.mjs — recompute an anchor batch root WITHOUT importing src/.
 *
 * Usage: node docs/devpost/verify_anchor_batch.mjs docs/devpost/anchors/batch-2026-11-05.json
 *
 * Deliberately standalone: if this agrees with the published root, the agreement is a second
 * implementation of the documented rule, not the same code checking itself.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const file = process.argv[2];
if (!file) {
  console.error("usage: node verify_anchor_batch.mjs <batch-record.json>");
  process.exit(2);
}
const doc = JSON.parse(readFileSync(file, "utf8"));

function canon(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const shaBytes = (h) => createHash("sha256").update(Buffer.from(h, "hex")).digest("hex");
const parent = (a, b) => shaBytes(a < b ? a + b : b + a);

const fulls = doc.receipts.map((r) => sha(canon(r.core)));
const leaves = fulls.map((f) => sha("tuesday:leaf:" + f));
const expectedLeaves = doc.receipts.map((r) => r.fp16);

let bad = 0;
fulls.forEach((f, i) => {
  const fp = doc.expected_full_sha256?.[i];
  if (fp && f !== fp) { console.log(`full[${i}] MISMATCH`); bad += 1; }
  if (expectedLeaves[i] && f.slice(0, 16) !== expectedLeaves[i]) {
    console.log(`fp16[${i}] MISMATCH: recomputed ${f.slice(0, 16)} vs ledger ${expectedLeaves[i]}`);
    bad += 1;
  }
});

// Build the tree: promote an odd node unchanged at each level.
let level = leaves.slice();
const levels = [level];
while (level.length > 1) {
  const next = [];
  for (let i = 0; i < level.length; i += 2) {
    next.push(i + 1 === level.length ? level[i] : parent(level[i], level[i + 1]));
  }
  levels.push(next);
  level = next;
}
const root = level[0];

console.log("receipts :", doc.receipts.length);
console.log("root     :", root);
console.log("published:", doc.root);
console.log("match    :", root === doc.root);
process.exit(root === doc.root && bad === 0 ? 0 : 1);
