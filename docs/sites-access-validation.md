# Sites identity and controlled public validation

Review date: 2026-10-16. Application baseline: PR2 commit
`6246cc6af8c583ebfa175b5876748bac2970bcff`, reported to match application
modules in saved source `55945400589a693c8e17ddff4a648566c118311b`.
No deployed source or settings were changed by this review.

## Supported design and trust boundary

The approved single-Site design is supported by the documented Sites contract:
public HTTPS ingress with optional platform ChatGPT sign-in; owner-only game,
assets and order APIs; one anonymous signed webhook endpoint. A new receiver or
new Site is not required or authorized.

- [Official public Sites sign-in guide](https://learn.chatgpt.com/docs/sites/data-and-connections): public Sites can offer optional ChatGPT sign-in, and authorization belongs on the server.
- Sites plugin `1.0.0`, release `pluginrel_6ac8f24d12588191ad46014b1c577b22`, official MCP resource `plugin://plugin_connector_1p_689987207de08191979cf68eca2941c6/bundle`, was read without running the source helper.
- `skills/sites/references/identity-and-secrets.md`, Request Identity: dispatch supplies a stable Site-scoped ID and email; public anonymous requests have neither. Sign-In: dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`; use a top-level anchor and authorize server-side.
- `skills/sites/templates/vinext-starter/app/chatgpt-auth.ts`, `getChatGPTUser()`: returns null unless both ID and email are present. It reads dispatch headers; it does not verify a separate JWT in application code. The Worker now follows this presence contract, but only exact `SITES_OWNER_USER_ID` equality grants access. Email/name never grant ownership.
- The starter README, Optional Dispatch-Owned ChatGPT Sign-In, assigns OAuth cookies and identity header injection to dispatch. The development plugin explicitly strips incoming identity headers before local mock injection; that is **development** code, not evidence of production dispatch stripping.
- `scripts/site-workflow.mjs` opens verified Site source with a credential and can commit/push in publish mode. It was inspected, not executed: this task does not authorize credential creation, source synchronization or publication.

Hosted dispatch implementation is not in the bundle. The docs establish the
intended trusted-header contract; they do not constitute a live adversarial
test of header sanitization. Neither checking both headers nor wrapping their
read in a helper can distinguish a verified tuple from an identical forged tuple
on direct Worker ingress. Therefore never expose the full Worker outside Sites
dispatch. Do not invent another OAuth stack or accept client identity claims.

## Changes and tests

Relative to the baseline: require the complete dispatch identity pair; reject
CSRF values whose one-hour lifetime expires during an awaited database read.
New deterministic tests cover missing/wrong CSRF, missing/null/foreign Origin,
expiry at the exact boundary, rotation, restart, an in-flight expiry, owner
rebinding/session isolation, alternate header/cookie/bearer identity claims,
duplicate/case-altered principal values, both query/body identity spellings, and
disabled anonymous webhook ingress without accessing secret properties or using
transport. All fixtures are synthetic; they prove application behavior only.

The new tests failed on the original code in three places (ID-only root,
ID-only setup, CSRF expiry during a database wait), then passed after the fixes.
The targeted suite has 22 passing tests. An anonymous public request without
identity still gets the minimal sign-in page on `/` and 401 JSON on APIs/assets.
The setup readout returns only the authenticated visitor's own Site ID; it never
enrolls that visitor, creates a session or grants game access.

## Controlled validation sequence, all paid traffic disabled

These are future operator actions, not changes made by this branch. Keep the
current Site private until the local checks and a supported private deployment
are separately authorized. Preserve the exact existing project and its database.

1. Verify the owner path in the normal signed-in browser after a later private
   deployment. Keep payment mode unconfigured, Sandbox enablement false, and
   AI external requests disabled. Never export cookies, tokens or secret values.
2. Before the separately authorized public-mode validation, temporarily leave
   `SITES_OWNER_USER_ID` unset through the owner's Settings UI, retaining the
   correct value privately. Confirm even a signed-in visitor cannot retrieve
   game/assets/orders (503). This deliberately closes all protected content
   while testing the public dispatch boundary. Setup readout remains available.
3. On this same Site, in a controlled public window, request
   `/api/setup/identity` anonymously with no identity, ID alone, email alone,
   both forged headers, mixed-case headers and duplicate identity headers.
   Every case must return application 401, never echo the synthetic ID. With a
   normally signed-in browser, forged headers must not replace the visitor's
   verified identity. Record comparisons/statuses, not real identity values.
   Any spoof acceptance means restore private access immediately, retain the
   unset owner binding and stop. Do not fix it by trusting another client header.
4. Only after dispatch passes, restore the real owner binding through Settings.
   Confirm owner success, anonymous 401, genuine signed-in non-owner 403,
   protected asset denial and no-store responses. Exercise missing/wrong/expired
   CSRF and foreign/missing Origin from the owner session without exporting its
   material. Use the recommendation endpoint with invalid input to distinguish
   CSRF rejection (403) from subsequent input validation (400) without purchases.
5. The unsigned anonymous webhook must reach the application and return 503
   `payments_not_configured` while payments are disabled. This proves routing,
   not signature verification. Keep the approved public owner-only architecture
   only after all intended-layer checks pass. Real webhook registration,
   signature verification, payment/AI enablement and costs are later phases.

Earlier live probes returned 401 HTML at the private gate, so they do not replace
steps 3–5. No public switch, credential/settings change, provider call, merge or
deployment occurred in this task.
