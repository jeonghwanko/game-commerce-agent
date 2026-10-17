import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/store.js";
import { GameBridge } from "../src/game.js";
import { sqliteD1 } from "../sites/testing/d1-fixture.js";
import { D1Ledger } from "../sites/d1.js";
import { D1Game } from "../sites/game.js";
import { D1Commerce } from "../sites/commerce.js";
import { D1MockProvider } from "../sites/mock-provider.js";
import { readFileSync } from "node:fs";
import { Commerce } from "../src/commerce.js";
import { MockProvider } from "../src/providers/mock.js";

async function fixture(t) {
  const db = sqliteD1(),
    s = new D1Ledger(db),
    p = new D1MockProvider(s),
    c = new D1Commerce(s, p),
    g = new D1Game(s);
  t.after(() => db.close());
  await c.init();
  const q = await c.quote("alice", "rosalyn-gala");
  const o = await c.create("alice", { ...q, quoteId: q.id, confirm: true });
  await p.approve(o.provider_id);
  await c.capture("alice", o.id);
  const remote = await p.inspect(o.provider_id);
  await c.settle(o.id, remote, "synthetic-completion");
  await g.state("alice");
  await s.run(
    "UPDATE sites_game SET borrowed=1,seal=1,rumor=1 WHERE user_id='alice'",
  );
  p.verifyWebhook = async () => true;
  p.eventReference = async () => ({
    providerId: o.provider_id,
    captureId: remote.captureId,
  });
  const refund = () =>
    c.webhook(
      {},
      {
        id: "synthetic-refund",
        event_type: "PAYMENT.CAPTURE.REFUNDED",
        resource_type: "capture",
        resource: {
          id: remote.captureId,
          supplementary_data: { related_ids: { order_id: o.provider_id } },
        },
      },
    );
  return { db, s, p, c, g, o, refund };
}

