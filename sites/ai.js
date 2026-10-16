import { requireThat } from "../src/catalog.js";
import { Recommender } from "../src/recommend.js";
import { offlineIntent } from "../src/intent.js";
import { recommendationPlan } from "../src/recommendation-plan.js";
import { consumeAIJSON } from "../src/ai-response.js";
import { typedAIError } from "../src/ai-telemetry.js";
import { D1WindowBudget } from "./d1.js";

// Reviewed against official model/deprecation docs on 2026-10-16. Explicit opt-in
// and a separate user-approved ceiling are still required; defaults make no calls.
export const SITES_AI_POLICY = Object.freeze({
  model: "gpt-6-luna",
  endpoint: "https://api.openai.com/v1/chat/completions",
  maxCalls: 100,
  maxUsd: 1,
  reservedUsdPerCall: 0.01,
  maxRequestBytes: 16000,
  maxOutputTokens: 250,
  reviewExpires: "2026-10-23T00:00:00Z",
});

export function sitesAIMode(env) {
  return env.AI_MODE === "openai" && env.AI_REQUESTS_ENABLED === "true"
    ? "openai"
    : "mock";
}

function decorate(result, goal, reason = null) {
  const ko = /[가-힣]/.test(goal);
  const messages = ko ? {
    already_owned: "이미 가진 옷이면 충분해요. 새로 사지 않고 미리 입어 볼까요?",
    already_ready: "지금 입은 옷으로 복장 조건을 통과해요. 남은 무료 이야기만 진행해요.",
    loan_available: "빌려 둔 정장을 입으면 돼요. 구매 없이 갈 수 있어요.",
    free_preference: "돈을 쓰지 않는 선택으로 준비했어요. 대여와 이야기 진행은 무료예요.",
    optional_collection: "이야기는 무료로 진행할 수 있어요. 마음에 드는 옷은 예산 안에서 선택해 미리 입어 보세요.",
    clarify: "입장하고 싶은 건가요, 아니면 정장이나 망토를 찾으시나요? 목적을 한 줄로 알려 주세요.",
    unsupported: "그 목적을 해결할 수 있는 옷은 없어요. 이야기 입장이나 원하는 옷차림을 알려 주세요.",
    budget_insufficient: "예산에 맞는 구매품이 없어요. 지금 옷이나 무료 대여를 이용해요.",
    held_purchase: "보류된 구매를 다시 사지 마세요. 현재 옷이나 무료 경로를 이용해요.",
    no_suitable_style: "원하는 조건에 맞는 옷이 없어요. 구매 없이 다른 모습을 살펴볼까요?",
  } : {
    already_owned: "You already own a suitable look. Let's try it on without buying again.",
    already_ready: "Your clothes already pass the dress check. Only the remaining free story steps matter.",
    loan_available: "Wear your borrowed formal clothes. No purchase is needed.",
    free_preference: "Let's keep this free. Keep your clothes, or use the free loan for the story.",
    optional_collection: "The story is free. If you want a new look, preview an optional outfit within your budget.",
    clarify: "Are you entering the gathering, or looking for a formal coat or cloak? Tell me in one line.",
    unsupported: "No outfit solves that goal. Tell me about story entry or the look you want.",
    budget_insufficient: "No suitable purchase fits this budget. Keep your outfit or take the free loan.",
    held_purchase: "Don't buy a held purchase again. Use your current clothes or the free route.",
    no_suitable_style: "No outfit matches those constraints. We can explore without buying.",
  };
  const notice = result.mode === "fallback"
    ? ko ? "AI 답변을 사용할 수 없어 무료·보유품 경로를 안내해요." : "AI is unavailable; here is a free or owned-outfit fallback."
    : result.mode === "mock"
      ? ko ? "오프라인 안내 · AI를 호출하지 않았어요." : "Offline guide · no AI call."
      : ko ? "AI가 목적을 해석했고, 게임 규칙으로 선택지를 확인했어요." : "AI interpreted your goal; game rules checked the choices.";
  return {
    ...result,
    dialogue: { language: ko ? "ko" : "en", text: messages[result.plan.reason] ?? messages.unsupported },
    ai: { status: result.mode === "openai" ? "live" : result.mode === "mock" ? "offline" : "fallback", notice, reason },
  };
}

function fallback(input, context, reason) {
  // Failure never promotes a purchase using an unverified interpretation.
  const intent = { ...offlineIntent(input.goal), spending: "free" };
  return decorate(recommendationPlan(intent, input.budgetMinor, context, "fallback"), input.goal, reason);
}

