import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { EVENT_NAMES, eventLimit, eventIds } from "./events.js";
export { EVENT_NAMES } from "./events.js";
export class Store {
  constructor(path = ":memory:") {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sku TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, version INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, quote_id TEXT UNIQUE NOT NULL REFERENCES quotes(id), user_id TEXT NOT NULL, sku TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, version INTEGER NOT NULL, provider TEXT NOT NULL, provider_id TEXT UNIQUE, status TEXT NOT NULL, capture_id TEXT UNIQUE, capture_verified INTEGER NOT NULL DEFAULT 0, webhook_verified INTEGER NOT NULL DEFAULT 0, review INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS entitlements (user_id TEXT NOT NULL, sku TEXT NOT NULL, source_order_id TEXT UNIQUE NOT NULL REFERENCES orders(id), status TEXT NOT NULL DEFAULT 'active', PRIMARY KEY(user_id,sku));
      CREATE TABLE IF NOT EXISTS webhook_receipts (id TEXT PRIMARY KEY, order_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT, name TEXT NOT NULL, at INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS mock_orders (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, capture_id TEXT);
      CREATE TABLE IF NOT EXISTS game (user_id TEXT PRIMARY KEY, equipped TEXT, seal INTEGER NOT NULL DEFAULT 0, rumor INTEGER NOT NULL DEFAULT 0, borrowed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS equip_requests (user_id TEXT NOT NULL, request_id TEXT NOT NULL, sku TEXT NOT NULL, PRIMARY KEY(user_id,request_id));
      CREATE TABLE IF NOT EXISTS environment (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS external_budgets (name TEXT PRIMARY KEY, used INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS external_budget_policy (name TEXT PRIMARY KEY, ceiling INTEGER NOT NULL, concurrency INTEGER NOT NULL, window_ms INTEGER NOT NULL, started INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS external_work (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS capture_operations (order_id TEXT PRIMARY KEY REFERENCES orders(id), token TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS principals (identity_hash TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS verified_webhooks (provider TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, provider_id TEXT, capture_id TEXT, PRIMARY KEY(provider,id));`);
  }
  bindProvider(provider) {
    this.transaction(() => {
      const bound = this.get(
        "SELECT value FROM environment WHERE key='payment_provider'",
      );
      const incompatible = this.get(
        "SELECT 1 FROM orders WHERE provider<>? LIMIT 1",
        provider,
      );
      if ((bound && bound.value !== provider) || incompatible)
        throw new Error("database_provider_mismatch");
      this.run(
        "INSERT OR IGNORE INTO environment VALUES('payment_provider',?)",
        provider,
      );
    });
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  event(user, name, order = null) {
    if (!EVENT_NAMES.has(name)) throw new Error("invalid_event");
    this.run(
      "INSERT INTO events(id,user_id,order_id,name,at) VALUES(?,?,?,?,?)",
      randomUUID(),
      user,
      order,
      name,
      Date.now(),
    );
  }
  outbox(limit = 100) {
    return this.all(
      "SELECT id,user_id,order_id,name,at FROM events WHERE delivered=0 ORDER BY at,id LIMIT ?",
      eventLimit(limit),
    );
  }
  acknowledge(ids) {
    eventIds(ids);
    this.transaction(() => {
      for (const id of ids)
        this.run("UPDATE events SET delivered=1 WHERE id=?", id);
    });
  }
  // Optional game/UX observations only. Payment audit events still use event()
  // inside their authority transaction and must fail closed on write failure.
  observe(...args) {
    try {
      this.event(...args);
      return true;
    } catch {
      return false;
    }
  }
  close() {
    this.db.close();
  }
}
