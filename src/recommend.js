import { catalog, requireThat } from "./catalog.js";
import { tokenUsage, transportAIError, httpAIError } from "./ai-telemetry.js";
import {
  intentSchema,
  validateIntent,
  offlineIntent,
  INTENT_SYSTEM_PROMPT,
} from "./intent.js";
import { planGoal } from "./planner.js";
import { storyComparison } from "./story-preview.js";
export class Recommender {
  constructor({
    mode = "mock",
    key,
    model,
    fetcher = fetch,
    timeoutMs = 15000,
    maxCalls = 100,
  } = {}) {
    requireThat(["mock", "openai"].includes(mode), "invalid_ai_mode");
    if (mode === "openai")
      requireThat(key && model, "ai_configuration_required");
    requireThat(
      Number.isInteger(timeoutMs) &&
        timeoutMs > 0 &&
        timeoutMs <= 15000 &&
        Number.isInteger(maxCalls) &&
        maxCalls >= 0 &&
        maxCalls <= 1000,
      "invalid_ai_limits",
    );
    Object.assign(this, { mode, key, model, fetcher, timeoutMs, maxCalls });
    this.calls = 0;
  }
  async recommend({ goal, budgetMinor }, context, { onUsage } = {}) {
    requireThat(
      typeof goal === "string" && goal.trim().length > 0 && goal.length <= 500,
      "invalid_goal",
    );
    requireThat(
      Number.isSafeInteger(budgetMinor) &&
        budgetMinor >= 0 &&
        budgetMinor <= 100000,
      "invalid_budget",
    );
    let intent = offlineIntent(goal);
    if (this.mode === "openai") {
      requireThat(this.calls < this.maxCalls, "ai_call_budget_exhausted", 429);
      this.calls++;
      const schema = intentSchema;
      let response;
      try {
        response = await this.fetcher(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(this.timeoutMs),
            headers: {
              Authorization: `Bearer ${this.key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: this.model,
              max_completion_tokens: 250,
              service_tier: "default",
              messages: [
                {
                  role: "system",
                  content: INTENT_SYSTEM_PROMPT,
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    goal,
                    budgetMinor,
                    catalog: catalog.map(({ name, description, effect }) => ({
                      name,
                      description,
                      effect,
                    })),
                    context: {
                      seal: context.seal,
                      rumor: context.rumor,
                      borrowed: context.borrowed,
                    },
                  }),
                },
              ],
              tool_choice: "none",
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "player_intent",
                  strict: true,
                  schema,
                },
              },
            }),
          },
        );
      } catch (e) {
        throw transportAIError(e);
      }
      if (!response.ok) throw httpAIError(response.status);
      let result;
      try {
        result = await response.json();
      } catch {
        requireThat(false, "invalid_ai_response", 502);
      }
      onUsage?.(tokenUsage(result?.usage));
      requireThat(
        result?.model === undefined || result.model === this.model,
        "ai_model_mismatch",
        502,
      );
      requireThat(
        result?.service_tier === undefined || result.service_tier === "default",
        "ai_service_tier_unexpected",
        502,
      );
      requireThat(
        result && typeof result === "object" && !Array.isArray(result),
        "invalid_ai_response",
        502,
      );
      const choice = result.choices?.[0];
      requireThat(
        result.choices?.length === 1 &&
          choice.finish_reason === "stop" &&
          !choice.message?.tool_calls &&
          !choice.message?.function_call &&
          !choice.message?.refusal &&
          typeof choice.message?.content === "string" &&
          choice.message.content.length <= 4096,
        "invalid_ai_response",
        502,
      );
      let parsed;
      try {
        parsed = JSON.parse(result.choices?.[0]?.message?.content);
      } catch {
        requireThat(false, "invalid_ai_response", 502);
      }
      intent = validateIntent(parsed);
    }
    const plan = planGoal(intent, budgetMinor, context, catalog);
    const available = catalog.filter((p) => plan.eligibleSkus.includes(p.sku));
    // Model text, price and effects are never rendered as authoritative product data.
    return {
      mode: this.mode,
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
}
