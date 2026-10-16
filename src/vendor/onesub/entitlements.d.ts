// Derived from OneSub 2b7dcd7ff5e21e252a7d8fdcf72769f651dc737f (MIT).
// Copyright (c) 2026 onesub. See ./LICENSE and ../../../THIRD_PARTY_NOTICES.md.
// Type erasure and dependency-free extraction only; evaluation semantics preserved.
export interface Entitlement {
  productIds: string[];
}

/** Map of entitlement id → definition. Pass via `OneSubServerConfig.entitlements`. */
export type EntitlementsConfig = Record<string, Entitlement>;

/** Result of evaluating a single entitlement for a userId. */
export interface EntitlementStatus {
  /** True when at least one matching active subscription or non-consumable purchase exists. */
  active: boolean;
  /**
   * Where the entitlement was sourced from when active:
   *   - 'subscription' — an active SubscriptionInfo matched
   *   - 'purchase'     — a non-consumable PurchaseInfo matched
   *   - null when not active
   */
  source: "subscription" | "purchase" | null;
  /** The matched productId (only present when active). */
  productId?: string;
  /** Subscription expiry (only present when source === 'subscription'). */
  expiresAt?: string;
}

/** Platform-independent projections required by the extracted evaluator. */
export interface SubscriptionRecord {
  productId: string;
  status: string;
  expiresAt: string;
  gracePeriodExpiresAt?: string;
}
export interface PurchaseRecord {
  productId: string;
  type: string;
}
export function evaluateEntitlementFrom(
  subs: readonly SubscriptionRecord[],
  purchases: readonly PurchaseRecord[],
  entitlement: Entitlement,
  now?: number,
): EntitlementStatus;
export function evaluateEntitlement(
  userId: string,
  entitlement: Entitlement,
  store: { getAllByUserId(id: string): Promise<SubscriptionRecord[]> },
  purchaseStore: {
    getPurchasesByUserId(id: string): Promise<PurchaseRecord[]>;
  },
): Promise<EntitlementStatus>;
export function isSubscriptionEntitled(
  sub: SubscriptionRecord,
  now?: number,
): boolean;
