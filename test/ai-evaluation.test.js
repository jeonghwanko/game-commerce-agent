import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { Recommender } from "../src/recommend.js";
import { AI_MODEL, costLimitedFetch } from "../src/ai-cost.js";
import { INTENT_SYSTEM_PROMPT, INTENT_PROMPT_VERSION } from "../src/intent.js";
import {
  requireEvaluationReadiness,
  evaluationManifest,
  runEvaluation,
} from "../src/ai-evaluation.js";
import { tokenUsage, usageCost, typedAIError } from "../src/ai-telemetry.js";
import {
  intentCases,
  compatibilityCase,
  GOLD_VERSION,
} from "../fixtures/intent-evaluation.js";
import { scoreIntent } from "../fixtures/score-intent.js";
const cases = [compatibilityCase, ...intentCases];
const now = () => Date.parse("2026-10-15T17:00:00Z");
const usage = {
  prompt_tokens: 1000,
  completion_tokens: 50,
  total_tokens: 1050,
  prompt_tokens_details: { cached_tokens: 400 },
  secret: "must-never-be-recorded",
};
const manifest = () =>
  evaluationManifest({
    commit: "a".repeat(40),
    mode: "stub",
    runId: "test-run",
  });
function setup(t, behavior) {
  const store = new Store();
  t.after(() => store.close());
  let reservations = 0,
    calls = 0;
  const records = [];
  const fetcher = costLimitedFetch(
    store,
    async (url, options) => {
      const i = calls++;
      const c = cases[i];
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      const request = JSON.parse(options.body);
      assert.equal(request.messages[0].content, INTENT_SYSTEM_PROMPT);
      assert.equal(request.service_tier, "default");
      const custom = await behavior?.(i, c, options);
      if (custom) return custom;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(c.expectedIntent) },
          },
        ],
        usage,
        service_tier: "default",
        secret: "must-never-be-recorded",
      });
    },
    now,
    { onReserve: () => reservations++ },
  );
  const recommender = new Recommender({
    mode: "openai",
    key: "synthetic-auth-must-never-be-recorded",
    model: AI_MODEL,
    fetcher,
  });
  return {
    store,
    records,
    recommender,
    calls: () => calls,
    run: () =>
      runEvaluation({
        recommender,
        manifest: manifest(),
        emit: (r) => records.push(r),
        reservationCount: () => reservations,
        lifetimeReservations: () =>
          store.get("SELECT used FROM external_budgets WHERE name='ai-usd5-v1'")
            .used,
        now,
      }),
  };
}
test("single smoke gates 44 cases, records fixed lineage, safe outputs, usage and distinct costs", async (t) => {
  const f = setup(t);
  const summary = await f.run();
  assert.equal(f.calls(), 45);
  assert.equal(summary.scored, 44);
  assert.equal(summary.correct, 44);
  assert.equal(summary.passed, true);
  assert.equal(
    summary.modelEvaluationPerformed,
    false,
    "stub transport is not model evidence",
  );
  assert.deepEqual(summary.bySplit, {
    regression: { scored: 36, correct: 36 },
    holdout: { scored: 8, correct: 8 },
  });
  assert.equal(summary.cost.reservedUsd, 2.25);
  assert.equal(summary.cost.lifetimeReservedAttempts, 45);
  const rows = f.records.filter((r) => r.kind === "case");
  assert.equal(rows.length, 45);
  for (const row of rows) {
    assert.equal(row.commit, "a".repeat(40));
    assert.equal(row.promptVersion, INTENT_PROMPT_VERSION);
    assert.equal(row.goldVersion, GOLD_VERSION);
    assert.match(row.promptHash, /^[a-f0-9]{64}$/);
    assert.match(row.goldHash, /^[a-f0-9]{64}$/);
    assert.ok(row.caseId);
    assert.equal(row.timestamp, "2026-10-15T17:00:00.000Z");
    assert.ok(row.latencyMs >= 0);
    assert.equal(row.error, null);
    assert.deepEqual(row.tokenUsage, {
      inputTokens: 1000,
      outputTokens: 50,
      totalTokens: 1050,
      cachedInputTokens: 400,
    });
    assert.equal(row.cost.reservedUsd, 0.05);
    assert.equal(row.cost.usageEstimatedUsd, 0.00036);
    assert.equal(row.cost.billedUsd, null);
    assert.ok(row.actions.every((a) => !("label" in a)));
    assert.ok(row.products.every((p) => !("description" in p)));
  }
  const log = JSON.stringify(f.records);
  assert.ok(!log.includes("must-never-be-recorded"));
  assert.ok(!log.includes("Bearer"));
  assert.ok(!log.includes("Authorization"));
  assert.ok(!log.includes(compatibilityCase.goal));
});
for (const [status, code] of [
  [401, "ai_authentication_failed"],
  [403, "ai_authentication_failed"],
  [404, "ai_model_or_endpoint_unavailable"],
  [400, "ai_request_rejected"],
  [429, "ai_rate_limited"],
  [503, "ai_provider_unavailable"],
])
  test(`compatibility HTTP ${status} stops after one attempt and strips raw errors`, async (t) => {
    const f = setup(
      t,
      () => new Response("synthetic-auth-must-never-be-recorded", { status }),
    );
    const summary = await f.run();
    assert.equal(f.calls(), 1);
    assert.equal(summary.status, "aborted");
    assert.equal(summary.scored, 0);
    assert.equal(summary.unscored, 44);
    assert.equal(summary.cost.reservedUsd, 0.05);
    assert.equal(summary.cost.usageEstimateComplete, false);
    const row = f.records.find((r) => r.kind === "case");
    assert.equal(row.error.code, code);
    assert.equal(row.tokenUsage, null);
    assert.equal(row.cost.usageEstimatedUsd, null);
    assert.ok(!JSON.stringify(f.records).includes("must-never-be-recorded"));
  });
