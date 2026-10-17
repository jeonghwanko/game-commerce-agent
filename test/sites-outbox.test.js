import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { deliverOutbox } from "../src/outbox.js";
import { D1Ledger } from "../sites/d1.js";
import { sqliteD1 } from "../sites/testing/d1-fixture.js";
import { deliverSitesOutbox } from "../sites/outbox.js";
import { SqliteEventSink } from "../examples/outbox-sink.js";

for (const kind of ["Node", "D1"]) {
  test(`${kind} outbox: wrong/missing/rejected ACK never clears a pending event`, async () => {
    const db = kind === "D1" ? sqliteD1() : new Store();
    const s = kind === "D1" ? new D1Ledger(db) : db;
    try {
      await s.event("opaque-user", "shop_opened");
      const [event] = await s.outbox();
      for (const ack of [
        undefined,
        true,
        {},
        { id: "wrong", status: "accepted" },
        { id: event.id, status: "rejected" },
        { id: event.id },
      ]) {
        await assert.rejects(
          deliverOutbox(s, { accept: async () => ack }),
          /invalid_outbox_ack/,
        );
        assert.equal((await s.outbox()).length, 1);
      }
      await assert.rejects(
        deliverOutbox(s, {
          accept: async (e) => {
            e.id = "mutated";
            return { id: e.id, status: "accepted" };
          },
        }),
      );
      assert.equal((await s.outbox())[0].id, event.id);
      for (const limit of [0, -1, 101, 1.5, "10"])
        await assert.rejects(
          deliverOutbox(s, {}, limit),
          /invalid_outbox_limit/,
        );
      await deliverOutbox(s, {
        accept: async (e) => ({ id: e.id, status: "accepted" }),
      });
      assert.equal((await s.outbox()).length, 0);
    } finally {
      db.close();
    }
  });
}

test("Sites outbox: lost acceptance, failed ACK, process reopen and concurrent drains preserve one durable sink effect", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gca-outbox-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, "source.sqlite"),
    sinkPath = join(dir, "sink.sqlite");
  let db = sqliteD1(sourcePath),
    sink = new SqliteEventSink(sinkPath);
  let s = new D1Ledger(db);
  for (let i = 0; i < 10; i++) await s.event("opaque-user", "shop_opened");
  const [first] = await s.outbox();
  await assert.rejects(
    deliverSitesOutbox(db, {
      accept: async (e) => {
        await sink.accept(e);
        throw Error("lost_acceptance");
      },
    }),
    /lost_acceptance/,
  );
  assert.equal((await s.outbox()).length, 10);
  db.close();
  sink.close();
  db = sqliteD1(sourcePath, false);
  sink = new SqliteEventSink(sinkPath);
  s = new D1Ledger(db);
  const second = sqliteD1(sourcePath, false),
    secondSink = new SqliteEventSink(sinkPath);
  try {
    db.fail = (sql) => sql.startsWith("UPDATE sites_events SET delivered");
    await assert.rejects(deliverSitesOutbox(db, sink), /synthetic_SQL_failure/);
    assert.equal((await s.outbox())[0].id, first.id);
    db.fail = null;
    await Promise.all([
      deliverSitesOutbox(db, sink),
      deliverSitesOutbox(second, secondSink),
    ]);
    assert.equal((await s.outbox()).length, 0);
    assert.equal(
      sink.db.prepare("SELECT count(*) n FROM received_events").get().n,
      10,
    );
    assert.equal(
      sink.db
        .prepare("SELECT count FROM event_counts WHERE name='shop_opened'")
        .get().count,
      10,
    );
    assert.deepEqual(await sink.accept(first), {
      id: first.id,
      status: "duplicate",
    });
    await assert.rejects(
      sink.accept({ ...first, user_id: "different-user" }),
      /event_id_conflict/,
    );
    await assert.rejects(
      sink.accept({ ...first, metadata: "private text" }),
      /invalid_sink_event/,
    );
  } finally {
    db.close();
    sink.close();
    second.close();
    secondSink.close();
  }
});
