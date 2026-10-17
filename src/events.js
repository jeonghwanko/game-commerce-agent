// Shared public analytics vocabulary; never accept arbitrary event metadata.
export const EVENT_NAMES = new Set([
  "shop_opened",
  "agent_query_submitted",
  "product_recommended",
  "product_selected",
  "checkout_started",
  "buyer_approved",
  "payment_captured",
  "payment_failed",
  "payment_pending",
  "checkout_cancelled",
  "entitlement_granted",
  "review_required",
  "item_equipped",
  "npc_reaction_triggered",
  "free_quest_completed",
]);

export function eventLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("invalid_outbox_limit");
  return limit;
}

export function eventIds(ids) {
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string" || !id || id.length > 256)
  )
    throw new Error("invalid_event_ids");
  return ids;
}
