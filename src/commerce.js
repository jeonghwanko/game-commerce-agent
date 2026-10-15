import { randomUUID } from "node:crypto";
import { product, requireThat } from "./catalog.js";
export class Commerce {
  constructor(store, provider, clock = Date.now) {
    this.s = store;
    this.p = provider;
    this.clock = clock;
  }
  owned(user, id) {
    const o = this.s.get("SELECT * FROM orders WHERE id=?", id);
    requireThat(o && o.user_id === user, "order_not_found", 404);
    requireThat(o.provider === this.p.name, "provider_mode_mismatch", 409);
    return o;
  }
  quote(user, sku) {
    const p = product(sku);
    const q = {
      id: randomUUID(),
      user_id: user,
      sku,
      amount: p.amount,
      currency: p.currency,
      version: p.version,
      expires: this.clock() + 300_000,
    };
    requireThat(
      !this.s.get(
        "SELECT 1 FROM entitlements WHERE user_id=? AND sku=?",
        user,
        sku,
      ),
      "already_owned",
      409,
    );
    this.s.run(
      "INSERT INTO quotes VALUES(?,?,?,?,?,?,?)",
      q.id,
      user,
      sku,
      q.amount,
      q.currency,
      q.version,
      q.expires,
    );
    this.s.event(user, "product_selected");
    return q;
  }
  async create(user, confirmation) {
    const q = this.s.get(
      "SELECT * FROM quotes WHERE id=?",
      confirmation.quoteId,
    );
    requireThat(q && q.user_id === user, "quote_not_found", 404);
    requireThat(
      confirmation.confirm === true &&
        confirmation.sku === q.sku &&
        confirmation.amount === q.amount &&
        confirmation.currency === q.currency &&
        confirmation.version === q.version,
      "explicit_confirmation_required",
    );
    let o = this.s.get("SELECT * FROM orders WHERE quote_id=?", q.id);
    if (!o) {
      const p = product(q.sku);
      requireThat(q.expires > this.clock(), "quote_expired", 409);
      requireThat(
        p.version === q.version &&
          p.amount === q.amount &&
          p.currency === q.currency,
        "catalog_changed",
        409,
      );
      this.s.transaction(() => {
        requireThat(
          !this.s.get(
            "SELECT 1 FROM entitlements WHERE user_id=? AND sku=?",
            user,
            q.sku,
          ),
          "already_owned",
          409,
        );
        requireThat(
          !this.s.get(
            "SELECT 1 FROM orders WHERE user_id=? AND sku=? AND status NOT IN ('CANCELLED','FAILED')",
            user,
            q.sku,
          ),
          "purchase_in_progress",
          409,
        );
        this.s.run(
          "INSERT INTO orders(id,quote_id,user_id,sku,amount,currency,version,provider,status,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
          randomUUID(),
          q.id,
          user,
          q.sku,
          q.amount,
          q.currency,
          q.version,
          this.p.name,
          "CREATING",
          this.clock(),
        );
        o = this.s.get("SELECT * FROM orders WHERE quote_id=?", q.id);
        this.s.event(user, "checkout_started", o.id);
      });
    }
    this.owned(user, o.id);
    if (o.status !== "CREATING")
      return { ...o, approvalUrl: this.p.approvalUrl?.(o.provider_id) ?? null };
    requireThat(
      this.clock() - o.created < 5 * 3600_000,
      "create_reconciliation_required",
      409,
    );
    try {
      const remote = await this.p.create(o);
      this.s.run(
        "UPDATE orders SET provider_id=?,status='APPROVAL_PENDING' WHERE id=? AND status='CREATING'",
        remote.id,
        o.id,
      );
      return { ...this.owned(user, o.id), approvalUrl: remote.approvalUrl };
    } catch (e) {
      this.s.event(user, "payment_pending", o.id);
      throw e;
    }
  }
  validate(o, remote) {
    requireThat(
      remote.id === o.provider_id && remote.reference === o.id,
      "provider_owner_mismatch",
      409,
    );
    requireThat(
      remote.amount === o.amount && remote.currency === o.currency,
      "payment_amount_mismatch",
      409,
    );
    requireThat(
      remote.status === "COMPLETED" &&
        remote.captureStatus === "COMPLETED" &&
        typeof remote.captureId === "string" &&
        remote.captureId.length > 0,
      "capture_not_completed",
      409,
    );
  }
  settle(id, remote, webhookId = null) {
    return this.s.transaction(() => {
      const o = this.s.get("SELECT * FROM orders WHERE id=?", id);
      this.validate(o, remote);
      requireThat(
        !o.capture_id || o.capture_id === remote.captureId,
        "capture_mismatch",
        409,
      );
      if (
        webhookId &&
        this.s.get("SELECT 1 FROM webhook_receipts WHERE id=?", webhookId)
      )
        return o;
      if (webhookId)
        this.s.run("INSERT INTO webhook_receipts VALUES(?,?)", webhookId, id);
      const review =
        o.review || ["CANCELLED", "FAILED"].includes(o.status) ? 1 : 0;
      this.s.run(
        "UPDATE orders SET capture_id=?,capture_verified=1,webhook_verified=?,review=? WHERE id=?",
        remote.captureId,
        webhookId ? 1 : o.webhook_verified,
        review,
        id,
      );
      if (!o.capture_verified) this.s.event(o.user_id, "payment_captured", id);
      if (review) {
        this.s.run("UPDATE orders SET status='REVIEW' WHERE id=?", id);
        this.s.event(o.user_id, "review_required", id);
      } else if (webhookId || o.webhook_verified) {
        const grant = this.s.run(
          "INSERT OR IGNORE INTO entitlements(user_id,sku,source_order_id) VALUES(?,?,?)",
          o.user_id,
          o.sku,
          id,
        );
        this.s.run("UPDATE orders SET status='GRANTED' WHERE id=?", id);
        if (grant.changes) this.s.event(o.user_id, "entitlement_granted", id);
      } else
        this.s.run(
          "UPDATE orders SET status='AWAITING_WEBHOOK' WHERE id=?",
          id,
        );
      return this.s.get("SELECT * FROM orders WHERE id=?", id);
    });
  }
  async capture(user, id) {
    let o = this.owned(user, id);
    if (o.status === "GRANTED") return o;
    requireThat(
      ["APPROVAL_PENDING", "CAPTURE_PENDING", "AWAITING_WEBHOOK"].includes(
        o.status,
      ),
      "order_not_capturable",
      409,
    );
    // Persist intent before I/O. Timeout remains recoverable; never blindly re-create an order.
    this.s.run("UPDATE orders SET status='CAPTURE_PENDING' WHERE id=?", id);
    try {
      let remote = await this.p.inspect(o.provider_id);
      requireThat(
        remote.id === o.provider_id &&
          remote.reference === o.id &&
          remote.amount === o.amount &&
          remote.currency === o.currency,
        "provider_order_mismatch",
        409,
      );
      if (
        remote.status === "CREATED" ||
        remote.status === "PAYER_ACTION_REQUIRED"
      ) {
        // No provider capture was attempted. Keep buyer approval/cancellation available.
        this.s.run(
          "UPDATE orders SET status='APPROVAL_PENDING' WHERE id=? AND status='CAPTURE_PENDING' AND capture_verified=0",
          id,
        );
      }
      if (remote.status !== "COMPLETED") {
        requireThat(
          remote.status === "APPROVED",
          "buyer_approval_required",
          409,
        );
        this.s.event(user, "buyer_approved", id);
        remote = await this.p.capture(o.provider_id, o.id);
      }
      return this.settle(id, remote);
    } catch (e) {
      // Uncertain transport outcomes must stay pending for inspect/retry.
      if (e.definitive) {
        this.s.run(
          "UPDATE orders SET status='FAILED' WHERE id=? AND capture_verified=0 AND status='CAPTURE_PENDING'",
          id,
        );
        this.s.event(user, "payment_failed", id);
      } else this.s.event(user, "payment_pending", id);
      throw e;
    }
  }
  cancel(user, id) {
    const o = this.owned(user, id);
    requireThat(
      ["APPROVAL_PENDING", "CANCELLED"].includes(o.status),
      "order_not_cancellable",
      409,
    );
    if (o.status !== "CANCELLED") {
      this.s.run("UPDATE orders SET status='CANCELLED' WHERE id=?", id);
      this.s.event(user, "checkout_cancelled", id);
    }
    return this.owned(user, id);
  }
  async webhook(headers, event) {
    requireThat(
      await this.p.verifyWebhook(headers, event),
      "invalid_webhook",
      401,
    );
    requireThat(
      typeof event.id === "string" && event.id.length < 256,
      "invalid_event",
    );
    const providerId =
      event.resource?.supplementary_data?.related_ids?.order_id;
    let o = this.s.get(
      "SELECT * FROM orders WHERE provider_id=? AND provider=?",
      providerId ?? "",
      this.p.name,
    );
    const captureId =
      event.resource?.supplementary_data?.related_ids?.capture_id ??
      event.resource?.id;
    if (!o && captureId)
      o = this.s.get(
        "SELECT * FROM orders WHERE capture_id=? AND provider=?",
        captureId,
        this.p.name,
      );
    // Unknown events are retryable: order creation may still be committing.
    requireThat(o, "webhook_order_not_found", 503);
    if (this.s.get("SELECT 1 FROM webhook_receipts WHERE id=?", event.id))
      return o;
    if (
      ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(
        event.event_type,
      )
    ) {
      this.s.transaction(() => {
        this.s.run("INSERT INTO webhook_receipts VALUES(?,?)", event.id, o.id);
        this.s.run(
          "UPDATE orders SET review=1,status='REVIEW' WHERE id=?",
          o.id,
        );
        this.s.run(
          "UPDATE entitlements SET status='held' WHERE source_order_id=?",
          o.id,
        );
        this.s.event(o.user_id, "review_required", o.id);
      });
      return this.owned(o.user_id, o.id);
    }
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") return o;
    const remote = await this.p.inspect(o.provider_id);
    requireThat(
      event.resource?.id === remote.captureId,
      "webhook_capture_mismatch",
      409,
    );
    return this.settle(o.id, remote, event.id);
  }
}
