# English demo script — target 2 minutes 40 seconds

Use this script only after completing the real Sandbox + AI checklist. If showing mock mode, say “offline simulation” and leave the badges visible. Never imply it is a successful real integration.

**0:00–0:20 — Intent**
“Game Commerce Agent connects a game conversation to an explicitly approved Sandbox purchase and a verified gameplay entitlement. This original shop is a standalone fixture; the commerce layer can be connected to a host game.”

**0:20–0:45 — Recommendation**
“I need formal clothes to get past the guard, with a three-dollar budget. The AI sees only the server catalog and minimal game context. It can recommend a SKU; it cannot set prices, approve a payment, or grant an item.”

**0:45–1:15 — Consent and approval**
“This quote shows the outfit, USD 1.99, contents and expiry. I explicitly confirm it, then approve the Sandbox order as the buyer. Returning to the page is not proof of payment.”

**1:15–1:45 — Verification**
“The server checks ownership, amount, currency and completed capture. It also verifies PayPal’s webhook. A unique capture, transactional entitlement and deduplicated receipt keep retries from granting twice.”

**1:45–2:10 — Game effect and free route**
“The outfit is now in the server wardrobe. Wearing it satisfies the dress check, but I still need the seal and rumor. The free borrowed outfit works too; purchase does not replace those quests.”

**2:10–2:40 — Reuse and limits**
“The session funnel contains only allowlisted events and opaque IDs. A durable outbox connects independent operations tools. Tests exercise cancellation, failures, mismatches, duplicates and recovery. This branch is a Sandbox prototype; production authentication and deployment remain separate integration work.”

Record a clean test profile. Do not show secrets, raw provider payloads, buyer personal data, internal Library documents or private game assets. This file is a script only: no video has been recorded or submitted.
