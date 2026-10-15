import { CommerceError, money, requireThat } from "../catalog.js";
export const SANDBOX = "https://api-m.sandbox.paypal.com";
export class PayPalSandboxProvider {
  name = "paypal-sandbox";
  constructor(config, fetcher = fetch) {
    requireThat((config.baseUrl ?? SANDBOX) === SANDBOX, "sandbox_only");
    requireThat(
      config.clientId && config.clientSecret && config.webhookId,
      "paypal_configuration_required",
    );
    const origin = new URL(config.origin);
    requireThat(
      origin.origin === config.origin &&
        (origin.protocol === "https:" ||
          ["localhost", "127.0.0.1"].includes(origin.hostname)),
      "invalid_origin",
    );
    this.config = config;
    this.fetcher = fetcher;
  }
  async token() {
    const res = await this.fetcher(`${SANDBOX}/v1/oauth2/token`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new CommerceError("paypal_auth_failed", 502);
    const data = await res.json();
    requireThat(
      typeof data.access_token === "string",
      "paypal_invalid_token",
      502,
    );
    return data.access_token;
  }
  async request(path, method = "GET", body, requestId) {
    const token = await this.token();
    const res = await this.fetcher(`${SANDBOX}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const error = new CommerceError("paypal_request_failed", 502);
      // Only known payment declines are terminal; 5xx, 429 and ambiguous errors stay pending.
      error.definitive =
        res.status === 422 &&
        data.details?.some((d) =>
          ["INSTRUMENT_DECLINED", "PAYER_CANNOT_PAY"].includes(d.issue),
        );
      throw error;
    }
    return res.json();
  }
  approvalUrl(id) {
    requireThat(/^[A-Za-z0-9-]+$/.test(id), "invalid_provider_id");
    return `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(id)}`;
  }
  async create(o) {
    const data = await this.request(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: o.id,
            custom_id: o.id,
            invoice_id: o.id,
            amount: { currency_code: o.currency, value: money(o.amount) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: `${this.config.origin}/?order=${o.id}&result=approved`,
              cancel_url: `${this.config.origin}/?order=${o.id}&result=cancelled`,
            },
          },
        },
      },
      o.id,
    );
    requireThat(typeof data.id === "string", "paypal_missing_order", 502);
    return { id: data.id, approvalUrl: this.approvalUrl(data.id) };
  }
  async inspect(id) {
    requireThat(/^[A-Za-z0-9-]+$/.test(id), "invalid_provider_id");
    const d = await this.request(`/v2/checkout/orders/${id}`);
    requireThat(
      d.purchase_units?.length === 1,
      "unexpected_purchase_units",
      502,
    );
    const unit = d.purchase_units[0];
    const captures = unit.payments?.captures ?? [];
    requireThat(captures.length <= 1, "unexpected_captures", 502);
    const cap = captures[0];
    const amount = cap?.amount ?? unit.amount;
    requireThat(
      /^\d+\.\d{2}$/.test(amount?.value ?? ""),
      "invalid_provider_amount",
      502,
    );
    const [whole, cents] = amount.value.split(".");
    const minor = Number(whole) * 100 + Number(cents);
    requireThat(Number.isSafeInteger(minor), "invalid_provider_amount", 502);
    requireThat(
      unit.custom_id === unit.reference_id,
      "provider_reference_mismatch",
      502,
    );
    return {
      id: d.id,
      reference: unit.custom_id,
      amount: minor,
      currency: amount.currency_code,
      status: d.status,
      captureId: cap?.id,
      captureStatus: cap?.status,
    };
  }
  async capture(id, localId) {
    requireThat(/^[A-Za-z0-9-]+$/.test(id), "invalid_provider_id");
    await this.request(
      `/v2/checkout/orders/${id}/capture`,
      "POST",
      {},
      `cap-${localId}`,
    );
    return this.inspect(id);
  }
  async verifyWebhook(headers, event) {
    const keys = [
      "paypal-auth-algo",
      "paypal-cert-url",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ];
    if (keys.some((k) => typeof headers[k] !== "string" || !headers[k]))
      return false;
    let cert;
    try {
      cert = new URL(headers["paypal-cert-url"]);
    } catch {
      return false;
    }
    if (
      cert.protocol !== "https:" ||
      cert.hostname !== "api.sandbox.paypal.com" ||
      !cert.pathname.startsWith("/v1/notifications/certs/") ||
      cert.port ||
      cert.username ||
      cert.password
    )
      return false;
    const d = await this.request(
      "/v1/notifications/verify-webhook-signature",
      "POST",
      {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: this.config.webhookId,
        webhook_event: event,
      },
    );
    return d.verification_status === "SUCCESS";
  }
}
