// Derived from OneSub 2b7dcd7ff5e21e252a7d8fdcf72769f651dc737f (MIT).
// Copyright (c) 2026 onesub. See ./LICENSE and ../../../THIRD_PARTY_NOTICES.md.
// Type erasure and dependency-free extraction only; evaluation semantics preserved.
const ENTITLED_SUBSCRIPTION_STATUSES = ["active", "grace_period"];
const PURCHASE_TYPE = { NON_CONSUMABLE: "non_consumable" };
export function isSubscriptionEntitled(sub, nowMs = Date.now()) {
  if (!ENTITLED_SUBSCRIPTION_STATUSES.includes(sub.status)) return false;
  // An unparsable grace end must not void a valid expiry (Math.max with NaN is NaN).
  const graceUntil = sub.gracePeriodExpiresAt
    ? Date.parse(sub.gracePeriodExpiresAt)
    : Number.NaN;
  return Date.parse(sub.expiresAt) > nowMs || graceUntil > nowMs;
}

export function evaluateEntitlementFrom(
  subs,
  purchases,
  entitlement,
  now = Date.now(),
) {
  const productIdSet = new Set(entitlement.productIds);

  // 1. Check subscriptions first (richer signal — has expiry).
  // Every record, as in 0.27. (/status drops replaced Google tokens; here that
  // would hide a still-paid old plan behind a deferred replacement.)
  for (const sub of subs) {
    if (!productIdSet.has(sub.productId)) continue;
    if (!isSubscriptionEntitled(sub, now)) continue;
    return {
      active: true,
      source: "subscription",
      productId: sub.productId,
      expiresAt: sub.expiresAt,
    };
  }

  // 2. Check non-consumable purchases.
  for (const p of purchases) {
    if (p.type !== PURCHASE_TYPE.NON_CONSUMABLE) continue;
    if (!productIdSet.has(p.productId)) continue;
    return {
      active: true,
      source: "purchase",
      productId: p.productId,
    };
  }

  return { active: false, source: null };
}

/**
 * Evaluate a single entitlement for a user, reading the records it needs.
 *
 * Thin wrapper over `evaluateEntitlementFrom` — see there for the entitlement
 * rules. Evaluating several entitlements for the same user through this
 * function costs 2 store reads each; prefer reading once and calling
 * `evaluateEntitlementFrom` directly in that case.
 */
export async function evaluateEntitlement(
  userId,
  entitlement,
  store,
  purchaseStore,
) {
  const now = Date.now();
  // Read subscriptions first and skip the purchase read entirely when one of
  // them already grants the entitlement — same laziness this function had
  // before `evaluateEntitlementFrom` was split out of it.
  const subs = await store.getAllByUserId(userId);
  const fromSubs = evaluateEntitlementFrom(subs, [], entitlement, now);
  if (fromSubs.active) return fromSubs;

  const purchases = await purchaseStore.getPurchasesByUserId(userId);
  return evaluateEntitlementFrom([], purchases, entitlement, now);
}
