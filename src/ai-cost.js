import { ExternalWorkBudget } from "./budget.js";
import { requireThat } from "./catalog.js";
import { AI_MODEL, AI_COST_POLICY } from "./ai-policy.js";
export { AI_MODEL, AI_COST_POLICY } from "./ai-policy.js";
import { consumeAIJSON } from "./ai-response.js";
/** Reserve the entire worst-case allowance BEFORE network I/O, including failures.
 * UTF-8 byte bound plus 1024 framing tokens is conservative for this text-only API.
 * Same DB/name in HTTP and CLI. No automatic refunds, retries or fallback models.
 */
export function costLimitedFetch(
  store,
  fetcher = fetch,
  now = Date.now,
  { onReserve } = {},
) {
  const budget = new ExternalWorkBudget(store, {
    name: "ai-usd5-v1",
    limit: 100,
    concurrency: 1,
  });
  return async (url, options) => {
    requireThat(
      now() < Date.parse(AI_COST_POLICY.reviewExpires),
      "ai_price_review_expired",
    );
    const b = JSON.parse(options.body);
    const bytes = Buffer.byteLength(options.body, "utf8");
    requireThat(
      url === "https://api.openai.com/v1/chat/completions" &&
        b.model === AI_MODEL &&
        b.max_completion_tokens === 250 &&
        b.tool_choice === "none" &&
        !b.tools &&
        !b.stream &&
        (b.service_tier === undefined || b.service_tier === "default") &&
        bytes <= 16000,
      "ai_cost_policy_violation",
    );
    const upper = ((bytes + 1024) * 0.4 + 250 * 1.6) / 1e6;
    requireThat(upper <= 0.05, "ai_cost_policy_violation");
    return budget.run(async () => {
      onReserve?.();
      const signal = options.signal ?? AbortSignal.timeout(15000);
      const response = await fetcher(url, { ...options, signal });
      const data = await consumeAIJSON(response, signal);
      return {
        ok: response.ok,
        status: response.status,
        json: async () => data,
      };
    });
  };
}
