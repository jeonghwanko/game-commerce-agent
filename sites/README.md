# Sites adapter — offline verified, hosted deployment blocked

This is a separate asynchronous Worker/D1 adapter for the existing public game, not a relaxation of the Node host's production guard. It reuses the canonical catalog, interpretation/planning functions, projected outfit/NPC previews, OneSub MIT entitlement evaluator, public scene/UI and actual Sandbox PayPal adapter. The Node HTTP/SQLite server remains unchanged. The shared PayPal adapter uses the standard inspection symbol instead of importing Node's inspection utility; recommendation response construction is now a shared transport-free function.

## Registered Site and current state

- Project: `appgprj_6ad23bbbedec81919b019e1bfe96fd0f`.
- Slug: `rosalyn-game-commerce-agent`.
- Creation returned expected URL: `https://rosalyn-game-commerce-agent.turbo08.chatgpt.site` — **not a live/deployed URL**.
- Current tool-confirmed access: `custom`, owner role, one allowed user, no groups. Supported access modes: `custom`, `public`.
- No version, Worker deployment, hosted migration, public access change, credentials, grant, webhook registration or provider requests were made for this adapter.
- Registration/manifest resides at `/workspace/sites/game-commerce-agent/.openai/hosting.json` in the existing cloud workspace. Keep the exact project ID; do not register another Site to recover this one.

The Sites skill requires its `project-setup.mjs`, `site-workflow.mjs` and supported build integration. No installed copies were found in this selected environment. Reading the indicated helper paths via the skill resource API returned **`failed to read skill resource`**; required starter files including `vite.config.ts`, `app/chatgpt-auth.ts` and `drizzle.config.ts` were likewise unavailable, although the skill/reference Markdown and package manifest were readable. We did not replace that workflow with a custom deployment or download a different environment. Recover the supported Sites plugin/helper installation in this same environment before packaging or publishing. The retained hosting manifest leaves `d1`/`r2` null until the supported starter can declare/validate the `DB` binding and migration metadata.

`node scripts/export-sites-source.js /workspace/sites/game-commerce-agent` creates a **source handoff**, preserving the registered manifest. It copies only the public transitive modules, schema SQL and MIT notices, embeds the existing UI assets in a JavaScript module, and emits an ESM `worker/index.js` importing them. It is not a build artifact, not the starter's single-file Worker build, and not ready for `save_site_version`. The supported Sites builder still needs to bundle the imports, retain its integration, declare `DB`, generate/inspect migration metadata and package the exact synchronized source. Do not upload a handcrafted archive as if those steps had passed.

## Owner access before public ingress

Sites dispatch owns ChatGPT sign-in and injects the Site-scoped `oai-authenticated-user-id`. The adapter uses that ID, never a query/body `userId`, email, bearer bypass credential or arbitrary developer header. `SITES_OWNER_USER_ID` is an explicit server-side equality allowlist. Missing configuration fails closed. No first-visitor enrollment or new authentication stack is implemented.

All game HTML/JS/CSS and game/order APIs require the configured owner. Anonymous `/` returns only a sign-in page with a top-level `/signin-with-chatgpt?return_to=%2F` anchor; it does not serve the game. Anonymous application APIs fail 401, other signed-in IDs fail 403. JSON writes additionally require exact Origin plus a one-hour server-side CSRF value. API responses and protected assets are no-store.

A non-game, signed-in `/api/setup/identity` readout returns only the current visitor's own Site-scoped ID. It does not store/bind that ID or grant access. While the Site is still **owner-private**, its owner can read that value and enter it directly in Settings as `SITES_OWNER_USER_ID`. Account-level IDs in `get_site`, emails and local test identities must not be substituted. After binding, verify owner success, anonymous denial, a second user's denial, forged-header stripping at Sites dispatch, protected asset denial and CSRF rejection on the actual private deployment. Local Request tests only simulate trusted dispatch headers; they do **not** establish hosted header spoof protection. Do not expose a direct Worker ingress that bypasses dispatch.

**Do not make the Site public before those hosted access checks pass.** Then the already-authorized public HTTPS audience can be selected, retaining application owner checks. Only `POST /api/paypal/webhooks` is an anonymous business endpoint; it must verify the signature and provider/capture/order details before any grant. Do not put browser-login middleware in front of that callback, and do not expose an alternate unsigned callback. A private Site cannot receive PayPal's anonymous notifications.

## Settings the user enters directly