test("D1 equip: concurrent duplicate keys and no-op keys record one transition; replay returns current state", async (t) => {
  const { db, s, g, o } = await fixture(t),
    id = randomUUID();
  await Promise.all(
    Array.from({ length: 8 }, () => g.equip("alice", o.sku, id)),
  );
  await g.equip("alice", o.sku, randomUUID());
  assert.equal(
    (
      await s.one(
        "SELECT count(*) n FROM sites_events WHERE name='item_equipped'",
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await s.one(
        "SELECT count(*) n FROM sites_events WHERE name='npc_reaction_triggered'",
      )
    ).n,
    1,
  );
  await assert.rejects(
    g.equip("alice", "borrowed", id),
    /equip_request_conflict/,
  );
  assert.equal((await g.state("alice")).equipped, o.sku);
  await g.equip("alice", "borrowed", randomUUID());
  assert.equal((await g.equip("alice", o.sku, id)).equipped, "borrowed");
  await assert.rejects(g.equip("bob", o.sku, id), /entitlement_required/);
  assert.equal(
    (
      await s.one(
        "SELECT count(*) n FROM sites_events WHERE name='item_equipped'",
      )
    ).n,
    2,
  );
  assert.equal(
    db.sqlite
      .prepare(
        "SELECT count(*) n FROM sites_equip_requests WHERE user_id='bob'",
      )
      .get().n,
    0,
  );
});

for (const timing of ["before equip batch", "after equip batch"]) {
  test(`D1 refund race ${timing}: held rights cannot be re-equipped or returned on replay`, async (t) => {
    const { db, s, g, o, refund } = await fixture(t),
      id = randomUUID();
    let injected = false;
    db.before = async (sql) => {
      if (
        injected ||
        (timing === "before equip batch"
          ? sql !== "BATCH"
          : !sql.startsWith("SELECT sku FROM sites_equip_requests"))
      )
        return;
      injected = true;
      await refund();
    };
    if (timing === "before equip batch")
      await assert.rejects(g.equip("alice", o.sku, id), /entitlement_required/);
    else {
      const result = await g.equip("alice", o.sku, id);
      assert.equal(result.equipped, null);
      assert.deepEqual(result.owned, []);
      assert.equal((await g.equip("alice", o.sku, id)).equipped, null);
    }
    assert.equal(injected, true);
    await assert.rejects(
      g.equip("alice", o.sku, randomUUID()),
      /entitlement_required/,
    );
    const result = await g.state("alice");
    assert.equal(result.canEnter, false);
    assert.equal(result.seal, true);
    assert.equal(result.rumor, true);
    assert.equal(result.borrowed, true);
    assert.equal(
      (await s.one("SELECT equipped FROM sites_game WHERE user_id='alice'"))
        .equipped,
      null,
    );
    assert.equal((await g.equip("alice", "borrowed")).canEnter, true);
  });
}

test("D1 equip: write failure rolls receipt back; optional analytics failure leaves quests and equipment usable", async (t) => {
  const { db, s, g, o } = await fixture(t),
    id = randomUUID();
  db.fail = (sql) => sql.startsWith("UPDATE sites_game SET equipped=?");
  await assert.rejects(g.equip("alice", o.sku, id), /synthetic_SQL_failure/);
  assert.equal(
    await s.one("SELECT * FROM sites_equip_requests WHERE request_id=?", id),
    null,
  );
  db.fail = (sql) => sql.includes("INTO sites_events");
  assert.equal((await g.equip("alice", o.sku, id)).equipped, o.sku);
  const challenge = await g.begin("bob", "shop");
  assert.equal((await g.quest("bob", challenge)).borrowed, true);
  assert.equal((await g.equip("bob", "borrowed")).equipped, "borrowed");
  assert.throws(
    () => s.event("bob", "private raw transcript"),
    /invalid_event/,
  );
});

test("Node equip: replay, no-op and optional observation failures never duplicate transitions or block play", () => {
  const s = new Store();
  try {
    const g = new GameBridge(s),
      id = randomUUID();
    g.quest("alice", "borrowed");
    g.equip("alice", "borrowed", id);
    g.equip("alice", "borrowed", id);
    g.equip("alice", "borrowed", randomUUID());
    assert.equal(
      s.get("SELECT count(*) n FROM events WHERE name='item_equipped'").n,
      1,
    );
    assert.throws(
      () => g.equip("alice", "rosalyn-gala", id),
      /equip_request_conflict/,
    );
    s.event = () => {
      throw Error("analytics_failed");
    };
    assert.equal(g.quest("bob", "borrowed").borrowed, true);
    assert.equal(g.equip("bob", "borrowed").equipped, "borrowed");
    assert.equal(g.quest("bob", "seal").seal, true);
    assert.equal(g.quest("bob", "rumor").canEnter, true);
  } finally {
    s.close();
  }
});

test("D1: a persisted verified refund denies equip before materialized holds finish", async (t) => {
  const { s, g, o } = await fixture(t);
  await g.equip("alice", o.sku);
  await s.run(
    "INSERT INTO sites_verified_events VALUES(?,?,?,?,?)",
    "mock",
    "persisted-hold",
    "PAYMENT.CAPTURE.REFUNDED",
    o.provider_id,
    null,
  );
  assert.equal((await g.state("alice")).equipped, null);
  await assert.rejects(g.equip("alice", o.sku), /entitlement_required/);
});

test("Node: persisted verified refund overrides active rows and old equip receipts", async () => {
  const s = new Store();
  try {
    const p = new MockProvider(s),
      c = new Commerce(s, p),
      g = new GameBridge(s);
    const q = c.quote("alice", "rosalyn-gala");
    const o = await c.create("alice", { ...q, quoteId: q.id, confirm: true });
    await p.approve(o.provider_id);
    await c.capture("alice", o.id);
    c.settle(o.id, await p.inspect(o.provider_id), "synthetic-completion");
    const id = randomUUID();
    g.equip("alice", o.sku, id);
    s.run(
      "INSERT INTO verified_webhooks VALUES(?,?,?,?,?)",
      "mock",
      "persisted-hold",
      "PAYMENT.CAPTURE.REFUNDED",
      o.provider_id,
      null,
    );
    assert.equal(g.state("alice").equipped, null);
    assert.equal(g.equip("alice", o.sku, id).equipped, null);
    assert.throws(() => g.equip("alice", o.sku), /entitlement_required/);
    assert.equal(g.state("alice").entitlements[0].status, "held");
  } finally {
    s.close();
  }
});

test("additive D1 migration preserves prior schemas and game/event rows", () => {
  const db = sqliteD1(":memory:", false);
  try {
    for (const name of ["0001_commerce.sql", "0002_ai_requests.sql"])
      db.sqlite.exec(
        readFileSync(
          new URL(`../sites/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    db.sqlite.exec(
      "INSERT INTO sites_game VALUES('old-player','borrowed',1,1,1); INSERT INTO sites_events VALUES('old-event','old-player',NULL,'item_equipped',123,0);",
    );
    const schema = db.sqlite
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
      )
      .all();
    const before = JSON.stringify([
      db.sqlite.prepare("SELECT * FROM sites_game").all(),
      db.sqlite.prepare("SELECT * FROM sites_events").all(),
    ]);
    db.sqlite.exec(
      readFileSync(
        new URL("../sites/migrations/0003_equip_requests.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      db.sqlite
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name<>'sites_equip_requests' ORDER BY name",
        )
        .all(),
      schema,
    );
    assert.equal(
      JSON.stringify([
        db.sqlite.prepare("SELECT * FROM sites_game").all(),
        db.sqlite.prepare("SELECT * FROM sites_events").all(),
      ]),
      before,
    );
  } finally {
    db.close();
  }
});
