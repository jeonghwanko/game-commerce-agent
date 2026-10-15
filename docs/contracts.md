# Public bridge and event contracts

## Identity boundary

`AUTH_MODE=anonymous-demo` uses the seven-day, hashed HttpOnly `gca_session` cookie for an isolated demo player. Cookie recovery is not account recovery. SameSite=Lax and Secure on HTTPS apply. Exact Origin plus a session CSRF token protects browser writes.

`AUTH_MODE=principal` requires an injected `AuthenticatedPrincipalAdapter` and a host-owned `resolveVerifiedPrincipal(request)` function. It must validate the actual server login session on **every request**, including revocation, and return `{authenticated:true, issuer, subject, expiresAt, csrfToken}`. The adapter validates shape/issuer/expiry, hashes the stable issuer+subject tuple, and maps it to an opaque commerce player ID in this database. Different login sessions for the same verified account recover the same rights. Raw subject IDs are not placed in events. The host verifier is a trust boundary, not a token-verification implementation supplied by this repo.

No HTTP endpoint, `userId` query/body, identity header or development impersonation header can create a principal. `NODE_ENV=production` rejects anonymous startup. In principal mode, the anonymous session issuer and free fixture quest mutation route are unavailable; the host must retain its actual quest authority. No existing authentication database is read or modified. See the proposed integration impact document before a private-game PR.

Real AI additionally requires explicit access enablement and a positive persistent global attempt budget. New sessions and process restarts cannot reset the budget in the same database. AI and webhook verification have shared SQLite concurrency reservations. AI lifetime costs and webhook recoverable 60-second windows are separate. Keep this single-instance prototype isolated until host auth, deployment controls, retention, backups and reconciliation operations are approved.

## HTTP interface

