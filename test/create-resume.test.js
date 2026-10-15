import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { Commerce } from "../src/commerce.js";
import { MockProvider } from "../src/providers/mock.js";
const confirm = (o) => ({
  confirm: true,
  quoteId: o.id,
  sku: o.sku,
  amount: o.amount,
  currency: o.currency,
  version: o.version,
});
function fixture(t) {
  const s = new Store();
  t.after(() => s.close());
  const p = new MockProvider(s);
  let now = Date.now();
  const c = new Commerce(s, p, () => now);
  return { s, p, c, advance: (ms) => (now += ms) };
}
test("lost create response resumes original expired quote with same order/key and no second remote order", async (t) => {
  const { s, p, c, advance } = fixture(t);
  const original = p.create.bind(p);
  let fail = true;
  const keys = [];
  p.create = async (o) => {
    keys.push(o.id);
    const r = await original(o);
    if (fail) {
      fail = false;
      throw new Error("lost response");
    }
    return r;
  };
  const q = c.quote("alice", "rosalyn-gala");
  await assert.rejects(c.create("alice", confirm(q)));
  const o = s.get("SELECT * FROM orders");
  advance(300001);
  await assert.rejects(c.resume("bob", o.id, confirm(o)), /order_not_found/);
  await assert.rejects(
    c.resume("alice", o.id, { ...confirm(o), amount: 99 }),
    /explicit_confirmation/,
  );
  const r = await c.resume("alice", o.id, confirm(o));
  assert.equal(r.status, "APPROVAL_PENDING");
  assert.equal(r.quote_id, q.id);
  assert.deepEqual(keys, [o.id, o.id]);
  assert.equal(s.get("SELECT count(*) n FROM mock_orders").n, 1);
  assert.equal((await c.resume("alice", o.id, confirm(o))).id, o.id);
  assert.equal(keys.length, 2);
});
test("resume beyond provider idempotency window fails without transport; creating cancellation survives later resume", async (t) => {
  const { s, p, c, advance } = fixture(t);
  let calls = 0;
  p.create = async () => {
    calls++;
    throw new Error("timeout");
  };
  await assert.rejects(
    c.create("alice", confirm(c.quote("alice", "rosalyn-gala"))),
  );
  const o = s.get("SELECT * FROM orders");
  advance(5 * 3600000);
  await assert.rejects(
    c.resume("alice", o.id, confirm(o)),
    /create_reconciliation_required/,
  );
  assert.equal(calls, 1);
  assert.equal(c.cancel("alice", o.id).status, "CANCELLED");
  await assert.rejects(
    c.resume("alice", o.id, confirm(o)),
    /order_not_resumable/,
  );
  assert.equal(calls, 1);
});
test("cancellation racing provider create preserves cancelled status and remote correlation", async (t) => {
  const { s, p, c } = fixture(t);
  const original = p.create.bind(p);
  let release;
  const gate = new Promise((r) => (release = r));
  p.create = async (o) => {
    const r = await original(o);
    await gate;
    return r;
  };
  const creating = c.create("alice", confirm(c.quote("alice", "rosalyn-gala")));
  const o = s.get("SELECT * FROM orders");
  c.cancel("alice", o.id);
  release();
  const r = await creating;
  assert.equal(r.status, "CANCELLED");
  assert.ok(r.provider_id);
  await assert.rejects(c.capture("alice", o.id));
  assert.equal(s.get("SELECT count(*) n FROM entitlements").n, 0);
});
