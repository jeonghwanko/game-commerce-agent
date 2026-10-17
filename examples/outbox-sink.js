// Local durable sink example only. A real destination needs its own atomic
// receipt + business-effect transaction and must ACK only after durable commit.
import { DatabaseSync } from "node:sqlite";
import { EVENT_NAMES } from "../src/events.js";

export class SqliteEventSink {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS received_events (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS event_counts (name TEXT PRIMARY KEY, count INTEGER NOT NULL);`);
  }
  async accept(event) {
    if (
      Object.keys(event).sort().join(",") !== "at,id,name,order_id,user_id" ||
      !EVENT_NAMES.has(event.name) ||
      !Number.isSafeInteger(event.at) ||
      typeof event.id !== "string" ||
      !event.id ||
      event.id.length > 256 ||
      typeof event.user_id !== "string" ||
      !event.user_id ||
      event.user_id.length > 256 ||
      !(
        event.order_id === null ||
        (typeof event.order_id === "string" && event.order_id.length <= 256)
      )
    )
      throw new Error("invalid_sink_event");
    const payload = JSON.stringify([
      event.user_id,
      event.order_id,
      event.name,
      event.at,
    ]);
    this.db.exec("BEGIN IMMEDIATE");
    let status;
    try {
      const prior = this.db
        .prepare("SELECT payload FROM received_events WHERE id=?")
        .get(event.id);
      if (prior && prior.payload !== payload)
        throw new Error("event_id_conflict");
      status = prior ? "duplicate" : "accepted";
      if (!prior) {
        this.db
          .prepare("INSERT INTO received_events VALUES(?,?)")
          .run(event.id, payload);
        this.db
          .prepare(
            "INSERT INTO event_counts VALUES(?,1) ON CONFLICT(name) DO UPDATE SET count=count+1",
          )
          .run(event.name);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { id: event.id, status };
  }
  close() {
    this.db.close();
  }
}
