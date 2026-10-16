# User-operated Sandbox payment: prepared, not executed

**Evidence boundary:** the user reported local Sandbox OAuth HTTP 200 / success on October 16, 2026 at 23:07 KST. This is a user report, not an independently observed run. It does not establish cloud credential injection, merchant identity, Orders API compatibility, signed webhook delivery, capture or outfit ownership. This change makes zero actual PayPal/OpenAI requests. AI stays **mock**. No deployment, tunnel, registration or new credentials are included.

## Exact product and seller contract

| Product             | Server SKU         | Test amount                   | Gameplay                                                                  |
| ------------------- | ------------------ | ----------------------------- | ------------------------------------------------------------------------- |
| Rosalyn Gala Outfit | `rosalyn-gala`     | USD **1.99**, 199 minor units | Violet/gold collectible; same formal dress check as free borrowed clothes |
| Traveler’s Cloak    | `rosalyn-traveler` | USD **0.99**, 99 minor units  | Teal collectible; does not meet formal dress check                        |

Use Gala for the first single-order demonstration. The server-issued expiring quote, confirmation and provider order must all match SKU, minor amount, currency and catalog version. No discounts/savings are claimed. Both seal and rumor remain separate free quests. Previewing grants nothing.

There is **no verified real merchant ID in the repository**. `FAKE-SELLER` / `MERCHANT` in tests are synthetic, never account configuration. The user must obtain the expected Sandbox seller merchant ID from their existing approved seller account and confirm it belongs to the selected app. The adapter includes it as the payee and independently checks returned order/capture relationships. Client ID, merchant ID and webhook ID are not interchangeable.

## Stop conditions before any request

Run only this public offline check first (Node 24+ already installed):

```sh
node src/sandbox-demo.js --check
```

It neither reads credentials nor opens a database/listener nor probes APIs. `actualProviderVerified: false` is intentional. Running without arguments does the same check. Missing Node or execution-policy restrictions are blockers; no installation or bypass is included.

Do not start the payment server until the operator has ALL of these:

- Existing approved Sandbox app credentials or complete OAuth Basic header, handed off directly by the user through a masked input in the execution process. Never send them to an agent/chat, source file, `.env`, argument, command history or log for this walkthrough.
- Actual expected `PAYPAL_MERCHANT_ID` and existing `PAYPAL_WEBHOOK_ID` for that app.
- **Existing approved HTTPS origin and webhook ingress**, forwarding its exact Host to the loopback server and `/api/paypal/webhooks` without the demo browser Basic-auth challenge. The application itself verifies PayPal webhook signatures. Registration must include completed, refunded and reversed capture events.
- Operator confirmation that the existing route/registration is ready (`SANDBOX_WEBHOOK_ROUTE_READY=true`). This is an attestation, not proof of delivery. If absent, stop; this task does not authorize creating a tunnel, deploying, expanding network access or registering a new webhook.
- Existing independent demo login (`DEMO_ACCESS_USER`, ASCII letters/numbers/underscore/hyphen; existing password at least 24 characters). No identity provisioning is performed.
- A separate persistent Sandbox database, all workers using the same local file. Do not reuse a mock DB, delete budget tables, or change merchant/account against an existing ledger.
- A distinct Sandbox buyer account with test funds. Never use live PayPal, real cards or real money.

Without the webhook route/ID, the full requested demo is **blocked**. OAuth or capture alone never grants an entitlement. Do not use a simulator event, fabricated callback, SQLite edit, mock-approve route or signature bypass to complete a real-provider order.

## 사용자 직접 시작: 비밀값은 실행 중인 프로세스 메모리에만

아래는 **이미 승인된 실행 호스트**에 저장소와 Node 24+, PowerShell 7이 있을 때만 사용하는 선택 안내입니다. 이번 구현은 기존 클라우드에서 수행했고 사용자 PC로 이전하거나 아래 코드를 실행하지 않았습니다. 실행 호스트/HTTPS 경로가 승인되지 않았다면 여기서 중단합니다. PowerShell 미설치·정책 차단 시 설치하거나 우회하지 않습니다. 이 PowerShell 시작 예시는 클라우드에 실행기가 없어 런타임 검증하지 못했습니다.

녹화·화면 공유·Transcript가 켜져 있으면 진행하지 마세요. 이 안내는 기록 기능을 끄지 않습니다. 저장소 폴더에서 새 PowerShell 7 창을 사용합니다. 비밀을 코드에 직접 써넣지 말고 실행 후 마스킹 입력란에만 붙여넣습니다. 도우미의 **전체 Basic 값**을 그대로 사용합니다. 실제 비밀값이 명령 인수나 사용자 프로세스 환경변수에 들어가지 않도록, 자식 Node 프로세스의 환경 사본에만 전달합니다. Node는 실행되는 동안 인증값이 필요합니다. 종료 후에도 메모리의 물리적 완전 삭제를 보장하지 않으며 클립보드는 별도로 정리해야 합니다.