for (const mode of [
  "transport",
  "abort",
  "malformed",
  "missing-usage",
  "wrong-semantics",
  "unexpected-tier",
  "unexpected-model",
])
  test(`compatibility ${mode} failure cannot burn the suite`, async (t) => {
    const f = setup(t, (i, c) => {
      if (mode === "transport")
        throw new Error("Bearer synthetic-auth-must-never-be-recorded");
      if (mode === "abort")
        throw new DOMException(
          "synthetic-auth-must-never-be-recorded",
          "AbortError",
        );
      if (mode === "malformed")
        return new Response("synthetic-auth-must-never-be-recorded");
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify(
                mode === "wrong-semantics"
                  ? { ...c.expectedIntent, goals: [] }
                  : c.expectedIntent,
              ),
            },
          },
        ],
        ...(mode === "missing-usage" ? {} : { usage }),
        service_tier: mode === "unexpected-tier" ? "priority" : "default",
        model:
          mode === "unexpected-model"
            ? "unknown-provider-model-must-never-be-recorded"
            : AI_MODEL,
      });
    });
    const summary = await f.run();
    assert.equal(f.calls(), 1);
    assert.equal(summary.status, "aborted");
    assert.equal(summary.scored, 0);
    assert.ok(!JSON.stringify(f.records).includes("must-never-be-recorded"));
  });
test("mid-evaluation auth failure stops immediately; completed case records survive", async (t) => {
  const f = setup(t, (i) =>
    i === 3
      ? Response.json(
          { error: { message: "must-never-be-recorded" } },
          { status: 401 },
        )
      : null,
  );
  const summary = await f.run();
  assert.equal(f.calls(), 4);
  assert.equal(summary.scored, 2);
  assert.equal(summary.status, "aborted");
  assert.equal(summary.cost.reservedUsd, 0.2);
  assert.equal(f.records.filter((r) => r.kind === "case").length, 4);
});
test("mixed-goal loss remains a scored failure, not neutral-style equivalence", async (t) => {
  const f = setup(t, (i, c) =>
    c.category === "mixed" && c.state === "new"
      ? Response.json({
          usage,
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  ...c.expectedIntent,
                  goals: ["collection"],
                }),
              },
            },
          ],
        })
      : null,
  );
  const summary = await f.run();
  assert.equal(summary.status, "complete");
  assert.equal(summary.scored, 44);
  assert.equal(summary.correct, 43);
  assert.equal(summary.passed, false);
  const row = f.records.find((r) => r.caseId === "regression/mixed/new");
  assert.ok(row.scoreErrors.includes("missing_action"));
  assert.ok(row.scoreErrors.includes("story_unsatisfied"));
  assert.ok(row.scoreErrors.includes("interpretation"));
});
test("dirty source or failed trace persistence blocks further paid work", async (t) => {
  const f = setup(t);
  await assert.rejects(
    runEvaluation({ manifest: { ...manifest(), dirty: true } }),
    /clean_commit/,
  );
  assert.equal(f.calls(), 0);
  let writes = 0;
  await assert.rejects(
    runEvaluation({
      manifest: manifest(),
      recommender: f.recommender,
      emit: () => {
        if (++writes === 2) throw new Error("disk failure");
      },
      reservationCount: () => f.calls(),
      lifetimeReservations: () => f.calls(),
      now,
    }),
    /disk failure/,
  );
  assert.equal(f.calls(), 1);
});
test("usage accepts only bounded consistent counts, with unknown billing rather than fake zero spend", () => {
  for (const u of [
    null,
    { ...usage, prompt_tokens: -1 },
    { ...usage, completion_tokens: 251 },
    { ...usage, total_tokens: 42 },
    { ...usage, prompt_tokens_details: { cached_tokens: 1001 } },
    { ...usage, prompt_tokens: "secret" },
  ])
    assert.equal(tokenUsage(u), null);
  assert.equal(usageCost(null).usageEstimatedUsd, null);
  assert.equal(usageCost(null).billedUsd, null);
  assert.equal(
    usageCost(tokenUsage({ ...usage, prompt_tokens_details: undefined }))
      .usageEstimateBasis,
    "uncached-list-rate-upper-estimate",
  );
  assert.deepEqual(
    typedAIError({
      code: "raw-secret",
      message: "raw-secret",
      cause: "raw-secret",
    }),
    { type: "internal", code: "evaluation_failed" },
  );
});
test("fixed gold policy separates unsupported and attacks from ambiguity; neutral styles do not weaken constraints", async () => {
  assert.ok(Object.isFrozen(intentCases));
  assert.ok(Object.isFrozen(intentCases[0].gold));
  assert.equal(new Set(intentCases.map((c) => c.id)).size, 44);
  for (const c of intentCases.filter((c) =>
    ["unsuitable", "attack", "attack-holdout"].includes(c.category),
  )) {
    assert.deepEqual(c.expectedIntent.goals, []);
    assert.equal(c.expectedIntent.clarify, false);
  }
  for (const c of intentCases.filter((c) => c.category.startsWith("ambiguity")))
    assert.equal(c.expectedIntent.clarify, true);
  const c = intentCases.find(
    (c) => c.category === "synonym" && c.state === "new",
  );
  for (const style of ["any", "unspecified", "formal", "cloak"]) {
    const r = new Recommender({
      mode: "openai",
      key: "stub",
      model: "stub",
      fetcher: async () =>
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ ...c.expectedIntent, style }),
              },
            },
          ],
        }),
    });
    const result = await r.recommend(c, c.context);
    assert.equal(scoreIntent(c, result).match, style !== "cloak");
    const missing = {
      ...result,
      plan: {
        ...result.plan,
        actions: result.plan.actions.filter((a) => a.quest !== "seal"),
      },
    };
    assert.equal(scoreIntent(c, missing).match, false);
    assert.equal(
      scoreIntent(c, {
        ...result,
        interpretation: { ...result.interpretation, spending: "free" },
      }).match,
      false,
    );
  }
});
test("expired price review stops locally before smoke transport with zero reserved spend", async (t) => {
  const store = new Store();
  t.after(() => store.close());
  let calls = 0,
    reservations = 0;
  const records = [];
  const r = new Recommender({
    mode: "openai",
    key: "synthetic",
    model: AI_MODEL,
    fetcher: costLimitedFetch(
      store,
      async () => {
        calls++;
        throw new Error("must not call");
      },
      () => Date.parse("2026-10-23"),
      { onReserve: () => reservations++ },
    ),
  });
  const summary = await runEvaluation({
    recommender: r,
    manifest: manifest(),
    emit: (r) => records.push(r),
    reservationCount: () => reservations,
    lifetimeReservations: () => 0,
    now,
  });
  assert.equal(calls, 0);
  assert.equal(reservations, 0);
  assert.equal(summary.status, "aborted");
  assert.equal(summary.cost.reservedUsd, 0);
  assert.equal(summary.cost.usageEstimatedUsd, null);
  assert.equal(records[1].error.code, "ai_price_review_expired");
});

