import { catalog } from "./catalog.js";
import { planGoal } from "./planner.js";
import { storyComparison } from "./story-preview.js";
// Shared server-authoritative response builder; no transport, storage or AI imports.
export function recommendationPlan(intent, budgetMinor, context, mode) {
  const plan = planGoal(intent, budgetMinor, context, catalog);
  const available = catalog.filter((p) => plan.eligibleSkus.includes(p.sku));
  // Model text, price and effects are never rendered as authoritative product data.
  return {
    mode: mode,
    interpretation: intent,
    products: available,
    comparison: storyComparison(plan, context, catalog, budgetMinor),
    plan: {
      goal: plan.goal,
      projected: plan.projected,
      strategy: plan.strategy,
      reason: plan.reason,
      actions: plan.actions,
    },
    freeAlternative: plan.freeAlternative,
  };
}