The [official Sites settings documentation](https://learn.chatgpt.com/docs/sites/managing-a-site) describes **More actions → Settings** at `https://chatgpt.com/sites` for runtime environment values. The actual input widgets have not been inspected here. Never send secret values through chat, tool arguments, source, files, logs or a custom collection form. No environment-value read/update tool was called. Source repository credentials returned by registration were not printed or written to disk.

| Name                                       | Purpose / default                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUBLIC_ORIGIN`                            | The Site's exact HTTPS origin above, once confirmed by supported deployment.                                                                                       |
| `SITES_OWNER_USER_ID`                      | Owner's Site-scoped ID from the private setup readout; server allowlist, not an API key.                                                                           |
| `PAYMENT_PROVIDER`                         | Initially omit or `unconfigured`: free quests and previews work; purchase requests fail closed. `mock` is only an explicitly selected rehearsal ledger.            |
| `SANDBOX_PAYMENTS_ENABLED`                 | Omit/false initially. `true` allows Sandbox requests only after user configuration readiness and hosted access verification.                                       |
| `PAYPAL_MERCHANT_ID`                       | `XB5RWXEAFHG8J`, supplied by the user as non-secret metadata. Account/app ownership and actual returned payee remain unverified.                                   |
| `PAYPAL_WEBHOOK_ID`                        | ID of a real registration for this existing Sandbox app and this Site's `/api/paypal/webhooks`. Registration is currently empty: **blocked**. Do not invent an ID. |
| `PAYPAL_OAUTH_BASIC_AUTH_HEADER`           | Secret: entire prepared Basic Authorization value, entered directly by the user in Sites Settings. Forwarded unchanged to the fixed Sandbox token endpoint.        |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Alternative direct pair, mutually exclusive with the whole-header mode. Do not configure both modes. Prefer the already prepared whole header.                     |
| `PAYPAL_BASE_URL`                          | Omit; only `https://api-m.sandbox.paypal.com` is accepted if supplied.                                                                                             |
| D1 binding `DB`                            | Provisioned/configured by the supported Sites workflow, not a pasted credential. Stop if a paid provisioning step or new permission is required.                   |

There is no OpenAI setting to supply for this phase: recommendation is **mock**, with no AI transport in the Worker dependency graph. No provider traffic occurs on import, UI load, session, preview or free quests. Missing Sandbox enablement blocks even the anonymous callback before OAuth. Keys are read only by the configured payment path after owner checks (or the explicitly enabled webhook path).

A provider+merchant marker binds purchase data to its environment. Never switch a mock ledger to real Sandbox or a seller to another seller; this fails closed even on game reads so mock rights cannot survive a mode change. The default `unconfigured` free path creates **no payment marker or mock entitlements**, so later first-time Sandbox configuration can preserve free story progress. If a mock ledger was deliberately used, a separately provisioned empty payment/demo database is required; do not delete the marker or rights to evade the guard.

## D1 authority and migration

`migrations/0001_commerce.sql` is schema-only. No request handler issues CREATE/ALTER or SQL BEGIN/COMMIT. An installed Sites/Vinext migration pipeline must still generate/inspect its metadata before hosted application; this SQL has only run in local SQLite contract tests, not on hosted D1.

[D1 documents batch transactions and rollback](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). The adapter uses one statement per `prepare`, first-primary D1 sessions, conditional writes, unique active-purchase/quote/capture/entitlement constraints and atomic batches. A transaction-local CHECK assertion turns a failed settlement CAS into a full rollback. External network awaits are outside SQL batches; the durable lease is rechecked afterward.

- Quote: canonical SKU, owner, amount, currency, version and five-minute expiry; explicit matching consent only.
- Create: one active purchase per owner/SKU, stable order/request key, five-hour resume ceiling; late create responses cannot undo cancellation.
- Capture: five-minute durable lease, compare-and-swap state/lease token, no stale CREATED downgrade, no capture from cancelled/review state. A crash leaves a lease; wait and reconcile the same order, never reset the ledger.
- Settlement: provider owner/reference, price/currency, expected merchant, final capture and parent-order validation. Grant requires both server capture verification and verified completion webhook. Grant, receipt and grant outbox event commit atomically, once.
- Refund/reversal: persist signed holds before correlation awaits; only allowlisted Sandbox capture paths are interpreted. No arbitrary link fetch. Existing rights are held and equipped paid effects removed, including when refund lookup fails or late completion arrives.
- Webhook abuse: durable 60-second / 100-attempt window and two concurrent signature verification requests across instances. Slot lasts through OAuth/verification body parsing; invalid signatures spend attempts. Cooldown permits full verification again. Crash-orphan slots fail closed and require coordinated operator recovery; there is no public reset API.
- Free quests: server-generated principal-bound expiring dialogue challenges, consumed once in a batch. Free borrowing is not ownership. Seal and rumor cannot be purchased or awarded by previews. OneSub's MIT evaluator gates usable paid rights exactly as in the Node app.
- Outbox: pseudonymous ID, event name, order correlation and timestamp only; no raw chat, identity/email, payment payload or credentials.

## Offline checks and remaining evidence

`node --test test/sites-d1.test.js` exercises actual SQLite SQL through an asynchronous D1 contract fixture, atomic rollback, competing requests, restart/reopen, refunds, signature failures, and the actual Sandbox adapter against fake HTTP responses. Existing `npm run check` retains Node-server payment/security regressions. Chromium adds the same original UI against the Worker/D1 fixture with synthetic identity: unconfigured purchase preview, zero quotes/orders/rights, 390px/200% layout, Tab/Enter free story and restart. These are not hosted D1/Cloudflare, real ChatGPT authentication, real signatures or Sandbox payment evidence.

The user's reported local OAuth HTTP 200 is the only real authentication evidence supplied. It does not establish this Site's credential injection, merchant/app match, approval, capture, webhook delivery or entitlement grant. Actual Sites deployment, migration behavior, owner identity binding/header stripping, public callback delivery, real Sandbox E2E and real AI remain unverified. No existing service was changed, PR merged, cost authorized or public deployment performed.
