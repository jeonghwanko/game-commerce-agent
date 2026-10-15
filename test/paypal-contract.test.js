import { test } from "node:test";
import assert from "node:assert/strict";
import { PayPalSandboxProvider, SANDBOX } from "../src/providers/paypal.js";
import { Store } from "../src/store.js";
import { Commerce } from "../src/commerce.js";
import { ExternalWorkBudget } from "../src/budget.js";
const headers = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url":
    "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
  "paypal-transmission-id": "tid",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "time",
};
function fixture(t) {
  const s = new Store();
  t.after(() => s.close());
  let orderId = "PP123",
    captureId = "CAP123",
    refundId = "REFUND123",
    reference,
    status = "CREATED",
    captures = [];
  const calls = [];
  const remote = {
    now: 0,
    merchant: "MERCHANT",
    orderId,
    captureId,
    refundId,
    captureOrderId: orderId,
    verify: "SUCCESS",
    patchOrder: null,
    patchCapture: null,
    fail: null,
  };
  const cap = () => ({
    id: captureId,
    status: "COMPLETED",
    final_capture: true,
    amount: { value: "1.99", currency_code: "USD" },
    supplementary_data: { related_ids: { order_id: remote.captureOrderId } },
    ...remote.patchCapture,
  });
  const order = () => ({
    id: orderId,
    intent: "CAPTURE",
    status,
    purchase_units: [
      {
        reference_id: reference,
        custom_id: reference,
        payee: { merchant_id: remote.merchant },
        amount: { value: "1.99", currency_code: "USD" },
        payments: { captures },
      },
    ],
    ...remote.patchOrder,
  });
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith(SANDBOX + "/"));
    assert.equal(options.redirect, "error");
    calls.push({ url, ...options });
    if (remote.fail) {
      const failure = remote.fail(url, options);
      if (failure) throw failure;
    }
    let data;
    if (url.endsWith("/token")) data = { access_token: "stub-token" };
    else if (url.endsWith("/verify-webhook-signature"))
      data = { verification_status: remote.verify };
    else if (url.endsWith("/orders") && options.method === "POST") {
      const b = JSON.parse(options.body);
      reference = b.purchase_units[0].custom_id;
      assert.equal(b.purchase_units[0].payee.merchant_id, "MERCHANT");
      data = { id: orderId };
      if (remote.afterCreateFailure) {
        remote.afterCreateFailure = false;
        throw new Error("create response timeout");
      }
    } else if (url.endsWith("/capture") && options.method === "POST") {
      status = "COMPLETED";
      captures = [cap()];
      data = order();
      if (remote.afterCaptureFailure) {
        remote.afterCaptureFailure = false;
        throw new Error("capture response timeout");
      }
    } else if (url.endsWith("/refunds/" + refundId))
      data = {
        id: refundId,
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "1.99" },
        links: [
          { rel: "up", href: `${SANDBOX}/v2/payments/captures/${captureId}` },
        ],
      };
    else if (url.endsWith("/captures/" + captureId)) data = cap();
    else if (url.endsWith("/orders/" + orderId)) data = order();
    else throw new Error("unexpected_path");
    return { ok: true, json: async () => data };
  };
  const p = new PayPalSandboxProvider(
    {
      clientId: "stub",
      clientSecret: "stub",
      webhookId: "WHID",
      merchantId: "MERCHANT",
      origin: "http://localhost:3000",
      webhookBudget: new ExternalWorkBudget(s, {
        name: "webhook-test",
        windowMs: 60000,
        now: () => remote.now,
        limit: 20,
        concurrency: 2,
      }),
    },
    fetcher,
  );
  const c = new Commerce(s, p);
  const create = async () => {
    const q = c.quote("alice", "rosalyn-gala");
    return c.create("alice", {
      quoteId: q.id,
      sku: q.sku,
      amount: q.amount,
      currency: q.currency,
      version: q.version,
      confirm: true,
    });
  };
  const approve = () => {
    status = "APPROVED";
  };
  const complete = () => {
    status = "COMPLETED";
    captures = [cap()];
  };
  const completion = () => ({
    id: "WH-COMPLETE",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      ...cap(),
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  });
  // Actual refund shape: resource.id is a REFUND, original capture is rel=up, no related_ids.
  const refund = () => ({
    id: "WH-REFUND",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: {
      id: refundId,
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "1.99" },
      links: [
        { rel: "up", href: `${SANDBOX}/v2/payments/captures/${captureId}` },
      ],
    },
  });
  return {
    s,
    c,
    p,
    remote,
    calls,
    create,
    approve,
    complete,
    completion,
    refund,
  };
}
test("Sandbox transport contract creates, captures, independently reads capture and verifies webhook", async (t) => {
  const f = fixture(t);
  const o = await f.create();
  f.approve();
  await f.c.capture("alice", o.id);
  assert.equal(f.s.get("SELECT count(*) n FROM entitlements").n, 0);
  await f.c.webhook(headers, f.completion());
  assert.equal(f.c.owned("alice", o.id).status, "GRANTED");
  assert.ok(f.calls.some((c) => c.url.endsWith("/captures/CAP123")));
  assert.equal(
    f.calls.find((c) => c.url.endsWith("/orders")).headers["PayPal-Request-Id"],
    o.id,
  );
  assert.equal(
    f.calls.find((c) => c.url.endsWith("/capture")).headers[
      "PayPal-Request-Id"
    ],
    "cap-" + o.id,
  );
});
test("actual refund payload holds a grant and delayed completion cannot restore it", async (t) => {
  const f = fixture(t);
  const o = await f.create();
  f.complete();
  await f.c.webhook(headers, f.completion());
  await f.c.webhook(headers, f.refund());
  assert.equal(f.c.owned("alice", o.id).status, "REVIEW");
  assert.equal(f.s.get("SELECT status FROM entitlements").status, "held");
  await f.c.webhook(headers, { ...f.completion(), id: "WH-LATE" });
  assert.equal(f.s.get("SELECT status FROM entitlements").status, "held");
  assert.ok(f.calls.some((c) => c.url.endsWith("/refunds/REFUND123")));
});
test("refund received before capture settlement and completion grants nothing", async (t) => {
  const f = fixture(t);
  const o = await f.create();
  f.complete();
  await f.c.webhook(headers, f.refund());
  await f.c.webhook(headers, f.completion());
  assert.equal(f.c.owned("alice", o.id).status, "REVIEW");
  assert.equal(f.s.get("SELECT count(*) n FROM entitlements").n, 0);
});
test("wrong merchant and capture-to-order linkage reject before entitlement", async (t) => {
  const f = fixture(t);
  const o = await f.create();
  f.approve();
  f.remote.merchant = "ATTACKER";
  await assert.rejects(f.c.capture("alice", o.id), /merchant_mismatch/);
  assert.ok(!f.calls.some((c) => c.url.endsWith("/capture")));
  f.remote.merchant = "MERCHANT";
  f.complete();
  f.remote.captureOrderId = "OTHER";
  await assert.rejects(
    f.c.webhook(headers, f.completion()),
    /capture_order_mismatch/,
  );
  assert.equal(f.s.get("SELECT count(*) n FROM entitlements").n, 0);
});
test("malicious refund link is never fetched and inconsistent signed capture link is rejected", async (t) => {
  const f = fixture(t);
  await f.create();
  f.complete();
  const event = f.refund();
  event.resource.links[0].href = "http://169.254.169.254/latest/meta-data";
  await f.c.webhook(headers, event);
  assert.ok(f.calls.every((c) => c.url.startsWith(SANDBOX + "/")));
  const bad = f.refund();
  bad.id = "WH-BAD";
  bad.resource.links[0].href = SANDBOX + "/v2/payments/captures/WRONG";
  await assert.rejects(f.c.webhook(headers, bad), /refund_capture_mismatch/);
});
test("invalid signature and verification network failure do not mark receipts or grant", async (t) => {
  const f = fixture(t);
  await f.create();
  f.complete();
  f.remote.verify = "FAILURE";
  await assert.rejects(f.c.webhook(headers, f.completion()), /invalid_webhook/);
  f.remote.verify = "SUCCESS";
  f.remote.fail = (url) =>
    url.endsWith("/verify-webhook-signature")
      ? new Error("network timeout")
      : null;
  await assert.rejects(f.c.webhook(headers, f.completion()));
  assert.equal(f.s.get("SELECT count(*) n FROM webhook_receipts").n, 0);
  assert.equal(f.s.get("SELECT count(*) n FROM entitlements").n, 0);
});
test("Sandbox adapter retries uncertain create using original key and recovers lost capture response without recapture", async (t) => {
  const f = fixture(t);
  f.remote.afterCreateFailure = true;
  await assert.rejects(f.create(), /create response timeout/);
  const q = f.s.get("SELECT * FROM quotes");
  const confirm = {
    quoteId: q.id,
    sku: q.sku,
    amount: q.amount,
    currency: q.currency,
    version: q.version,
    confirm: true,
  };
  const o = await f.c.create("alice", confirm);
  const requests = f.calls.filter((c) => c.url.endsWith("/orders"));
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].headers["PayPal-Request-Id"],
    requests[1].headers["PayPal-Request-Id"],
  );
  f.approve();
  f.remote.afterCaptureFailure = true;
  await assert.rejects(f.c.capture("alice", o.id), /capture response timeout/);
  await f.c.capture("alice", o.id);
  assert.equal(f.calls.filter((c) => c.url.endsWith("/capture")).length, 1);
  assert.equal(f.c.owned("alice", o.id).status, "AWAITING_WEBHOOK");
});
test("signed refund holds rights even if refund details are temporarily unavailable", async (t) => {
  const f = fixture(t);
  const o = await f.create();
  f.complete();
  await f.c.webhook(headers, f.completion());
  f.remote.fail = (url) =>
    url.endsWith("/refunds/REFUND123")
      ? new Error("refund lookup timeout")
      : null;
  await assert.rejects(f.c.webhook(headers, f.refund()));
  assert.equal(f.c.owned("alice", o.id).status, "REVIEW");
  assert.equal(f.s.get("SELECT status FROM entitlements").status, "held");
  f.remote.fail = null;
  await f.c.webhook(headers, f.refund());
  assert.equal(f.s.get("SELECT status FROM entitlements").status, "held");
});
test("webhook budget prevents further OAuth and verification calls after exhaustion", async (t) => {
  const f = fixture(t);
  f.p.config.webhookBudget = new ExternalWorkBudget(f.s, {
    name: "limited-webhooks",
    limit: 1,
    concurrency: 1,
  });
  assert.equal(await f.p.verifyWebhook(headers, { id: "one" }), true);
  const calls = f.calls.length;
  await assert.rejects(
    f.p.verifyWebhook(headers, { id: "two" }),
    /external_budget_exhausted/,
  );
  assert.equal(f.calls.length, calls);
});
test("capture detail mismatches and partial capture cannot grant", async (t) => {
  const f = fixture(t);
  await f.create();
  f.complete();
  for (const patch of [
    { amount: { value: "0.01", currency_code: "USD" } },
    { amount: { value: "1.99", currency_code: "EUR" } },
    { status: "PENDING" },
    { final_capture: false },
    { payee: { merchant_id: "ATTACKER" } },
  ]) {
    f.remote.patchCapture = patch;
    await assert.rejects(f.c.webhook(headers, f.completion()));
  }
  assert.equal(f.s.get("SELECT count(*) n FROM entitlements").n, 0);
});

