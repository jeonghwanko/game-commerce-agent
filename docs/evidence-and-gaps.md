# Verification evidence and remaining gaps

This branch is **not yet submission-ready, and there is no basis to claim first-place quality**. Local safety and interaction evidence is stronger than the initial prototype, but the required real integrations and a recorded end-to-end demonstration are missing. These results are not a security certification or a prediction of judging outcomes.

## What was exercised locally

- `npm run check`: 155 passing automated cases at this revision, including 36 offline goal-plan cases (six each: normal, already owned, free preference, ambiguous, unsuitable and adversarial input).
- In those 36 cases: zero observed catalog SKU, displayed price, budget or entitlement-mutation invariant violations. This is **deterministic server/mock validation, not measured LLM accuracy**. The independent typed-interpretation gold suite contains **12 sentences × 3 states = 36 regression cases**, plus **8 holdout sentences absent from prompt examples** (44 total). It covers synonyms, negation, mixed intentions, Korean/Spanish/Japanese, ambiguity, attacks and post-story collection. Fixed gold goals, excluded styles, free preference, SKU/price and required/allowed actions are authored separately from the planner. Final story state is checked by an independent simulator; mutation tests reject lost mixed goals or missing/overwriting actions. These are human-authored stub interpretations, not model responses. Actual model quality remains unmeasured.
- PayPal transport-contract tests use a locally stubbed fetcher for create, OAuth, order read, capture, capture read, webhook verification and refund lookup. They check merchant identity, exact amounts/currency, parent-order binding, lost create/capture responses, signed refund holds and fixed Sandbox paths. **No PayPal API was called.**
- Independent review's refund-ID and stale-inspect/cancel defects now have regression coverage: a realistic refund resource has its own ID and a capture `rel=up` link; CAS operation leases and post-await rechecks prevent an old CREATED result from enabling cancellation during another capture.
- Provider-mode isolation, atomic grant rollback, early refund inbox, delayed completion, SSRF-link rejection, global external attempt budgets, principal re-login recovery and spoofed identity headers are tested.
- `node scripts/verify-onesub.js /path/to/pinned/onesub`: 324 outputs match actual upstream commit `2b7dcd7ff5e21e252a7d8fdcf72769f651dc737f`. The MIT core is executed by wardrobe/equip authorization after ledger filtering; notices and license are preserved.
- `npm run test:browser`: Chromium exercises movement to the shop, preview, quote/order isolation, approval-required rejection, lost-response retry, pending webhook without rights, reload, verified wardrobe, outfit appearance, seal/rumor conversations, gate passage, cancellation followed by an old approval URL, and a fresh player's complete free route.

The checked-in screenshots below are generated from that **offline mock** browser sequence using only original vector elements. They contain no real buyer, payment or account data.

- [Mock mobile 200% CSS reflow](screenshots/mock-mobile-200-percent.png)
- [Mock fitting-room preview](screenshots/mock-preview.png)
- [Mock webhook-pending state](screenshots/mock-pending.png)
- [Mock outfit and completed story](screenshots/mock-complete.png)

## Self-assessment against official criteria

