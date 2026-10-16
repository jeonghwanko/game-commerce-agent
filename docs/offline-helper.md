# Offline PayPal Sandbox setup helper

[Download the single HTML file](../tools/paypal-oauth-helper.html) using GitHub's **Download raw file** control, then open the saved `.html` in a browser. No installation, conversion website, command, application server or internet connection is needed. Korean instructions are embedded in the file. This tool is separate from the game and is not served by the commerce server.

The **user** supplies their Sandbox Client ID and Secret in two password fields. “인증값 만들기” computes `Basic ` followed by Base64 of the exact ASCII `clientId:secret` string. Base64 is reversible encoding, not encryption. Nothing is copied automatically. “인증값 복사” requests clipboard access; if the API is missing or rejects the request, a separate “수동 복사용 값 표시” button reveals a selectable read-only field only after another explicit action. “값 숨기기” clears that visible field. “모두 지우기” resets inputs, result, pending UI state and retained authorization variable. Edits invalidate the old result; page hide/restore also clears values. An older clipboard promise cannot restore a result after clearing or editing.

Paste the complete value directly into the environment's secure Network secret editor for `PAYPAL_OAUTH_BASIC_AUTH_HEADER`. Leave the separate `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` settings empty in that mode. Do not add another `Basic`, re-encode it, paste it into chat, or save it to source/logs. The helper does not configure the environment, contact PayPal, validate credentials, or establish Cloud Network proxy compatibility. No new account, credential, deployment or actual API call is performed by this work.

## Input and privacy contract

- Each value must contain 1–4096 printable ASCII characters (`!` through `~`). Empty values, any whitespace (including leading/trailing spaces, tabs and newlines), controls and non-ASCII characters are rejected. Nothing is trimmed or silently normalized.
- Client ID cannot contain `:` because it is the Basic username delimiter. Secret may contain `:` and preserves it exactly.
- Raw paste data is checked **before** a password field can silently strip CR/LF. Invalid paste is cancelled, that field is cleared, the previous result is invalidated, and a text error explains what happened. Invalid programmatically assigned values are also rejected at generation. Input errors do not echo supplied values.
- The file contains no external scripts, fonts, images, links, network APIs, telemetry, browser storage, cookies or service workers. Hash-based CSP permits only the embedded script/style and denies connections, images, fonts, objects, frames, workers, forms, manifests and base URLs. No third-party dependencies are added.
- The normal UI never renders the generated secret. Clipboard exceptions are replaced by fixed text. Copy requires an explicit user action; the manual fallback requires a further explicit disclosure action.
- Clearing discards page-held values; it **does not guarantee physical erasure** from browser/OS memory. A completed or already-started clipboard write may leave a value in the system clipboard. The helper does not read or automatically overwrite that clipboard. Decline password-manager save prompts. Browser extensions and OS clipboard history are outside the page's control.

## Reproducible verification (synthetic data only)

```sh
node --test test/offline-helper.test.js
npm run test:helper
# On a browser/environment that permits local HTML navigation:
node scripts/offline-helper-browser.js --file
npm run check
npm run format:check
```

The nine focused Node tests execute the actual embedded script with a DOM harness and check exact encoding, delimiter handling, maximum lengths, empty/whitespace/control/Unicode rejection, raw CRLF paste, edits, absent/denied clipboard, explicit fallback/hide, clearing, delayed clipboard success/failure, lifecycle clearing and CSP hashes. The browser test uses Chromium with a temporary profile and a stub clipboard; it never reads or writes the system clipboard. Fake data is the only input. No PayPal or OpenAI code/API is invoked by this harness.

Verified in cloud Chromium: real pointer and Tab/Enter actions for generate/copy/fallback/hide/clear/error states, desktop and 390px layout, 200% browser text sizing, and 195px effective-width reflow. Screenshots contain fake data only and stay under `/tmp/offline-helper-*.png`. Missing/denied/delayed clipboard modes are injected API stubs; CRLF paste is a synthetic ClipboardEvent to avoid touching the host clipboard. This is not a claim of testing native clipboard permission dialogs, an actual phone, or all browser engines.

The default browser harness serves the exact unchanged HTML once on loopback. The page makes no additional network requests. Test-only hostile fetch, WebSocket, image, script, frame, font, worker and form probes point at a local tripwire; CSP violations are observed and zero requests arrive. Untrusted inline script is also blocked. The production HTML has none of those probes or a dependency on this test server.

**Local-file verification limit:** this cloud's managed Chromium rejects `file://` with `net::ERR_BLOCKED_BY_ADMINISTRATOR`, even for a synthetic HTML file. Its policy was not changed. Loopback browser QA and static self-containment checks pass; direct `file://` execution in the user's browser remains unverified. The `--file` mode fails explicitly if local navigation is blocked. Real Sandbox OAuth, Cloud Network substitution, real AI and real credentials remain untested here.

After editing the inline script or style, format the HTML first, then update its matching SHA-256 CSP hash. The focused test rejects stale hashes; never relax the CSP to make the test pass.