| Method/path                                  | Input / result                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /api/session`                           | Issue/resume anonymous session; return CSRF token and explicit provider modes                       |
| `GET /api/commerce/catalog`                  | Active canonical SKU records, minor-unit prices and versions                                        |
| `POST /api/commerce/agent/recommend`         | `{goal, budgetMinor}` → server-validated goal plan, max two canonical products and free alternative |
| `POST /api/commerce/quotes`                  | `{sku}` → five-minute quote bound to session owner and catalog version                              |
| `POST /api/commerce/orders`                  | `{quoteId, sku, amount, currency, version, confirm:true}`; exact displayed quote required           |
| `GET /api/commerce/orders`                   | This session’s latest 20 orders                                                                     |
| `GET /api/commerce/orders/:id`               | Owned order status                                                                                  |
| `POST /api/commerce/orders/:id/capture`      | Inspect approval, capture using stable request ID, re-read payment                                  |
| `POST /api/commerce/orders/:id/cancel`       | Local cancellation before capture attempt                                                           |
| `POST /api/commerce/orders/:id/mock-approve` | Mock mode only; explicit simulated approval/capture/webhook                                         |
| `POST /api/paypal/webhooks`                  | Provider authentication through PayPal signature verification, not browser session                  |
| `GET /api/commerce/entitlements`             | Own rights, including held status                                                                   |
| `GET /api/game`                              | Original fixture wardrobe and three independent guard conditions                                    |
| `POST /api/game/equip`                       | `{sku}`; active server entitlement or free borrowed outfit required                                 |
| `POST /api/game/quest`                       | `{quest}`: seal, rumor or borrowed; anonymous fixture only                                          |
| `GET /api/analytics/funnel`                  | Own session event counts only                                                                       |

Catalog controls money, currency and effect; the model controls none of them. Quotes cannot be used by another session or changed after confirmation. A retry of the same confirmed quote returns/reconciles its existing order even after quote expiry. A new order requires an unexpired quote and unchanged catalog. Unknown/held entitlement cannot be equipped for a paid effect.

`src/contracts.d.ts` defines the provider, entitlement view, game bridge and event sink types. The host should query entitlements on login and after checkout, then compute its own existing quest predicates. Buying formal clothing must never automatically grant a seal or rumor.

## Persistence and failure semantics

SQLite is the single-host source of truth; no localStorage ledger exists. Unique provider order/capture IDs and `(user_id,sku)` rights prevent duplicate grants. Event, receipt and entitlement mutations run in one transaction. Provider I/O happens outside transactions. Budget reservations are tested across eight workers sharing one local SQLite file. Deployment support remains a single host; separate/replicated databases do not share these limits. No multi-region exactly-once claim is made.

A `CREATING` retry uses the same PayPal request ID, bounded to five hours (inside the default six-hour create idempotency window). Older uncertain creates require operator reconciliation and cannot be blindly retried. `CAPTURE_PENDING` retries inspect the existing provider order first. `AWAITING_WEBHOOK` is deliberately not ownership. Verified webhook processing re-reads the provider and matches local reference, order, capture ID, final status, exact amount and currency. Unknown provider orders return retryable 503; a webhook can arrive before local create commits. Signature failure returns 401. Irrelevant event types cannot grant.

Refund/reversal receipts are durable. Existing rights become held; future completion does not overwrite the hold. Late payment following cancellation/failure is review-only. An operator must resolve payment/rights discrepancies; the prototype does not automatically issue refunds or resolve disputes.

## OneSub boundary

The MIT `evaluateEntitlementFrom`, `evaluateEntitlement`, and `isSubscriptionEntitled` implementations are extracted from pinned OneSub commit `2b7dcd7ff5e21e252a7d8fdcf72769f651dc737f`. `src/entitlements.js` filters ledger records to active, verified, non-held rights owned by the current principal, then calls the extracted evaluator. `GameBridge` uses these evaluated rights for equip and dress checks. This is runtime reuse, not merely naming an interface.

[Third-party notices](../THIRD_PARTY_NOTICES.md) preserve provenance and the complete MIT license. Input declarations are platform-independent projections of fields the evaluator actually reads. No upstream query-based router or mobile SDK is copied; PayPal remains `paypal-sandbox`. Run `node scripts/verify-onesub.js /path/to/pinned/onesub` for 324 differential cases against the actual upstream source (no network in the script). Normal tests cover evaluator and wrapper behavior without another checkout.

## Privacy and outbox

Allowed rows are exactly `{id, user_id, order_id, name, at}` plus an internal delivery marker. Both user and order IDs are local opaque identifiers. Event names are allowlisted. There is no free-form metadata field, chat transcript, email, provider order ID, capture ID, token or card data in analytics. Payment reconciliation fields stay in the private ledger.

`Store.outbox(limit)` returns undelivered events. `deliverOutbox(store, sink)` calls `sink.accept(event)` then acknowledges each accepted ID. Delivery is at least once: the sink **must deduplicate by `event.id`**. If it fails, that and subsequent events remain pending. The adapter is an operator-only library contract, with no public raw-events/admin endpoint. A mimi-seed-sdk integration can implement this boundary independently without importing its noncommercial code. No external sink is configured or invoked here.

`npm run funnel` performs a local aggregate query by event name and distinct pseudonymous players. Browser aggregation is restricted to its own session. Funnel counts reflect attempts and may include repeated pending events; they are not billed transactions or unique conversions. A production retention/deletion policy remains a host integration decision.

## Capture and webhook race rules

`capture_operations` holds a unique operation token and five-minute lease. Acquisition and order transition are atomic. Concurrent capture returns 409; cancellation uses CAS and rejects while an operation exists. After each provider await, the token, lease, current status and review flag are rechecked. An expired operation can be replaced for reconciliation; its delayed response cannot overwrite the newer operation or initiate a capture. Stable provider request IDs still protect uncertain remote side effects.

`verified_webhooks` retains only signed, bounded event references, not raw provider payloads. A refund resource ID is never treated as a capture ID. Only a known Sandbox `rel=up` origin/path can yield a capture ID, and the adapter calls fixed API paths to verify refund → capture → order and the expected payee. No supplied URL is fetched. An early signed refund hold can block subsequent completion even before local order binding; known rights are held even if follow-up provider reads time out. Completed capture validation and grant/receipt/outbox writes are atomic in SQLite; external provider effects are reconciled separately.

Payment-provider mode is persisted in `environment`. Opening a database in another mode fails. Legacy databases are checked for incompatible order providers before marking; do not bypass this guard by deleting its marker.

## Intent interpretation and plan authority

The read-only interpreter returns exactly `{goals, style, avoidStyles, spending, clarify}`. Goals distinguish story entry from optional collection and can coexist. It has no action, SKU, money, principal or entitlement fields. Strict response schema, bounded output, no tools, refusal/truncation checks and runtime validation apply. The server planner then reads verified rights and host quest state, filters canonical products by budget/style/held rights, and creates only allowed actions. Loaned formal clothes solve story entry but do not suppress an explicit collectible purchase. State changes invalidate rendered plans; new recommendations require current server context. The offline parser remains a limited rehearsal substitute, not a claim of multilingual model accuracy.

`PAYMENT.CAPTURE.REVERSED` with `resource_type=refund` follows refund-ID → allowed capture link → fixed API correlation, just like refund-shaped REFUNDED. A capture resource remains distinct. Partial refund/reversal conservatively holds the complete cosmetic right for review. Late completion cannot undo a hold. Unknown resource types fail closed.

Official [PayPal event names](https://developer.paypal.com/api/rest/webhooks/event-names/) link REVERSED to the refund operation; the [Payments v2 schema](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/payments_payment_v2.json) supplies refund/capture resources. The reported [WooCommerce #1614](https://github.com/woocommerce/woocommerce-paypal-payments/issues/1614) is a compatibility regression input, not a replacement for signature/API validation. Tests use synthetic IDs and Sandbox origins, with no private payer fields copied.
