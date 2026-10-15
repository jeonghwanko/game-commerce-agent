# Sandbox verification runbook

Status: mock unit, HTTP, transport-contract and browser paths are exercised. **Real Sandbox payment, real signed webhook delivery and real AI response are not yet verified.** Do not present mock output as PayPal/AI evidence.

## Prerequisites requiring owner action

Use an existing approved PayPal Sandbox application and approved AI account. Do not create credentials, expand scopes, subscribe to paid services, publish a tunnel, deploy or accept terms without owner authorization.

Configure `.env` locally (never commit it):

```dotenv
PAYMENT_PROVIDER=paypal-sandbox
PAYPAL_CLIENT_ID=<existing sandbox client id>
PAYPAL_CLIENT_SECRET=<existing sandbox secret>
PAYPAL_WEBHOOK_ID=<registered sandbox webhook id>
PAYPAL_MERCHANT_ID=<expected sandbox seller merchant id>
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PUBLIC_ORIGIN=https://<approved test origin>
AUTH_MODE=principal
AI_PROVIDER=openai
AI_ACCESS_ENABLED=true
AI_TOTAL_CALL_LIMIT=<explicitly approved total attempt ceiling>
WEBHOOK_WINDOW_VERIFY_LIMIT=100
OPENAI_API_KEY=<approved API key>
OPENAI_MODEL=gpt-4.1-mini-2025-04-14
DATABASE_PATH=./data/sandbox-commerce.sqlite
```

The standard CLI has no built-in principal verifier and therefore refuses real AI mode. Embed `createApp` with an `AuthenticatedPrincipalAdapter` backed by approved existing host authentication. Do not invent a development identity header or bypass principal verification. A host integration must supply real quest state; the anonymous fixture quest endpoint is disabled in principal mode. This is an outstanding integration prerequisite, not completed Sandbox E2E.

Use a separate database from mock runs. A persistent provider marker enforces this separation. Restart after changing provider configuration. Incompatible provider orders are rejected. Keep the Sandbox base URL unchanged in every NODE_ENV. Live credentials will not make the hardcoded Sandbox host become live.

A reviewer-approved HTTPS reverse proxy must deliver the exact configured Host to the loopback app and route `/api/paypal/webhooks` to it. Set up no proxy or exposure automatically. An existing approved Sandbox webhook registration must subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, and `PAYMENT.CAPTURE.REVERSED`; its ID must match the application credentials. Do not expose any developer CLI/gateway. Real payer approval must use a Sandbox buyer account distinct from the seller. Do not enter real card/account details in this fixture.

## Normal flow

1. `npm ci && npm run check`; run the approved host entrypoint that injects the verified-principal adapter. `npm start` remains the offline anonymous fixture by default.
2. Verify the UI displays `PAYPAL-SANDBOX` and `AI: OPENAI`. A provider config error must fail startup; it must not become mock silently.
3. Enter a non-sensitive goal and budget. Verify products come from the server catalog and no unlisted SKU appears. Real AI mode transmits goal/catalog/minimal quest state to OpenAI; no user ID, payment fields or conversation history are sent.
4. Review and explicitly confirm SKU, USD amount and contents. Continue to the Sandbox buyer approval page.
5. Approve as the Sandbox buyer. The return URL alone grants nothing. Click **Retry payment check**. It checks the provider approval and amount before capture, then re-reads completion.
6. If it says `AWAITING_WEBHOOK`, retain the session and wait for the registered provider callback. Use **Refresh saved status** after delivery. Only verified payment plus a signed completion notification may yield `GRANTED`.
7. Equip the outfit. The seal and rumor must still be missing until the host’s independent free quests are completed. The anonymous fixture has its own playable free quests; these are disabled in principal integration mode. Inspect `npm run funnel` locally; do not export payment records or credentials as demo evidence.

## Failure and recovery checks

