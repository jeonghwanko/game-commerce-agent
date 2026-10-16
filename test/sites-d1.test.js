import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteD1 } from "../sites/testing/d1-fixture.js";
import { D1Ledger, D1WindowBudget } from "../sites/d1.js";
import { D1Commerce } from "../sites/commerce.js";
import { D1MockProvider } from "../sites/mock-provider.js";
import { D1Game } from "../sites/game.js";
import { createSitesWorker } from "../sites/worker.js";
import { PayPalSandboxProvider } from "../src/providers/paypal.js";
const gate = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(t) {
  const db = sqliteD1();
  t.after(() => db.close());
  const s = new D1Ledger(db),
    p = new D1MockProvider(s),
    c = new D1Commerce(s, p);
  await c.init();
  return {
    db,
    s,
    p,
    c,
    g: new D1Game(s),
    create: async (user = "alice") => {
      const q = await c.quote(user, "rosalyn-gala"),
        consent = { ...q, quoteId: q.id, confirm: true };
      return { q, consent, o: await c.create(user, consent) };
    },
  };
}
function workerFixture(
  t,
  { db = sqliteD1(), mode = "unconfigured", transport } = {},
) {
  t.after(() => db.close());
  let calls = 0;
  const assets = Object.fromEntries(
    ["/", "/app.js", "/scene.js", "/style.css"].map((path) => [
      path,
      readFileSync(
        new URL(
          "../public/" + (path === "/" ? "index.html" : path.slice(1)),
          import.meta.url,
        ),
        "utf8",
      ),
    ]),
  );
  const fetcher = (...args) => {
    calls++;
    if (transport) return transport(...args);
    throw Error("external_network_forbidden");
  };
  let worker = createSitesWorker({ assets, fetcher });
  const env = {
    PUBLIC_ORIGIN: "https://site.invalid",
    SITES_OWNER_USER_ID: "owner-site-id",
    DB: db,
    PAYMENT_PROVIDER: mode,
  };
  let csrf;
  const call = async (path, body, headers = {}) => {
    const requestHeaders = new Headers({
      "oai-authenticated-user-id": "owner-site-id",
      "oai-authenticated-user-email": "owner@example.invalid",
      "content-type": "application/json",
      origin: env.PUBLIC_ORIGIN,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    });
    for (const [name, value] of Object.entries(headers)) {
      if (value === null) requestHeaders.delete(name);
      else requestHeaders.set(name, value);
    }
    const req = new Request(env.PUBLIC_ORIGIN + path, {
      method: body === undefined ? "GET" : "POST",
      headers: requestHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return worker.fetch(req, env);
  };
  return {
    db,
    env,
    call,
    get calls() {
      return calls;
    },
    restart() {
      worker = createSitesWorker({ assets, fetcher });
    },
    async login() {
      const r = await call("/api/session");
      const j = await r.json();
      csrf = j.csrf;
      return { r, j };
    },
  };
}

test("Sites: owner ID is explicit; anonymous and other users cannot load game/assets/API or bind first visitor", async (t) => {
  const f = workerFixture(t);
  for (const path of [
    "/",
    "/app.js",
    "/scene.js",
    "/style.css",
    "/api/session",
    "/api/game",
    "/api/commerce/orders",
  ]) {
    assert.equal(
      (await f.call(path, undefined, { "oai-authenticated-user-id": "" }))
        .status,
      401,
      path,
    );
    assert.equal(
      (
        await f.call(path, undefined, {
          "oai-authenticated-user-id": "other-site-id",
        })
      ).status,
      403,
      path,
    );
  }
  delete f.env.SITES_OWNER_USER_ID;
  assert.equal((await f.call("/api/game")).status, 503);
  const setup = await (await f.call("/api/setup/identity")).json();
  assert.equal(setup.siteUserId, "owner-site-id");
  assert.equal(setup.configured, false);
  assert.equal(
    f.db.sqlite.prepare("SELECT count(*) n FROM sites_sessions").get().n,
    0,
  );
  assert.equal(f.calls, 0);
});

test("Sites: complete dispatch identity is required; alternate identity claims never select the owner", async (t) => {
  const f = workerFixture(t);
  const claims = {
    "x-user-id": "owner-site-id",
    "x-authenticated-user-id": "owner-site-id",
    "x-developer-user-id": "owner-site-id",
    "x-forwarded-user": "owner-site-id",
    "oai-authenticated-user-email": "owner@example.invalid",
    "oai-authenticated-user-full-name": "owner-site-id",
    cookie: "userId=owner-site-id; __sites_local_auth=1",
    authorization: "Bearer synthetic-not-a-session",
  };
  const attempts = [
    [401, { ...claims, "oai-authenticated-user-id": null }],
    [401, { "oai-authenticated-user-email": null }],
    [401, { "oai-authenticated-user-email": "" }],
    [403, { ...claims, "oai-authenticated-user-id": "other-site-id" }],
    [403, { ...claims, "oai-authenticated-user-id": "OWNER-SITE-ID" }],
    [403, { "oai-authenticated-user-id": "owner-site-id, other-site-id" }],
    [403, { "oai-authenticated-user-id": "other-site-id, owner-site-id" }],
    [403, { "oai-authenticated-user-id": "owner-site-id, owner-site-id" }],
  ];
  for (const [expected, headers] of attempts) {
    for (const path of [
      "/", "/app.js", "/scene.js", "/style.css", "/api/session",
      "/api/game", "/api/commerce/catalog", "/api/commerce/entitlements",
      "/api/commerce/orders", "/api/analytics/funnel",
    ]) {
      const r = await f.call(path, undefined, headers);
      assert.equal(r.status, expected, path);
      assert.equal(r.headers.get("cache-control"), "no-store");
    }
    for (const path of [
      "/api/game/interact", "/api/game/quest", "/api/game/equip",
      "/api/commerce/quotes", "/api/commerce/orders",
      "/api/commerce/agent/recommend",
      "/api/commerce/orders/00000000-0000-0000-0000-000000000000/capture",
    ])
      assert.equal((await f.call(path, {}, headers)).status, expected, path);
  }
  for (const table of ["sites_sessions", "sites_game", "sites_orders", "sites_quotes"])
    assert.equal(f.db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(f.calls, 0);

  // These are trusted-dispatch inputs in a unit test, not a hosted spoof test.
  // Email is required to match the starter contract but never selects the owner.
  assert.equal((await f.call("/", undefined, {
    "OAI-Authenticated-User-Id": "owner-site-id",
    "oai-authenticated-user-email": "renamed@example.invalid",
  })).status, 200);
});

test("Sites: setup readout cannot enroll an owner or create sessions", async (t) => {
  const f = workerFixture(t);
  delete f.env.SITES_OWNER_USER_ID;
  assert.equal((await f.call("/api/setup/identity", undefined, {
    "oai-authenticated-user-email": null,
  })).status, 401);
  for (const id of ["first-visitor", "owner-site-id"]) {
    const headers = { "oai-authenticated-user-id": id };
    const setup = await (await f.call("/api/setup/identity", undefined, headers)).json();
    assert.equal(setup.siteUserId, id);
    assert.equal(setup.configured, false);
    assert.equal((await f.call("/", undefined, headers)).status, 503);
    assert.equal((await f.call("/api/game", undefined, headers)).status, 503);
    assert.equal(f.env.SITES_OWNER_USER_ID, undefined);
  }
  f.env.SITES_OWNER_USER_ID = "owner-site-id";
  assert.equal((await f.call("/api/game", undefined, {
    "oai-authenticated-user-id": "first-visitor",
  })).status, 403);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_sessions").get().n, 0);
  assert.equal(f.calls, 0);
});

test("Sites: missing/wrong CSRF and missing/null/foreign Origin reject before game writes", async (t) => {
  const f = workerFixture(t);
  await f.login();
  for (const headers of [
    { "x-csrf-token": null },
    { "x-csrf-token": "" },
    { "x-csrf-token": "wrong-synthetic-value" },
    { origin: null },
    { origin: "null" },
    { origin: "https://evil.invalid" },
    { origin: f.env.PUBLIC_ORIGIN + "/" },
    { origin: f.env.PUBLIC_ORIGIN + ".evil.invalid" },
  ]) {
    const r = await f.call("/api/game/interact", { npc: "seal" }, headers);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: "csrf_rejected" });
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  for (const table of ["sites_challenges", "sites_game", "sites_events", "sites_quotes", "sites_orders"])
    assert.equal(f.db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal((await f.call("/api/game/interact", { npc: "seal" })).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_challenges").get().n, 1);
  assert.equal(f.calls, 0);
});

test("Sites: CSRF expires at one hour, rotates, and rejects the old value after restart", async (t) => {
  const now = 2000000000000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const f = workerFixture(t);
  const old = (await f.login()).j.csrf;
  t.mock.timers.setTime(now + 3600000 - 1);
  assert.equal((await f.login()).j.csrf, old);
  t.mock.timers.setTime(now + 3600000);
  const expired = await f.call("/api/game/interact", { npc: "seal" });
  assert.equal(expired.status, 403);
  assert.deepEqual(await expired.json(), { error: "csrf_rejected" });
  const fresh = (await f.login()).j.csrf;
  assert.notEqual(fresh, old);
  f.restart();
  assert.equal((await f.login()).j.csrf, fresh);
  assert.equal((await f.call("/api/game/interact", { npc: "seal" }, {
    "x-csrf-token": old,
  })).status, 403);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_challenges").get().n, 0);
  assert.equal((await f.call("/api/game/interact", { npc: "seal" })).status, 200);
  assert.equal(f.calls, 0);
});

test("Sites: CSRF that expires during an awaited database read cannot authorize a write", async (t) => {
  const now = 2000000000000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const f = workerFixture(t);
  await f.login();
  f.db.before = async (sql) => {
    if (sql.startsWith("SELECT value FROM sites_environment"))
      t.mock.timers.setTime(now + 3600000);
  };
  const r = await f.call("/api/game/interact", { npc: "seal" });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: "csrf_rejected" });
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_challenges").get().n, 0);
  assert.equal(f.calls, 0);
});

test("Sites: changing the configured owner revokes the old principal and isolates CSRF sessions", async (t) => {
  const f = workerFixture(t);
  const old = (await f.login()).j.csrf;
  f.env.SITES_OWNER_USER_ID = "new-owner-site-id";
  assert.equal((await f.call("/api/game")).status, 403);
  assert.equal((await f.call("/api/game/interact", { npc: "seal" })).status, 403);
  const identity = {
    "oai-authenticated-user-id": "new-owner-site-id",
    "oai-authenticated-user-email": "new-owner@example.invalid",
  };
  const session = await (await f.call("/api/session", undefined, identity)).json();
  assert.notEqual(session.csrf, old);
  assert.equal((await f.call("/api/game/interact", { npc: "seal" }, identity)).status, 403);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_challenges").get().n, 0);
  assert.equal((await f.call("/api/game/interact", { npc: "seal" }, {
    ...identity, "x-csrf-token": session.csrf,
  })).status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_sessions").get().n, 2);
  assert.equal(f.calls, 0);
});

test("Sites: claimed query/body identities cannot override dispatch, even with valid CSRF", async (t) => {
  const f = workerFixture(t);
  await f.login();
  for (const key of ["userId", "user_id"]) {
    assert.equal((await f.call(`/api/game?${key}=owner-site-id`)).status, 400);
    assert.equal((await f.call("/api/game/interact", {
      npc: "seal", [key]: "owner-site-id",
    })).status, 400);
    const other = { "oai-authenticated-user-id": "other-site-id" };
    assert.equal((await f.call(`/api/game?${key}=owner-site-id`, undefined, other)).status, 403);
    assert.equal((await f.call("/api/game/interact", {
      npc: "seal", [key]: "owner-site-id",
    }, other)).status, 403);
  }
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_challenges").get().n, 0);
  assert.equal(f.calls, 0);
});

test("Sites: public callback stays anonymous-compatible but disabled before secret access or transport", async (t) => {
  const f = workerFixture(t);
  for (const key of ["PAYPAL_OAUTH_BASIC_AUTH_HEADER", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"])
    Object.defineProperty(f.env, key, { get() { throw Error("secret_access_forbidden"); } });
  for (const mode of ["unconfigured", "paypal-sandbox"]) {
    f.env.PAYMENT_PROVIDER = mode;
    f.env.SANDBOX_PAYMENTS_ENABLED = "false";
    const r = await f.call("/api/paypal/webhooks", {}, {
      "oai-authenticated-user-id": null,
      "oai-authenticated-user-email": null,
      origin: null,
      "x-csrf-token": null,
    });
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: "payments_not_configured" });
  }
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_sessions").get().n, 0);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM sites_environment").get().n, 0);
  assert.equal(f.calls, 0);
});

test("Sites: unconfigured mode supports server-authoritative free quests, re-login and previews but zero payments", async (t) => {
  const f = workerFixture(t);
  assert.equal((await f.login()).j.paymentMode, "unconfigured");
  for (let i = 0; i < 3; i++)
    assert.equal((await f.call("/api/game")).status, 200);
  assert.equal(
    (await f.call("/api/commerce/quotes", { sku: "rosalyn-gala" })).status,
    503,
  );
  assert.equal(
    (await f.call("/api/game/quest", { quest: "seal" })).status,
    409,
  );
  for (const npc of ["shop", "seal", "rumor"]) {
    const q = await (await f.call("/api/game/interact", { npc })).json();
    assert.equal((await f.call("/api/game/quest", q)).status, 200);
    assert.equal((await f.call("/api/game/quest", q)).status, 409);
  }
  const dressed = await (
    await f.call("/api/game/equip", { sku: "borrowed" })
  ).json();
  assert.equal(dressed.canEnter, true);
  assert.deepEqual(dressed.owned, []);
  f.restart();
  await f.login();
  assert.equal((await (await f.call("/api/game")).json()).canEnter, true);
  assert.equal((await f.call("/api/commerce/orders?userId=other")).status, 400);
  assert.equal(
    (await f.call("/api/game/equip", { sku: "borrowed", userId: "other" }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/api/game/interact",
        { npc: "seal" },
        { origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    f.db.sqlite.prepare("SELECT count(*) n FROM sites_entitlements").get().n,
    0,
  );
  assert.equal(f.calls, 0);
});

test("Sites: mock click flow stays mock, and provider/environment switches refuse existing rights", async (t) => {
  const f = workerFixture(t, { mode: "mock" });
  await f.login();
  const q = await (
    await f.call("/api/commerce/quotes", { sku: "rosalyn-gala" })
  ).json();
  const o = await (
    await f.call("/api/commerce/orders", { ...q, quoteId: q.id, confirm: true })
  ).json();
  const r = await (
    await f.call(`/api/commerce/orders/${o.id}/mock-approve`, {})
  ).json();
  assert.equal(r.status, "GRANTED");
  assert.equal(
    (await (await f.call("/api/game/equip", { sku: q.sku })).json()).canEnter,
    false,
  );
  f.env.PAYMENT_PROVIDER = "paypal-sandbox";
  f.env.PAYPAL_MERCHANT_ID = "XB5RWXEAFHG8J";
  assert.equal((await f.call("/api/game")).status, 409);
  f.env.PAYMENT_PROVIDER = "unconfigured";
  assert.equal((await f.call("/api/game")).status, 409);
  assert.equal(f.calls, 0);
});

test("D1: simultaneous create/capture yields one remote operation and one atomic grant event", async (t) => {
  const f = await fixture(t),
    q = await f.c.quote("alice", "rosalyn-gala"),
    b = { ...q, quoteId: q.id, confirm: true };
  let creates = 0,
    captures = 0;
  const create = f.p.create.bind(f.p),
    capture = f.p.capture.bind(f.p);
  f.p.create = async (o) => {
    creates++;
    return create(o);
  };
  f.p.capture = async (id) => {
    captures++;
    return capture(id);
  };
  const responses = await Promise.allSettled(
    Array.from({ length: 8 }, () => f.c.create("alice", b)),
  );
  assert.ok(responses.some((r) => r.status === "fulfilled"));
  assert.equal(creates, 1);
  const o = responses.find((r) => r.status === "fulfilled").value;
  await f.p.approve(o.provider_id);
  await Promise.allSettled(
    Array.from({ length: 8 }, () => f.c.capture("alice", o.id)),
  );
  assert.equal(captures, 1);
  assert.equal((await f.c.owned("alice", o.id)).status, "AWAITING_WEBHOOK");
  assert.deepEqual((await f.g.state("alice")).owned, []);
  const remote = await f.p.inspect(o.provider_id);
  await Promise.all(
    Array.from({ length: 8 }, () =>
      f.c.settle(o.id, remote, "fake-verified-event"),
    ),
  );
  assert.equal(
    (await f.s.one("SELECT count(*) n FROM sites_entitlements")).n,
    1,
  );
  assert.equal(
    (
      await f.s.one(
        "SELECT count(*) n FROM sites_events WHERE name='entitlement_granted'",
      )
    ).n,
    1,
  );
  assert.ok(f.db.sessions.every((s) => s === "first-primary"));
});

test("D1: atomic batch rollback leaves no partial entitlement/capture flag on SQL failure or lost lease", async (t) => {
  const f = await fixture(t),
    { o } = await f.create();
  await f.p.approve(o.provider_id);
  const remote = await f.p.capture(o.provider_id);
  f.db.fail = (sql) =>
    sql.startsWith("INSERT OR IGNORE INTO sites_entitlements");
  await assert.rejects(f.c.settle(o.id, remote, "fake-event"));
  f.db.fail = null;
  assert.equal((await f.c.owned("alice", o.id)).capture_verified, 0);
  assert.equal((await f.s.one("SELECT count(*) n FROM sites_events")).n, 0);
  await assert.rejects(
    f.c.settle(o.id, remote, "fake-event", "expired-or-replaced-lease"),
  );
  assert.equal((await f.c.owned("alice", o.id)).capture_verified, 0);
  assert.equal(
    (await f.s.one("SELECT count(*) n FROM sites_entitlements")).n,
    0,
  );
  await f.c.settle(o.id, remote, "fake-event");
  assert.equal((await f.c.owned("alice", o.id)).status, "GRANTED");
});

test("D1: delayed CREATED cannot restore a newer capture or enable cancel", async (t) => {
  const f = await fixture(t),
    { o } = await f.create(),
    started = gate(),
    resume = gate();
  let now = 1000;
  f.c.now = () => now;
  const inspect = f.p.inspect.bind(f.p);
  let first = true;
  f.p.inspect = async (id) => {
    const r = await inspect(id);
    if (first) {
      first = false;
      started.resolve();
      await resume.promise;
    }
    return r;
  };
  const slow = f.c.capture("alice", o.id);
  await started.promise;
  await assert.rejects(f.c.cancel("alice", o.id), /cancellable/);
  now += 300001;
  await f.p.approve(o.provider_id);
  await f.c.capture("alice", o.id);
  resume.resolve();
  await assert.rejects(slow, /operation_changed/);
  assert.equal((await f.c.owned("alice", o.id)).status, "AWAITING_WEBHOOK");
  await assert.rejects(f.c.cancel("alice", o.id), /cancellable/);
});

test("D1: create response loss resumes original consent after expiry; cancel while create is pending never reactivates", async (t) => {
  const f = await fixture(t);
  let now = Date.now();
  f.c.now = () => now;
  const q = await f.c.quote("alice", "rosalyn-gala"),
    b = { ...q, quoteId: q.id, confirm: true };
  const create = f.p.create.bind(f.p);
  let fail = true;
  f.p.create = async (o) => {
    const r = await create(o);
    if (fail) {
      fail = false;
      throw Error("synthetic timeout");
    }
    return r;
  };
  await assert.rejects(f.c.create("alice", b));
  let o = await f.s.one("SELECT * FROM sites_orders WHERE quote_id=?", q.id);
  now += 300001;
  const resumed = await f.c.resume("alice", o.id, b);
  assert.equal(resumed.id, o.id);
  assert.equal(
    (await f.s.one("SELECT count(*) n FROM sites_mock_orders")).n,
    1,
  );
  await f.c.cancel("alice", o.id);
  await assert.rejects(f.c.capture("alice", o.id));
  const second = await f.c.quote("alice", "rosalyn-gala"),
    started = gate(),
    release = gate();
  f.p.create = async (o) => {
    const r = await create(o);
    started.resolve();
    await release.promise;
    return r;
  };
  const pending = f.c.create("alice", {
    ...second,
    quoteId: second.id,
    confirm: true,
  });
  await started.promise;
  o = await f.s.one("SELECT * FROM sites_orders WHERE quote_id=?", second.id);
  await f.c.cancel("alice", o.id);
  release.resolve();
  assert.equal((await pending).status, "CANCELLED");
});

test("D1: verified refund before binding and delayed completion leave rights held and remove outfit effects", async (t) => {
  const f = await fixture(t),
    { o } = await f.create();
  await f.p.approve(o.provider_id);
  await f.c.capture("alice", o.id);
  const remote = await f.p.inspect(o.provider_id);
  await f.c.settle(o.id, remote, "fake-completion");
  await f.g.equip("alice", o.sku);
  // Signature verification is deliberately a fixture here; no HTTP bypass exists.
  f.p.verifyWebhook = async () => true;
  f.p.eventReference = async () => ({
    providerId: o.provider_id,
    captureId: remote.captureId,
  });
  const refund = {
    id: "fake-refund-event",
    event_type: "PAYMENT.CAPTURE.REVERSED",
    resource_type: "refund",
    resource: {
      id: "fake-refund-id",
      links: [
        {
          rel: "up",
          href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${remote.captureId}`,
        },
      ],
    },
  };
  await f.c.webhook({}, refund);
  await f.c.settle(o.id, remote, "fake-delayed-completion");
  const g = await f.g.state("alice");
  assert.deepEqual(g.owned, []);
  assert.equal(g.equipped, null);
  assert.equal(g.formal, false);
  await assert.rejects(f.g.equip("alice", o.sku));
  assert.equal((await f.c.owned("alice", o.id)).status, "REVIEW");
  const f2 = await fixture(t),
    started = gate(),
    release = gate();
  const create = f2.p.create.bind(f2.p);
  let earlyId;
  f2.p.create = async (o) => {
    const r = await create(o);
    earlyId = r.id;
    started.resolve();
    await release.promise;
    return r;
  };
  const pending = f2.create();
  await started.promise;
  f2.p.verifyWebhook = async () => true;
  f2.p.eventReference = async () => ({
    providerId: earlyId,
    captureId: "early-cap",
  });
  await assert.rejects(
    f2.c.webhook(
      {},
      {
        id: "early-refund",
        event_type: "PAYMENT.CAPTURE.REFUNDED",
        resource: {
          id: "early-refund-id",
          supplementary_data: {
            related_ids: { order_id: earlyId, capture_id: "early-cap" },
          },
        },
      },
    ),
    /not_found/,
  );
  release.resolve();
  assert.equal((await pending).o.status, "REVIEW");
});

test("D1: wrong quote owner, amount, currency and missing confirmation reject before provider calls", async (t) => {
  const f = await fixture(t),
    q = await f.c.quote("alice", "rosalyn-gala"),
    b = { ...q, quoteId: q.id, confirm: true };
  for (const patch of [
    { amount: 1 },
    { currency: "EUR" },
    { confirm: false },
    { sku: "rosalyn-traveler" },
  ])
    await assert.rejects(f.c.create("alice", { ...b, ...patch }));
  await assert.rejects(f.c.create("mallory", b), /quote_not_found/);
  assert.equal(
    (await f.s.one("SELECT count(*) n FROM sites_mock_orders")).n,
    0,
  );
});

test("D1: webhook window and concurrency survive new instances; invalid attempts recover after cooldown", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  let now = 1000;
  const budget = () =>
    new D1WindowBudget(new D1Ledger(db), {
      limit: 3,
      concurrency: 1,
      now: () => now,
    });
  const started = gate(),
    release = gate();
  const one = budget().run(async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;
  await assert.rejects(
    budget().run(() => {}),
    /budget_exhausted/,
  );
  release.resolve();
  await one;
  await assert.rejects(
    budget().run(() => {
      throw Error("invalid signature");
    }),
  );
  await assert.rejects(
    budget().run(() => {
      throw Error("invalid signature");
    }),
  );
  await assert.rejects(
    budget().run(() => {}),
    /budget_exhausted/,
  );
  now += 60001;
  assert.equal(
    await budget().run(() => "fully verified callback"),
    "fully verified callback",
  );
  await db
    .prepare("INSERT INTO sites_external_work VALUES('orphan','webhooks-v1')")
    .run();
  now += 60001;
  await assert.rejects(
    budget().run(() => {}),
    /budget_exhausted/,
  );
});

test("D1: actual ledger file reopens with the same owner wardrobe and rejects provider mode change", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gca-d1-")),
    path = join(dir, "d1.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = sqliteD1(path),
    s = new D1Ledger(db),
    p = new D1MockProvider(s),
    c = new D1Commerce(s, p);
  await c.init();
  const q = await c.quote("alice", "rosalyn-gala"),
    o = await c.create("alice", { ...q, quoteId: q.id, confirm: true });
  await p.approve(o.provider_id);
  await c.capture("alice", o.id);
  await c.settle(o.id, await p.inspect(o.provider_id), "fake-signed");
  await new D1Game(s).equip("alice", o.sku);
  db.close();
  db = sqliteD1(path, false);
  t.after(() => db.close());
  s = new D1Ledger(db);
  assert.equal((await new D1Game(s).state("alice")).equipped, o.sku);
  assert.deepEqual((await new D1Game(s).state("bob")).owned, []);
  await assert.rejects(
    s.bindProvider("paypal-sandbox", "fake-seller"),
    /mismatch/,
  );
});

function paypalTransport() {
  let unit,
    status = "CREATED",
    captured = false;
  const f = {
    paths: [],
    signature: "SUCCESS",
    merchant: "XB5RWXEAFHG8J",
    amount: "1.99",
    parent: "FAKE-ORDER",
    refundLink:
      "https://api-m.sandbox.paypal.com/v2/payments/captures/FAKE-CAPTURE",
  };
  const cap = () => ({
    id: "FAKE-CAPTURE",
    status: "COMPLETED",
    final_capture: true,
    amount: { value: f.amount, currency_code: "USD" },
    supplementary_data: { related_ids: { order_id: f.parent } },
  });
  f.approve = () => {
    status = "APPROVED";
  };
  f.completed = () => ({
    id: "FAKE-COMPLETE-EVENT",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: cap(),
  });
  f.refund = () => ({
    id: "FAKE-REVERSED-EVENT",
    event_type: "PAYMENT.CAPTURE.REVERSED",
    resource_type: "refund",
    resource: {
      id: "FAKE-REFUND",
      links: [
        {
          rel: "up",
          href: "https://api-m.sandbox.paypal.com/v2/payments/captures/FAKE-CAPTURE",
        },
      ],
    },
  });
  f.fetcher = async (url, options) => {
    assert.equal(new URL(url).origin, "https://api-m.sandbox.paypal.com");
    assert.equal(options.redirect, "error");
    const path = new URL(url).pathname;
    f.paths.push(path);
    let data;
    if (path === "/v1/oauth2/token") {
      assert.equal(options.headers.Authorization, "Basic ZmFrZTpmYWtl");
      data = { access_token: "fake-token" };
    } else if (path === "/v1/notifications/verify-webhook-signature") {
      assert.equal(JSON.parse(options.body).webhook_id, "FAKE-WEBHOOK");
      data = { verification_status: f.signature };
    } else if (path === "/v2/checkout/orders") {
      unit = JSON.parse(options.body).purchase_units[0];
      data = { id: "FAKE-ORDER" };
    } else if (path === "/v2/checkout/orders/FAKE-ORDER/capture") {
      status = "COMPLETED";
      captured = true;
      data = {};
    } else if (path === "/v2/checkout/orders/FAKE-ORDER")
      data = {
        id: "FAKE-ORDER",
        intent: "CAPTURE",
        status,
        purchase_units: [
          {
            ...unit,
            amount: { value: f.amount, currency_code: "USD" },
            payee: { merchant_id: f.merchant },
            payments: { captures: captured ? [cap()] : [] },
          },
        ],
      };
    else if (path === "/v2/payments/captures/FAKE-CAPTURE") data = cap();
    else if (path === "/v2/payments/refunds/FAKE-REFUND")
      data = {
        id: "FAKE-REFUND",
        status: "COMPLETED",
        links: [{ rel: "up", href: f.refundLink }],
      };
    else throw Error("unexpected_synthetic_endpoint");
    return Response.json(data);
  };
  return f;
}
const syntheticSignature = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url":
    "https://api.sandbox.paypal.com/v1/notifications/certs/FAKE",
  "paypal-transmission-id": "FAKE",
  "paypal-transmission-sig": "FAKE",
  "paypal-transmission-time": "FAKE",
};
async function actualAdapterFixture(t) {
  const remote = paypalTransport(),
    f = workerFixture(t, { mode: "paypal-sandbox", transport: remote.fetcher });
  Object.assign(f.env, {
    PAYPAL_MERCHANT_ID: "XB5RWXEAFHG8J",
    PAYPAL_WEBHOOK_ID: "FAKE-WEBHOOK",
    PAYPAL_OAUTH_BASIC_AUTH_HEADER: "Basic ZmFrZTpmYWtl",
    SANDBOX_PAYMENTS_ENABLED: "true",
  });
  await f.login();
  assert.equal(f.calls, 0);
  const q = await (
    await f.call("/api/commerce/quotes", { sku: "rosalyn-gala" })
  ).json();
  const response = await f.call("/api/commerce/orders", {
    ...q,
    quoteId: q.id,
    confirm: true,
  });
  assert.equal(response.status, 201);
  return { ...f, remote, o: await response.json() };
}

test("Sites: actual PayPal adapter + D1 + Worker with fake HTTP, anonymous verified callback grants once and reversal revokes", async (t) => {
  const f = await actualAdapterFixture(t),
    path = `/api/commerce/orders/${f.o.id}`;
  assert.equal((await f.call(path + "/mock-approve", {})).status, 404);
  f.remote.approve();
  assert.equal(
    (await (await f.call(path + "/capture", {})).json()).status,
    "AWAITING_WEBHOOK",
  );
  const headers = { ...syntheticSignature, "oai-authenticated-user-id": "" };
  f.remote.signature = "FAILURE";
  assert.equal(
    (await f.call("/api/paypal/webhooks", f.remote.completed(), headers))
      .status,
    401,
  );
  assert.deepEqual((await (await f.call("/api/game")).json()).owned, []);
  f.remote.signature = "SUCCESS";
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await (
          await f.call("/api/paypal/webhooks", f.remote.completed(), headers)
        ).json()
      ).status,
      "GRANTED",
    );
  await f.call("/api/game/equip", { sku: "rosalyn-gala" });
  assert.equal((await (await f.call("/api/game")).json()).formal, true);
  f.remote.refundLink =
    "https://evil.invalid/v2/payments/captures/FAKE-CAPTURE";
  assert.equal(
    (await f.call("/api/paypal/webhooks", f.remote.refund(), headers)).status,
    502,
  );
  assert.equal((await (await f.call("/api/game")).json()).formal, false); // signed known hold persists before lookup failure
  f.remote.refundLink =
    "https://api-m.sandbox.paypal.com/v2/payments/captures/FAKE-CAPTURE";
  assert.equal(
    (
      await (
        await f.call("/api/paypal/webhooks", f.remote.refund(), headers)
      ).json()
    ).status,
    "REVIEW",
  );
  f.restart();
  await f.login();
  assert.equal(
    (
      await (
        await f.call("/api/paypal/webhooks", f.remote.completed(), headers)
      ).json()
    ).status,
    "REVIEW",
  );
  assert.deepEqual((await (await f.call("/api/game")).json()).owned, []);
  assert.equal(
    f.db.sqlite
      .prepare(
        "SELECT count(*) n FROM sites_events WHERE name='entitlement_granted'",
      )
      .get().n,
    1,
  );
});

test("Sites: actual adapter rejects wrong seller/amount/order; disabled configuration never starts OAuth", async (t) => {
  const f = await actualAdapterFixture(t),
    path = `/api/commerce/orders/${f.o.id}`;
  f.remote.approve();
  f.remote.merchant = "OTHER-SELLER";
  assert.equal(
    (await (await f.call(path + "/capture", {})).json()).error,
    "merchant_mismatch",
  );
  f.remote.merchant = "XB5RWXEAFHG8J";
  f.remote.amount = "0.01";
  assert.equal(
    (await (await f.call(path + "/capture", {})).json()).error,
    "payment_amount_mismatch",
  );
  f.remote.amount = "1.99";
  f.remote.parent = "WRONG-ORDER";
  assert.equal(
    (await (await f.call(path + "/capture", {})).json()).error,
    "capture_order_mismatch",
  );
  assert.deepEqual((await (await f.call("/api/game")).json()).owned, []);
  const before = f.remote.paths.length;
  f.env.SANDBOX_PAYMENTS_ENABLED = "false";
  assert.equal(
    (
      await f.call(
        "/api/paypal/webhooks",
        f.remote.completed(),
        syntheticSignature,
      )
    ).status,
    503,
  );
  assert.equal((await f.call(path + "/capture", {})).status, 503);
  assert.equal(f.remote.paths.length, before);
});

test("D1: refund arriving during inspect prevents the later capture call", async (t) => {
  const f = await fixture(t),
    { o } = await f.create();
  await f.p.approve(o.provider_id);
  const started = gate(),
    release = gate(),
    inspect = f.p.inspect.bind(f.p);
  let captureCalls = 0;
  f.p.inspect = async (id) => {
    const remote = await inspect(id);
    started.resolve();
    await release.promise;
    return remote;
  };
  f.p.capture = async () => {
    captureCalls++;
    throw Error("capture_must_not_start");
  };
  f.p.verifyWebhook = async () => true;
  f.p.eventReference = async () => ({
    providerId: o.provider_id,
    captureId: "FAKE-HELD-CAPTURE",
  });
  const pending = f.c.capture("alice", o.id);
  await started.promise;
  await f.c.webhook(
    {},
    {
      id: "FAKE-EARLY-HOLD",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "FAKE-REFUND",
        supplementary_data: {
          related_ids: {
            order_id: o.provider_id,
            capture_id: "FAKE-HELD-CAPTURE",
          },
        },
      },
    },
  );
  release.resolve();
  await assert.rejects(pending, /operation_changed/);
  assert.equal(captureCalls, 0);
  assert.equal((await f.c.owned("alice", o.id)).status, "REVIEW");
});
