/** Public integration contracts; independent of private game and mobile SDK code. */
export type ProviderName = "mock" | "paypal-sandbox";
export type OrderStatus =
  | "CREATING"
  | "APPROVAL_PENDING"
  | "CAPTURE_PENDING"
  | "AWAITING_WEBHOOK"
  | "GRANTED"
  | "CANCELLED"
  | "FAILED"
  | "REVIEW";
export interface Quote {
  id: string;
  user_id: string;
  sku: string;
  amount: number;
  currency: "USD";
  version: number;
  expires: number;
}
export interface ProviderOrder {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  captureId?: string;
  captureStatus?: string;
  merchantId?: string;
  captureOrderId?: string;
}
export interface PaymentProvider {
  name: ProviderName;
  create(order: {
    id: string;
    amount: number;
    currency: string;
  }): Promise<{ id: string; approvalUrl: string | null }>;
  inspect(providerId: string): Promise<ProviderOrder>;
  capture(providerId: string, localOrderId: string): Promise<ProviderOrder>;
  verifyWebhook(
    headers: Record<string, string>,
    event: unknown,
  ): Promise<boolean>;
}
export interface EntitlementView {
  sku: string;
  status: "active" | "held";
}
export interface GameCommerceBridge {
  /** Identity comes from host-authenticated session, never URL/body userId. */
  entitlements(): Promise<EntitlementView[]>;
  equip(sku: string): Promise<unknown>;
  /** Host game retains authority over independent seal/rumor quest progression. */
}
export interface CommerceEvent {
  id: string;
  user_id: string;
  order_id: string | null;
  name: string;
  at: number;
}
export interface EventSink {
  accept(event: CommerceEvent): Promise<void>;
}
/** Only a host-owned authentication verifier may construct this value. */
export interface VerifiedPrincipal {
  authenticated: true;
  issuer: string;
  subject: string;
  expiresAt: number;
  csrfToken: string;
}
export interface PrincipalVerifier {
  (
    request: import("node:http").IncomingMessage,
  ): Promise<VerifiedPrincipal | null>;
}
export interface GoalPlan {
  goal: "guard" | "travel" | "outfit" | "unsupported";
  strategy: "use_owned" | "use_free" | "no_purchase" | "consider_purchase";
  projected: {
    equipped: string | null;
    formal: boolean;
    borrowed: boolean;
    seal: boolean;
    rumor: boolean;
    canEnter: boolean;
  };
  actions: Array<{
    type:
      | "equip"
      | "keep_owned"
      | "borrow"
      | "quest"
      | "review_purchase"
      | "no_purchase";
    label: string;
    sku?: string;
    quest?: "seal" | "rumor";
  }>;
}

/** Conditional display data; never usable as an ownership or quest grant. */
export interface LookPreview {
  sku: string;
  name: string;
  access: "owned" | "free_loan" | "optional_purchase" | "held";
  additionalCost: { amount: number; currency: string } | null;
  dressCheck: boolean;
  afterWearing: GoalPlan["projected"];
  remaining: string[];
  condition: string;
  rosalyn: string;
  guard: string;
}
export interface StoryComparison {
  budget: { amount: number; currency: "USD" };
  afterPlan: GoalPlan["projected"];
  freeQuestActions: GoalPlan["actions"];
  options: Array<
    LookPreview & { withinBudget: boolean; suggestedPurchase: boolean }
  >;
}
