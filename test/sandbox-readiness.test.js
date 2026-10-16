import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxDemo, sandboxReadiness } from "../src/sandbox-demo.js";

const origin = "https://sandbox-demo.invalid";
const authorization =
  "Basic " +
  Buffer.from("fixture:fake-demo-password-at-least-24-chars").toString(
    "base64",
  );
const config = (path) => ({
  PAYMENT_PROVIDER: "paypal-sandbox",
  AI_PROVIDER: "mock",
  PUBLIC_ORIGIN: origin,
  DATABASE_PATH: path,
  SANDBOX_DEMO_HOST_ENABLED: "true",
  SANDBOX_WEBHOOK_ROUTE_READY: "true",
  DEMO_ACCESS_USER: "fixture",
  DEMO_ACCESS_PASSWORD: "fake-demo-password-at-least-24-chars",
  PAYPAL_OAUTH_BASIC_AUTH_HEADER: "Basic ZmFrZTpmYWtl",
  PAYPAL_MERCHANT_ID: "FAKE-SELLER",
  PAYPAL_WEBHOOK_ID: "FAKE-WEBHOOK",
});
const signedHeaders = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url":
    "https://api.sandbox.paypal.com/v1/notifications/certs/FAKE",
  "paypal-transmission-id": "FAKE",
  "paypal-transmission-sig": "FAKE",
  "paypal-transmission-time": "FAKE",
};

function fakeTransport() {
  let unit,
    status = "CREATED",
    captured = false;
  const f = {
    calls: [],
    signature: "SUCCESS",
    merchant: "FAKE-SELLER",
    amount: "1.99",
    parent: "FAKE-ORDER",
  };
  const capture = () => ({
    id: "FAKE-CAPTURE",
    status: "COMPLETED",
    final_capture: true,
    amount: { value: f.amount, currency_code: "USD" },
    supplementary_data: { related_ids: { order_id: f.parent } },
  });
  f.approve = () => {
    status = "APPROVED";
  };
  f.event = () => ({
    id: "FAKE-EVENT",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: capture(),
  });
  f.fetcher = async (url, options) => {
    assert.equal(new URL(url).origin, "https://api-m.sandbox.paypal.com");
    assert.equal(options.redirect, "error");
    const path = new URL(url).pathname;
    f.calls.push(path);
    let body;
    if (path === "/v1/oauth2/token") {
      assert.equal(options.headers.Authorization, "Basic ZmFrZTpmYWtl");
      body = { access_token: "fake-token" };
    } else if (path === "/v1/notifications/verify-webhook-signature") {
      assert.equal(JSON.parse(options.body).webhook_id, "FAKE-WEBHOOK");
      body = { verification_status: f.signature };
    } else if (path === "/v2/checkout/orders") {
      unit = JSON.parse(options.body).purchase_units[0];
      assert.deepEqual(unit.amount, { currency_code: "USD", value: "1.99" });
      assert.equal(unit.payee.merchant_id, "FAKE-SELLER");
      assert.equal(options.headers["PayPal-Request-Id"], unit.custom_id);
      body = { id: "FAKE-ORDER" };
    } else if (path === "/v2/checkout/orders/FAKE-ORDER/capture") {
      assert.equal(status, "APPROVED");
      assert.equal(
        options.headers["PayPal-Request-Id"],
        `cap-${unit.custom_id}`,
      );
      status = "COMPLETED";
      captured = true;
      body = {};
    } else if (path === "/v2/checkout/orders/FAKE-ORDER") {
      body = {
        id: "FAKE-ORDER",
        intent: "CAPTURE",
        status,
        purchase_units: [
          {
            ...unit,
            amount: { value: f.amount, currency_code: "USD" },
            payee: { merchant_id: f.merchant },
            payments: { captures: captured ? [capture()] : [] },
          },
        ],
      };
    } else if (path === "/v2/payments/captures/FAKE-CAPTURE") body = capture();
    else throw new Error("unexpected_fake_transport_path");
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  };
  return f;
}

