import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { Commerce } from "../src/commerce.js";
import { MockProvider } from "../src/providers/mock.js";
function fixture(t, path) {
  const s = new Store(path);
  t.after(() => s.close());
  const p = new MockProvider(s);
  const c = new Commerce(s, p);
  return { s, p, c };
}
function confirmation(q) {
  return {
    quoteId: q.id,
    sku: q.sku,
    amount: q.amount,
    currency: q.currency,
    version: q.version,
    confirm: true,
  };
}
async function order(c) {
  return c.create("alice", confirmation(c.quote("alice", "rosalyn-gala")));
}
async function paid(c, p, o) {
  await p.approve(o.provider_id);
  await c.capture("alice", o.id);
  return p.inspect(o.provider_id);
}
function event(r, id = "evt-1", type = "PAYMENT.CAPTURE.COMPLETED") {
  return {
    id,
    event_type: type,
    resource: {
      id: r.captureId,
      supplementary_data: { related_ids: { order_id: r.id } },
    },
  };
}
test("explicit confirmation, expiration, price and owner checks", async (t) => {
  const { c } = fixture(t);
  const q = c.quote("alice", "rosalyn-gala");
  for (const patch of [
    { confirm: false },
    { amount: 1 },
    { currency: "EUR" },
    { sku: "fake" },
    { version: 9 },
  ])
    await assert.rejects(c.create("alice", { ...confirmation(q), ...patch }));
  await assert.rejects(c.create("bob", confirmation(q)));
  c.clock = () => q.expires;
  await assert.rejects(c.create("alice", confirmation(q)), /quote_expired/);
  assert.throws(() => c.quote("alice", "fake"));
});
test("capture and verified webhook grant once across duplicates and reversed arrival order", async (t) => {
  const { s, c, p } = fixture(t);
  p.verifyWebhook = async () => true;
  const o = await order(c);
  await p.approve(o.provider_id);
  const r = await p.capture(o.provider_id);
  await c.webhook({}, event(r));
  await c.capture("alice", o.id);
  await c.webhook({}, event(r));
  await c.webhook({}, event(r, "evt-2"));
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 1);
  assert.equal(
    s.get("SELECT count(*) n FROM events WHERE name='entitlement_granted'").n,
    1,
  );
  assert.equal(c.owned("alice", o.id).status, "GRANTED");
});
test("capture alone and unsigned webhook cannot grant", async (t) => {
  const { s, c, p } = fixture(t);
  const o = await order(c);
  await assert.rejects(c.capture("bob", o.id), /order_not_found/);
  await assert.rejects(c.capture("alice", o.id), /buyer_approval_required/);
  const r = await paid(c, p, o);
  assert.equal(c.owned("alice", o.id).status, "AWAITING_WEBHOOK");
  await assert.rejects(c.webhook({}, event(r)), /invalid_webhook/);
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 0);
});
test("concurrent create uses one durable order and provider request", async (t) => {
  const { s, c } = fixture(t);
  const q = c.quote("alice", "rosalyn-gala");
  const a = await Promise.all([
    c.create("alice", confirmation(q)),
    c.create("alice", confirmation(q)),
  ]);
  assert.equal(a[0].id, a[1].id);
  assert.equal(s.get("SELECT count(*) n FROM mock_orders").n, 1);
});
test("create timeout retries stable idempotency key", async (t) => {
  const { s, c, p } = fixture(t);
  const q = c.quote("alice", "rosalyn-gala");
  const create = p.create.bind(p);
  p.create = async (o) => {
    await create(o);
    throw new Error("timeout");
  };
  await assert.rejects(c.create("alice", confirmation(q)));
  p.create = create;
  await c.create("alice", confirmation(q));
  assert.equal(s.get("SELECT count(*) n FROM mock_orders").n, 1);
});
test("capture timeout after remote success reconciles without second capture", async (t) => {
  const { c, p } = fixture(t);
  const o = await order(c);
  await p.approve(o.provider_id);
  const capture = p.capture.bind(p);
  let calls = 0;
  p.capture = async (...args) => {
    calls++;
    await capture(...args);
    throw new Error("timeout");
  };
  await assert.rejects(c.capture("alice", o.id));
  assert.equal(c.owned("alice", o.id).status, "CAPTURE_PENDING");
  await c.capture("alice", o.id);
  assert.equal(calls, 1);
});
test("cancel refuses capture; delayed payment goes to review without grant", async (t) => {
  const { s, c, p } = fixture(t);
  p.verifyWebhook = async () => true;
  const o = await order(c);
  c.cancel("alice", o.id);
  await assert.rejects(c.capture("alice", o.id));
  await p.approve(o.provider_id);
  const r = await p.capture(o.provider_id);
  await c.webhook({}, event(r));
  assert.equal(c.owned("alice", o.id).status, "REVIEW");
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 0);
});
test("definitive capture failure never grants", async (t) => {
  const { s, c, p } = fixture(t);
  const o = await order(c);
  await p.approve(o.provider_id);
  p.capture = async () => {
    throw Object.assign(new Error("declined"), { definitive: true });
  };
  await assert.rejects(c.capture("alice", o.id));
  assert.equal(c.owned("alice", o.id).status, "FAILED");
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 0);
});
test("mismatched amount, currency, owner, status and capture reject atomically", async (t) => {
  const { s, c, p } = fixture(t);
  const o = await order(c);
  const r = await paid(c, p, o);
  for (const patch of [
    { amount: 1 },
    { currency: "EUR" },
    { reference: "bob" },
    { id: "wrong" },
    { captureStatus: "PENDING" },
    { captureId: "" },
  ])
    assert.throws(() => c.settle(o.id, { ...r, ...patch }, "bad"));
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 0);
  assert.equal(s.get("SELECT count(*) n FROM webhook_receipts").n, 0);
});
test("refund before completion cannot be undone by delayed completion", async (t) => {
  const { s, c, p } = fixture(t);
  p.verifyWebhook = async () => true;
  const o = await order(c);
  const r = await paid(c, p, o);
  await c.webhook({}, event(r, "refund", "PAYMENT.CAPTURE.REFUNDED"));
  await c.webhook({}, event(r));
  assert.equal(c.owned("alice", o.id).status, "REVIEW");
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 0);
});
test("ledger and entitlements survive reopening", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gca-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "db.sqlite");
  const s = new Store(path);
  const p = new MockProvider(s);
  const c = new Commerce(s, p);
  const o = await order(c);
  const r = await paid(c, p, o);
  c.settle(o.id, r, "verified-mock");
  s.close();
  const reopened = new Store(path);
  assert.equal(
    reopened.get("SELECT status FROM orders WHERE id=?", o.id).status,
    "GRANTED",
  );
  assert.equal(reopened.get("SELECT count(*) n FROM entitlements").n, 1);
  reopened.close();
});
test("capture IDs cannot be reused for a second order", async (t) => {
  const { s, c, p } = fixture(t);
  const first = await order(c);
  const a = await paid(c, p, first);
  c.settle(first.id, a, "event-first");
  const q = c.quote("bob", "rosalyn-gala");
  const second = await c.create("bob", confirmation(q));
  await p.approve(second.provider_id);
  const b = await p.capture(second.provider_id);
  assert.throws(() =>
    c.settle(second.id, { ...b, captureId: a.captureId }, "event-second"),
  );
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 1);
});
test("refund holds existing grant and removes gameplay effect", async (t) => {
  const { s, c, p } = fixture(t);
  const { GameBridge } = await import("../src/game.js");
  p.verifyWebhook = async () => true;
  const o = await order(c);
  const r = await paid(c, p, o);
  await c.webhook({}, event(r));
  const g = new GameBridge(s);
  g.equip("alice", "rosalyn-gala");
  assert.equal(g.state("alice").formal, true);
  await c.webhook({}, event(r, "refund-after", "PAYMENT.CAPTURE.REFUNDED"));
  assert.equal(g.state("alice").formal, false);
  assert.equal(s.get("SELECT status FROM entitlements").status, "held");
  await c.webhook({}, event(r, "late-completion"));
  assert.equal(g.state("alice").formal, false);
});
test("outbox retries unacknowledged delivery without accepting arbitrary metadata", async (t) => {
  const { s } = fixture(t);
  const { deliverOutbox } = await import("../src/outbox.js");
  s.event("pseudonym", "shop_opened");
  assert.throws(() => s.event("pseudonym", "raw chat message"));
  const first = s.outbox()[0];
  await assert.rejects(
    deliverOutbox(s, {
      accept: async () => {
        throw new Error("sink unavailable");
      },
    }),
  );
  assert.equal(s.outbox()[0].id, first.id);
  let received;
  await deliverOutbox(s, {
    accept: async (e) => {
      received = e;
    },
  });
  assert.equal(received.id, first.id);
  assert.equal(s.outbox().length, 0);
});
test("capture before approval keeps cancellation available", async (t) => {
  const { c } = fixture(t);
  const o = await order(c);
  await assert.rejects(c.capture("alice", o.id), /buyer_approval_required/);
  assert.equal(c.owned("alice", o.id).status, "APPROVAL_PENDING");
  assert.equal(c.cancel("alice", o.id).status, "CANCELLED");
});
test("stale catalog version and old uncertain create fail closed", async (t) => {
  const { s, c, p } = fixture(t);
  const q = c.quote("alice", "rosalyn-gala");
  s.run("UPDATE quotes SET version=0 WHERE id=?", q.id);
  await assert.rejects(
    c.create("alice", confirmation({ ...q, version: 0 })),
    /catalog_changed/,
  );
  const fresh = c.quote("alice", "rosalyn-gala");
  p.create = async () => {
    throw new Error("timeout");
  };
  await assert.rejects(c.create("alice", confirmation(fresh)));
  c.clock = () => Date.now() + 6 * 3600000;
  await assert.rejects(
    c.create("alice", confirmation(fresh)),
    /create_reconciliation_required/,
  );
});
