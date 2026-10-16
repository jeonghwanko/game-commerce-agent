# Player-led recording route — 2:45

Prepared script only; no final video or actual-provider evidence has been recorded. Keep the entire run in one declared mode. The current browser artifacts are **MOCK REHEARSAL**, with that badge visible throughout. Do not splice mock recovery into a claimed live payment.

| Time      | Player action / framing                                                                                                                                                | English narration                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Keep MOCK / REHEARSAL visible. Walk to shop and ask “enter the evening gathering” with USD 3.00. Evidence stays closed.                                                | “I want to reach the gathering. This is an offline rehearsal: no AI model or PayPal service is being called.”                                                                                                     |
| 0:15–0:45 | Show Compare paths: owned status, free USD 0.00 loan, optional Gala USD 1.99 and cloak USD 0.99. Point at dress checks, budget and missing quests.                     | “Rosalyn checks what I own and can spend. A free loan meets the same dress check as Gala. The cloak is cosmetic. These are additional costs, not invented savings. The seal and password are always free quests.” |
| 0:45–1:10 | Compare Gala, then cloak, then the loan. Show Rosalyn and Gatekeeper reactions; no confirmation yet.                                                                   | “Rosalyn explains the look; the guard explains the consequences. The cloak does not pass his dress check. This preview changes nothing in my wardrobe or quest progress.”                                         |
| 1:10–1:35 | Return to recommended Gala's Review purchase. Show item, USD 1.99, currency and explicit confirm. Use the mode-specific payment track.                                 | “I choose the optional gold-embroidered coat. I confirm this exact item and amount. In this rehearsal, payment is simulated. The model never approves a purchase or grants an outfit.”                            |
| 1:35–2:10 | Wear purchased Gala. Use next-step directions to courier and archivist; accept seal and password; meet guard and enter.                                                | “Choosing Wear changes my character. The coat does not skip either quest. A player wearing the free loan can enter the same gathering.”                                                                           |
| 2:10–2:35 | **One recovery case:** reopen/reload with the same session. Show server-loaded owned outfit and three completed checks, then walk to the guard again. No new checkout. | “The server restores my wardrobe and quest progress without another purchase. My position starts back in the courtyard. It is saved-state recovery, not a claim of a provider outage.”                            |
| 2:35–2:45 | End on the free path and visible mode badge.                                                                                                                           | “Goal solving first, collection by choice. Real Sandbox and AI evidence are still pending; this is an independent original demo.”                                                                                 |

## Mock rehearsal track

Use “Simulate buyer approval + verified webhook (MOCK)” and say “This is an offline rehearsal; neither PayPal nor an AI model is being called.” The browser test separately injects a lost response and delayed notification to verify recovery. Do not claim those injected conditions occurred at PayPal. Recovery can be recorded as a clearly labeled rehearsal segment; no other failure/cancellation/refund montage is needed in the 2:45 narrative.

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

For the owned/free comparison shot, complete the mock purchase and quests, reload, then ask “enter the evening gathering for free” with USD 0.00. Gala now shows **Already owned / USD 0.00 additional cost**, the separate loan remains free, the cloak is over budget, and no purchase is recommended. This repeat path is tested but need not become a second recovery montage in the 2:45 film.

The normal rehearsal does not inject failures. The browser harness separately injects lost create/capture responses and delayed mock notification, so its recovery artifacts are fault-injection evidence, not an incident at PayPal. New comparison/preview shots are generated under `/tmp/gca-*.png`; they contain original fixture art and mock state only. The script is ready to rehearse, not a recorded or uploaded video.
