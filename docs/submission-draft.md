# English submission draft — not submitted

**Project:** Rosalyn’s Atelier / Game Commerce Agent

**One sentence:** A game companion that helps a player reach a goal through what they already own, a free loan, or an optional cosmetic purchase, with payments and rights controlled by the server.

## Player problem and experience

A player wants to enter an evening gathering. The gatekeeper needs formal clothes, an invitation seal, and a password. A sales-only chatbot might immediately suggest buying a coat. Rosalyn instead makes the choices and consequences visible.

The main screen offers a free or already-owned path and an optional purchase path. Detailed comparisons are collapsed until requested. The comparison uses the player's server-owned wardrobe, quest state and stated budget. An owned outfit has zero additional cost. A plain formal loan is free and meets the same dress requirement as the Gala coat. The optional violet coat costs USD 1.99; the teal cloak costs USD 0.99 and does not meet the formal dress requirement. These are catalog prices, not claimed savings. Over-budget and already-owned options remain distinguishable from recommended purchases.

Before any purchase, the player can compare the appearances and read Rosalyn's and the gatekeeper's conditional reactions. The two paid looks and free loan have distinct original vector designs. The preview explains what would change and what would remain required. It creates no quote, order, entitlement or quest reward. Buying a cosmetic never supplies the seal or password. Free borrowing can finish the same story.

The existing validated goal plan provides actionable directions to the shop, courier and archivist. Its projected outcome is explicitly conditional on completing the actions. After an optional purchase, the player must choose to wear the outfit to change the character. Reloading restores wardrobe and quest flags from the server; movement and typed goals are deliberately not persisted. The UI shows that boundary.

## How it is built

The independent public scene uses original canvas visuals and browser JavaScript. A Node.js server owns catalog prices, expiring quotes, explicit purchase consent, durable SQLite order transitions, ownership and free quest flags. The recommendation layer can interpret goals through a read-only AI contract, while validated server actions and projections decide the eligible options. The preview reuses that projection code; it is not another planner or an authority to grant rights.

The reusable commerce core includes a fixed PayPal Sandbox adapter, owner/amount/currency checks, idempotent recovery, verified webhook handling, refund/reversal holds, and a pseudonymous outbox. A small MIT-licensed OneSub entitlement evaluator is actually reused with preserved attribution. The private game, its assets and authentication system are not part of this repository.

## Evidence and honest limits

The currently reproducible demo is **MOCK REHEARSAL**. Recommendation parsing and payment completion are simulated; NPC preview dialogue is authored fixture text. It is not evidence of actual AI quality or PayPal execution. Automated unit/HTTP/browser tests exercise the free and optional-purchase paths, preview non-mutation, catalog costs, NPC consequences, duplicate prevention and reload recovery. Browser interaction uses pointer and keyboard input, including a 390px viewport and 200% CSS reflow approximation.

Real Sandbox buyer approval, capture and verified callbacks, actual model evaluation, Cloud Network secret substitution, private-game integration, native mobile/assistive-technology certification and a final recorded video remain unverified. No deployment, upload or submission has been performed. Real-provider proof must replace the mock payment/model segment before presenting this as a live integration.

**Recording plan:** [2:45 script and reproducible rehearsal](demo-script.md).

**Implementation/test record:** [evidence and remaining gaps](evidence-and-gaps.md).