- Cancel on PayPal: return to the same session; local order becomes cancelled. No grant. Remote payment after local cancellation must become `REVIEW`.
- Close the tab after approval: reopen in the same browser session; the latest pending order is restored. Retry server capture on that existing order.
- Timeout: do not create a fresh payment. Retry the existing order; server reads remote status before capture and uses stable idempotency keys.
- Missing webhook: check the registered Sandbox application/webhook ID and callback delivery, then resend the **original actual event** using approved PayPal tooling. A simulator event is not evidence that an actual order was paid. Do not manually mark webhook verification successful in SQLite.
- Duplicate/reordered completion: resend the actual completion event. There must remain one entitlement and one grant event.
- `CREATING` after five hours: stop automatic retries. Authorized operator must inspect the original request/provider ledger and reconcile before any new attempt. There is no unsafe automatic reset.
- Refund/reversal: a verified event holds rights, removes the paid outfit’s gameplay effect, and sets `REVIEW`. No automated refund/dispute API is implemented. Record the operator decision privately; restoration is a future controlled workflow.
- Server restart: keep the same persistent database and unexpired session cookie. Verify ownership and order status survive. Clearing the cookie does not constitute login; account recovery is not implemented.

Record only sanitized outcome/status, test timestamps and pass/fail in evidence. Do not publish credentials, buyer profiles, raw PayPal payloads or the private development brief. Real provider runs may reveal payload compatibility gaps; transport tests are stubs and cannot substitute for this checklist.

## References checked for implementation

