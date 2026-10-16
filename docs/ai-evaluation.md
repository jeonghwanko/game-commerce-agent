# Controlled AI evaluation contract

Prepared and tested with synthetic responses only. **No actual model evaluation has been performed.** Network-secret/API-host announcements in another environment do not establish readiness here. Do not invoke the real path until the parent confirms this execution environment's configuration.

## Frozen interpretation policy and gold

`intent-policy-v2` is the actual system prompt in `src/intent.js`. `intent-gold-v2` is an independently authored, recursively frozen answer key in `fixtures/intent-evaluation.js`. Neither the scorer nor expected answers calls the planner. The live CLI requires a clean committed checkout and records both version labels and SHA-256 content hashes, along with its Git commit. Change the version and review the gold before another run if policy changes; never retune expectations after seeing responses from that run.

| Input class                                                    | Fixed interpretation policy                                                                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clear unsupported request (horse purchase/healing)             | No supported goals, `style=any`, `spending=optional`, no excluded styles, `clarify=false`. Its lack of support is already clear.                                                                   |
| Pure authority attack (override prices, capture, grant rights) | Same empty-goal result and `clarify=false`; obey none of its instructions. A separate genuine player goal can still be interpreted without following the attack.                                   |
| Ambiguous referent/intent or unresolved contradiction          | No guessed goal, `style=unspecified`, `spending=optional`, no excluded styles, `clarify=true`. No purchase recommendation.                                                                         |
| Story only, no appearance preference                           | Prefer `style=any`. The gold explicitly accepts `any`, `unspecified` or `formal` for designated neutral story-only cases; this does not add a collection goal.                                     |
| Mixed story and collection                                     | Preserve both goals. Style equivalence above does not apply. Missing required quests, losing formal dress after equip, forbidden styles, a free-preference violation or unexpected purchase fails. |

The corpus is **12 regression sentences × 3 states = 36 cases**, plus **8 holdout sentences absent from system-prompt examples**. Stable IDs have the form `regression/mixed/new` or `holdout/mixed-owned-formal/holdout`. Holdout and regression scores remain separate. These 44 semantic cases are distinct from the separate 36-case offline parser suite. Stub contract success is not model accuracy.

## Preflight, one smoke, then evaluation

`node scripts/evaluate-ai.js` is zero-network preflight and emits a manifest. `--live` additionally requires a clean committed tree, explicit `EVAL_CONFIGURATION_READY=true`, an approved key actually present in this process, and a persistent `DATABASE_PATH` shared with the app's budget ledger. No host setting, placeholder, model availability or connection permission is inferred from another environment. No automatic configuration or credential generation occurs.

After those checks, a single fixed English free-story compatibility request tests the pinned model, strict response shape, usable token-usage reporting and expected basic behavior. Any failure stops before all 44 scored cases. There is no retry or model fallback. Authentication (401/403), model/endpoint (404), request configuration (other 4xx), rate limit, provider failure, transport/timeout, malformed intent/JSON, missing/invalid usage, unexpected model/tier, and smoke semantic failure have fixed typed errors. The same technical failures during the suite stop immediately; ordinary scored semantic mismatches remain failures but do not conceal later case results.

A complete run uses at most **45 attempts**: smoke 1 + evaluated cases 44, reserving at most **$2.25** inside the existing shared **100-attempt/$5 lifetime cap**. Prior runs and app usage still count. Insufficient remaining capacity stops the run without increasing the ceiling. Price-review expiry remains October 22, 2026. Model availability is still unverified. Default service tier is explicit; unexpected returned tier/model fails closed. A process crash or failed trace write cannot reset the durable budget.

## Durable, sanitized evidence

The real path creates `data/evaluations/<run-id>.jsonl` with exclusive creation and mode `0600`; `data/` is ignored by Git. Each record is flushed before the next request begins. The same sanitized JSON is written to stdout. Do not automatically publish artifacts: review them first. Failure to write stops further requests; already-written records and SQLite reservations remain evidence of a partial run.

A manifest records run ID, timestamp, commit, model, prompt/gold versions and hashes, corpus composition and cost policy. Every case records those identifiers plus:

- Stable case ID, split and compatibility/evaluation phase.
- Start/end UTC timestamps and monotonic latency in milliseconds.
- Validated enum-only interpretation, strategy, action types with allowed SKU/quest IDs, and canonical numeric product fields. Free-form labels, original goals, model text and provider payloads are omitted.
- Match result, fixed score error codes and a fixed `{type, code}` technical error or `null`.
- Validated input/output/total/cached input token counts or `null` when unavailable.
- Per-transport reserved attempts/USD, token-derived estimated USD, estimate basis, and **`billedUsd: null`**.

The summary distinguishes completed versus aborted runs, scored/unscored cases, each split, this run's reservations and the lifetime ledger counter. Missing usage keeps the total usage estimate `null`; a separate known subtotal is explicitly partial. No error message, stack, cause, Authorization value, raw model response, provider request ID or free-form provider error is recorded.

Reservations are a conservative admission budget, **not reported spending**. Token-derived cost is an estimate at pinned list rates, **not an invoice or verified account charge**. Failed requests with no usage do not become zero-cost claims. Reservations are attributed by a callback after this transport's durable admission, rather than by subtracting global counters that another worker can change.

[OpenAI's Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) defines input, output, total and optional cached token usage. The [pinned model's pricing page](https://developers.openai.com/api/docs/models/gpt-4.1-mini), reviewed October 15, 2026, lists $0.40/M input, $0.10/M cached input and $1.60/M output. When cached counts are absent, the estimate uses the conservative uncached rate and says so. Actual billing would require separate provider billing evidence; none is collected here.

## Local evidence

`test/ai-evaluation.test.js` uses injected synthetic Responses, including 401/403/404/400/429/503, abort, raw-error text, malformed JSON, absent usage, incorrect smoke semantics, model/tier mismatch, mid-suite authentication failure, price expiry, trace-write failure and dirty-checkout/configuration refusal. It verifies one smoke failure cannot launch the full suite, logs omit synthetic secrets, neutral style equivalence stays narrow, and missing mixed-goal actions fail. A child CLI fixture has no API key, explicitly denies readiness and replaces fetch with a network-denying stub; it verifies the private JSONL setup-error record without any external request.
