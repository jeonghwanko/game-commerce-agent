/** Authoritative goal plan. LLM output cannot create actions or change quest rules. */
export function planGoal(goal, budgetMinor, context, catalog) {
  const normalized = goal.toLowerCase();
  const kind = /guard|formal|gala|경비|저택|정장/.test(normalized)
    ? "guard"
    : /travel|cloak|망토/.test(normalized)
      ? "travel"
      : /outfit|clothes|옷|의상/.test(normalized)
        ? "outfit"
        : "unsupported";
  const goalProducts = catalog.filter((p) =>
    kind === "guard"
      ? p.effect === "formal"
      : kind === "travel"
        ? p.effect === "cosmetic"
        : kind === "outfit",
  );
  const owned = goalProducts.find((p) => context.owned.includes(p.sku));
  const actions = [];
  let strategy;
  if (kind === "unsupported") {
    strategy = "no_purchase";
    actions.push({
      type: "no_purchase",
      label: "No catalog item is verified to solve this goal.",
    });
  } else if (kind === "guard" && context.formal) {
    strategy = "no_purchase";
    actions.push({
      type: "no_purchase",
      label: "Your equipped outfit already meets the dress check.",
    });
  } else if (owned) {
    strategy = "use_owned";
    actions.push({
      type: "equip",
      sku: owned.sku,
      label: `Wear your owned ${owned.name}.`,
    });
  } else if (kind === "guard" && context.borrowed) {
    strategy = "use_free";
    actions.push({
      type: "equip",
      sku: "borrowed",
      label: "Wear the formal clothes you already borrowed.",
    });
  } else if (
    budgetMinor === 0 ||
    /free|no purchase|do not buy|무료|사지|구매하지/.test(normalized)
  ) {
    strategy = kind === "guard" ? "use_free" : "no_purchase";
    actions.push(
      kind === "guard"
        ? {
            type: "borrow",
            label: "Borrow formal clothes for free, then equip them.",
          }
        : {
            type: "no_purchase",
            label: "Keep your current outfit; no purchase is needed.",
          },
    );
  } else if (goalProducts.some((p) => p.amount <= budgetMinor)) {
    strategy = "consider_purchase";
    actions.push({
      type: "review_purchase",
      label:
        "Optional: review a suitable outfit within your budget. Confirmation is required.",
    });
  } else {
    strategy = kind === "guard" ? "use_free" : "no_purchase";
    actions.push(
      kind === "guard"
        ? {
            type: "borrow",
            label: "Borrow formal clothes; paid options exceed your budget.",
          }
        : {
            type: "no_purchase",
            label: "No suitable outfit fits this budget.",
          },
    );
  }
  if (kind === "guard") {
    if (!context.seal)
      actions.push({
        type: "quest",
        quest: "seal",
        label: "Complete the free seal quest.",
      });
    if (!context.rumor)
      actions.push({
        type: "quest",
        quest: "rumor",
        label: "Complete the free rumor quest.",
      });
  }
  return {
    goal: kind,
    strategy,
    actions,
    freeAlternative:
      kind === "guard"
        ? "Borrow formal clothes and complete the seal and rumor quests for free."
        : "Keep your current outfit; buying is optional.",
    eligibleSkus:
      strategy === "consider_purchase" ? goalProducts.map((p) => p.sku) : [],
  };
}