for (const early of [false, true])
  test(`refund-shaped REVERSED, early=${early}`, async (t) => {
    const f = fixture(t);
    const o = await f.create();
    f.complete();
    if (!early) await f.c.webhook(headers, f.completion());
    await f.c.webhook(headers, {
      ...f.refund(),
      event_type: "PAYMENT.CAPTURE.REVERSED",
      resource_type: "refund",
    });
    await f.c.webhook(headers, { ...f.completion(), id: "WH-LATE-REVERSE" });
    assert.equal(f.c.owned("alice", o.id).status, "REVIEW");
    assert.equal(
      f.s.get("SELECT count(*) n FROM entitlements WHERE status='active'").n,
      0,
    );
    assert.ok(f.calls.some((c) => c.url.endsWith("/refunds/REFUND123")));
  });

test("invalid signatures exhaust a recoverable window; verified completion and refund succeed after cooldown", async (t) => {
  const f = fixture(t);
  const o = await f.create();
  f.complete();
  f.remote.verify = "FAILURE";
  for (let i = 0; i < 20; i++)
    await assert.rejects(
      f.c.webhook(headers, f.completion()),
      /invalid_webhook/,
    );
  f.remote.verify = "SUCCESS";
  await assert.rejects(
    f.c.webhook(headers, f.completion()),
    /external_budget_exhausted/,
  );
  f.remote.now = 60001;
  await f.c.webhook(headers, f.completion());
  assert.equal(f.c.owned("alice", o.id).status, "GRANTED");
  f.remote.verify = "FAILURE";
  for (let i = 0; i < 19; i++)
    await assert.rejects(f.c.webhook(headers, f.refund()), /invalid_webhook/);
  f.remote.verify = "SUCCESS";
  await assert.rejects(
    f.c.webhook(headers, f.refund()),
    /external_budget_exhausted/,
  );
  f.remote.now = 120002;
  await f.c.webhook(headers, f.refund());
  assert.equal(f.c.owned("alice", o.id).status, "REVIEW");
  assert.equal(f.s.get("SELECT status FROM entitlements").status, "held");
});
test("malicious refund-shaped REVERSED up URL is never fetched", async (t) => {
  const f = fixture(t);
  await f.create();
  f.complete();
  const e = {
    ...f.refund(),
    event_type: "PAYMENT.CAPTURE.REVERSED",
    resource_type: "refund",
  };
  e.resource.links[0].href = "https://evil.invalid/v2/payments/captures/CAP123";
  await f.c.webhook(headers, e);
  assert.ok(f.calls.every((c) => c.url.startsWith(SANDBOX + "/")));
});

test("capture-shaped REVERSED stays distinct from refund-shaped resources", async (t) => {
  const f = fixture(t);
  const o = await f.create();
  f.complete();
  await f.c.webhook(headers, f.completion());
  await f.c.webhook(headers, {
    ...f.completion(),
    id: "WH-CAPTURE-REVERSED",
    event_type: "PAYMENT.CAPTURE.REVERSED",
    resource_type: "capture",
  });
  assert.equal(f.c.owned("alice", o.id).status, "REVIEW");
  assert.ok(!f.calls.some((c) => c.url.includes("/refunds/")));
});