function policyLimit(env, now) {
  const p = SITES_AI_POLICY;
  requireThat(now < Date.parse(p.reviewExpires), "ai_price_review_expired", 503);
  requireThat(env.AI_MODEL === p.model, "ai_configuration_required", 503);
  requireThat(typeof env.AI_MAX_CALLS === "string" && /^[1-9][0-9]{0,2}$/.test(env.AI_MAX_CALLS), "ai_configuration_required", 503);
  requireThat(typeof env.AI_BUDGET_USD === "string" && /^(?:0\.[0-9]{2}|1\.00)$/.test(env.AI_BUDGET_USD), "ai_configuration_required", 503);
  const calls = Number(env.AI_MAX_CALLS), cents = Math.round(Number(env.AI_BUDGET_USD) * 100);
  requireThat(calls <= p.maxCalls && cents > 0 && cents <= p.maxUsd * 100, "ai_configuration_required", 503);
  return Math.min(calls, cents); // Each reserved attempt consumes a full cent, even on failure.
}

async function fingerprint(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Called only after owner + Origin + CSRF + input validation. Context is read
// from D1 by the Worker, never accepted from the request or from the model.
export async function sitesRecommend(s, env, user, input, context, fetcher, timeoutMs = 10000, refreshContext = async () => context) {
  if (sitesAIMode(env) === "mock") {
    const mode = env.AI_MODE ?? "mock";
    if (mode !== "mock") return fallback(input, context, "ai_requests_disabled");
    return decorate(recommendationPlan(offlineIntent(input.goal), input.budgetMinor, context, "mock"), input.goal);
  }
  let limit;
  try { limit = policyLimit(env, Date.now()); }
  catch (e) { return fallback(input, context, typedAIError(e).code); }
  requireThat(typeof input.requestId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId), "ai_request_id_required");
  const hash = await fingerprint({ goal: input.goal, budgetMinor: input.budgetMinor, context });
  const claimed = await s.run(
    "INSERT OR IGNORE INTO sites_ai_requests SELECT ?,?,?,NULL,? WHERE (SELECT count(*) FROM sites_ai_requests)<256",
    user, input.requestId, hash, Date.now(),
  );
  if (!claimed.meta.changes) {
    const previous = await s.one("SELECT fingerprint,result FROM sites_ai_requests WHERE user_id=? AND request_id=?", user, input.requestId);
    if (!previous) return fallback(input, context, "ai_call_budget_exhausted");
    requireThat(previous.fingerprint === hash, "ai_request_conflict", 409);
    return previous.result ? JSON.parse(previous.result) : fallback(input, context, "ai_request_pending");
  }
  let result;
  try {
    const p = SITES_AI_POLICY;
    const budget = new D1WindowBudget(s, { name: "ai-luna-cent-v1", limit, concurrency: 1, windowMs: 0 });
    const guardedFetch = async (url, options) => {
      requireThat(Date.now() < Date.parse(p.reviewExpires), "ai_price_review_expired", 503);
      const b = JSON.parse(options.body), bytes = new TextEncoder().encode(options.body).length;
      requireThat(url === p.endpoint && options.redirect === "error" &&
        b.model === p.model && b.reasoning_effort === "none" && b.store === false &&
        b.max_completion_tokens === p.maxOutputTokens && b.service_tier === "default" &&
        b.tool_choice === "none" && !b.tools && !b.stream && bytes <= p.maxRequestBytes,
      "ai_cost_policy_violation", 503);
      // Includes 1.25x cache-write rate and 10% regional premium conservatively.
      requireThat(((bytes + 1024) * 0.1375 + 250 * 0.55) / 1e6 <= p.reservedUsdPerCall, "ai_cost_policy_violation", 503);
      return budget.run(async () => {
        const response = await fetcher(url, options);
        const data = await consumeAIJSON(response, options.signal);
        return { ok: response.ok, status: response.status, json: async () => data };
      });
    };
    const key = env.OPENAI_API_KEY;
    requireThat(typeof key === "string" && key.length > 0 && key.length <= 8192 && !/[\r\n\0]/.test(key), "ai_configuration_required", 503);
    const interpreter = new Recommender({ mode: "openai", key, model: p.model, reasoningEffort: "none", fetcher: guardedFetch, maxCalls: 1, timeoutMs });
    let usage;
    const interpreted = await interpreter.recommend(input, context, { onUsage: (value) => { usage = value; } });
    requireThat(usage, "ai_usage_missing_or_invalid", 502);
    context = await refreshContext();
    const intent = { ...interpreted.interpretation };
    if (input.budgetMinor === 0 || offlineIntent(input.goal).spending === "free") intent.spending = "free";
    result = decorate(recommendationPlan(intent, input.budgetMinor, context, "openai"), input.goal);
  } catch (e) {
    context = await refreshContext();
    result = fallback(input, context, typedAIError(e).code);
  }
  await s.run("UPDATE sites_ai_requests SET result=? WHERE user_id=? AND request_id=? AND result IS NULL", JSON.stringify(result), user, input.requestId);
  return result;
}
