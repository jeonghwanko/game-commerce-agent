import { createHash, randomUUID } from "node:crypto";
import {
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM_PROMPT,
  intentSchema,
  validateIntent,
} from "./intent.js";
import { AI_MODEL, AI_COST_POLICY } from "./ai-cost.js";
import { requireThat, CommerceError, catalog } from "./catalog.js";
import { typedAIError, usageCost } from "./ai-telemetry.js";
import {
  intentCases,
  compatibilityCase,
  GOLD_VERSION,
  evaluationComposition,
} from "../fixtures/intent-evaluation.js";
import { scoreIntent } from "../fixtures/score-intent.js";
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function requireEvaluationReadiness({
  ready,
  keyPresent,
  databasePresent,
  dirty,
}) {
  requireThat(!dirty, "evaluation_clean_commit_required");
  requireThat(
    ready === true && keyPresent === true && databasePresent === true,
    "evaluation_configuration_required",
  );
}
export function evaluationManifest({
  commit,
  dirty = false,
  mode = "live",
  runId = randomUUID(),
}) {
  requireThat(
    /^[0-9a-f]{40}$/.test(commit),
    "evaluation_clean_commit_required",
  );
  return {
    runId,
    mode,
    commit,
    dirty,
    model: AI_MODEL,
    promptVersion: INTENT_PROMPT_VERSION,
    promptHash: hash({ prompt: INTENT_SYSTEM_PROMPT, schema: intentSchema }),
    goldVersion: GOLD_VERSION,
    goldHash: hash({ cases: intentCases, smoke: compatibilityCase }),
    composition: evaluationComposition,
    maximumRunAttempts: 1 + intentCases.length,
    maximumRunReservationUsd:
      (1 + intentCases.length) * AI_COST_POLICY.reservedUsdPerCall,
    policy: AI_COST_POLICY,
  };
}
// Log only typed enums/identifiers and canonical numeric fields; omit all free text.
function safePlan(result) {
  requireThat(
    Array.isArray(result?.plan?.actions) && Array.isArray(result?.products),
    "invalid_ai_response",
    502,
  );
  const i = validateIntent(result.interpretation);
  requireThat(
    ["use_owned", "use_free", "no_purchase", "consider_purchase"].includes(
      result.plan?.strategy,
    ),
    "invalid_ai_response",
    502,
  );
  const actions = result.plan.actions.map((a) => {
    requireThat(
      [
        "equip",
        "keep_owned",
        "borrow",
        "quest",
        "review_purchase",
        "no_purchase",
      ].includes(a.type),
      "invalid_ai_response",
      502,
    );
    requireThat(
      a.sku === undefined ||
        ["borrowed", ...catalog.map((p) => p.sku)].includes(a.sku),
      "invalid_ai_response",
      502,
    );
    requireThat(
      a.quest === undefined || ["seal", "rumor"].includes(a.quest),
      "invalid_ai_response",
      502,
    );
    return {
      type: a.type,
      ...(a.sku === undefined ? {} : { sku: a.sku }),
      ...(a.quest === undefined ? {} : { quest: a.quest }),
    };
  });
  const products = result.products.map((p) => {
    requireThat(
      catalog.some((c) => c.sku === p.sku) &&
        Number.isSafeInteger(p.amount) &&
        p.amount >= 0 &&
        p.amount <= 100000 &&
        p.currency === "USD" &&
        Number.isSafeInteger(p.version),
      "invalid_ai_response",
      502,
    );
    return {
      sku: p.sku,
      amount: p.amount,
      currency: p.currency,
      version: p.version,
    };
  });
  return {
    interpretation: {
      goals: [...i.goals],
      style: i.style,
      avoidStyles: [...i.avoidStyles],
      spending: i.spending,
      clarify: i.clarify,
    },
    strategy: result.plan.strategy,
    actions,
    products,
  };
}
/** A single compatibility call gates all 44 scored cases. No retry or fallback.
 * emit must persist each record before another request starts. Reservations are
 * attributed by a per-transport callback, not by racy shared-DB counter deltas.
 */
