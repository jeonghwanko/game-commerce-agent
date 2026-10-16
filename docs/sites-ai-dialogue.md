# Rosalyn AI dialogue — implemented, external calls disabled

This branch connects the existing structured intent interpreter to the Sites
Worker/D1 game. The player still enters one goal, sees two choices, previews a
look, and explicitly confirms any purchase. It is not a general chat agent or
an autonomous buyer. Korean and English input receive concise localized replies.

## What the model does

`src/recommend.js` interprets only goals, style/avoidance, free preference and
ambiguity using the existing strict schema and validator. It receives the goal,
budget, catalog names/effects and minimal server-read wardrobe/story context.
It receives no visitor identity, email, cookies, payment payloads or credentials.
There are no model tools, payment calls, automatic retries or alternate models.

The existing planner constructs the choices from the canonical catalog and D1
state. The model cannot choose prices, fabricate ownership, award quests or
perform payment. Explicit free requests and budget zero suppress paid suggestions
independently of model spending output. Already-owned outfits are reused; held
rights are not re-sold. The response's short explanation is deterministic localized
copy selected from the validated plan. It is **not** unvalidated model prose.
This keeps Rosalyn's answer consistent with actual game rules.

UI notices distinguish successful AI interpretation, offline guidance and fallback.
Only a validated successful interpreter response has `mode: openai` / `ai.status:
live`. Failure, refusal, malformed output, model mismatch, missing usage, timeout,
disabled configuration and exhausted limits return an explicit fallback with
free/owned-item choices and no purchase promotion. The source notice is visible,
including when AI has never been called. No text is presented as real AI merely
because a mode flag was configured.

## Model compatibility and limits

Official documentation checked 2026-10-16:

- [Deprecations](https://developers.openai.com/api/docs/deprecations) lists
  `gpt-4.1-mini-2025-04-14` as deprecated, with shutdown on 2027-01-14 and
  `gpt-6-luna` as the recommended replacement.
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) documents
  Chat Completions, structured outputs and `none` reasoning. It specifies the
  `gpt-6-luna` identifier. Standard input/output rates are $0.10/$0.50 per million
  tokens; cache writes cost $0.125 per million, and regional processing can add 10%.

Sites uses that candidate with `reasoning_effort: none`, strict JSON schema,
`max_completion_tokens: 250`, `service_tier: default`, `tool_choice: none`,
`store: false`, no tools and redirects rejected. These are documented-contract
and fake-HTTP checks, **not live model availability or quality evidence**. The
legacy Node evaluation policy remains separate and was not silently migrated.

The new Sites policy caps each serialized request at 16,000 UTF-8 bytes, allows
1,024 additional framing tokens in its conservative estimate, bounds response
consumption to 64 KiB and times out at 10 seconds. Its upper estimate includes the
cache-write and regional premiums. Each network attempt reserves $0.01 forever,
including failures; the code ceiling is 100 calls/$1.00 for this database, with
one in-flight call across Worker instances. User configuration may choose a lower
cap. There are no refunds, periodic resets or automatic increases. Review expires
2026-10-23T00:00:00Z; the transport fails closed afterward until code/pricing is
reviewed again. This is a conservative reservation limit, not a billed-cost claim.

The existing D1 budget now supports `windowMs: 0` as a lifetime budget; webhook
windows retain their existing reset behavior. A reservation holds its concurrency
slot through headers, streamed body parsing and cancellation. Orphan slots after
a crash fail closed and require controlled operator recovery, never a public reset.

## Duplicate requests and storage

The UI sends a UUID per recommendation and suppresses double submission while
busy. A transport retry keeps that UUID. D1 stores the owner pseudonym, request ID,
a SHA-256 fingerprint of inputs/current state and the validated response. It stores
no raw goal or raw provider output. A completed repeat returns the saved response
without another call. A pending/crashed repeat falls back without retrying. Reusing
an ID with changed inputs/state fails 409. The application table is capped at 256
rows; reaching that cap fails closed. No recommendation mutates wardrobe, quest,
quote, order or entitlement records.

`sites/migrations/0002_ai_requests.sql` is a new schema-only migration. It has run
only against the local SQLite/D1 fixture. It must be included in the supported
Sites migration/build process for a future authorized deployment. No handler runs
CREATE/ALTER, and no hosted migration was applied here.

## Activation handoff — values are not configured

Default behavior remains offline with zero provider calls. No key was read or set
and no paid API call was made during implementation. For a later separately
authorized compatibility run, the parent must obtain explicit approval for the
cap and ask the user to enter the key privately in Sites Settings:

| Variable | Future proposed value / purpose |
| --- | --- |
| `AI_MODE` | `openai` selects the optional interpreter; omitted/`mock` is offline |
| `AI_REQUESTS_ENABLED` | `true` only after spend and hosted-access authorization; otherwise disabled |
| `AI_MODEL` | Exactly `gpt-6-luna`; no arbitrary endpoint or model fallback |
| `AI_MAX_CALLS` | Proposed **100 maximum**, or a smaller approved integer |
| `AI_BUDGET_USD` | Proposed **`1.00` lifetime ceiling**, or smaller two-decimal amount; each attempt reserves `0.01` |
| `OPENAI_API_KEY` | User enters privately; never put it in chat/source/logs |

Effective attempts are the lower of the call cap and the number of one-cent
reservations. The durable policy is bound to the database; changing its ceiling
does not reset usage. Keep `PAYMENT_PROVIDER` unconfigured and Sandbox payments
disabled throughout AI validation. Keep AI disabled during the separate public
dispatch validation in [the access plan](sites-access-validation.md). Public
operation, deployment, paid compatibility testing and payment activation are
separate later decisions, not actions completed here.

## Verification and provenance

Tests exercise the actual interpreter, schema validator, planner and Worker
against synthetic OpenAI Responses and local SQLite/D1. Cases include English
and Korean goals, free preference, budget zero, owned clothing, canonical prices,
hostile/invalid model output, refusals, response/usage/model errors, HTTP failures,
timeouts, streamed-body concurrency, missing auth/CSRF, duplicate sends, replay,
restart, lifetime dollar/call limits, policy expiry and zero payment mutations.
The shared response reader is also exercised by the existing body-budget tests.

The existing Chromium suite exercises the unchanged purchase/free/owned workflows
plus the Sites interpreter with fake HTTP: Korean reply, two choices, zero-budget
free path, double-submit suppression, English fallback, lifetime cap, mobile
layout and keyboard navigation. It does not contact OpenAI/PayPal or validate real
ChatGPT dispatch. Real model semantics, live latency and billed cost remain untested.

Final local verification: `npm run check` passed **236/236 tests** with zero
failures/skips; the Chromium suite passed. The source-handoff exporter copied
18 transitive application modules plus the new schema migration, with byte-match
checks against the worktree. That output is source-only, not a deployable archive.
Optional Prettier installation failed with `EAI_AGAIN` resolving
`registry.npmjs.org`; no formatting download completed. Syntax checks and
`git diff --check` passed independently. No network workaround was attempted.

The work starts at PR2 commit `6246cc6af8c583ebfa175b5876748bac2970bcff`, whose
application modules were supplied as matching saved source
`55945400589a693c8e17ddff4a648566c118311b`. Security fixes are retained in commit
`9f07c8d` on `codex/sites-owner-csrf-review`; AI work continues separately on
`codex/rosalyn-ai-dialogue`. Original PR2/main and the existing deployment are
unchanged. No source credential, native Site mutation or publishing helper was
used. The exact deployed wrapper/archive was not downloaded, so this is an
application-source delta against the supplied mapping, not an archive comparison.
