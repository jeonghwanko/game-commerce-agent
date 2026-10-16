import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { Commerce } from "../src/commerce.js";
import { MockProvider } from "../src/providers/mock.js";
import { AuthenticatedPrincipalAdapter } from "../src/identity.js";
import { ExternalWorkBudget } from "../src/budget.js";
import { createApp } from "../src/server.js";
import {
  evaluateEntitlementFrom,
  evaluateEntitlement,
} from "../src/vendor/onesub/entitlements.js";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { resolve, promise };
};
const confirm = (q) => ({
  quoteId: q.id,
  sku: q.sku,
  amount: q.amount,
  currency: q.currency,
  version: q.version,
  confirm: true,
});
async function fixture(t) {
  const s = new Store();
  t.after(() => s.close());
  const p = new MockProvider(s);
  const c = new Commerce(s, p);
  const o = await c.create("alice", confirm(c.quote("alice", "rosalyn-gala")));
  return { s, p, c, o };
}
test("concurrent inspect cannot reset capture ownership or enable cancellation", async (t) => {
  const { p, c, o } = await fixture(t);
  const inspect = p.inspect.bind(p);
  const old = await inspect(o.provider_id);
  const delayed = deferred();
  p.inspect = () => delayed.promise;
  const first = c.capture("alice", o.id);
  await assert.rejects(c.capture("alice", o.id), /capture_in_progress/);
  assert.throws(() => c.cancel("alice", o.id), /order_not_cancellable/);
  delayed.resolve(old);
  await assert.rejects(first, /buyer_approval_required/);
  assert.equal(c.cancel("alice", o.id).status, "CANCELLED");
  let captures = 0;
  p.capture = async () => {
    captures++;
  };
  await assert.rejects(c.capture("alice", o.id));
  assert.equal(captures, 0);
});
test("expired operation with delayed CREATED cannot overwrite newer APPROVED operation", async (t) => {
  const { p, c, o } = await fixture(t);
  const inspect = p.inspect.bind(p);
  const stale = await inspect(o.provider_id);
  await p.approve(o.provider_id);
  const approved = await inspect(o.provider_id);
  const older = deferred(),
    newer = deferred();
  let reads = 0;
  p.inspect = () =>
    ++reads === 1
      ? older.promise
      : reads === 2
        ? newer.promise
        : inspect(o.provider_id);
  let now = Date.now();
  c.clock = () => now;
  const first = c.capture("alice", o.id);
  now += 300001;
  const second = c.capture("alice", o.id);
  older.resolve(stale);
  await assert.rejects(first, /capture_operation_changed/);
  assert.equal(c.owned("alice", o.id).status, "CAPTURE_PENDING");
  assert.throws(() => c.cancel("alice", o.id));
  newer.resolve(approved);
  await second;
  assert.equal(c.owned("alice", o.id).status, "AWAITING_WEBHOOK");
});
test("refund while inspect awaits prevents subsequent capture side effect", async (t) => {
  const { s, p, c, o } = await fixture(t);
  await p.approve(o.provider_id);
  const remote = await p.inspect(o.provider_id);
  const delayed = deferred();
  p.inspect = () => delayed.promise;
  const running = c.capture("alice", o.id);
  s.run("UPDATE orders SET review=1,status='REVIEW' WHERE id=?", o.id);
  let captures = 0;
  p.capture = async () => {
    captures++;
  };
  delayed.resolve(remote);
  await assert.rejects(running, /capture_operation_changed/);
  assert.equal(captures, 0);
});
test("atomic grant rolls back receipt, capture flag and entitlement on event failure", async (t) => {
  const { s, p, c, o } = await fixture(t);
  await p.approve(o.provider_id);
  const remote = await p.capture(o.provider_id);
  const event = s.event.bind(s);
  s.event = (user, name, id) => {
    if (name === "entitlement_granted") throw new Error("disk failure");
    return event(user, name, id);
  };
  assert.throws(() => c.settle(o.id, remote, "verified"), /disk failure/);
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 0);
  assert.equal(s.get("SELECT count(*) n FROM webhook_receipts").n, 0);
  assert.equal(c.owned("alice", o.id).capture_verified, 0);
  s.event = event;
  c.settle(o.id, remote, "verified");
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 1);
});
test("verified refund before local provider binding blocks later completion", async (t) => {
  const { s, p, c, o } = await fixture(t);
  p.verifyWebhook = async () => true;
  await p.approve(o.provider_id);
  const remote = await p.capture(o.provider_id);
  s.run("UPDATE orders SET provider_id=NULL WHERE id=?", o.id);
  const refund = {
    id: "early-refund",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: {
      id: "REFUND",
      links: [
        {
          rel: "up",
          href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${remote.captureId}`,
        },
      ],
    },
  };
  await assert.rejects(c.webhook({}, refund), /webhook_order_not_found/);
  s.run("UPDATE orders SET provider_id=? WHERE id=?", o.provider_id, o.id);
  c.settle(o.id, remote, "late-completed");
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 0);
  assert.equal(c.owned("alice", o.id).status, "REVIEW");
});
test("database payment provider binding survives restart and rejects mode mixing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gca-mode-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "db");
  const a = new Store(path);
  a.bindProvider("mock");
  a.close();
  const b = new Store(path);
  assert.throws(
    () => b.bindProvider("paypal-sandbox"),
    /database_provider_mismatch/,
  );
  b.bindProvider("mock");
  b.close();
});
test("authenticated principal restores one stable pseudonym across login sessions and never trusts identity headers", async (t) => {
  const { s } = await fixture(t);
  let principal;
  const adapter = new AuthenticatedPrincipalAdapter({
    issuer: "test-game",
    resolveVerifiedPrincipal: async () => principal,
  });
  const req = {
    headers: { "x-user-id": "alice", "x-dev-user": "alice" },
    url: "/?userId=alice",
  };
  await assert.rejects(
    adapter.resolve(req, s),
    /authenticated_principal_required/,
  );
  principal = {
    authenticated: true,
    issuer: "test-game",
    subject: "stable-account",
    expiresAt: Date.now() + 100000,
    csrfToken: "a".repeat(24),
  };
  const first = await adapter.resolve(req, s);
  principal = { ...principal, csrfToken: "b".repeat(24) };
  const second = await adapter.resolve(req, s);
  assert.equal(second.user_id, first.user_id);
  assert.notEqual(second.csrf, first.csrf);
  principal = { ...principal, subject: "other-account" };
  assert.notEqual((await adapter.resolve(req, s)).user_id, first.user_id);
  principal = { ...principal, expiresAt: 0 };
  await assert.rejects(adapter.resolve(req, s));
  assert.ok(
    !JSON.stringify(s.all("SELECT * FROM principals")).includes(
      "stable-account",
    ),
  );
});
test("real AI denies anonymous mode and missing access/budget even with a supplied adapter", () => {
  for (const options of [
    {},
    { authMode: "principal", identity: { resolve: async () => null } },
    {
      authMode: "principal",
      identity: { resolve: async () => null },
      aiAccessEnabled: true,
    },
  ]) {
    const s = new Store();
    assert.throws(
      () =>
        createApp({ store: s, recommender: { mode: "openai" }, ...options }),
      /real_ai_access_not_authorized/,
    );
    s.close();
  }
});
test("global external budget resists new sessions and restarts; concurrency is bounded", async () => {
  const s = new Store();
  const budget = new ExternalWorkBudget(s, {
    name: "webhook",
    limit: 2,
    concurrency: 1,
  });
  const d = deferred();
  const one = budget.run(() => d.promise);
  await assert.rejects(
    budget.run(async () => {}),
    /external_concurrency_exhausted/,
  );
  d.resolve();
  await one;
  await budget.run(async () => {});
  const restarted = new ExternalWorkBudget(s, {
    name: "webhook",
    limit: 2,
    concurrency: 1,
  });
  await assert.rejects(
    restarted.run(async () => {}),
    /external_budget_exhausted/,
  );
  s.close();
});
test("OneSub extracted evaluator matches upstream semantics and async store boundary", async () => {
  const now = 1000;
  const e = { productIds: ["gala"] };
  const future = new Date(2000).toISOString(),
    past = new Date(0).toISOString();
  const cases = [
    { subs: [], purchases: [], expected: { active: false, source: null } },
    {
      subs: [],
      purchases: [{ productId: "gala", type: "consumable" }],
      expected: { active: false, source: null },
    },
    {
      subs: [],
      purchases: [{ productId: "gala", type: "non_consumable" }],
      expected: { active: true, source: "purchase", productId: "gala" },
    },
    {
      subs: [{ productId: "gala", status: "active", expiresAt: future }],
      purchases: [],
      expected: {
        active: true,
        source: "subscription",
        productId: "gala",
        expiresAt: future,
      },
    },
    {
      subs: [{ productId: "gala", status: "expired", expiresAt: future }],
      purchases: [],
      expected: { active: false, source: null },
    },
    {
      subs: [
        {
          productId: "gala",
          status: "grace_period",
          expiresAt: past,
          gracePeriodExpiresAt: future,
        },
      ],
      purchases: [],
      expected: {
        active: true,
        source: "subscription",
        productId: "gala",
        expiresAt: past,
      },
    },
  ];
  for (const c of cases)
    assert.deepEqual(
      evaluateEntitlementFrom(c.subs, c.purchases, e, now),
      c.expected,
    );
  let reads = 0;
  const result = await evaluateEntitlement(
    "principal",
    e,
    {
      getAllByUserId: async (id) => {
        assert.equal(id, "principal");
        return [];
      },
    },
    {
      getPurchasesByUserId: async (id) => {
        reads++;
        assert.equal(id, "principal");
        return [{ productId: "gala", type: "non_consumable" }];
      },
    },
  );
  assert.equal(result.active, true);
  assert.equal(reads, 1);
});
