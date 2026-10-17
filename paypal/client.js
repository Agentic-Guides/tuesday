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
    return new PayPalClient(id, secret);
  }

  get mode() {
    return this.mock ? 'MOCK' : 'SANDBOX';
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
          amount: { currency_code: currency, value: Number(purchase.amount).toFixed(2) },
          description: `${purchase.category}: ${purchase.reason}`.slice(0, 127),
          custom_id: purchase.customId || purchase.id || `triad_${Date.now()}`,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Tuesday',
            user_action: 'PAY_NOW',
            return_url: options.returnUrl || 'https://example.com/return',
            cancel_url: options.cancelUrl || 'https://example.com/cancel',
          },
        },
      },
    };
    return this._req('POST', '/v2/checkout/orders', body);
  }

  /** Capture an approved order (finalizes payment). */
  async captureOrder(orderId) {
    return this._req('POST', `/v2/checkout/orders/${orderId}/capture`, {});
  }

  async getOrder(orderId) {
    return this._req('GET', `/v2/checkout/orders/${orderId}`, null);
  }

  async _req(method, path, body) {
    if (this.mock) return this._mockResponse(method, path, body);

    const token = await this._accessToken();
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`PayPal ${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
    }
    return data;
  }

  _mockResponse(method, path, body) {
    const id = `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    if (path.includes('/capture')) {
      const orderId = path.split('/')[4];
      return {
        id: orderId,
        status: 'COMPLETED',
        mock: true,
        purchase_units: [{ payments: { captures: [{ id, status: 'COMPLETED' }] } }],
      };
    }
    // create / get order
    return {
      id,
      status: method === 'POST' ? 'CREATED' : 'APPROVED',
      mock: true,
      purchase_units: [{ custom_id: body?.purchase_units?.[0]?.custom_id ?? null }],
      links: [
        { rel: 'approve', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` },
        { rel: 'self', href: `${this.base}${path}` },
      ],
    };
  }
}
