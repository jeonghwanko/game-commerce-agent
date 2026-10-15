// Independent evaluator. Never import planner or use its projected state as truth.
const sameSet = (a, b) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export const actionKey = (a) =>
  a.type + ((a.sku ?? a.quest) ? ":" + (a.sku ?? a.quest) : "");
export function scoreIntent(c, result) {
  const errors = [];
  const actual = result.interpretation,
    expected = c.expectedIntent;
  if (
    !actual ||
    !sameSet(actual.goals, expected.goals) ||
    !sameSet(actual.avoidStyles, expected.avoidStyles) ||
    ["style", "spending", "clarify"].some((k) => actual[k] !== expected[k])
  )
    errors.push("interpretation");
  if (result.plan.strategy !== c.gold.strategy) errors.push("strategy");
  if (
    !sameSet(
      result.products.map((p) => p.sku),
      c.gold.skus,
    )
  )
    errors.push("sku");
  const actions = result.plan.actions.map(actionKey);
  if (c.gold.requiredActions.some((a) => !actions.includes(a)))
    errors.push("missing_action");
  if (
    actions.some((a) => !c.gold.allowedActions.includes(a)) ||
    new Set(actions).size !== actions.length
  )
    errors.push("forbidden_or_duplicate_action");
  let formal = c.context.formal,
    borrowed = c.context.borrowed,
    seal = c.context.seal,
    rumor = c.context.rumor;
  for (const a of result.plan.actions) {
    if (a.type === "borrow") borrowed = true;
    if (a.type === "equip") {
      if (a.sku === "borrowed" ? !borrowed : !c.context.owned.includes(a.sku))
        errors.push("ownership");
      formal = a.sku === "borrowed" || a.sku === "rosalyn-gala";
      if (expected.avoidStyles.includes(formal ? "formal" : "cloak"))
        errors.push("forbidden_style");
    }
    if (a.type === "quest" && a.quest === "seal") seal = true;
    if (a.type === "quest" && a.quest === "rumor") rumor = true;
  }
  if (
    expected.goals.includes("story") &&
    !expected.clarify &&
    !expected.avoidStyles.includes("formal") &&
    !(formal && seal && rumor)
  )
    errors.push("story_unsatisfied");
  const prices = { "rosalyn-gala": 199, "rosalyn-traveler": 99 };
  for (const p of result.products) {
    if (
      p.amount !== prices[p.sku] ||
      p.currency !== "USD" ||
      p.version !== 1 ||
      p.amount > c.budgetMinor ||
      c.context.entitlements.some((e) => e.sku === p.sku) ||
      expected.spending === "free"
    )
      errors.push("commerce_invariant");
    if (
      expected.avoidStyles.includes(
        p.sku === "rosalyn-gala" ? "formal" : "cloak",
      )
    )
      errors.push("forbidden_style");
  }
  return { match: errors.length === 0, errors: [...new Set(errors)] };
}