```powershell
# PowerShell 7; user execution only. Do not run under recording/Transcript.
$start = [Diagnostics.ProcessStartInfo]::new()
$child = $null
try {
    $start.FileName = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    $start.UseShellExecute = $false
    $start.WorkingDirectory = (Get-Location).Path
    $start.Environment.Clear()
    $start.Environment['SystemRoot'] = [Environment]::GetEnvironmentVariable('SystemRoot')
    $start.Environment['PAYMENT_PROVIDER'] = 'paypal-sandbox'
    $start.Environment['AI_PROVIDER'] = 'mock'
    $start.Environment['SANDBOX_DEMO_HOST_ENABLED'] = 'true'
    foreach ($name in @('PUBLIC_ORIGIN', 'PAYPAL_MERCHANT_ID', 'PAYPAL_WEBHOOK_ID',
                        'DEMO_ACCESS_USER', 'DATABASE_PATH')) {
        $start.Environment[$name] = Read-Host $name
    }
    # DATABASE_PATH must be a dedicated persistent SQLite path; PORT defaults to 3000.
    foreach ($name in @('PAYPAL_OAUTH_BASIC_AUTH_HEADER', 'DEMO_ACCESS_PASSWORD')) {
        $masked = $null; $ptr = [IntPtr]::Zero
        try {
            $masked = Read-Host "$name (masked; no recording)" -AsSecureString
            $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($masked)
            $start.Environment[$name] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        } finally {
            if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
            if ($null -ne $masked) { $masked.Dispose() }
            $ptr = [IntPtr]::Zero; $masked = $null
        }
    }
    $answer = Read-Host 'Existing approved HTTPS webhook route ready? Type START SANDBOX to allow requests, Enter to cancel'
    if ([string]::Equals($answer, 'START SANDBOX', [StringComparison]::Ordinal)) {
        $start.Environment['SANDBOX_WEBHOOK_ROUTE_READY'] = 'true'
        foreach ($arg in @('src/sandbox-demo.js', '--start', '--confirm-sandbox-requests')) {
            $start.ArgumentList.Add($arg)
        }
        $child = [Diagnostics.Process]::Start($start)
        $start.Environment.Clear()
        $child.WaitForExit()
    }
} catch {
    Write-Host 'sandbox_start_failed: stop and review prerequisites; do not share raw errors or credentials.'
    [void]$Error.Remove($_)
} finally {
    $start.Environment.Clear()
    if ($null -ne $child) { $child.Dispose() }
    $child = $null; $start = $null; $answer = $null
}
```

`START SANDBOX` 이외에는 자식 프로세스를 시작하지 않습니다. 명시적으로 시작해도 startup preflight는 OAuth/API를 호출하지 않습니다. 이후 인증된 사용자가 구매/결제 확인을 누르거나 실제 webhook이 도착하면 provider 요청이 발생합니다. 따라서 승인된 경로 외에 공개하지 마세요. 서버는 loopback에만 바인딩합니다. 이 예시는 새 credential이나 OAuth grant를 생성하지 않습니다. 취소·실패 시 자동 재시작하지 않으며, 서버 중단 시 실행 중인 Node 프로세스가 종료됐는지 사용자가 확인해야 합니다.

An operator with an already approved **memory-only** secret launcher can instead run `node src/sandbox-demo.js --start --confirm-sandbox-requests` through that launcher. Do not use `npm start` or `--env-file` for this walkthrough. The entrypoint rejects OpenAI mode instead of silently enabling billable AI; the underlying `createApp` integration remains available for separately authorized AI work.

## One-order walkthrough using the existing UI

1. Open the existing approved HTTPS origin; authenticate with the independent demo login. Confirm `PAYPAL-SANDBOX` and `AI: MOCK`. No provider request is needed for session/catalog/preview. Do not record the login prompt.
2. Approach Rosalyn, choose the evening-gathering goal and review free formal borrowing versus optional Gala collection. Preview the violet/gold coat and NPC reactions. Confirm the **Gala / USD 1.99** server quote explicitly; this creates the test order. Buyer approval and capture have not occurred yet.
3. Follow that order's Sandbox PayPal approval link and approve using the separate Sandbox buyer. A return URL is not payment evidence. Do not start another purchase after a timeout.
4. Back in the same authenticated browser, choose **Retry payment check** for that saved order. The server verifies approval, amount, merchant and order/capture correlation, then captures with its stable idempotency key.
5. If **Waiting for verified payment notification** (`AWAITING_WEBHOOK`), choose **Refresh saved status** after the real registered completion webhook arrives. This read-only status refresh does not retry capture. Missing/invalid notifications leave ownership empty. Stop and report only sanitized status; do not fabricate a callback.
6. Once granted, equip Gala. The appearance and formal dress condition change; seal/rumor remain missing. Complete those two free NPC quests, then talk to the guard. Borrowed formal clothing supports exactly the same story route without purchase.

Recovery example for the eventual video: close/reopen after approval, restore the **same saved order**, and use the existing payment check. For lost create responses use **Resume confirmed purchase**, preserving the confirmed quote/idempotency key. For a cancelled order do not retry capture. Keep the persistent DB and same demo login on restart; do not edit the ledger. Capture retry leases, duplicate notifications, amount/merchant checks and revocation behavior are unchanged.

## Offline evidence and remaining proof

`test/sandbox-readiness.test.js` runs the **actual PayPal adapter + principal demo + HTTP routes + SQLite** against a strictly fake fetch implementation. It verifies zero startup requests, opt-in/route/persistence guards, no mock approval on the real-provider route, pending ownership denial, simultaneous capture checks, invalid then valid synthetic webhook verification, restart/re-login recovery, duplicate grant prevention, amount/merchant rejection and cancellation. These are transport-contract tests, **not actual signatures or Sandbox E2E**. Existing provider tests separately cover parent-order/capture mismatch, refunds/reversals, retry failures and malicious links. Existing Chromium smoke covers the public scene and authenticated free route using mock payment only.

Actual app/merchant mapping, HTTPS routing, buyer approval UX, real capture payloads, real signature verification/delivery, paid outfit grant and cloud secret injection remain unverified. No actual AI model was called. A future evidence record should contain timestamp, commit, product/amount/currency and sanitized pass/fail only—never headers, tokens, buyer profiles or raw provider payloads.
