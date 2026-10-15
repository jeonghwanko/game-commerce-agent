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
WEBHOOK_TOTAL_VERIFY_LIMIT=100
OPENAI_API_KEY=<approved API key>
OPENAI_MODEL=<approved model with strict Chat Completions JSON Schema output>
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
5. Approve as the Sandbox buyer. The return URL alone grants nothing. Click **Verify / retry server capture**. It checks the provider approval and amount before capture, then re-reads completion.
6. If it says `AWAITING_WEBHOOK`, retain the session and wait for the registered provider callback. Use **Refresh verified status** after delivery. Only verified payment plus a signed completion notification may yield `GRANTED`.
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

AI attempt usage and webhook verification usage persist in `external_budgets`. New sessions/restarts cannot reset them. At the configured ceiling, requests fail closed with 429 and do not call the external provider. Concurrency is bounded per single application instance. If webhook verification is exhausted, keep grants pending; an authorized operator must review abuse and approve any ceiling increase before retrying actual events. Do not silently reset counters or expose a public administrative reset.

A process crash during capture leaves a five-minute operation lease. Wait for it to expire, then reconcile the same order; never clear the token to start a new charge. A cancelled or review order cannot initiate capture. A remotely completed payment after cancellation remains review-only.

Expected payee merchant must match `PAYPAL_MERCHANT_ID`. The adapter independently reads capture details and validates its parent order, amount, currency, status and final-capture marker. For refunds it reads the refund ID, extracts the allowed Sandbox capture relationship, and revalidates the original order/payee. Live Sandbox payload compatibility remains to be confirmed with approved credentials.
