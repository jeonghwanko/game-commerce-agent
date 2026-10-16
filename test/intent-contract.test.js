import { test } from "node:test";
import assert from "node:assert/strict";
import { Recommender } from "../src/recommend.js";
import { planGoal } from "../src/planner.js";
import { scoreIntent } from "../fixtures/score-intent.js";
import { catalog } from "../src/catalog.js";
import { intentCases, baseContext } from "../fixtures/intent-evaluation.js";
for (const [i, c] of intentCases.entries())
  test(`interpreted plan contract ${i + 1}/${intentCases.length} ${c.category}/${c.state} (stub, not model quality)`, async () => {
    const before = JSON.stringify(c.context);
    const r = new Recommender({
      mode: "openai",
      key: "stub",
      model: "stub",
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(c.expectedIntent) },
            },
          ],
        }),
      }),
    });
    const result = await r.recommend(c, c.context);
    assert.equal(JSON.stringify(c.context), before);
    assert.deepEqual(scoreIntent(c, result), { match: true, errors: [] });
  });
test("offline rehearsal phrases and negation are handled; collection survives loan and completed story", async () => {
  const r = new Recommender();
  for (const [goal, sku] of [
    ["enter the evening gathering", "rosalyn-gala"],
    ["violet coat with gold embroidery", "rosalyn-gala"],
    ["I do not want formal clothes; show me a teal cloak", "rosalyn-traveler"],
  ]) {
    const p = await r.recommend({ goal, budgetMinor: 300 }, baseContext);
    assert.equal(p.products[0].sku, sku);
  }
  const p = await r.recommend(
    { goal: "Collect the Gala coat", budgetMinor: 300 },
    { ...baseContext, borrowed: true, formal: true, seal: true, rumor: true },
  );
  assert.equal(p.plan.strategy, "consider_purchase");
});
test("server independently filters hostile typed interpretations across budgets and held rights", () => {
  for (const budget of [0, 98, 99, 198, 199, 300])
    for (const style of ["formal", "cloak", "any", "unspecified"])
      for (const spending of ["free", "optional"]) {
        const p = planGoal(
          {
            goals: ["story", "collection"],
            style,
            avoidStyles: ["formal"],
            spending,
            clarify: false,
          },
          budget,
          {
            ...baseContext,
            entitlements: [{ sku: "rosalyn-traveler", status: "held" }],
          },
          catalog,
        );
        assert.equal(p.eligibleSkus.length, 0);
      }
});

test("gold rejects collection-only mixed result and missing/overwriting actions even if strategy/SKU match", () => {
  const c = intentCases.find(
    (c) => c.category === "mixed" && c.state === "new",
  );
  const intent = c.expectedIntent;
  const p = planGoal(intent, c.budgetMinor, c.context, catalog);
  const good = {
    interpretation: intent,
    plan: p,
    products: catalog.filter((x) => p.eligibleSkus.includes(x.sku)),
  };
  assert.equal(scoreIntent(c, good).match, true);
  for (const bad of [
    { ...good, interpretation: { ...intent, goals: ["collection"] } },
    {
      ...good,
      plan: { ...p, actions: p.actions.filter((a) => a.quest !== "seal") },
    },
    {
      ...good,
      plan: {
        ...p,
        actions: [...p.actions, { type: "equip", sku: "rosalyn-traveler" }],
      },
    },
  ])
    assert.equal(scoreIntent(c, bad).match, false);
});