test("readiness requires explicit local confirmation, key presence, persistent DB and clean committed source", () => {
  const good = {
    ready: true,
    keyPresent: true,
    databasePresent: true,
    dirty: false,
  };
  assert.doesNotThrow(() => requireEvaluationReadiness(good));
  for (const key of ["ready", "keyPresent", "databasePresent"])
    assert.throws(
      () => requireEvaluationReadiness({ ...good, [key]: false }),
      /evaluation_configuration_required/,
    );
  assert.throws(
    () => requireEvaluationReadiness({ ...good, dirty: true }),
    /evaluation_clean_commit_required/,
  );
});
test("CLI denied live setup writes a private sanitized JSONL record without network", async () => {
  const { spawnSync, execFileSync } = await import("node:child_process");
  const { cpSync, mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "gca-eval-deny-"));
  const hook = join(dir, "deny-network.mjs");
  writeFileSync(
    hook,
    "globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN')};",
  );
  let artifact;
  try {
    for (const name of ["src", "fixtures", "scripts", "package.json"])
      cpSync(new URL("../" + name, import.meta.url), join(dir, name), {
        recursive: true,
      });
    const git = (...args) =>
      execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git("init", "--quiet");
    git("add", ".");
    git(
      "-c",
      "user.name=Synthetic Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Synthetic CLI fixture",
    );
    const child = spawnSync(
      process.execPath,
      ["--import", hook, "scripts/evaluate-ai.js", "--live"],
      {
        cwd: dir,
        encoding: "utf8",
        env: { PATH: process.env.PATH, EVAL_CONFIGURATION_READY: "false" },
      },
    );
    assert.equal(child.status, 1);
    assert.equal(child.stderr, "");
    const record = JSON.parse(child.stdout.trim());
    assert.equal(record.kind, "setup_or_recording_error");
    assert.equal(record.modelEvaluationPerformed, false);
    assert.ok(
      [
        "evaluation_clean_commit_required",
        "evaluation_configuration_required",
      ].includes(record.error.code),
    );
    artifact = join(dir, "data", "evaluations", record.runId + ".jsonl");
    assert.deepEqual(JSON.parse(readFileSync(artifact, "utf8")), record);
    assert.equal(statSync(artifact).mode & 0o777, 0o600);
    assert.ok(!child.stdout.includes("NETWORK_FORBIDDEN"));
  } finally {
    if (artifact) rmSync(artifact, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
