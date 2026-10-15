// Default is a zero-network preflight. Only run --live after configuration is confirmed.
import { Store } from "../src/store.js";
import { Recommender } from "../src/recommend.js";
import { AI_MODEL, AI_COST_POLICY, costLimitedFetch } from "../src/ai-cost.js";
import { intentCases } from "../fixtures/intent-evaluation.js";
import { planGoal } from "../src/planner.js";
import { catalog } from "../src/catalog.js";
const live = process.argv.includes("--live");
console.log(
  JSON.stringify({
    mode: live ? "live" : "dry-run",
    cases: intentCases.length,
    model: AI_MODEL,
    policy: AI_COST_POLICY,
    modelEvaluationPerformed: false,
  }),
);
if (live) {
  if (
    process.env.EVAL_CONFIGURATION_READY !== "true" ||
    !process.env.OPENAI_API_KEY ||
    !process.env.DATABASE_PATH
  )
    throw new Error(
      "parent_configuration_confirmation_and_persistent_DATABASE_PATH_required",
    );
  const store = new Store(process.env.DATABASE_PATH);
  const r = new Recommender({
    mode: "openai",
    key: process.env.OPENAI_API_KEY,
    model: AI_MODEL,
    fetcher: costLimitedFetch(store),
  });
  let correct = 0,
    violations = 0,
    failures = 0;
  try {
    for (const c of intentCases) {
      try {
        const result = await r.recommend(c, c.context);
        const expected = planGoal(
          c.expectedIntent,
          c.budgetMinor,
          c.context,
          catalog,
        );
        const match =
          result.plan.strategy === expected.strategy &&
          JSON.stringify(result.products.map((p) => p.sku)) ===
            JSON.stringify(expected.eligibleSkus);
        correct += Number(match);
        violations += Number(
          result.products.some(
            (p) =>
              !catalog.some((x) => JSON.stringify(x) === JSON.stringify(p)) ||
              p.amount > c.budgetMinor ||
              c.context.owned.includes(p.sku),
          ),
        );
        console.log(
          JSON.stringify({
            category: c.category,
            state: c.state,
            match,
            strategy: result.plan.strategy,
          }),
        );
      } catch {
        failures++;
        console.log(
          JSON.stringify({
            category: c.category,
            state: c.state,
            error: "evaluation_request_failed",
          }),
        );
      }
    }
    console.log(
      JSON.stringify({
        modelEvaluationPerformed: true,
        cases: intentCases.length,
        correct,
        violations,
        failures,
        reservedAttempts: store.get(
          "SELECT used FROM external_budgets WHERE name='ai-usd5-v1'",
        ).used,
      }),
    );
    if (violations || failures || correct !== intentCases.length)
      process.exitCode = 1;
  } finally {
    store.close();
  }
}
