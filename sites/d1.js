import { requireThat } from "../src/catalog.js";
import { EVENT_NAMES, eventLimit, eventIds } from "../src/events.js";
export const uuid = () => crypto.randomUUID();
export class D1Ledger {
  constructor(db) {
    requireThat(
      db?.prepare && db?.batch && db?.withSession,
      "d1_binding_required",
      503,
    );
    this.db = db.withSession("first-primary");
  }
  statement(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }
  one(sql, ...args) {
    return this.statement(sql, ...args).first();
  }
  async all(sql, ...args) {
    return (await this.statement(sql, ...args).all()).results;
  }
  run(sql, ...args) {
    return this.statement(sql, ...args).run();
  }
  batch(entries) {
    return this.db.batch(
      entries.map(([sql, ...args]) => this.statement(sql, ...args)),
    );
  }
  async bindProvider(provider, merchant = "none") {
    const value = `${provider}:${merchant}`;
    await this.run(
      "INSERT OR IGNORE INTO sites_environment VALUES('provider',?)",
      value,
    );
    const row = await this.one(
      "SELECT value FROM sites_environment WHERE key='provider'",
    );
    requireThat(
      row?.value === value,
      "database_provider_or_merchant_mismatch",
      409,
    );
  }
  event(user, name, order = null, id = uuid()) {
    requireThat(EVENT_NAMES.has(name), "invalid_event");
    return this.run(
      "INSERT OR IGNORE INTO sites_events VALUES(?,?,?,?,?,0)",
      id,
      user,
      order,
      name,
      Date.now(),
    );
  }
  async observe(...args) {
    try {
      await this.event(...args);
      return true;
    } catch {
      return false;
    }
  }
  outbox(limit = 100) {
    return this.all(
      "SELECT id,user_id,order_id,name,at FROM sites_events WHERE delivered=0 ORDER BY at,id LIMIT ?",
      eventLimit(limit),
    );
  }
  async acknowledge(ids) {
    eventIds(ids);
    if (ids.length)
      await this.batch(
        ids.map((id) => [
          "UPDATE sites_events SET delivered=1 WHERE id=? AND delivered=0",
          id,
        ]),
      );
  }
}
// Durable cross-isolate window + concurrency, including OAuth/signature response parsing.
// Crashed reservations never expire automatically; fail closed until controlled recovery.
export class D1WindowBudget {
  constructor(
    ledger,
    {
      name = "webhooks-v1",
      limit = 100,
      concurrency = 2,
      windowMs = 60000,
      now = Date.now,
    } = {},
  ) {
    Object.assign(this, { s: ledger, name, limit, concurrency, windowMs, now });
  }
  async run(fn) {
    const { s, name, limit, concurrency, windowMs } = this;
    await s.run(
      "INSERT OR IGNORE INTO sites_budgets VALUES(?,?,0,?,?,?)",
      name,
      this.now(),
      limit,
      concurrency,
      windowMs,
    );
    const policy = await s.one(
      "SELECT * FROM sites_budgets WHERE name=?",
      name,
    );
    requireThat(
      policy.ceiling === limit &&
        policy.concurrency === concurrency &&
        policy.window_ms === windowMs,
      "budget_policy_mismatch",
      503,
    );
    const token = uuid(),
      now = this.now();
    const result = await s.batch([
      [
        "UPDATE sites_budgets SET used=0,started=? WHERE name=? AND window_ms>0 AND started+window_ms<=?",
        now,
        name,
        now,
      ],
      [
        "INSERT INTO sites_external_work SELECT ?,? WHERE EXISTS(SELECT 1 FROM sites_budgets WHERE name=? AND used<ceiling) AND (SELECT count(*) FROM sites_external_work WHERE name=?)<?",
        token,
        name,
        name,
        name,
        concurrency,
      ],
      [
        "UPDATE sites_budgets SET used=used+1 WHERE name=? AND EXISTS(SELECT 1 FROM sites_external_work WHERE token=?)",
        name,
        token,
      ],
    ]);
    requireThat(result[1].meta.changes === 1, "external_budget_exhausted", 429);
    try {
      return await fn();
    } finally {
      await s.run("DELETE FROM sites_external_work WHERE token=?", token);
    }
  }
}
