# SETUP — Running Tuesday

The project runs in **two modes**: `MOCK` (no credentials needed — the demo always runs) and
`SANDBOX` (real PayPal sandbox orders). Judges can use either.

---

## 1. Zero-setup (MOCK mode)

```bash
node demo/server.mjs
# open http://localhost:8787
```

No credentials, no installs. The full 3-agent debate, Dissent Map, receipt hashing, and
the money gate all run deterministically against PayPal's *mock* client, so you can see the
complete experience immediately.

---

## 2. Real PayPal sandbox (SANDBOX mode)

The project talks to the PayPal REST API directly — no SDK, no `npm install`.

### Get your own sandbox credentials (2 minutes, free)

1. Go to <https://developer.paypal.com/dashboard/applications/sandbox>
2. Create an app (or open an existing one)
3. Copy its **Client ID** and **Secret**

Then:

```bash
export PAYPAL_CLIENT_ID=<your sandbox client id>
export PAYPAL_CLIENT_SECRET=<your sandbox secret>
export PAYPAL_ENVIRONMENT=SANDBOX
```

- Base URL: `https://api-m.sandbox.paypal.com`
- Sandbox credentials move **test money only** — no real funds.
- Create them fresh for your own run; do not reuse anyone else's.

> **Why we removed our own sandbox keys from this repo:** we had published them here on the
> reasoning that sandbox credentials are test-only. That was the wrong call. A published
> credential is still a published credential — it can be abused, and it trains people to treat
> secrets as shareable. We rotated ours and now read everything from the environment. If you
> deploy this, keep your keys in a secret store (Cloudflare secrets, GitHub Actions secrets,
> `.env` that is git-ignored) and never in the tree.

### Verify against the real API

```bash
node tests/paypalSandbox.live.mjs
```

Expected output (with *your* credentials and your own order id):

```
mode: SANDBOX
token OK (expires_in=..., app_id=APP-XXXXXXXXXXXXX)
receipt hash: <hash> -> custom_id: triad1:<hash>
order OK id=... status=CREATED
round-trip custom_id=triad1:<hash> MATCH=true
ALL LIVE PAYPAL SANDBOX CHECKS PASSED
```

### Verify the official MCP server (agent-facing layer)

```bash
npx -y @paypal/mcp@1.8.1 --tools=all      # with PAYPAL_ACCESS_TOKEN + PAYPAL_ENVIRONMENT=SANDBOX
```

An OAuth token is generated the usual way:

```bash
curl -s https://api-m.sandbox.paypal.com/v1/oauth2/token \
  -H "Accept: application/json" \
  -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
  -d "grant_type=client_credentials"
```

---

## 3. Tests

```bash
node tests/moneyGate.test.js         # money gate: createOrder is 0× on DENIED/DISSENT
bash tests/smoke.sh                  # end-to-end against the running server
node tests/paypalSandbox.live.mjs    # live PayPal sandbox (needs credentials above)
node test_triad.mjs                  # core adjudication unit tests
```

---

## 4. What each test proves

| Test | Proves |
|---|---|
| `moneyGate.test.js` | A DENIED/DISSENT decision **cannot** create a PayPal payment — enforced in code, counted by a spy. |
| `paypalSandbox.live.mjs` | The consensus receipt hash **survives inside a real PayPal `custom_id`** and is retrievable for audit. |
| `smoke.sh` | The full web flow works end-to-end. |

The combination is the point: **the receipt is not a UI decoration — it is stamped into the payment record itself, and a test proves it round-trips.**
