import { validateIntent } from "./intent.js";
/** Pure authoritative planner. Interpretation is untrusted data, never actions/prices/rights. */
export function planGoal(input, budgetMinor, context, catalog) {
  const intent = validateIntent(input);
  const story = intent.goals.includes("story"),
    collection = intent.goals.includes("collection");
  const kind = story
    ? "guard"
    : collection
      ? intent.style === "cloak"
        ? "travel"
        : "outfit"
      : "unsupported";
  const actions = [];
  const style = collection ? intent.style : "formal";
  const matches = catalog.filter(
    (p) =>
      p.active &&
      !intent.avoidStyles.includes(
        p.effect === "formal" ? "formal" : "cloak",
      ) &&
      (style === "any" ||
        (style === "formal"
          ? p.effect === "formal"
          : style === "cloak" && p.effect === "cosmetic")),
  );
  const owned = matches.find((p) => context.owned.includes(p.sku));
  const available = matches.filter(
    (p) =>
      p.amount <= budgetMinor &&
      !context.entitlements?.some((e) => e.sku === p.sku),
  );
  let strategy = "no_purchase",
    reason = "unsupported";
  if (intent.clarify || style === "unspecified") reason = "clarify";
  else if (!intent.goals.length) reason = "unsupported";
  else if (owned) {
    strategy = "use_owned";
    reason = "already_owned";
    actions.push({
      type: "equip",
      sku: owned.sku,
      label: `Wear your owned ${owned.name}.`,
    });
  } else if (story && !collection && context.formal) reason = "already_ready";
  else if (story && !collection && context.borrowed) {
    strategy = "use_free";
    reason = "loan_available";
    actions.push({
      type: "equip",
      sku: "borrowed",
      label: "Wear your free borrowed formal clothes.",
    });
  } else if (intent.spending === "free" || budgetMinor === 0) {
    strategy = story ? "use_free" : "no_purchase";
    reason = "free_preference";
  } else if (available.length) {
    strategy = "consider_purchase";
    reason = "optional_collection";
    actions.push({
      type: "review_purchase",
      label:
        "Optional collection: preview an outfit within your budget. Purchase requires your explicit confirmation.",
    });
  } else
    reason = !matches.length
      ? "no_suitable_style"
      : matches.every((p) => context.entitlements?.some((e) => e.sku === p.sku))
        ? "held_purchase"
        : "budget_insufficient";
  if (story && !context.formal) {
    actions.push({
      type: "borrow",
      label:
        "For story entry, borrow and wear formal clothes for free. Collecting a different look is optional.",
    });
    if (strategy === "no_purchase" && !collection && !intent.clarify)
      strategy = "use_free";
  }
  if (story) {
    if (!context.seal)
      actions.push({
        type: "quest",
        quest: "seal",
        label: "Get the free invitation seal from the courier.",
      });
    if (!context.rumor)
      actions.push({
        type: "quest",
        quest: "rumor",
        label: "Learn the free password from the archivist.",
      });
  }
  const reasons = {
    unsupported: "No catalog item is verified to solve this goal.",
    clarify:
      "Please clarify: story entry, a formal coat, or a traveler’s cloak?",
    already_ready: "Your current clothes already meet the dress check.",
    free_preference:
      "Your free preference is respected. No purchase is suggested.",
    budget_insufficient:
      "No suitable available outfit fits this budget. Buying is optional.",
    held_purchase:
      "This purchase is on hold. Review its status; do not buy it again.",
    no_suitable_style: "No catalog outfit meets these style constraints.",
  };
  if (reasons[reason])
    actions.unshift({ type: "no_purchase", label: reasons[reason] });
  return {
    goal: kind,
    strategy,
    reason,
    actions,
    freeAlternative: story
      ? "Borrow formal clothes and complete only the missing seal and rumor quests for free."
      : "Keep your current outfit; buying is optional.",
    eligibleSkus:
      strategy === "consider_purchase" ? available.map((p) => p.sku) : [],
  };
}
