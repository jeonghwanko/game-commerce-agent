import { projectPlan } from "./planner.js";

/** Read-only, conditional look simulation. Never writes rights, quests or orders. */
export function lookPreviews(context, catalog) {
  return [
    {
      sku: "borrowed",
      name: "Plain formal loan",
      amount: 0,
      currency: "USD",
      effect: "formal",
    },
    ...catalog.filter((p) => p.active),
  ].map((p) => {
    const loan = p.sku === "borrowed";
    const owned = context.owned.includes(p.sku);
    const held =
      !loan && !owned && context.entitlements?.some((e) => e.sku === p.sku);
    const access = loan
      ? "free_loan"
      : owned
        ? "owned"
        : held
          ? "held"
          : "optional_purchase";
    // This copied context is hypothetical, not an entitlement. No quest is added.
    const hypothetical = {
      ...context,
      borrowed: loan || context.borrowed,
      owned: [...context.owned, ...(!loan && !owned ? [p.sku] : [])],
    };
    const afterWearing = projectPlan(
      [{ type: "equip", sku: p.sku }],
      hypothetical,
      catalog,
    );
    const remaining = [
      !afterWearing.formal && "formal clothes (free loan available)",
      !context.seal && "the free invitation seal",
      !context.rumor && "the free password quest",
    ].filter(Boolean);
    return {
      sku: p.sku,
      name: p.name,
      access,
      additionalCost: held
        ? null
        : { amount: loan || owned ? 0 : p.amount, currency: p.currency },
      dressCheck: afterWearing.formal,
      afterWearing,
      remaining,
      condition: held
        ? "On hold. This look is unavailable; do not purchase it again."
        : loan
          ? context.borrowed
            ? "Available loan. Choose Wear to equip; it never becomes an owned collectible."
            : "Visit Rosalyn to borrow for free, then choose Wear. No purchase required."
          : owned
            ? "Already in your owned collection. Choose Wear; no new purchase required."
            : "Optional purchase. Confirm the exact quote, complete verified payment, then choose Wear. Preview grants nothing.",
      rosalyn: loan
        ? "This plain formal loan passes the same dress check as Gala, for free. It is a loan, not a collectible."
        : p.effect === "formal"
          ? "The violet coat and gold star embroidery change your look. Collection is optional; the free loan meets the same dress check."
          : "The teal cloak changes your silhouette. It is a collectible, but it is not formal clothing.",
      guard: held
        ? "I cannot count an outfit that is on hold. Use an available outfit or the free formal loan."
        : remaining.length
          ? `If you wear this look, you still need ${remaining.join(" and ")}.`
          : "If you wear this look, all three checks pass. You may enter without another purchase.",
    };
  });
}

export function storyComparison(plan, context, catalog, budgetMinor) {
  if (plan.goal !== "guard") return null;
  return {
    budget: { amount: budgetMinor, currency: "USD" },
    // Reuse the validated plan, not a second interpretation/planning system.
    afterPlan: plan.projected,
    freeQuestActions: plan.actions.filter((a) => a.type === "quest"),
    options: lookPreviews(context, catalog).map((p) => ({
      ...p,
      withinBudget:
        p.additionalCost !== null && p.additionalCost.amount <= budgetMinor,
      suggestedPurchase: plan.eligibleSkus.includes(p.sku),
    })),
  };
}
