import { evaluateEntitlementFrom } from "./vendor/onesub/entitlements.js";
/** Ledger trust boundary: only active, verified, non-held purchases reach OneSub.
 * Provider platform remains paypal-sandbox/mock, never apple/google.
 */
export function entitlementViews(store, user) {
  const records = store.all(
    `SELECT e.sku,e.status,o.status order_status,o.capture_verified,o.webhook_verified,o.review
    FROM entitlements e JOIN orders o ON o.id=e.source_order_id WHERE e.user_id=? AND o.user_id=?`,
    user,
    user,
  );
  const purchases = records
    .filter(
      (r) =>
        r.status === "active" &&
        r.order_status === "GRANTED" &&
        r.capture_verified === 1 &&
        r.webhook_verified === 1 &&
        r.review === 0,
    )
    .map((r) => ({ productId: r.sku, type: "non_consumable" }));
  return records.map((r) => ({
    sku: r.sku,
    status: evaluateEntitlementFrom([], purchases, { productIds: [r.sku] })
      .active
      ? "active"
      : "held",
  }));
}