async function harness(t) {
  const dir = mkdtempSync(join(tmpdir(), "gca-readiness-"));
  const env = config(join(dir, "ledger.sqlite"));
  const remote = fakeTransport();
  let app, csrf;
  async function start() {
    app = createSandboxDemo({
      env,
      fetcher: remote.fetcher,
      confirmSandboxRequests: true,
    });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  }
  async function close() {
    await new Promise((r) => app.server.close(r));
    app.store.close();
  }
  await start();
  t.after(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });
  function call(path, data, extra = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: app.server.address().port,
          path,
          method: data === undefined ? "GET" : "POST",
          headers: {
            host: "sandbox-demo.invalid",
            authorization,
            origin,
            "content-type": "application/json",
            ...(csrf ? { "x-csrf-token": csrf } : {}),
            ...extra,
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, body: JSON.parse(raw) }),
          );
        },
      );
      req.on("error", reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  const session = await call("/api/session");
  csrf = session.body.csrf;
  assert.equal(session.body.paymentMode, "paypal-sandbox");
  assert.equal(session.body.aiMode, "mock");
  assert.equal(remote.calls.length, 0); // startup + authenticated session are offline
  const create = async () => {
    const q = (await call("/api/commerce/quotes", { sku: "rosalyn-gala" }))
      .body;
    const consent = {
      sku: q.sku,
      amount: q.amount,
      currency: q.currency,
      version: q.version,
      quoteId: q.id,
      confirm: true,
    };
    const o = await call("/api/commerce/orders", consent);
    assert.equal(o.status, 201);
    return { o: o.body, consent };
  };
  return {
    call,
    create,
    remote,
    get app() {
      return app;
    },
    restart: async () => {
      await close();
      const n = remote.calls.length;
      await start();
      csrf = (await call("/api/session")).body.csrf;
      assert.equal(remote.calls.length, n);
    },
  };
}

