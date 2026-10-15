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
    return budget.run(async () => {
      const signal = options.signal ?? AbortSignal.timeout(15000);
      const response = await fetcher(url, { ...options, signal });
      const data = await consumeJSON(response, signal);
      return {
        ok: response.ok,
        status: response.status,
        json: async () => data,
      };
    });
  };
}

// The reservation covers headers, bounded body consumption, parsing and cancellation.
async function consumeJSON(response, signal) {
  requireThat(
    response.body && typeof response.body.getReader === "function",
    "invalid_ai_response",
    502,
  );
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0,
    done = false,
    cancellation;
  const cancel = () => (cancellation ??= reader.cancel().catch(() => {}));
  const abort = () => {
    void cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) {
        done = true;
        break;
      }
      bytes += part.value.byteLength;
      requireThat(bytes <= 65536, "ai_response_too_large", 502);
      chunks.push(Buffer.from(part.value));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      requireThat(false, "invalid_ai_response", 502);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (!done || cancellation) await cancel();
    reader.releaseLock();
  }
}
