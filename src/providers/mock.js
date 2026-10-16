import { randomUUID } from "node:crypto";
import { requireThat } from "../catalog.js";
/** Offline provider; durable state makes timeout/restart tests realistic. */
export class MockProvider {
  name = "mock";
  constructor(store) {
    this.store = store;
  }
  async create(order) {
    const existing = this.store.get(
      "SELECT * FROM mock_orders WHERE reference=?",
      order.id,
    );
    const id = existing?.id ?? `mock-${randomUUID()}`;
    if (!existing)
      this.store.run(
        "INSERT INTO mock_orders VALUES(?,?,?,?,?,NULL)",
        id,
        order.id,
        order.amount,
        order.currency,
        "CREATED",
      );
    return { id, approvalUrl: null };
  }
  async approve(id) {
    this.store.run(
      "UPDATE mock_orders SET status='APPROVED' WHERE id=? AND status='CREATED'",
      id,
    );
  }
  async capture(id) {
    const o = await this.inspect(id);
    requireThat(
      ["APPROVED", "COMPLETED"].includes(o.status),
      "buyer_approval_required",
    );
    if (o.status !== "COMPLETED")
      this.store.run(
        "UPDATE mock_orders SET status='COMPLETED',capture_id=? WHERE id=?",
        `cap-${randomUUID()}`,
        id,
      );
    return this.inspect(id);
  }
  async inspect(id) {
    const o = this.store.get("SELECT * FROM mock_orders WHERE id=?", id);
    requireThat(o, "provider_order_missing");
    return {
      id: o.id,
      reference: o.reference,
      amount: o.amount,
      currency: o.currency,
      status: o.status,
      captureId: o.capture_id,
      captureStatus: o.capture_id ? "COMPLETED" : null,
    };
  }
  async verifyWebhook() {
    return false;
  } // No public mock webhook signature bypass.
}