- [Orders v2](https://developer.paypal.com/api/orders/v2): create, read and capture endpoints; PayPal-Request-Id for retries.
- [Webhook verification API](https://developer.paypal.com/api/webhooks/v1): verification endpoint and transmission headers.
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat): strict JSON Schema output and bounded completion request.
- [Official hackathon rules](https://paypalaihackathon.devpost.com/rules): actual PayPal Sandbox and AI integration, public executable open-source code, English materials and a video under three minutes. The stated deadline is November 12, 2026 at 12:00 PST / November 13 at 05:00 KST. Submission eligibility and final compliance remain the entrant’s review; no registration or submission has occurred.

## Budget and capture-operation recovery

AI lifetime cost and webhook abuse controls are separate. AI attempts never reset. Webhook verification has a durable 60-second fixed window (default 100 attempts, two concurrent requests). Invalid signatures consume attempts. Exhaustion returns 429 without granting rights or skipping verification. After cooldown, retry/resend the original actual event and perform full signature verification. Repeated invalid signatures followed by valid completion/refund after cooldown are tested. Sustained flooding can still delay valid events: isolate ingress and investigate abuse before public testing. Local certificate verification is not implemented; this is not DoS immunity.

All workers must share the **same local SQLite file**. Eight-worker tests exercise aggregate attempts/concurrency; multi-host/replicated databases remain unsupported. Separate DBs, deleted counters or old backup restoration bypass a local cap. Preserve the full ledger, including budget tables. `external_budget_policy` pins configuration; a silent ceiling/window/concurrency change fails startup.

`external_work` reservations have no expiry, preventing crashed workers from freeing capacity while their external requests may still run. Recovery: stop **all** workers, wait for external requests to end, investigate, back up the ledger, then remove only orphan `external_work` rows. Keep attempt counters, policy and payment state intact. Restart and resend actual events. No public reset endpoint exists. Tests exercise fail-closed orphan recovery.

A process crash during capture leaves a five-minute operation lease. Wait for it to expire, then reconcile the same order; never clear the token to start a new charge. A cancelled or review order cannot initiate capture. A remotely completed payment after cancellation remains review-only.

Expected payee merchant must match `PAYPAL_MERCHANT_ID`. The adapter independently reads capture details and validates its parent order, amount, currency, status and final-capture marker. For refunds it reads the refund ID, extracts the allowed Sandbox capture relationship, and revalidates the original order/payee. Live Sandbox payload compatibility remains to be confirmed with approved credentials.

## Controlled AI evaluation: prepared, not executed

The owner approved Sandbox setup and up to US$5 for AI evaluation. Configuration is being prepared separately. This iteration performed zero actual API calls. The process-presence check returned false for OPENAI_API_KEY, OPENAI_MODEL and all four PayPal credential/merchant variables. No secret values were printed.

`node scripts/evaluate-ai.js` performs zero-network preflight. Only after configuration readiness is confirmed: `node --env-file=.env scripts/evaluate-ai.js --live`, with `EVAL_CONFIGURATION_READY=true` and `DATABASE_PATH` set to the same persistent ledger used by the app. Do not set readiness speculatively.

The real transport reserves $0.05 **before** each attempt: 100 attempts maximum, one concurrent request, $5 lifetime envelope shared by HTTP/CLI/restarts. Failures consume their reservation; no automatic retry/refund/model fallback. Model: `gpt-4.1-mini-2025-04-14`; request JSON ≤16,000 UTF-8 bytes; output ≤250 tokens; no tools. At reviewed rates ($0.40/M input, $1.60/M output), treating every request byte plus 1,024 framing tokens as input costs < $0.008 per attempt, below its reservation. This cap covers this application's requests, not unrelated account activity. Pricing review expires October 22, 2026 and then fails closed. The model is currently documented as deprecated: availability must be confirmed, or a replacement model/price/token policy reviewed, before evaluation. No silent fallback.

[Official model pricing and snapshot](https://developers.openai.com/api/docs/models/gpt-4.1-mini), reviewed October 15, 2026. The harness contains 36 semantic cases and reports actual quality only in live mode; offline typed-response stubs are not model performance.

## Cloud Network secret OAuth header mode — proxy E2E unverified

[Cloud environments documentation](https://learn.chatgpt.com/docs/environments/cloud-environments#configure-environment-variables-and-network-secrets) says programs receive a placeholder and the proxy substitutes the real network secret for allowed HTTPS destinations on port 443. [PayPal OAuth documentation](https://developer.paypal.com/api/rest/authentication/) specifies Basic client authentication at `https://api-m.sandbox.paypal.com/v1/oauth2/token`. Therefore, encoding separate placeholder client credentials in the application may prevent substitution. The alternative interface supplies the **entire Authorization header value** as one opaque placeholder. This compatibility design is inferred from those two documented contracts; actual proxy replacement remains untested.

Choose exactly one mode:

- Direct client pair: `PAYPAL_CLIENT_ID` plus `PAYPAL_CLIENT_SECRET`, with the alternative unset. This legacy mode constructs Basic authentication in process and is intended for direct values, not independently substituted secret placeholders.
- Opaque header: `PAYPAL_OAUTH_BASIC_AUTH_HEADER` holds the entire header-value placeholder. Both client-pair variables must be absent/empty. The adapter passes this string unchanged to the fixed Sandbox token endpoint: no added `Basic`, trimming, Base64, URL encoding or `client_secret_post`. It rejects redirects and CR/LF/NUL input. The opaque value is private, absent from enumerable configuration, redacted in JSON/inspect diagnostics, and excluded from sanitized transport errors. It is never used on order/capture endpoints, which receive the returned Bearer access token instead.

User-only setup after the parent confirms readiness: open the environment's Network secrets editor; use key `PAYPAL_OAUTH_BASIC_AUTH_HEADER`, enter an already prepared complete OAuth Authorization value directly in the secure value field, and limit its destination to `api-m.sandbox.paypal.com`. Do not paste it into chat, source files, terminal commands, logs or this repository. Clear the separate ID/secret settings for this mode. The agent has not generated/converted a secret or changed configuration/network permissions. The user completes security prompts and login themselves. Saving a network secret may change allowed-domain policy, so review that setting explicitly.

The synthetic fetch test proves the exact string passed by this application, including absence of transformations. It does not certify the HTTP client/proxy's treatment of arbitrary whitespace or actual secret replacement. Use the platform-issued placeholder as supplied and prove the complete Sandbox OAuth path only after configuration-ready confirmation. No raw OAuth request headers should be logged during that proof.
