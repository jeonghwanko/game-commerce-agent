import { ExternalWorkBudget } from "./budget.js";
import { requireThat } from "./catalog.js";
export const AI_MODEL = "gpt-4.1-mini-2025-04-14";
export const AI_COST_POLICY = {
  maxCalls: 100,
  reservedUsdPerCall: 0.05,
  maxUsd: 5,
  maxRequestBytes: 16000,
  maxOutputTokens: 250,
  inputUsdPerMillion: 0.4,
  outputUsdPerMillion: 1.6,
  reviewed: "2026-10-15",
  reviewExpires: "2026-10-22T00:00:00Z",
};
/** Reserve the entire worst-case allowance BEFORE network I/O, including failures.
 * UTF-8 byte bound plus 1024 framing tokens is conservative for this text-only API.
 * Same DB/name in HTTP and CLI. No automatic refunds, retries or fallback models.
 */
export function costLimitedFetch(store, fetcher = fetch, now = Date.now) {
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
        bytes <= 16000,
      "ai_cost_policy_violation",
    );
    const upper = ((bytes + 1024) * 0.4 + 250 * 1.6) / 1e6;
    requireThat(upper <= 0.05, "ai_cost_policy_violation");
    return budget.run(() => fetcher(url, options));
  };
}
