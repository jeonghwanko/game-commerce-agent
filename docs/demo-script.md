# Player-led recording route — 2:45

Prepared script only; no final video or actual-provider evidence has been recorded. Keep the entire run in one declared mode. The current browser artifacts are **MOCK REHEARSAL**, with that badge visible throughout. Do not splice mock recovery into a claimed live payment.

| Time      | Player action / framing                                                                                                                         | English narration                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Start on the single goal field. Keep the MOCK / REHEARSAL badge visible. Enter “I want to go to the gathering.”                                 | “I want to reach the gathering. This is an offline rehearsal: no AI model or PayPal service is being called.”                                         |
| 0:15–0:35 | Show the two choices: Borrow for free and Find a look to buy. Keep Why these choices closed.                                                    | “I can borrow for free or choose an optional look. If I already own a suitable outfit, Rosalyn offers that first.”                                    |
| 0:35–1:00 | Preview the free loan, go back, then browse the optional Gala. Show Preview only / Not owned, USD 1.99 and the short remaining-conditions line. | “Trying a look changes nothing. Gala passes the same dress check as the free loan. I still need the free seal and password.”                          |
| 1:00–1:20 | Explicitly confirm the named item/amount, then Complete mock payment.                                                                           | “This is my exact purchase confirmation. Payment is simulated here. The model cannot approve it or grant an outfit.”                                  |
| 1:20–1:55 | Explicitly Wear purchased outfit; visit courier and archivist, complete their free quests, meet guard, enter.                                   | “Choosing Wear changes my character. The coat does not bypass either free quest. Borrowed clothes lead to the same story.”                            |
| 1:55–2:25 | **One recovery case:** reload in the same session. Show the saved checks and wardrobe. Ask the goal again; Wear what I own replaces borrowing.  | “My wardrobe and quests return without another purchase. My position starts in the courtyard. I can use what I already own.”                          |
| 2:25–2:45 | Optionally open Other looks & details for the two authored NPC reactions, then close. End with the visible mock badge.                          | “The detail is available when I need it. The main path stays simple: goal, choice, preview, confirm. Real Sandbox and AI evidence are still pending.” |

## Mock rehearsal track

Use “Complete mock payment” and say “This is an offline rehearsal; neither PayPal nor an AI model is being called.” The browser test separately injects a lost response and delayed notification to verify recovery. Do not claim those injected conditions occurred at PayPal. Recovery can be recorded as a clearly labeled rehearsal segment; no other failure/cancellation/refund montage is needed in the 2:45 narrative.

## Actual-provider proof track — blocked pending configuration confirmation

Use the approved Sandbox seller/buyer, configured callback and host-authenticated real AI entrypoint. Show actual goal interpretation and buyer approval; redact buyer identifiers and secrets. Retain a sanitized evidence record tying one local order to actual capture and verified provider notification. For the single recovery example, reopen the completed run and show its restored ownership and quests. Explain that this is reload recovery, not a provider outage. Never fabricate a signed event or force a grant. Pending-event and timeout fault injection remain separate test evidence, outside the final film. End by distinguishing the independent original scene from the still-unintegrated private game.

Before filming: run `npm run test:browser`, review mobile/keyboard access, confirm provider/AI badges, keep evidence closed, use an operator-approved existing test identity with a fresh scene ledger, and rehearse to 2:45. Capture with the operator’s approved recorder; no publishing, external testers or submission is authorized by this script.

## Reproduce the mock recording locally

Use Node.js 24+ and the existing branch. These Bash commands force mock modes and do not load `.env` or configure credentials:

```sh
npm ci --ignore-scripts
npm run check
npm run format:check
npm run test:browser
NODE_ENV=development PAYMENT_PROVIDER=mock AI_PROVIDER=mock AUTH_MODE=anonymous-demo PUBLIC_ORIGIN=http://localhost:3000 PORT=3000 DATABASE_PATH=./data/mock-rehearsal.sqlite node src/server.js
```

Open `http://localhost:3000` with a fresh local browser profile for the initial scene. Keep that same profile/session for recovery; do not clear cookies between the purchase and reload. Use the file-backed mock database above again after stopping/restarting the process. Do not reuse a Sandbox-mode database. Do not delete an existing ledger to reset a recording; a separate profile provides a separate demo player. Tests use synthetic in-memory or temporary ledgers and never connect to payment/model APIs. `npm ci` only installs the pinned development formatter; there are no runtime packages.

For the owned/free comparison shot, complete the mock purchase and quests, reload, then ask “enter the evening gathering for free” with USD 0.00. The first choice is now **Wear what I own**, and its preview shows **Already owned / USD 0.00**, the separate loan remains free, the cloak is over budget, and no purchase is recommended. This repeat path is tested but need not become a second recovery montage in the 2:45 film.

The normal rehearsal does not inject failures. The browser harness separately injects lost create/capture responses and delayed mock notification, so its recovery artifacts are fault-injection evidence, not an incident at PayPal. New comparison/preview shots are generated under `/tmp/gca-*.png`; they contain original fixture art and mock state only. The script is ready to rehearse, not a recorded or uploaded video.
