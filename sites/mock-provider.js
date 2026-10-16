import { requireThat } from "../src/catalog.js";
import { uuid } from "./d1.js";
export class D1MockProvider {
  name = "mock";
  constructor(s) {
    this.s = s;
  }
  async create(o) {
    await this.s.run(
      "INSERT OR IGNORE INTO sites_mock_orders VALUES(?,?,?,?, 'CREATED',NULL)",
      `mock-${uuid()}`,
      o.id,
      o.amount,
      o.currency,
    );
    const r = await this.s.one(
      "SELECT id FROM sites_mock_orders WHERE reference=?",
      o.id,
    );
    return { id: r.id, approvalUrl: null };
  }
  async inspect(id) {
    const r = await this.s.one(
      "SELECT * FROM sites_mock_orders WHERE id=?",
      id,
    );
    requireThat(r, "provider_order_missing");
    return {
      id: r.id,
      reference: r.reference,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      captureId: r.capture_id,
      captureStatus: r.capture_id ? "COMPLETED" : null,
    };
  }
  async approve(id) {
    await this.s.run(
      "UPDATE sites_mock_orders SET status='APPROVED' WHERE id=? AND status='CREATED'",
      id,
    );
  }
  async capture(id) {
    const r = await this.inspect(id);
    requireThat(
      ["APPROVED", "COMPLETED"].includes(r.status),
      "buyer_approval_required",
    );
    await this.s.run(
      "UPDATE sites_mock_orders SET status='COMPLETED',capture_id=? WHERE id=? AND status='APPROVED'",
      `cap-${uuid()}`,
      id,
    );
    return this.inspect(id);
  }
  async verifyWebhook() {
    return false;
  }
}
