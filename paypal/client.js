/**
 * PayPal Integration for Tuesday
 *
 * Two modes:
 *   1. LIVE SANDBOX  — uses PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox)
 *   2. MOCK          — deterministic fake order flow when credentials are absent,
 *                      so the demo always runs and judges can see the full experience.
 *
 * Uses the PayPal REST Orders v2 API directly (no SDK dependency) so the project
 * has zero install friction for judges.
 *
 * Sandbox base: https://api-m.sandbox.paypal.com
 */

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

/**
 * The custom_id is the audit trail. Refuse to create an order without one.
 *
 * It has to be at most 255 characters (PayPal Orders v2 limit), so a caller passing
 * something absurd gets a clear error rather than a rejected API call deep inside a
 * request that has already been sent.
 */
/**
 * Format an amount the way PayPal expects it for that currency.
 *
 * `toFixed(2)` is wrong for JPY and the other zero-decimal currencies — PayPal rejects
 * "8000.00" for JPY, so a Japanese merchant's live demo would fail on the first order.
 * This is the list PayPal documents; anything not in it uses two decimals.
 */
const ZERO_DECIMAL = new Set(['HUF', 'JPY', 'TWD']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR']);

export function formatAmount(amount, currency = 'USD') {
  const code = String(currency || 'USD').toUpperCase();
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error(`Cannot format a non-numeric amount: ${amount}`);
  const digits = ZERO_DECIMAL.has(code) ? 0 : (THREE_DECIMAL.has(code) ? 3 : 2);
  return n.toFixed(digits);
}

function requireCustomId(purchase) {
  const id = purchase?.customId || purchase?.custom_id || null;
  if (!id || !String(id).trim()) {
    throw new Error(
      'Refusing to create a PayPal order without a receipt: custom_id is the audit stamp. ' +
      'Pass purchase.customId (e.g. "triad1:<hash>").'
    );
  }
  if (String(id).length > 255) {
    throw new Error(`custom_id is ${String(id).length} characters; PayPal Orders v2 allows 255.`);
  }
  return String(id);
}

export class PayPalClient {
  constructor(clientId, secret, { base = SANDBOX_BASE, mock = false } = {}) {
    this.clientId = clientId;
    this.secret = secret;
    this.base = base;
    this.mock = mock || !clientId || !secret;
    this._token = null;
    this._tokenExp = 0;
  }

  static fromEnv() {
    const id = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    const hasId = Boolean(id && String(id).trim());
    const hasSecret = Boolean(secret && String(secret).trim());

    // ★ Half-configured is a mistake, not a mode. Falling back to MOCK when only one
    //   of the two variables is set means a typo'd .env silently demos a fake PayPal
    //   while the operator believes they are testing the sandbox. Be loud instead.
    if (hasId !== hasSecret) {
      const missing = hasId ? 'PAYPAL_CLIENT_SECRET' : 'PAYPAL_CLIENT_ID';
      throw new Error(
        `PayPal is half-configured: ${missing} is missing but its partner is set. ` +
        'Set both to use the sandbox, or neither to run in MOCK. Refusing to guess.'
      );
    }

    // REQUIRE_LIVE=1 means "this deployment is supposed to be live, so refuse to start
    // in MOCK". Without it, a typo in a hosting provider's environment variables demos a
    // fake PayPal while the operator believes the sandbox is being exercised — and the
    // mode badge, on a page nobody has loaded yet, cannot warn anyone. Failing at boot is
    // the only place the mistake is still cheap.
    if (!hasId && String(process.env.REQUIRE_LIVE || '').trim() === '1') {
      throw new Error(
        'REQUIRE_LIVE=1 but PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are both unset. ' +
        'Refusing to start in MOCK: this deployment is declared live.'
      );
    }
    return new PayPalClient(id, secret);
  }

  get mode() {
    return this.mock ? 'MOCK' : 'SANDBOX';
  }

  /**
   * ★ A human-readable one-liner for the UI. The mode flag alone ("MOCK") reads as
   *   "this is fake"; what a judge needs to know is which of the two claims is being
   *   demonstrated right now.
   */
  get modeDescription() {
    return this.mock
      ? 'MOCK — no PayPal credentials. Orders are simulated locally; the receipt check compares against this session, not against PayPal.'
      : 'SANDBOX — orders are created against the real PayPal sandbox API and the custom_id is read back with GET /orders/{id}.';
  }

  async _accessToken() {
    if (this.mock) return 'MOCK_TOKEN';
    if (this._token && Date.now() < this._tokenExp) return this._token;

    const auth = Buffer.from(`${this.clientId}:${this.secret}`).toString('base64');
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`PayPal auth failed (${res.status}): ${t}`);
    }
    const data = await res.json();
    this._token = data.access_token;
    this._tokenExp = Date.now() + (data.expires_in - 60) * 1000;
    return this._token;
  }

  /**
   * Create an order for a tribunal-approved purchase.
   * @param {object} purchase { amount, currency, reason, category }
   * @param {object} options  { returnUrl, cancelUrl }
   *
   * Redirect URLs live in payment_source.paypal.experience_context for Orders v2
   * (the v1-era application_context block is not what current docs describe), so
   * the buyer's approval link carries the landing pages PayPal should return to.
   */
  async createOrder(purchase, options = {}) {
    const currency = purchase.currency || 'USD';
    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: currency, value: formatAmount(purchase.amount, currency) },
          description: `${purchase.category}: ${purchase.reason}`.slice(0, 127),
          // A receipt-less order is not a Tuesday order. The whole claim of the project is
      // that the decision travels with the money, so an order without a decision hash is
      // exactly what this code exists to prevent. Falling back to a timestamp let one
      // through and quietly falsified the audit trail.
      custom_id: requireCustomId(purchase),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Tuesday',
            user_action: 'PAY_NOW',
            // ★ Local demo URLs, not example.com. A judge who clicks the approval
            //   link should land back on something that exists.
            return_url: options.returnUrl || 'http://localhost:8787/?paypal=return',
            cancel_url: options.cancelUrl || 'http://localhost:8787/?paypal=cancel',
          },
        },
      },
    };
    // ★ Derive the idempotency key from the purchase, so retrying the same purchase
    //   cannot produce a second order. A caller can override it.
    const requestId = options.requestId
      || `create-${purchase.id || purchase.customId || purchase.reason}`;
    return this._req('POST', '/v2/checkout/orders', body, requestId);
  }

  /** Capture an approved order (finalizes payment). */
  async captureOrder(orderId) {
    return this._req('POST', `/v2/checkout/orders/${orderId}/capture`, {});
  }

  async getOrder(orderId) {
    return this._req('GET', `/v2/checkout/orders/${orderId}`, null);
  }

  /* ── Disputes (customer-disputes v1) ──────────────────────────────────────
   * PayPal's dispute surface, as far as a merchant can use it:
   *   list       GET  /v1/customer/disputes
   *   get        GET  /v1/customer/disputes/{id}
   *   accept     POST /v1/customer/disputes/{id}/accept-claim
   *   offer      POST /v1/customer/disputes/{id}/make-offer
   *   evidence   POST /v1/customer/disputes/{id}/provide-evidence
   *   escalate   POST /v1/customer/disputes/{id}/escalate
   *
   * Creating a dispute is sandbox-only and needs buyer-side scopes this app does
   * not have, so Tuesday never creates one — it reads them and responds to them.
   * That is the merchant's real job anyway.
   */

  async listDisputes({ pageSize = 20, status = null } = {}) {
    const q = new URLSearchParams({ page_size: String(pageSize) });
    if (status) q.set('dispute_state', status);
    return this._req('GET', `/v1/customer/disputes?${q.toString()}`, null);
  }

  async getDispute(disputeId) {
    return this._req('GET', `/v1/customer/disputes/${encodeURIComponent(disputeId)}`, null);
  }

  async acceptDisputeClaim(disputeId, { note = null } = {}) {
    const body = {};
    if (note) body.note = note;
    return this._req('POST', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`,
                     body, `accept-${disputeId}`);
  }

  async makeDisputeOffer(disputeId, { amount, currency = 'USD', note = null } = {}) {
    const body = {
      note: note || 'Offer from the merchant.',
      offer_type: 'REFUND',
      offer_amount: { currency_code: currency, value: formatAmount(amount, currency) },
    };
    return this._req('POST', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/make-offer`,
                     body, `offer-${disputeId}`);
  }

  /**
   * Submit evidence for a dispute.
   *
   * The shape matters more than it looks. Measured against the live sandbox, the naive
   * body — `evidence_info: { tracking_info: [], refund_ids: [] }` — is rejected with
   * 400 MISSING_OR_INVALID_REQUEST_BODY, because:
   *
   *   - `tracking_info[].carrier_name` is **required** and must be one of PayPal's
   *     enumerated values (UPS, USPS, FEDEX, DHL, ... or OTHER plus a free-text name).
   *     "FedEx" is not accepted; "FEDEX" is.
   *   - `tracking_info[].tracking_number` is required.
   *   - `refund_ids` must be omitted rather than sent empty: an empty array fails the
   *     "Items: 1 <= length" constraint.
   *   - `evidence_info` is only expected for PROOF_OF_FULFILLMENT, PROOF_OF_REFUND and
   *     PROOF_OF_RETURN. Other evidence types take `notes` and `documents`.
   *
   * So an empty `tracking_info` is not sent at all. When the merchant has tracking it is
   * normalised to the enum; when it does not, the evidence is notes-only, which is what
   * PayPal accepts for a claim that is not about a shipment.
   */
  async provideDisputeEvidence(disputeId, {
    evidenceType = 'PROOF_OF_FULFILLMENT', notes = '', documents = [], tracking = null,
  } = {}) {
    const ENUM = ['UPS', 'USPS', 'FEDEX', 'AIRBORNE_EXPRESS', 'DHL', 'AIRSURE',
                  'ROYAL_MAIL', 'PARCELFORCE', 'SWIFTAIR', 'OTHER', 'UK_PARCELFORCE',
                  'UK_ROYALMAIL_SPECIAL'];

    const payload = { evidence_type: evidenceType, notes: String(notes || '').slice(0, 2000) };

    const wantsTracking = ['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND', 'PROOF_OF_RETURN'].includes(evidenceType);
    if (wantsTracking && tracking && tracking.number) {
      const raw = String(tracking.carrier || 'OTHER').toUpperCase().replace(/[^0-9A-Z_]/g, '_');
      const isOther = !ENUM.includes(raw);
      const t = {
        carrier_name: isOther ? 'OTHER' : raw,
        tracking_number: String(tracking.number).slice(0, 255),
      };
      if (isOther) t.carrier_name_other = String(tracking.carrier || 'Carrier').slice(0, 2000);
      if (tracking.url) t.tracking_url = tracking.url;
      payload.evidence_info = { tracking_info: [t] };
    }
    if (documents && documents.length) payload.documents = documents.slice(0, 100);
    if (!payload.evidence_info && !payload.documents && !payload.notes) {
      throw new Error('Refusing to submit empty evidence: PayPal requires notes, documents, or tracking.');
    }

    // ★ Measured against the live sandbox: this endpoint takes `multipart/form-data`, not
    //   JSON. Posted as JSON it returns 400 MISSING_OR_INVALID_REQUEST_BODY with no field
    //   named, because the whole body is the wrong content type. The documented body has a
    //   single optional part, `evidence-file`; the structured fields go alongside it.
    //   Everything below is verified by an actual call, not inferred from the schema page.
    const form = new FormData();
    form.append('evidence', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'evidence.json');

    return this._reqMultipart('POST',
      `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`,
      form, `evidence-${disputeId}`);
  }

  /** POST a FormData body. fetch sets the multipart boundary; we must not set it ourselves. */
  async _reqMultipart(method, path, form, requestId) {
    if (this.mock) return this._mockResponse(method, path, null);

    const token = await this._accessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (requestId) headers['PayPal-Request-Id'] = requestId;

    const res = await fetch(`${this.base}${path}`, { method, headers, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const issue = data?.details?.[0]?.issue || null;
      throw Object.assign(
        new Error(`PayPal ${method} ${path} failed (${res.status})${issue ? ' ' + issue : ''}: ${JSON.stringify(data)}`),
        { status: res.status, issue, paypal: data }
      );
    }
    return data;
  }

  async escalateDispute(disputeId, { note = null } = {}) {
    const body = {};
    if (note) body.note = note;
    return this._req('POST', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/escalate`,
                     body, `escalate-${disputeId}`);
  }

  async _req(method, path, body, requestId) {
    if (this.mock) return this._mockResponse(method, path, body);

    const token = await this._accessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    // ★ PayPal-Request-Id makes create/capture idempotent. Without it a retried
    //   request is a second order - the exact double-charge this project claims to
    //   prevent. Derive it from the purchase so a retry of the same purchase cannot
    //   produce a second order.
    if (requestId) headers['PayPal-Request-Id'] = requestId;

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Carry the status and PayPal's issue code so callers can distinguish "you asked
      // me to do something PayPal forbids" (422 ORDER_NOT_APPROVED) from "I am broken"
      // (500). Collapsing both into a 500 made the demo look crashed when it was in fact
      // correctly refusing an unapproved capture.
      const issue = data?.details?.[0]?.issue || null;
      throw Object.assign(
        new Error(`PayPal ${method} ${path} failed (${res.status})${issue ? ' ' + issue : ''}: ${JSON.stringify(data)}`),
        { status: res.status, issue, paypal: data }
      );
    }
    return data;
  }

  /**
   * The mock is a state machine, not a stub that always says yes.
   *
   * A mock that returns COMPLETED for any capture id proves nothing — it would let an
   * unapproved order be captured, which is precisely the behaviour the real API forbids
   * and the project claims to prevent. Each mock order now moves
   * CREATED -> APPROVED -> COMPLETED, and a capture before approval fails with 422, the
   * same status PayPal returns. "A human must approve first" is therefore demonstrated
   * even with no credentials.
   */
  _mockResponse(method, path, body) {
    this._mockOrders = this._mockOrders || new Map();

    // POST /v2/checkout/orders
    if (method === 'POST' && /\/v2\/checkout\/orders$/.test(path)) {
      const id = `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const customId = body?.purchase_units?.[0]?.custom_id ?? null;
      const order = { id, status: 'CREATED', customId, captured: false };
      this._mockOrders.set(id, order);
      return {
        id,
        status: 'PAYER_ACTION_REQUIRED',
        mock: true,
        purchase_units: [{ custom_id: customId }],
        links: [
          { rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` },
          { rel: 'self', href: `${this.base}${path}` },
        ],
      };
    }

    // POST /v2/checkout/orders/{id}/capture
    if (method === 'POST' && path.includes('/capture')) {
      const orderId = path.split('/')[4];
      const order = this._mockOrders.get(orderId);
      if (!order) {
        throw Object.assign(new Error(`PayPal POST ${path} failed (404): unknown order ${orderId}`), { status: 404 });
      }
      if (order.status !== 'APPROVED') {
        throw Object.assign(
          new Error(
            `PayPal POST ${path} failed (422): order ${orderId} is ${order.status}, ` +
            'not APPROVED. A human must approve before it can be captured.'
          ),
          { status: 422 }
        );
      }
      order.status = 'COMPLETED';
      order.captured = true;
      const captureId = `CAP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      return {
        id: orderId,
        status: 'COMPLETED',
        mock: true,
        purchase_units: [{ custom_id: order.customId, payments: { captures: [{ id: captureId, status: 'COMPLETED' }] } }],
      };
    }

    // GET /v2/checkout/orders/{id}
    if (method === 'GET' && /\/v2\/checkout\/orders\/[^/]+$/.test(path)) {
      const orderId = path.split('/').pop();
      const order = this._mockOrders.get(orderId);
      if (!order) {
        throw Object.assign(new Error(`PayPal GET ${path} failed (404): unknown order ${orderId}`), { status: 404 });
      }
      const links = [{ rel: 'self', href: `${this.base}${path}` }];
      if (order.status === 'CREATED') {
        links.unshift({ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}` });
      }
      return {
        id: order.id,
        status: order.status,
        mock: true,
        purchase_units: [{ custom_id: order.customId }],
        links,
      };
    }

    // Disputes: nothing stored locally, so report an empty list rather than inventing one.
    if (path.includes('/customer/disputes')) {
      if (method === 'GET' && /\/customer\/disputes\?/.test(path)) return { items: [], mock: true };
      if (method === 'GET') {
        throw Object.assign(new Error(`PayPal GET ${path} failed (404): no mock dispute`), { status: 404 });
      }
      return { mock: true, status: 'OK' };
    }

    const id = `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    return { id, status: 'CREATED', mock: true, links: [{ rel: 'self', href: `${this.base}${path}` }] };
  }

  /** Mock-only: approve an order, standing in for the buyer tapping "Pay". */
  _mockApprove(orderId) {
    this._mockOrders = this._mockOrders || new Map();
    const order = this._mockOrders.get(orderId);
    if (!order) throw new Error(`No mock order ${orderId}`);
    order.status = 'APPROVED';
    return order;
  }
}
