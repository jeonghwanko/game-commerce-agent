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
    if (context.equipped !== owned.sku)
      actions.push(
        (story && owned.effect !== "formal") ||
          (collection && intent.spending === "free")
          ? {
              type: "keep_owned",
              sku: owned.sku,
              label: story
                ? `Keep your owned ${owned.name} in your collection; wear formal clothes for entry.`
                : `Keep your owned ${owned.name}; no purchase or change of outfit is required.`,
            }
          : {
              type: "equip",
              sku: owned.sku,
              label: `Wear your owned ${owned.name}.`,
            },
      );
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
  // Simulate chosen actions before adding dress-code repairs. Reviews grant nothing.
  let projected = projectPlan(actions, context, catalog);
  if (
    story &&
    !intent.clarify &&
    !intent.avoidStyles.includes("formal") &&
    !projected.formal
  ) {
    const formalOwned = catalog.find(
      (p) => p.effect === "formal" && context.owned.includes(p.sku),
    );
    if (formalOwned)
      actions.push({
        type: "equip",
        sku: formalOwned.sku,
        label: `Wear your owned ${formalOwned.name} for entry.`,
      });
    else {
      if (!projected.borrowed)
        actions.push({
          type: "borrow",
          label: "Borrow formal clothes for free; ownership stays separate.",
        });
      actions.push({
        type: "equip",
        sku: "borrowed",
        label: "Wear the free formal loan for story entry.",
      });
    }
    if (strategy === "no_purchase" && !collection && !intent.clarify)
      strategy = "use_free";
  }
  if (story && !intent.clarify) {
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
  projected = projectPlan(actions, context, catalog);
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
    intent: {
      goals: [...intent.goals],
      style: intent.style,
      avoidStyles: [...intent.avoidStyles],
      spending: intent.spending,
      clarify: intent.clarify,
    },
    projected,
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

/** Projection only: no mutation, no speculative purchase grants. */
export function projectPlan(actions, context, catalog) {
  const p = {
    equipped: context.equipped ?? null,
    formal: !!context.formal,
    borrowed: !!context.borrowed,
    seal: !!context.seal,
    rumor: !!context.rumor,
  };
  for (const a of actions) {
    if (a.type === "borrow") p.borrowed = true;
    if (a.type === "equip") {
      const owned = context.owned.includes(a.sku);
      if ((a.sku === "borrowed" && p.borrowed) || owned) {
        p.equipped = a.sku;
        p.formal =
          a.sku === "borrowed" ||
          catalog.some((c) => c.sku === a.sku && c.effect === "formal");
      }
    }
    if (a.type === "quest" && ["seal", "rumor"].includes(a.quest))
      p[a.quest] = true;
  }
  return { ...p, canEnter: p.formal && p.seal && p.rumor };
}
