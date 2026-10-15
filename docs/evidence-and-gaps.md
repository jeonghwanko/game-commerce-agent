# Verification evidence and remaining gaps

This branch is **not yet submission-ready, and there is no basis to claim first-place quality**. Local safety and interaction evidence is stronger than the initial prototype, but the required real integrations and a recorded end-to-end demonstration are missing. These results are not a security certification or a prediction of judging outcomes.

## What was exercised locally

- `npm run check`: 80 passing automated cases at this revision, including 36 offline goal-plan cases (six each: normal, already owned, free preference, ambiguous, unsuitable and adversarial input).
- In those 36 cases: zero observed catalog SKU, displayed price, budget or entitlement-mutation invariant violations. This is **deterministic server/mock validation, not measured LLM accuracy**. Separate stubbed AI tests reject unknown/out-of-goal SKUs, extra price fields, duplicate suggestions, tool calls, refusal, truncation and timeout; actual model quality remains unmeasured.
- PayPal transport-contract tests use a locally stubbed fetcher for create, OAuth, order read, capture, capture read, webhook verification and refund lookup. They check merchant identity, exact amounts/currency, parent-order binding, lost create/capture responses, signed refund holds and fixed Sandbox paths. **No PayPal API was called.**
- Independent review's refund-ID and stale-inspect/cancel defects now have regression coverage: a realistic refund resource has its own ID and a capture `rel=up` link; CAS operation leases and post-await rechecks prevent an old CREATED result from enabling cancellation during another capture.
- Provider-mode isolation, atomic grant rollback, early refund inbox, delayed completion, SSRF-link rejection, global external attempt budgets, principal re-login recovery and spoofed identity headers are tested.
- `node scripts/verify-onesub.js /path/to/pinned/onesub`: 324 outputs match actual upstream commit `2b7dcd7ff5e21e252a7d8fdcf72769f651dc737f`. The MIT core is executed by wardrobe/equip authorization after ledger filtering; notices and license are preserved.
- `npm run test:browser`: Chromium exercises movement to the shop, preview, repeated purchase confirmation, approval-required rejection, lost-response retry, pending webhook without rights, reload, verified wardrobe, outfit appearance, seal/rumor conversations, gate passage, cancellation followed by an old approval URL, and a fresh player's complete free route.

The checked-in screenshots below are generated from that **offline mock** browser sequence using only original vector elements. They contain no real buyer, payment or account data.

- [Mock fitting-room preview](screenshots/mock-preview.png)
- [Mock webhook-pending state](screenshots/mock-pending.png)
- [Mock outfit and completed story](screenshots/mock-complete.png)

## Self-assessment against official criteria

The [official rules](https://paypalaihackathon.devpost.com/rules), reviewed October 15, 2026, apply equally weighted technical implementation, design, potential impact, innovation and presentation criteria after an initial viability/API-fit check. The following is our internal assessment, not a judge's score.

| Criterion                | Demonstrated here                                                                                                         | Material gap                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Technical implementation | Durable money/ownership boundaries, real adapter code, fault-injection tests, reused MIT entitlement core                 | Actual Sandbox buyer approval/capture/signed callbacks and real AI are unverified; host auth integration is not connected |
| Design                   | A playable original scene; visible cosmetic distinction; owned/free/no-purchase plans; honest pending and recovery states | Small fixture with simple vector art; no independent player usability evidence or private-game integration                |
| Potential impact         | Concrete goal: help a player progress without pressuring them into a purchase; free story parity                          | No external player/developer research, adoption evidence or measured impact                                               |
| Innovation               | Server-validated goal actions tied to game state and optional collectible commerce; read-only model boundary              | Need a real AI demonstration and comparative product evidence; no claim that this concept is unique                       |
| Presentation             | A 2:45 player-led script and reproducible labeled mock screenshots                                                        | No recorded video, real end-to-end evidence, published test access or completed submission                                |

## Can finish without new approval

Local implementation, deterministic/contract tests, browser fault injection, documentation and updates to the existing public draft PR are authorized. This round completed those items. Existing private services remain untouched. The [private integration proposal](private-integration-proposal.md) documents intended surfaces and impact before any private PR.

## Requires separate approval or configuration

| Need                                                                                           | Target and reason                                                                | Current status                                                                                |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Existing `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MERCHANT_ID` | Sandbox app/seller and actual signed callbacks                                   | Not read, created or configured in this task; real E2E unverified                             |
| Approved HTTPS origin/proxy                                                                    | Deliver real Sandbox callbacks to the app                                        | Not exposed or deployed; no CLI/conversation gateway exposure                                 |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, explicit AI access and finite call budget                    | Measure real model behavior and complete 36+ input evaluation                    | No paid API calls authorized or performed                                                     |
| Host principal and quest adapter                                                               | Restore rights after real login and consume authoritative game state             | Boundary implemented and tested with synthetic host sessions; no private DB connection/change |
| Private-game PR                                                                                | Connect existing shop, wardrobe and guard rules while preserving existing quests | Impact proposal only; no private changes                                                      |
| External testers and recording/access plan                                                     | Validate experience and record a truthful live demo                              | Not recruited, recorded, hosted or submitted                                                  |

The command-line app defaults to anonymous offline play. Real AI intentionally fails closed until a host verifier, explicit enablement and global budget are supplied. The public fixture is therefore not a ready-to-publish anonymous real-AI demo. Single-instance operation remains the supported scope; no autonomous reconciliation worker, refund issuance or dispute-resolution service exists.