export async function runEvaluation({
  recommender,
  manifest,
  emit,
  reservationCount,
  lifetimeReservations,
  now = Date.now,
  monotonic = () => performance.now(),
}) {
  requireThat(!manifest.dirty, "evaluation_clean_commit_required");
  const common = {
    runId: manifest.runId,
    mode: manifest.mode,
    commit: manifest.commit,
    model: manifest.model,
    promptVersion: manifest.promptVersion,
    promptHash: manifest.promptHash,
    goldVersion: manifest.goldVersion,
    goldHash: manifest.goldHash,
  };
  await emit({
    kind: "manifest",
    timestamp: new Date(now()).toISOString(),
    ...manifest,
    modelEvaluationPerformed: false,
  });
  let attempts = 0,
    scored = 0,
    correct = 0,
    reserved = 0,
    usageEstimate = 0,
    missingUsage = 0,
    aborted = false,
    smokePassed = false;
  const bySplit = {
    regression: { scored: 0, correct: 0 },
    holdout: { scored: 0, correct: 0 },
  };
  for (const c of [compatibilityCase, ...intentCases]) {
    const before = reservationCount(),
      start = monotonic(),
      startedAt = new Date(now()).toISOString();
    let usage = null,
      result = null,
      score = null,
      error = null,
      safe = null;
    try {
      result = await recommender.recommend(c, c.context, {
        onUsage: (u) => {
          usage = u;
        },
      });
      safe = safePlan(result);
      requireThat(usage, "ai_usage_missing_or_invalid", 502);
      score = scoreIntent(c, result);
      if (c === compatibilityCase && !score.match)
        throw new CommerceError("compatibility_semantics_failed", 502);
    } catch (e) {
      error = typedAIError(e);
    }
    attempts++;
    const delta = reservationCount() - before;
    requireThat(
      Number.isSafeInteger(delta) && delta >= 0 && delta <= 1,
      "evaluation_failed",
    );
    reserved += delta;
    const cost = usageCost(
      ["ai_service_tier_unexpected", "ai_model_mismatch"].includes(error?.code)
        ? null
        : usage,
    );
    if (cost.usageEstimatedUsd === null) missingUsage++;
    else usageEstimate += cost.usageEstimatedUsd;
    const record = {
      kind: "case",
      ...common,
      phase: c === compatibilityCase ? "compatibility" : "evaluation",
      caseId: c.id,
      split: c.split,
      startedAt,
      timestamp: new Date(now()).toISOString(),
      latencyMs: Math.max(0, Math.round(monotonic() - start)),
      ...(safe ?? {
        interpretation: null,
        strategy: null,
        actions: null,
        products: null,
      }),
      error,
      match: error ? false : score.match,
      scoreErrors: score?.errors ?? [],
      tokenUsage: usage,
      cost: {
        reservedAttempts: delta,
        reservedUsd: delta * AI_COST_POLICY.reservedUsdPerCall,
        ...cost,
      },
    };
    await emit(record);
    if (error) {
      aborted = true;
      break;
    }
    if (c === compatibilityCase) {
      smokePassed = true;
      continue;
    }
    scored++;
    correct += Number(score.match);
    bySplit[c.split].scored++;
    bySplit[c.split].correct += Number(score.match);
  }
  const summary = {
    kind: "summary",
    ...common,
    timestamp: new Date(now()).toISOString(),
    status: aborted ? "aborted" : "complete",
    smokePassed,
    attempts,
    scored,
    correct,
    unscored: intentCases.length - scored,
    bySplit,
    modelEvaluationPerformed: manifest.mode === "live" && scored > 0,
    cost: {
      reservedAttempts: reserved,
      reservedUsd: Number(
        (reserved * AI_COST_POLICY.reservedUsdPerCall).toFixed(2),
      ),
      lifetimeReservedAttempts: lifetimeReservations(),
      usageEstimatedUsd: missingUsage ? null : Number(usageEstimate.toFixed(9)),
      knownUsageEstimatedUsd: Number(usageEstimate.toFixed(9)),
      usageEstimateComplete: missingUsage === 0,
      missingUsageAttempts: missingUsage,
      billedUsd: null,
    },
    passed: !aborted && scored === intentCases.length && correct === scored,
  };
  await emit(summary);
  return summary;
}
