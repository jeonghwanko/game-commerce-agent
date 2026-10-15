// Default is a zero-network preflight. Only run --live after configuration is confirmed.
import { Store } from "../src/store.js";
import { Recommender } from "../src/recommend.js";
import { AI_MODEL, AI_COST_POLICY, costLimitedFetch } from "../src/ai-cost.js";
import {
  intentCases,
  evaluationComposition,
} from "../fixtures/intent-evaluation.js";
import { scoreIntent } from "../fixtures/score-intent.js";
import { catalog } from "../src/catalog.js";
const live = process.argv.includes("--live");
console.log(
  JSON.stringify({
    mode: live ? "live" : "dry-run",
    cases: intentCases.length,
    composition: evaluationComposition,
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
  const bySplit = {
    regression: { cases: 0, correct: 0, failures: 0 },
    holdout: { cases: 0, correct: 0, failures: 0 },
  };
  try {
    for (const c of intentCases) {
      bySplit[c.split].cases++;
      try {
        const result = await r.recommend(c, c.context);
        const { match, errors } = scoreIntent(c, result);
        correct += Number(match);
        bySplit[c.split].correct += Number(match);
        violations += Number(
          errors.some((e) =>
            ["commerce_invariant", "ownership", "forbidden_style"].includes(e),
          ) ||
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
            errors,
            split: c.split,
            strategy: result.plan.strategy,
          }),
        );
      } catch {
        failures++;
        bySplit[c.split].failures++;
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
        bySplit,
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
