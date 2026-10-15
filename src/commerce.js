import { randomUUID } from "node:crypto";
import { eventReference } from "./webhook-reference.js";
import { product, requireThat } from "./catalog.js";
export class Commerce {
  constructor(store, provider, clock = Date.now) {
    store.bindProvider(provider.name);
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
      if (
        this.s.get(
          "SELECT 1 FROM verified_webhooks WHERE provider=? AND provider_id=? AND type IN ('PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED')",
          this.p.name,
          remote.id,
        )
      ) {
        this.s.run(
          "UPDATE orders SET review=1,status='REVIEW' WHERE id=?",
          o.id,
        );
      }
      return { ...this.owned(user, o.id), approvalUrl: remote.approvalUrl };
    } catch (e) {
      this.s.event(user, "payment_pending", o.id);
      throw e;
    }
  }
  validate(o, remote) {
    if (this.p.name === "paypal-sandbox") {
      requireThat(
        typeof this.p.config?.merchantId === "string" &&
          remote.merchantId === this.p.config.merchantId,
        "merchant_mismatch",
        409,
      );
      requireThat(
        remote.captureOrderId === o.provider_id,
        "capture_order_mismatch",
        409,
      );
    }
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
      const priorHold = this.s.get(
        "SELECT 1 FROM verified_webhooks WHERE provider=? AND type IN ('PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED') AND (provider_id=? OR capture_id=?)",
        this.p.name,
        o.provider_id,
        remote.captureId,
      );
      const review =
        o.review || priorHold || ["CANCELLED", "FAILED"].includes(o.status)
          ? 1
          : 0;
      this.s.run(
        "UPDATE orders SET capture_id=?,capture_verified=1,webhook_verified=?,review=? WHERE id=?",
        remote.captureId,
        webhookId ? 1 : o.webhook_verified,
        review,
        id,
      );
      if (!o.capture_verified) this.s.event(o.user_id, "payment_captured", id);
      if (review) {
        this.s.run(
          "UPDATE entitlements SET status='held' WHERE source_order_id=?",
          id,
        );
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
  assertCaptureOperation(id, token) {
    const current = this.s.get(
      "SELECT o.* FROM orders o JOIN capture_operations op ON op.order_id=o.id WHERE o.id=? AND op.token=? AND op.expires>?",
      id,
      token,
      this.clock(),
    );
    requireThat(
      current &&
        current.review === 0 &&
        ["CAPTURE_PENDING", "AWAITING_WEBHOOK", "GRANTED"].includes(
          current.status,
        ),
      "capture_operation_changed",
      409,
    );
    return current;
  }
  async capture(user, id) {
    const original = this.owned(user, id);
    if (original.status === "GRANTED") return original;
    const token = randomUUID();
    this.s.transaction(() => {
      const o = this.owned(user, id);
      requireThat(
        ["APPROVAL_PENDING", "CAPTURE_PENDING", "AWAITING_WEBHOOK"].includes(
          o.status,
        ) && !o.review,
        "order_not_capturable",
        409,
      );
      this.s.run(
        "DELETE FROM capture_operations WHERE order_id=? AND expires<=?",
        id,
        this.clock(),
      );
      requireThat(
        !this.s.get("SELECT 1 FROM capture_operations WHERE order_id=?", id),
        "capture_in_progress",
        409,
      );
      this.s.run(
        "INSERT INTO capture_operations VALUES(?,?,?)",
        id,
        token,
        this.clock() + 300000,
      );
      const changed = this.s.run(
        "UPDATE orders SET status='CAPTURE_PENDING' WHERE id=? AND status=? AND review=0",
        id,
        o.status,
      );
      requireThat(changed.changes === 1, "capture_operation_changed", 409);
    });
    try {
      let remote = await this.p.inspect(original.provider_id);
      let current = this.assertCaptureOperation(id, token);
      if (current.status === "GRANTED") return current;
      requireThat(
        remote.id === original.provider_id &&
          remote.reference === original.id &&
          remote.amount === original.amount &&
          remote.currency === original.currency,
        "provider_order_mismatch",
        409,
      );
      if (this.p.name === "paypal-sandbox")
        requireThat(
          remote.merchantId === this.p.config.merchantId,
          "merchant_mismatch",
          409,
        );
      if (["CREATED", "PAYER_ACTION_REQUIRED"].includes(remote.status)) {
        // Only the operation that owns this lease may restore approval state.
        this.s.transaction(() => {
          this.assertCaptureOperation(id, token);
          this.s.run(
            "UPDATE orders SET status='APPROVAL_PENDING' WHERE id=? AND status='CAPTURE_PENDING' AND capture_verified=0 AND review=0 AND EXISTS(SELECT 1 FROM capture_operations WHERE order_id=? AND token=?)",
            id,
            id,
            token,
          );
          this.s.run(
            "DELETE FROM capture_operations WHERE order_id=? AND token=?",
            id,
            token,
          );
        });
        requireThat(false, "buyer_approval_required", 409);
      }
      if (remote.status !== "COMPLETED") {
        requireThat(
          remote.status === "APPROVED",
          "buyer_approval_required",
          409,
        );
        current = this.assertCaptureOperation(id, token); // Recheck after every external await, immediately before side effect.
        if (current.status === "GRANTED") return current;
        this.s.event(user, "buyer_approved", id);
        remote = await this.p.capture(original.provider_id, original.id);
        this.assertCaptureOperation(id, token);
      }
      return this.settle(id, remote);
    } catch (e) {
      if (e.definitive) {
        const changed = this.s.run(
          "UPDATE orders SET status='FAILED' WHERE id=? AND capture_verified=0 AND status='CAPTURE_PENDING' AND EXISTS(SELECT 1 FROM capture_operations WHERE order_id=? AND token=?)",
          id,
          id,
          token,
        );
        if (changed.changes) this.s.event(user, "payment_failed", id);
      } else this.s.event(user, "payment_pending", id);
      throw e;
    } finally {
      this.s.run(
        "DELETE FROM capture_operations WHERE order_id=? AND token=?",
        id,
        token,
      );
    }
  }
  cancel(user, id) {
    return this.s.transaction(() => {
      const o = this.owned(user, id);
      if (o.status === "CANCELLED") return o;
      const changed = this.s.run(
        "UPDATE orders SET status='CANCELLED' WHERE id=? AND status='APPROVAL_PENDING' AND NOT EXISTS(SELECT 1 FROM capture_operations WHERE order_id=?)",
        id,
        id,
      );
      requireThat(changed.changes === 1, "order_not_cancellable", 409);
      this.s.event(user, "checkout_cancelled", id);
      return this.owned(user, id);
    });
  }
  async webhook(headers, event) {
    requireThat(
      await this.p.verifyWebhook(headers, event),
      "invalid_webhook",
      401,
    );
    requireThat(
      typeof event.id === "string" &&
        event.id.length > 0 &&
        event.id.length < 256,
      "invalid_event",
    );
    const acceptedTypes = [
      "PAYMENT.CAPTURE.COMPLETED",
      "PAYMENT.CAPTURE.REFUNDED",
      "PAYMENT.CAPTURE.REVERSED",
    ];
    if (!acceptedTypes.includes(event.event_type)) return { status: "IGNORED" };
    let { providerId, captureId } = eventReference(event);
    // Keep signed early holds before network resolution; never confuse a refund ID with a capture ID.
    this.s.run(
      "INSERT OR IGNORE INTO verified_webhooks VALUES(?,?,?,?,?)",
      this.p.name,
      event.id,
      event.event_type,
      providerId ?? null,
      captureId ?? null,
    );
    if (
      ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(
        event.event_type,
      )
    ) {
      // A signed, correlated hold takes effect even if subsequent provider reads time out.
      this.s.transaction(() => {
        const known = this.s.get(
          "SELECT * FROM orders WHERE provider=? AND (provider_id=? OR capture_id=?)",
          this.p.name,
          providerId ?? "",
          captureId ?? "",
        );
        if (known) {
          this.s.run(
            "UPDATE orders SET review=1,status='REVIEW' WHERE id=?",
            known.id,
          );
          this.s.run(
            "UPDATE entitlements SET status='held' WHERE source_order_id=?",
            known.id,
          );
          if (!known.review)
            this.s.event(known.user_id, "review_required", known.id);
        }
      });
    }
    if (this.p.eventReference) {
      const resolved = await this.p.eventReference(event);
      providerId = resolved.providerId;
      captureId = resolved.captureId;
      this.s.run(
        "UPDATE verified_webhooks SET provider_id=?,capture_id=? WHERE provider=? AND id=?",
        providerId ?? null,
        captureId ?? null,
        this.p.name,
        event.id,
      );
    }
    requireThat(providerId || captureId, "invalid_event_reference");
    let o = this.s.get(
      "SELECT * FROM orders WHERE provider_id=? AND provider=?",
      providerId ?? "",
      this.p.name,
    );
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
