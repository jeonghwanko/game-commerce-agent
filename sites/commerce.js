import { product, requireThat } from "../src/catalog.js";
import { eventReference } from "../src/webhook-reference.js";
import { uuid } from "./d1.js";
const heldTypes = "('PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED')";
const priorHold = `EXISTS(SELECT 1 FROM sites_verified_events v WHERE v.provider=sites_orders.provider AND v.type IN ${heldTypes} AND (v.provider_id=sites_orders.provider_id OR v.capture_id=sites_orders.capture_id))`;
const confirmed = (q, b) =>
  b.confirm === true &&
  b.sku === q.sku &&
  b.amount === q.amount &&
  b.currency === q.currency &&
  b.version === q.version;
export class D1Commerce {
  constructor(s, p, now = Date.now) {
    Object.assign(this, { s, p, now });
  }
  async init() {
    await this.s.bindProvider(this.p.name, this.p.config?.merchantId);
  }
  async owned(user, id) {
    const o = await this.s.one(
      "SELECT * FROM sites_orders WHERE id=? AND user_id=?",
      id,
      user,
    );
    requireThat(o, "order_not_found", 404);
    requireThat(o.provider === this.p.name, "provider_mode_mismatch", 409);
    return o;
  }
  view(o) {
    // Do not expose internal lease tokens to the browser.
    const { lease_token, lease_expires, lease_kind, ...publicOrder } = o;
    return {
      ...publicOrder,
      approvalUrl: o.provider_id
        ? (this.p.approvalUrl?.(o.provider_id) ?? null)
        : null,
    };
  }
  async quote(user, sku) {
    const p = product(sku);
    requireThat(
      !(await this.s.one(
        "SELECT 1 FROM sites_entitlements WHERE user_id=? AND sku=?",
        user,
        sku,
      )),
      "already_owned",
      409,
    );
    const q = {
      id: uuid(),
      sku,
      amount: p.amount,
      currency: p.currency,
      version: p.version,
      expires: this.now() + 300000,
    };
    await this.s.run(
      "INSERT INTO sites_quotes VALUES(?,?,?,?,?,?,?)",
      q.id,
      user,
      sku,
      q.amount,
      q.currency,
      q.version,
      q.expires,
    );
    return q;
  }
  async create(user, b) {
    const q = await this.s.one(
      "SELECT * FROM sites_quotes WHERE id=? AND user_id=?",
      b.quoteId,
      user,
    );
    requireThat(q, "quote_not_found", 404);
    requireThat(confirmed(q, b), "explicit_confirmation_required");
    let o = await this.s.one(
      "SELECT * FROM sites_orders WHERE quote_id=?",
      q.id,
    );
    if (!o) {
      const p = product(q.sku);
      requireThat(q.expires > this.now(), "quote_expired", 409);
      requireThat(
        q.version === p.version &&
          q.amount === p.amount &&
          q.currency === p.currency,
        "catalog_changed",
        409,
      );
      // One SQL statement is the create CAS. Unique indexes arbitrate simultaneous quotes.
      await this.s.run(
        `INSERT OR IGNORE INTO sites_orders(id,quote_id,user_id,sku,amount,currency,version,provider,status,created)
        SELECT ?,id,user_id,sku,amount,currency,version,?,'CREATING',? FROM sites_quotes
        WHERE id=? AND user_id=? AND expires>? AND NOT EXISTS(SELECT 1 FROM sites_entitlements WHERE user_id=? AND sku=?)`,
        uuid(),
        this.p.name,
        this.now(),
        q.id,
        user,
        this.now(),
        user,
        q.sku,
      );
      o = await this.s.one("SELECT * FROM sites_orders WHERE quote_id=?", q.id);
      requireThat(o, "purchase_in_progress", 409);
    }
    requireThat(o.provider === this.p.name, "provider_mode_mismatch", 409);
    if (o.status !== "CREATING") return this.view(o);
    requireThat(
      this.now() - o.created < 5 * 3600000,
      "create_reconciliation_required",
      409,
    );
    const token = uuid();
    const lease = await this.s.run(
      "UPDATE sites_orders SET lease_token=?,lease_expires=?,lease_kind='create' WHERE id=? AND status='CREATING' AND (lease_token IS NULL OR lease_expires<=?)",
      token,
      this.now() + 300000,
      o.id,
      this.now(),
    );
    requireThat(lease.meta.changes === 1, "create_in_progress", 409);
    try {
      const r = await this.p.create(o);
      const bound = await this.s.run(
        `UPDATE sites_orders SET provider_id=?,status=CASE WHEN status='CREATING' THEN 'APPROVAL_PENDING' ELSE status END
        WHERE id=? AND lease_token=? AND lease_expires>? AND (provider_id IS NULL OR provider_id=?)`,
        r.id,
        o.id,
        token,
        this.now(),
        r.id,
      );
      requireThat(bound.meta.changes === 1, "create_operation_changed", 409);
      await this.applyHolds();
      return this.view(await this.owned(user, o.id));
    } finally {
      await this.release(o.id, token);
    }
  }
  async resume(user, id, b) {
    const o = await this.owned(user, id);
    requireThat(confirmed(o, b), "explicit_confirmation_required");
    requireThat(
      ["CREATING", "APPROVAL_PENDING"].includes(o.status),
      "order_not_resumable",
      409,
    );
    return this.create(user, { ...b, quoteId: o.quote_id });
  }
  async release(id, token) {
    await this.s.run(
      "UPDATE sites_orders SET lease_token=NULL,lease_expires=0,lease_kind=NULL WHERE id=? AND lease_token=?",
      id,
      token,
    );
  }
  async assertLease(id, token) {
    const o = await this.s.one(
      "SELECT * FROM sites_orders WHERE id=? AND lease_token=? AND lease_expires>? AND review=0 AND status IN ('CAPTURE_PENDING','AWAITING_WEBHOOK','GRANTED')",
      id,
      token,
      this.now(),
    );
    requireThat(o, "capture_operation_changed", 409);
    return o;
  }
  validate(o, r, completed = true) {
    requireThat(
      r.id === o.provider_id && r.reference === o.id,
      "provider_owner_mismatch",
      409,
    );
    requireThat(
      r.amount === o.amount && r.currency === o.currency,
      "payment_amount_mismatch",
      409,
    );
    if (this.p.name === "paypal-sandbox") {
      requireThat(
        r.merchantId === this.p.config.merchantId,
        "merchant_mismatch",
        409,
      );
      if (completed)
        requireThat(
          r.captureOrderId === o.provider_id,
          "capture_order_mismatch",
          409,
        );
    }
    if (completed)
      requireThat(
        r.status === "COMPLETED" &&
          r.captureStatus === "COMPLETED" &&
          typeof r.captureId === "string" &&
          r.captureId.length > 0,
        "capture_not_completed",
        409,
      );
  }
  async settle(id, r, eventId = null, leaseToken = null) {
    const o = await this.s.one("SELECT * FROM sites_orders WHERE id=?", id);
    requireThat(o, "order_not_found", 404);
    this.validate(o, r);
    requireThat(
      !o.capture_id || o.capture_id === r.captureId,
      "capture_mismatch",
      409,
    );
    const guard = leaseToken ? " AND lease_token=? AND lease_expires>?" : "";
    const bind = leaseToken ? [leaseToken, this.now()] : [];
    // All authority changes, revocation, grant and its outbox entry commit together.
    const assertion = uuid();
    const results = await this.s.batch([
      [
        `UPDATE sites_orders SET capture_id=?,capture_verified=1,webhook_verified=CASE WHEN ? IS NOT NULL THEN 1 ELSE webhook_verified END WHERE id=? AND (capture_id IS NULL OR capture_id=?)${guard}`,
        r.captureId,
        eventId,
        id,
        r.captureId,
        ...bind,
      ],
      ["INSERT INTO sites_assertions VALUES(?,changes())", assertion],
      [
        `UPDATE sites_orders SET review=1 WHERE id=? AND capture_verified=1 AND (review=1 OR status IN ('CANCELLED','FAILED') OR ${priorHold})`,
        id,
      ],
      [
        "UPDATE sites_orders SET status=CASE WHEN review=1 THEN 'REVIEW' WHEN webhook_verified=1 THEN 'GRANTED' ELSE 'AWAITING_WEBHOOK' END WHERE id=? AND capture_verified=1",
        id,
      ],
      [
        "UPDATE sites_entitlements SET status='held' WHERE source_order_id=? AND EXISTS(SELECT 1 FROM sites_orders WHERE id=? AND review=1)",
        id,
        id,
      ],
      [
        "UPDATE sites_game SET equipped=NULL WHERE user_id=? AND equipped=? AND EXISTS(SELECT 1 FROM sites_orders WHERE id=? AND review=1)",
        o.user_id,
        o.sku,
        id,
      ],
      [
        "INSERT OR IGNORE INTO sites_entitlements SELECT user_id,sku,id,'active' FROM sites_orders WHERE id=? AND status='GRANTED' AND review=0 AND capture_verified=1 AND webhook_verified=1",
        id,
      ],
      [
        "INSERT OR IGNORE INTO sites_events SELECT ?,user_id,id,'entitlement_granted',?,0 FROM sites_orders WHERE id=? AND status='GRANTED' AND EXISTS(SELECT 1 FROM sites_entitlements WHERE source_order_id=?)",
        `grant:${id}`,
        this.now(),
        id,
        id,
      ],
      [
        "INSERT OR IGNORE INTO sites_receipts SELECT ?,id FROM sites_orders WHERE id=? AND capture_verified=1 AND webhook_verified=1 AND ? IS NOT NULL",
        eventId ?? "",
        id,
        eventId,
      ],
      ["DELETE FROM sites_assertions WHERE id=?", assertion],
    ]);
    requireThat(
      results[0].meta.changes === 1,
      "settlement_operation_changed",
      409,
    );
    return this.view(await this.owned(o.user_id, id));
  }
  async capture(user, id) {
    const before = await this.owned(user, id);
    if (before.status === "GRANTED") return this.view(before);
    const token = uuid();
    const lease = await this.s.run(
      "UPDATE sites_orders SET status='CAPTURE_PENDING',lease_token=?,lease_expires=?,lease_kind='capture' WHERE id=? AND user_id=? AND review=0 AND status IN ('APPROVAL_PENDING','CAPTURE_PENDING','AWAITING_WEBHOOK') AND (lease_token IS NULL OR lease_expires<=?)",
      token,
      this.now() + 300000,
      id,
      user,
      this.now(),
    );
    requireThat(
      lease.meta.changes === 1,
      "capture_in_progress_or_not_capturable",
      409,
    );
    try {
      let r = await this.p.inspect(before.provider_id);
      await this.assertLease(id, token);
      this.validate(before, r, false);
      if (["CREATED", "PAYER_ACTION_REQUIRED"].includes(r.status)) {
        await this.s.run(
          "UPDATE sites_orders SET status='APPROVAL_PENDING' WHERE id=? AND lease_token=? AND lease_expires>? AND status='CAPTURE_PENDING' AND capture_verified=0 AND review=0",
          id,
          token,
          this.now(),
        );
        requireThat(false, "buyer_approval_required", 409);
      }
      if (r.status !== "COMPLETED") {
        requireThat(r.status === "APPROVED", "buyer_approval_required", 409);
        await this.assertLease(id, token);
        r = await this.p.capture(before.provider_id, id);
        await this.assertLease(id, token);
      }
      return await this.settle(id, r, null, token);
    } catch (e) {
      if (e.definitive)
        await this.s.run(
          "UPDATE sites_orders SET status='FAILED' WHERE id=? AND lease_token=? AND status='CAPTURE_PENDING' AND capture_verified=0",
          id,
          token,
        );
      throw e;
    } finally {
      await this.release(id, token);
    }
  }
  async cancel(user, id) {
    const r = await this.s.run(
      "UPDATE sites_orders SET status='CANCELLED' WHERE id=? AND user_id=? AND status IN ('CREATING','APPROVAL_PENDING') AND (lease_kind IS NULL OR lease_kind='create')",
      id,
      user,
    );
    const o = await this.owned(user, id);
    requireThat(
      r.meta.changes === 1 || o.status === "CANCELLED",
      "order_not_cancellable",
      409,
    );
    return this.view(o);
  }
  async applyHolds() {
    await this.s.batch([
      [`UPDATE sites_orders SET review=1,status='REVIEW' WHERE ${priorHold}`],
      [
        "UPDATE sites_entitlements SET status='held' WHERE source_order_id IN (SELECT id FROM sites_orders WHERE review=1)",
      ],
      [
        "UPDATE sites_game SET equipped=NULL WHERE EXISTS(SELECT 1 FROM sites_entitlements e WHERE e.user_id=sites_game.user_id AND e.sku=sites_game.equipped AND e.status='held')",
      ],
    ]);
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
    if (
      ![
        "PAYMENT.CAPTURE.COMPLETED",
        "PAYMENT.CAPTURE.REFUNDED",
        "PAYMENT.CAPTURE.REVERSED",
      ].includes(event.event_type)
    )
      return { status: "IGNORED" };
    let ref = eventReference(event);
    await this.s.run(
      "INSERT OR IGNORE INTO sites_verified_events VALUES(?,?,?,?,?)",
      this.p.name,
      event.id,
      event.event_type,
      ref.providerId ?? null,
      ref.captureId ?? null,
    );
    const saved = await this.s.one(
      "SELECT * FROM sites_verified_events WHERE provider=? AND id=?",
      this.p.name,
      event.id,
    );
    requireThat(
      saved.type === event.event_type &&
        (!saved.provider_id ||
          !ref.providerId ||
          saved.provider_id === ref.providerId) &&
        (!saved.capture_id ||
          !ref.captureId ||
          saved.capture_id === ref.captureId),
      "webhook_event_conflict",
      409,
    );
    const hold = event.event_type !== "PAYMENT.CAPTURE.COMPLETED";
    if (hold) {
      // Hold known rights before awaiting refund/capture/order API correlation.
      await this.applyHolds();
      ref = await this.p.eventReference(event);
      await this.s.run(
        "UPDATE sites_verified_events SET provider_id=?,capture_id=? WHERE provider=? AND id=?",
        ref.providerId ?? null,
        ref.captureId ?? null,
        this.p.name,
        event.id,
      );
      await this.applyHolds();
    }
    const o = await this.s.one(
      "SELECT * FROM sites_orders WHERE provider=? AND (provider_id=? OR capture_id=?)",
      this.p.name,
      ref.providerId ?? "",
      ref.captureId ?? "",
    );
    requireThat(o, "webhook_order_not_found", 503);
    if (hold) return this.view(await this.owned(o.user_id, o.id));
    const r = await this.p.inspect(o.provider_id);
    requireThat(
      event.resource?.id === r.captureId,
      "webhook_capture_mismatch",
      409,
    );
    return this.settle(o.id, r, event.id);
  }
}
