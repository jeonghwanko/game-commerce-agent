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
