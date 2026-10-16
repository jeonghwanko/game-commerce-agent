import { CommerceError, money, requireThat } from "../catalog.js";
import {
  eventReference,
  paypalLinkId,
  isRefundResource,
} from "../webhook-reference.js";
export const SANDBOX = "https://api-m.sandbox.paypal.com";
export class PayPalSandboxProvider {
  name = "paypal-sandbox";
  #oauthAuthorization;
  constructor(config, fetcher = fetch) {
    requireThat((config.baseUrl ?? SANDBOX) === SANDBOX, "sandbox_only");
    const headerMode =
      typeof config.oauthBasicAuthHeader === "string" &&
      config.oauthBasicAuthHeader.length > 0;
    requireThat(
      !(headerMode && (config.clientId || config.clientSecret)),
      "paypal_auth_modes_conflict",
    );
    requireThat(
      config.webhookId &&
        config.merchantId &&
        (headerMode || (config.clientId && config.clientSecret)),
      "paypal_configuration_required",
    );
    if (headerMode)
      requireThat(
        config.oauthBasicAuthHeader.length <= 8192 &&
          !/[\r\n\0]/.test(config.oauthBasicAuthHeader),
        "invalid_paypal_auth_header",
      );
    this.#oauthAuthorization = headerMode
      ? config.oauthBasicAuthHeader
      : `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
    this.authMode = headerMode ? "opaque-header" : "client-pair";
    const origin = new URL(config.origin);
    requireThat(
      origin.origin === config.origin &&
        (origin.protocol === "https:" ||
          ["localhost", "127.0.0.1"].includes(origin.hostname)),
      "invalid_origin",
    );
    // Keep authentication values out of enumerable configuration and diagnostics.
    this.config = {
      origin: config.origin,
      webhookId: config.webhookId,
      merchantId: config.merchantId,
      webhookBudget: config.webhookBudget,
    };
    this.fetcher = fetcher;
  }
  toJSON() {
    return {
      provider: this.name,
      authMode: this.authMode,
      authorization: "[REDACTED]",
    };
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toJSON();
  }
  async token() {
    let res;
    try {
      res = await this.fetcher(`${SANDBOX}/v1/oauth2/token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: this.#oauthAuthorization,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
    } catch {
      throw new CommerceError("paypal_auth_transport_failed", 502);
    }
    if (!res.ok) throw new CommerceError("paypal_auth_failed", 502);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new CommerceError("paypal_auth_response_failed", 502);
    }
    requireThat(
      typeof data?.access_token === "string" &&
        data.access_token.length > 0 &&
        data.access_token.length <= 4096 &&
        /^[A-Za-z0-9._~+/-]+=*$/.test(data.access_token),
      "paypal_invalid_token",
      502,
    );
    return data.access_token;
  }
  async request(path, method = "GET", body, requestId) {
    const token = await this.token();
    let res;
    try {
      res = await this.fetcher(`${SANDBOX}${path}`, {
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
    } catch {
      throw new CommerceError("paypal_transport_failed", 502);
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new CommerceError("paypal_response_failed", 502);
    }
    if (!res.ok) {
      const error = new CommerceError("paypal_request_failed", 502);
      error.definitive =
        res.status === 422 &&
        Array.isArray(data?.details) &&
        data.details.some((d) =>
          ["INSTRUMENT_DECLINED", "PAYER_CANNOT_PAY"].includes(d?.issue),
        );
      throw error;
    }
    requireThat(
      data && typeof data === "object" && !Array.isArray(data),
      "paypal_response_failed",
      502,
    );
    return data;
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
            payee: { merchant_id: this.config.merchantId },
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
    requireThat(
      d.id === id && d.intent === "CAPTURE",
      "provider_order_mismatch",
      502,
    );
    requireThat(
      unit.payee?.merchant_id === this.config.merchantId,
      "merchant_mismatch",
      502,
    );
    const captures = unit.payments?.captures ?? [];
    requireThat(captures.length <= 1, "unexpected_captures", 502);
    const cap = captures[0];
    if (cap) {
      requireThat(
        typeof cap.id === "string" && /^[A-Za-z0-9-]+$/.test(cap.id),
        "invalid_capture_id",
        502,
      );
      const details = await this.request(`/v2/payments/captures/${cap.id}`);
      const related = details.supplementary_data?.related_ids?.order_id;
      const up = details.links?.find((link) => link.rel === "up")?.href;
      const expectedLinks = [SANDBOX, "https://api.sandbox.paypal.com"].map(
        (base) => `${base}/v2/checkout/orders/${id}`,
      );
      requireThat(
        details.id === cap.id &&
          (related === id || (!related && expectedLinks.includes(up))),
        "capture_order_mismatch",
        502,
      );
      requireThat(
        !details.payee || details.payee.merchant_id === this.config.merchantId,
        "merchant_mismatch",
        502,
      );
      requireThat(
        details.status === cap.status &&
          details.amount?.value === cap.amount?.value &&
          details.amount?.currency_code === cap.amount?.currency_code &&
          cap.amount?.value === unit.amount?.value &&
          cap.amount?.currency_code === unit.amount?.currency_code,
        "capture_details_mismatch",
        502,
      );
      requireThat(
        details.final_capture === true,
        "partial_capture_not_supported",
        502,
      );
    }
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
      merchantId: unit.payee.merchant_id,
      captureOrderId: cap ? id : undefined,
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
  async eventReference(event) {
    const ref = eventReference(event);
    if (!isRefundResource(event)) return ref;
    const refundId = event.resource?.id;
    requireThat(
      typeof refundId === "string" && /^[A-Za-z0-9-]+$/.test(refundId),
      "invalid_refund_id",
      502,
    );
    const refund = await this.request(`/v2/payments/refunds/${refundId}`);
    const captureId = paypalLinkId(refund.links, "capture");
    requireThat(
      refund.id === refundId &&
        refund.status === "COMPLETED" &&
        captureId &&
        (!ref.captureId || ref.captureId === captureId),
      "refund_capture_mismatch",
      502,
    );
    const cap = await this.request(`/v2/payments/captures/${captureId}`);
    const providerId =
      cap.supplementary_data?.related_ids?.order_id ??
      paypalLinkId(cap.links, "order");
    requireThat(
      cap.id === captureId &&
        providerId &&
        (!ref.providerId || ref.providerId === providerId),
      "capture_order_mismatch",
      502,
    );
    if (cap.payee)
      requireThat(
        cap.payee.merchant_id === this.config.merchantId,
        "merchant_mismatch",
        502,
      );
    const order = await this.request(`/v2/checkout/orders/${providerId}`);
    requireThat(
      order.id === providerId &&
        order.purchase_units?.length === 1 &&
        order.purchase_units[0].payee?.merchant_id === this.config.merchantId &&
        order.purchase_units[0].payments?.captures?.some(
          (c) => c.id === captureId,
        ),
      "refund_order_mismatch",
      502,
    );
    return { providerId, captureId };
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
    requireThat(this.config.webhookBudget, "webhook_budget_required", 503);
    const d = await this.config.webhookBudget.run(() =>
      this.request("/v1/notifications/verify-webhook-signature", "POST", {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: this.config.webhookId,
        webhook_event: event,
      }),
    );
    return d.verification_status === "SUCCESS";
  }
}
