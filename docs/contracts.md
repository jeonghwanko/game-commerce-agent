# Public bridge and event contracts

## Identity boundary

All commerce and game APIs resolve `gca_session` to a server-held pseudonymous player ID. The random cookie is hashed in SQLite, expires in seven days, and is HttpOnly / SameSite=Lax (Secure for HTTPS). Mutating browser requests additionally require exact Origin, JSON content type, and the session CSRF token. There is no client identity override. The fixture is anonymous; clearing the cookie creates a new player.

A host integration must replace the demo session issuer with its verified login session and map its stable player identity server-side. Never import private game code/assets into this repository, trust a localStorage ownership flag, or expose a local Codex conversation gateway. This prototype has per-session request limits, not production abuse prevention. Keep it isolated until host auth, deployment controls, backups, retention, and reconciliation workers are explicitly designed and approved.

## HTTP interface

| Method/path                                  | Input / result                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| `GET /api/session`                           | Issue/resume anonymous session; return CSRF token and explicit provider modes             |
| `GET /api/commerce/catalog`                  | Active canonical SKU records, minor-unit prices and versions                              |
| `POST /api/commerce/agent/recommend`         | `{goal, budgetMinor}` → max two canonical products and free alternative                   |
| `POST /api/commerce/quotes`                  | `{sku}` → five-minute quote bound to session owner and catalog version                    |
| `POST /api/commerce/orders`                  | `{quoteId, sku, amount, currency, version, confirm:true}`; exact displayed quote required |
| `GET /api/commerce/orders`                   | This session’s latest 20 orders                                                           |
| `GET /api/commerce/orders/:id`               | Owned order status                                                                        |
| `POST /api/commerce/orders/:id/capture`      | Inspect approval, capture using stable request ID, re-read payment                        |
| `POST /api/commerce/orders/:id/cancel`       | Local cancellation before capture attempt                                                 |
| `POST /api/commerce/orders/:id/mock-approve` | Mock mode only; explicit simulated approval/capture/webhook                               |
| `POST /api/paypal/webhooks`                  | Provider authentication through PayPal signature verification, not browser session        |
| `GET /api/commerce/entitlements`             | Own rights, including held status                                                         |
| `GET /api/game`                              | Original fixture wardrobe and three independent guard conditions                          |
| `POST /api/game/equip`                       | `{sku}`; active server entitlement or free borrowed outfit required                       |
| `POST /api/game/quest`                       | `{quest:'seal'                                                                            | 'rumor' | 'borrowed'}`; fixture shortcut, not a real game quest API |
| `GET /api/analytics/funnel`                  | Own session event counts only                                                             |

Catalog controls money, currency and effect; the model controls none of them. Quotes cannot be used by another session or changed after confirmation. A retry of the same confirmed quote returns/reconciles its existing order even after quote expiry. A new order requires an unexpired quote and unchanged catalog. Unknown/held entitlement cannot be equipped for a paid effect.

`src/contracts.d.ts` defines the provider, entitlement view, game bridge and event sink types. The host should query entitlements on login and after checkout, then compute its own existing quest predicates. Buying formal clothing must never automatically grant a seal or rumor.

## Persistence and failure semantics

SQLite is the single-host source of truth; no localStorage ledger exists. Unique provider order/capture IDs and `(user_id,sku)` rights prevent duplicate grants. Event, receipt and entitlement mutations run in one transaction. Provider I/O happens outside transactions. The prototype supports one application instance, with synchronous SQLite transactions; it does not promise multi-region/distributed exactly-once execution.

A `CREATING` retry uses the same PayPal request ID, bounded to five hours (inside the default six-hour create idempotency window). Older uncertain creates require operator reconciliation and cannot be blindly retried. `CAPTURE_PENDING` retries inspect the existing provider order first. `AWAITING_WEBHOOK` is deliberately not ownership. Verified webhook processing re-reads the provider and matches local reference, order, capture ID, final status, exact amount and currency. Unknown provider orders return retryable 503; a webhook can arrive before local create commits. Signature failure returns 401. Irrelevant event types cannot grant.

Refund/reversal receipts are durable. Existing rights become held; future completion does not overwrite the hold. Late payment following cancellation/failure is review-only. An operator must resolve payment/rights discrepancies; the prototype does not automatically issue refunds or resolve disputes.

## OneSub boundary

The inspected public evaluator provides a useful read boundary: evaluate configured product rights over already-fetched records, or fetch through a purchase/subscription store first. This repository uses its own active/held entitlement view and a distinct `paypal-sandbox` provider. No source was copied and no OneSub dependency is installed. A future shared extraction requires preserving OneSub’s MIT notice, extending its platform model explicitly, excluding held/refunded rights, and enforcing the host session identity outside any query-based router.

## Privacy and outbox

Allowed rows are exactly `{id, user_id, order_id, name, at}` plus an internal delivery marker. Both user and order IDs are local opaque identifiers. Event names are allowlisted. There is no free-form metadata field, chat transcript, email, provider order ID, capture ID, token or card data in analytics. Payment reconciliation fields stay in the private ledger.

`Store.outbox(limit)` returns undelivered events. `deliverOutbox(store, sink)` calls `sink.accept(event)` then acknowledges each accepted ID. Delivery is at least once: the sink **must deduplicate by `event.id`**. If it fails, that and subsequent events remain pending. The adapter is an operator-only library contract, with no public raw-events/admin endpoint. A mimi-seed-sdk integration can implement this boundary independently without importing its noncommercial code. No external sink is configured or invoked here.

`npm run funnel` performs a local aggregate query by event name and distinct pseudonymous players. Browser aggregation is restricted to its own session. Funnel counts reflect attempts and may include repeated pending events; they are not billed transactions or unique conversions. A production retention/deletion policy remains a host integration decision.
