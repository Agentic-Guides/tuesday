#!/usr/bin/env bash
# TRIAD E2E smoke test — boots the real demo server and drives the API.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=8899
export PORT
node demo/server.mjs >/tmp/triad-demo.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

# wait for readiness
for i in $(seq 1 40); do
  curl -s "http://localhost:$PORT/api/ledger" >/dev/null 2>&1 && break
  sleep 0.25
done

B="http://localhost:$PORT"
echo "── adjudicate (in budget) ──"
ADJ=$(curl -s -X POST "$B/api/adjudicate" -H 'Content-Type: application/json' \
  -d '{"amount":45,"category":"books","reason":"study","monthlyBudget":500,"spentThisMonth":50}')
PID=$(echo "$ADJ" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.purchase.id)})')
echo "$ADJ" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("decision:",j.decision);console.log("receipt :",j.receipt.customId)})'

echo "── create order ──"
ORD=$(curl -s -X POST "$B/api/order" -H 'Content-Type: application/json' -d "{\"purchaseId\":\"$PID\"}")
echo "$ORD" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("ok:",j.ok,"orderId:",j.orderId);console.log("audit:",JSON.stringify(j.audit))})'
OID=$(echo "$ORD" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).orderId)})')

echo "── capture ──"
curl -s -X POST "$B/api/capture" -H 'Content-Type: application/json' -d "{\"orderId\":\"$OID\"}" | head -c 300; echo

echo "── verify audit trail ──"
curl -s -X POST "$B/api/verify" -H 'Content-Type: application/json' -d "{\"orderId\":\"$OID\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify(j,null,2))})'

echo "── denied purchase cannot mint an order ──"
ADJ2=$(curl -s -X POST "$B/api/adjudicate" -H 'Content-Type: application/json' \
  -d '{"amount":5000,"category":"luxury watch","reason":"impulse","monthlyBudget":1000,"spentThisMonth":900}')
PID2=$(echo "$ADJ2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).purchase.id)})')
echo "$ADJ2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log("decision:",JSON.parse(s).decision)})'
curl -s -X POST "$B/api/order" -H 'Content-Type: application/json' -d "{\"purchaseId\":\"$PID2\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log("order:",JSON.stringify(JSON.parse(s)))})'

echo "── ledger ──"
curl -s "$B/api/ledger" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("entries:",j.count);j.entries.forEach(e=>console.log(" ",e.decision,e.customId))})'
echo "── done ──"
