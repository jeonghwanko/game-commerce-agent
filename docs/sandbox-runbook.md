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
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PUBLIC_ORIGIN=https://<approved test origin>
AI_PROVIDER=openai
OPENAI_API_KEY=<approved API key>
OPENAI_MODEL=<approved model with Chat Completions JSON output>
DATABASE_PATH=./data/sandbox-commerce.sqlite
```

Use a separate database from mock runs. Restart after changing provider configuration. Incompatible provider orders are rejected. Keep the Sandbox base URL unchanged in every NODE_ENV. Live credentials will not make the hardcoded Sandbox host become live.

A reviewer-approved HTTPS reverse proxy must deliver the exact configured Host to the loopback app and route `/api/paypal/webhooks` to it. Set up no proxy or exposure automatically. An existing approved Sandbox webhook registration must subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, and `PAYMENT.CAPTURE.REVERSED`; its ID must match the application credentials. Do not expose any developer CLI/gateway. Real payer approval must use a Sandbox buyer account distinct from the seller. Do not enter real card/account details in this fixture.

## Normal flow

1. `npm ci && npm run check && npm start`.
2. Verify the UI displays `PAYPAL-SANDBOX` and `AI: OPENAI`. A provider config error must fail startup; it must not become mock silently.
3. Enter a non-sensitive goal and budget. Verify products come from the server catalog and no unlisted SKU appears. Real AI mode transmits goal/catalog/minimal quest state to OpenAI; no user ID, payment fields or conversation history are sent.
4. Review and explicitly confirm SKU, USD amount and contents. Continue to the Sandbox buyer approval page.
5. Approve as the Sandbox buyer. The return URL alone grants nothing. Click **Verify / retry server capture**. It checks the provider approval and amount before capture, then re-reads completion.
6. If it says `AWAITING_WEBHOOK`, retain the session and wait for the registered provider callback. Use **Refresh verified status** after delivery. Only verified payment plus a signed completion notification may yield `GRANTED`.
7. Equip the outfit. The seal and rumor must still be missing until their free fixture quests are completed. Inspect `npm run funnel` locally; do not export payment records or credentials as demo evidence.

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
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat): JSON output mode and bounded completion request.
- [Official hackathon rules](https://paypalaihackathon.devpost.com/rules): actual PayPal Sandbox and AI integration, public executable open-source code, English materials and a video under three minutes. The stated deadline is November 12, 2026 at 12:00 PST / November 13 at 05:00 KST. Submission eligibility and final compliance remain the entrant’s review; no registration or submission has occurred.