The [official rules](https://paypalaihackathon.devpost.com/rules), reviewed October 15, 2026, apply equally weighted technical implementation, design, potential impact, innovation and presentation criteria after an initial viability/API-fit check. The following is our internal assessment, not a judge's score.

| Criterion                | Demonstrated here                                                                                                         | Material gap                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Technical implementation | Durable money/ownership boundaries, real adapter code, fault-injection tests, reused MIT entitlement core                 | Actual Sandbox buyer approval/capture/signed callbacks and real AI are unverified; private host auth integration is not connected |
| Design                   | A playable original scene; visible cosmetic distinction; owned/free/no-purchase plans; honest pending and recovery states | Small fixture with simple vector art; no independent player usability evidence or private-game integration                        |
| Potential impact         | Concrete goal: help a player progress without pressuring them into a purchase; free story parity                          | No external player/developer research, adoption evidence or measured impact                                                       |
| Innovation               | Server-validated goal actions tied to game state and optional collectible commerce; read-only model boundary              | Need a real AI demonstration and comparative product evidence; no claim that this concept is unique                               |
| Presentation             | A 2:45 player-led script and reproducible labeled mock screenshots                                                        | No recorded video, real end-to-end evidence, published test access or completed submission                                        |

## Can finish without new approval

Local implementation, deterministic/contract tests, browser fault injection, documentation and updates to the existing public draft PR are authorized. This round completed those items. Existing private services remain untouched. The [private integration proposal](private-integration-proposal.md) documents intended surfaces and impact before any private PR.

## Requires separate approval or configuration

| Need                                                                                           | Target and reason                                                                | Current status                                                                                |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Existing `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MERCHANT_ID` | Sandbox app/seller and actual signed callbacks                                   | Setup approved and prepared by owner separately; no keys configured here; real E2E unverified |
| Approved HTTPS origin/proxy                                                                    | Deliver real Sandbox callbacks to the app                                        | Not exposed or deployed; no CLI/conversation gateway exposure                                 |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, explicit AI access and finite call budget                    | Measure real model behavior and complete 36+ input evaluation                    | US$5 evaluation approved; configuration readiness pending; no calls performed                 |
| Host principal and quest adapter                                                               | Restore rights after real login and consume authoritative game state             | Explicit independent demo host and free quest adapter tested; no private DB connection/change |
| Private-game PR                                                                                | Connect existing shop, wardrobe and guard rules while preserving existing quests | Impact proposal only; no private changes                                                      |
| External testers and recording/access plan                                                     | Validate experience and record a truthful live demo                              | Not recruited, recorded, hosted or submitted                                                  |

The command-line app defaults to anonymous offline play. Real AI intentionally fails closed until a host verifier, explicit enablement and global budget are supplied. The explicit independent Sandbox demo host now provides authenticated test access and server-owned free quests; actual credentials, real AI and hosting remain unconfigured. The public fixture is not a ready-to-publish anonymous real-AI demo. Single-instance operation remains the supported scope; no autonomous reconciliation worker, refund issuance or dispute-resolution service exists.

## This review iteration

Both reported P1 paths were reproduced before fixes: refund-shaped REVERSED returned 503 before/after grant; changing Gala to cloak left four stale order controls next to the new quote. Regressions now pass. Refund/capture normalization uses type plus resource type and fixed Sandbox correlation. The UI detaches payment controls before quote loading and offers an explicit return to the previous order.

- 8 worker threads share one file-backed budget: 10 allowed attempts total, no more than 2 concurrent slots. Restarts preserve usage; altered policy is refused; orphan slots fail closed until the documented stop-all-workers recovery.
- Invalid-signature floods exhaust only the webhook time window. Valid completion and refund recover after cooldown with full signature verification. Continuous flooding remains an availability risk.
- A real local HTTP server is stopped/recreated twice against the same SQLite file: session, pending order, granted right and equipped state recover. Held rights remove the formal effect; a separate free loan restores only loan access, not ownership.
- 100 outbox events survive acceptance-before-ack failure and concurrent retry with sink ID deduplication.
- Chromium purchase flow uses CDP pointer events; the fresh-player free route uses Tab/Shift-Tab/Enter only. Initial session 503 produces a visible global error and retry; 390px layout and 200% CSS zoom have no horizontal overflow; reduced-motion route passes. CSS zoom is a reflow approximation, not certification of every browser's native zoom or screen reader behavior.
- Global intent-plan invalidation and remaining-only gate requirements prevent stale purchase advice and repeated completed-quest instructions. Wardrobe distinguishes owned products from a free loan; player UI uses natural-language states.
- Live AI harness preflight makes zero requests. A persistent shared guard reserves $0.05 per attempted request, at most 100 attempts/$5, with bounded input/output, one concurrent transport, pinned model and price-review expiry. No actual model score, provider success or recorded final video is claimed.

Remaining evidence gaps: private principal/quest host integration and deployed demo authentication, actual model evaluation, actual Sandbox approval/capture/signed callback/refund, native mobile touch and assistive-technology checks, human usability evaluation, and a truthful recorded provider demonstration. Credentials are not available in this process. Setup approval exists; execution still waits for the parent's explicit configuration-ready confirmation. Deployment, private implementation and submission remain outside authorization.

Clean-install evidence: a separate temporary directory containing only public repository candidate files ran `npm ci --ignore-scripts`, all 155 tests, formatting and the pointer/keyboard browser rehearsal successfully. Runtime dependency count remains zero; the sole dev dependency is MIT Prettier 3.6.2. `npm audit` reports zero known vulnerabilities. Targeted tracked/candidate-file scans found no private-key blocks, provider-token patterns or private Library identifier. These scans are scoped checks, not proof that every possible secret is absent. MIT notices and OneSub license remain intact.

OAuth proxy compatibility is a **document-based interface**, not live proxy E2E evidence. Four synthetic tests cover exact full-header placeholder forwarding, fixed endpoint/redirect rejection, mutually exclusive credential modes, diagnostic redaction, and unchanged client-pair mode. No credentials were generated, configured, converted or transmitted by this task.

## Follow-up recovery, planning and transport review

- Lost create response was reproduced in Chromium before the fix. Reload now restores `CREATING` with the originally confirmed product/amount/currency and an explicit resume control. Expired quote, same idempotency key, five-hour refusal, cancellation and late create response races are covered; a real local HTTP restart restores and resumes the same remote mock order.
- AI concurrency now includes header arrival, full bounded response-body reading, JSON parsing and completed cancellation. Actual `Response`/delayed `ReadableStream` stubs prove the second request stays blocked with a single slot, including abort awaiting cancellation. Body failure/malformed/oversized responses consume attempts and clean up reservations. These are transport-lifetime tests, not external API calls.
- Synthetic PayPal CRLF/empty/oversized/whitespace/control-character bearer tokens are rejected before API header construction. API transport and JSON failures return fixed `CommerceError` codes without raw token/upstream error text. The report did not establish external token exposure; this is defense against diagnostic leakage.
- Open shop, form entry, quote, create error, reload/resume, approval-pending and webhook-pending states run at **390px with 200% CSS zoom** using CDP pointer/keyboard input. A long error string overflow was found and fixed. The free route remains Tab/Enter-only at that zoom. This is CSS reflow approximation, not native mobile touch or assistive-technology certification.
- The explicit independent Sandbox demo host verifies synthetic test credentials on every API request, keeps stable principal identity, and consumes expiring user-bound dialogue challenges for free quests. HTTP and Chromium tests complete the free story with no purchased rights. A stub in real-AI mode verifies access/budget gating; no model is called. Production rejects this host. Generic principal mode is not weakened; private-game integration remains unimplemented.

Additional offline screenshots: [open shop/form](screenshots/mock-mobile-open-shop.png), [quote](screenshots/mock-mobile-quote.png), [recoverable create](screenshots/mock-mobile-resume.png), and [global error](screenshots/mock-mobile-error.png). Each is a mock rehearsal, not real-provider evidence.