test("check/import are inert; public manifest is not a readiness or merchant claim", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import net from 'node:net';
    globalThis.fetch = () => { throw Error('external_network_forbidden'); };
    net.Server.prototype.listen = () => { throw Error('listener_forbidden'); };
    const m = await import('./src/sandbox-demo.js');
    console.log(JSON.stringify(m.sandboxReadiness()));
  `,
    ],
    { encoding: "utf8", env: {} },
  );
  assert.equal(child.status, 0, child.stderr);
  const manifest = JSON.parse(child.stdout);
  assert.equal(manifest.actualProviderVerified, false);
  assert.deepEqual(
    manifest.products.map((p) => [p.sku, p.amountMinor, p.currency]),
    [
      ["rosalyn-gala", 199, "USD"],
      ["rosalyn-traveler", 99, "USD"],
    ],
  );
  assert.equal(sandboxReadiness().ai, "mock");
  const check = spawnSync(
    process.execPath,
    ["src/sandbox-demo.js", "--check"],
    { encoding: "utf8", env: {} },
  );
  assert.equal(check.status, 0);
  assert.deepEqual(JSON.parse(check.stdout), manifest);
});

test("payment demo refuses missing confirmation, route, HTTPS, persistence and real AI before transport", () => {
  const env = config("unused-test-path.sqlite");
  for (const [patch, confirm, error] of [
    [{}, false, /confirmation_required/],
    [{ SANDBOX_WEBHOOK_ROUTE_READY: "false" }, true, /route_not_ready/],
    [{ PUBLIC_ORIGIN: "http://localhost:3000" }, true, /https_origin_required/],
    [{ DATABASE_PATH: ":memory:" }, true, /persistent_database_required/],
    [{ AI_PROVIDER: "openai" }, true, /ai_must_be_mock/],
  ])
    assert.throws(
      () =>
        createSandboxDemo({
          env: { ...env, ...patch },
          confirmSandboxRequests: confirm,
          fetcher: () => {
            throw Error("network_forbidden");
          },
        }),
      error,
    );
});

test("real adapter + HTTP + principal demo, entirely fake transport: approval, capture, signed webhook, restart, one grant", async (t) => {
  const f = await harness(t);
  const { o, consent } = await f.create();
  const path = `/api/commerce/orders/${o.id}`;
  assert.equal((await f.call(path + "/mock-approve", {})).status, 404);
  assert.deepEqual((await f.call("/api/game")).body.owned, []);
  assert.equal(
    (await f.call(path + "/capture", {})).body.error,
    "buyer_approval_required",
  );
  assert.equal((await f.call(path)).body.status, "APPROVAL_PENDING");
  f.remote.approve();
  const repeated = await Promise.all([
    f.call(path + "/capture", {}),
    f.call(path + "/capture", {}),
  ]);
  assert.ok(repeated.some((r) => r.body.status === "AWAITING_WEBHOOK"));
  assert.equal(f.remote.calls.filter((p) => p.endsWith("/capture")).length, 1);
  assert.equal((await f.call("/api/game/equip", { sku: o.sku })).status, 403);
  await f.restart();
  assert.equal((await f.call(path)).body.status, "AWAITING_WEBHOOK");
  f.remote.signature = "FAILURE";
  assert.equal(
    (await f.call("/api/paypal/webhooks", f.remote.event(), signedHeaders))
      .status,
    401,
  );
  assert.equal(f.app.store.get("SELECT count(*) n FROM entitlements").n, 0);
  f.remote.signature = "SUCCESS";
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await f.call("/api/paypal/webhooks", f.remote.event(), signedHeaders))
        .body.status,
      "GRANTED",
    );
  assert.equal((await f.call("/api/commerce/orders", consent)).body.id, o.id);
  const game = (await f.call("/api/game/equip", { sku: o.sku })).body;
  assert.equal(game.formal, true);
  assert.equal(game.canEnter, false);
  assert.equal(f.app.store.get("SELECT count(*) n FROM entitlements").n, 1);
  assert.equal(
    f.app.store.get(
      "SELECT count(*) n FROM events WHERE name='entitlement_granted'",
    ).n,
    1,
  );
  for (const npc of ["seal", "rumor"]) {
    const challenge = (await f.call("/api/game/interact", { npc })).body;
    assert.equal((await f.call("/api/game/quest", challenge)).status, 200);
  }
  assert.equal((await f.call("/api/game")).body.canEnter, true);
});

test("fake remote merchant/amount mismatches do not capture or grant", async (t) => {
  const f = await harness(t);
  const { o } = await f.create();
  const path = `/api/commerce/orders/${o.id}`;
  f.remote.approve();
  f.remote.merchant = "OTHER-FAKE-SELLER";
  assert.equal(
    (await f.call(path + "/capture", {})).body.error,
    "merchant_mismatch",
  );
  f.remote.merchant = "FAKE-SELLER";
  f.remote.amount = "0.01";
  assert.notEqual((await f.call(path + "/capture", {})).status, 200);

  assert.equal(f.remote.calls.filter((p) => p.endsWith("/capture")).length, 0);
  assert.equal(f.app.store.get("SELECT count(*) n FROM entitlements").n, 0);
});

test("cancelled demo purchase cannot capture after buyer approval", async (t) => {
  const f = await harness(t);
  const { o } = await f.create();
  const path = `/api/commerce/orders/${o.id}`;
  assert.equal((await f.call(path + "/cancel", {})).body.status, "CANCELLED");
  f.remote.approve();
  assert.equal(
    (await f.call(path + "/capture", {})).body.error,
    "order_not_capturable",
  );
  assert.equal(f.remote.calls.filter((p) => p.endsWith("/capture")).length, 0);
  assert.equal(f.app.store.get("SELECT count(*) n FROM entitlements").n, 0);
});
