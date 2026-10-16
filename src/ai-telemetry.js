import { AI_COST_POLICY } from "./ai-policy.js";
import { CommerceError } from "./catalog.js";
// Fixed error vocabulary only: never serialize provider text, headers, URLs or causes.
const kinds = Object.freeze({
  ai_authentication_failed: "authentication",
  ai_model_or_endpoint_unavailable: "model",
  ai_model_mismatch: "model",
  ai_request_rejected: "configuration",
  ai_configuration_required: "configuration",
  evaluation_configuration_required: "configuration",
  evaluation_clean_commit_required: "configuration",
  ai_rate_limited: "rate_limit",
  ai_provider_unavailable: "provider",
  ai_unavailable: "provider",
  ai_transport_failed: "transport",
  ai_timeout: "timeout",
  invalid_ai_response: "response",
  invalid_ai_intent: "response",
  ai_response_too_large: "response",
  ai_usage_missing_or_invalid: "usage",
  ai_service_tier_unexpected: "usage",
  ai_price_review_expired: "configuration",
  ai_cost_policy_violation: "configuration",
  external_budget_exhausted: "budget",
  external_concurrency_exhausted: "budget",
  external_budget_policy_mismatch: "configuration",
  budget_policy_mismatch: "configuration",
  ai_call_budget_exhausted: "budget",
  compatibility_semantics_failed: "compatibility",
  evaluation_failed: "internal",
});
export function typedAIError(e) {
  const code = Object.hasOwn(kinds, e?.code)
    ? e.code
    : ["AbortError", "TimeoutError"].includes(e?.name)
      ? "ai_timeout"
      : e instanceof TypeError
        ? "ai_transport_failed"
        : "evaluation_failed";
  return { type: kinds[code], code };
}
export function transportAIError(e) {
  const safe = typedAIError(e);
  return new CommerceError(
    safe.code === "evaluation_failed" ? "ai_transport_failed" : safe.code,
    502,
  );
}
export function httpAIError(status) {
  const code = [401, 403].includes(status)
    ? "ai_authentication_failed"
    : status === 404
      ? "ai_model_or_endpoint_unavailable"
      : status === 429
        ? "ai_rate_limited"
        : status >= 500
          ? "ai_provider_unavailable"
          : status >= 400 && status < 500
            ? "ai_request_rejected"
            : "ai_unavailable";
  return new CommerceError(code, 502);
}
export function tokenUsage(usage) {
  if (
    !usage ||
    !["prompt_tokens", "completion_tokens", "total_tokens"].every(
      (k) => Number.isSafeInteger(usage[k]) && usage[k] >= 0,
    )
  )
    return null;
  const inputTokens = usage.prompt_tokens,
    outputTokens = usage.completion_tokens,
    totalTokens = usage.total_tokens;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  if (
    inputTokens > AI_COST_POLICY.maxRequestBytes + 1024 ||
    outputTokens > AI_COST_POLICY.maxOutputTokens ||
    totalTokens !== inputTokens + outputTokens ||
    (cached !== undefined &&
      (!Number.isSafeInteger(cached) || cached < 0 || cached > inputTokens))
  )
    return null;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: cached ?? null,
  };
}
export function usageCost(usage) {
  if (!usage)
    return {
      usageEstimatedUsd: null,
      usageEstimateBasis: "unknown",
      billedUsd: null,
    };
  const cached = usage.cachedInputTokens ?? 0;
  return {
    usageEstimatedUsd: Number(
      (
        ((usage.inputTokens - cached) * AI_COST_POLICY.inputUsdPerMillion) /
          1e6 +
        (cached * AI_COST_POLICY.cachedInputUsdPerMillion) / 1e6 +
        (usage.outputTokens * AI_COST_POLICY.outputUsdPerMillion) / 1e6
      ).toFixed(9),
    ),
    usageEstimateBasis:
      usage.cachedInputTokens === null
        ? "uncached-list-rate-upper-estimate"
        : "reported-tokens-list-rate-estimate",
    billedUsd: null,
  };
}
