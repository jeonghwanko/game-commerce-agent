import { test } from "node:test";
import assert from "node:assert/strict";
import { Recommender } from "../src/recommend.js";
import { planGoal } from "../src/planner.js";
import { catalog } from "../src/catalog.js";
import { intentCases, baseContext } from "../fixtures/intent-evaluation.js";
for (const [i, c] of intentCases.entries())
  test(`interpreted plan contract ${i + 1}/36 ${c.category}/${c.state} (stub, not model quality)`, async () => {
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
    const expected = planGoal(
      c.expectedIntent,
      c.budgetMinor,
      c.context,
      catalog,
    );
    assert.equal(result.plan.strategy, expected.strategy);
    assert.equal(JSON.stringify(c.context), before);
    for (const p of result.products) {
      assert.deepEqual(
        p,
        catalog.find((x) => x.sku === p.sku),
      );
      assert.ok(p.amount <= c.budgetMinor);
      assert.ok(!c.context.owned.includes(p.sku));
    }
    if (c.expectedIntent.spending === "free" || c.expectedIntent.clarify)
      assert.equal(result.products.length, 0);
    if (c.category === "collection" && c.state === "free-story-complete")
      assert.equal(result.products[0].sku, "rosalyn-gala");
    if (c.category === "negation")
      assert.deepEqual(
        result.products.map((p) => p.sku),
        ["rosalyn-traveler"],
      );
    if (c.category === "mixed")
      assert.ok(
        result.plan.actions.some((a) => a.type === "borrow") ||
          c.context.formal,
      );
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
