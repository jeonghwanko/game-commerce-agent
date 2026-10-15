// Zero-network preflight by default. --live still requires explicit configuration readiness.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { Recommender } from "../src/recommend.js";
import { AI_MODEL, costLimitedFetch } from "../src/ai-cost.js";
import { typedAIError } from "../src/ai-telemetry.js";
import {
  requireEvaluationReadiness,
  evaluationManifest,
  runEvaluation,
} from "../src/ai-evaluation.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const live = process.argv.includes("--live");
let store, fd, manifest;
let executionStarted = false;
const emit = (record) => {
  const line = JSON.stringify(record) + "\n";
  if (fd !== undefined) {
    writeFileSync(fd, line);
    fsyncSync(fd);
  }
  process.stdout.write(line);
};
try {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  manifest = evaluationManifest({
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
    mode: live ? "live" : "dry-run",
  });
  if (!live)
    emit({
      kind: "preflight",
      timestamp: new Date().toISOString(),
      ...manifest,
      modelEvaluationPerformed: false,
      externalCalls: 0,
    });
  else {
    const directory = join(root, "data", "evaluations");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    fd = openSync(join(directory, manifest.runId + ".jsonl"), "wx", 0o600);
    requireEvaluationReadiness({
      dirty: manifest.dirty,
      ready: process.env.EVAL_CONFIGURATION_READY === "true",
      keyPresent: !!process.env.OPENAI_API_KEY,
      databasePresent: !!process.env.DATABASE_PATH,
    });
    // Do not infer readiness from a host/secret announcement in another environment.
    store = new Store(process.env.DATABASE_PATH);
    let reservations = 0;
    const recommender = new Recommender({
      mode: "openai",
      key: process.env.OPENAI_API_KEY,
      model: AI_MODEL,
      fetcher: costLimitedFetch(store, fetch, Date.now, {
        onReserve: () => reservations++,
      }),
    });
    executionStarted = true;
    const summary = await runEvaluation({
      recommender,
      manifest,
      emit,
      reservationCount: () => reservations,
      lifetimeReservations: () =>
        store.get("SELECT used FROM external_budgets WHERE name='ai-usd5-v1'")
          .used,
    });
    if (!summary.passed) process.exitCode = 1;
  }
} catch (e) {
  emit({
    kind: "setup_or_recording_error",
    timestamp: new Date().toISOString(),
    ...(manifest ?? {}),
    error: typedAIError(e),
    modelEvaluationPerformed: executionStarted ? null : false,
    outcomeIncomplete: executionStarted,
  });
  process.exitCode = 1;
} finally {
  if (fd !== undefined) closeSync(fd);
  store?.close();
}
