import { randomUUID } from "node:crypto";
import { requireThat } from "./catalog.js";
/** Shared SQLite reservations. Lifetime AI cap; recoverable fixed window for webhooks.
 * Slots never expire while work might still run. A process crash fails closed until
 * an operator stops all workers and clears orphan slots; usage is never refunded.
 */
export class ExternalWorkBudget {
  constructor(
    store,
    { name, limit, concurrency = 2, windowMs = 0, now = Date.now },
  ) {
    requireThat(
      Number.isSafeInteger(limit) &&
        limit >= 0 &&
        Number.isInteger(concurrency) &&
        concurrency > 0 &&
        concurrency <= 8 &&
        Number.isSafeInteger(windowMs) &&
        windowMs >= 0,
      "invalid_external_budget",
    );
    Object.assign(this, { store, name, limit, concurrency, windowMs, now });
    store.transaction(() => {
      store.run("INSERT OR IGNORE INTO external_budgets VALUES(?,0)", name);
      store.run(
        "INSERT OR IGNORE INTO external_budget_policy VALUES(?,?,?,?,?)",
        name,
        limit,
        concurrency,
        windowMs,
        now(),
      );
      const p = store.get(
        "SELECT * FROM external_budget_policy WHERE name=?",
        name,
      );
      requireThat(
        p.ceiling === limit &&
          p.concurrency === concurrency &&
          p.window_ms === windowMs,
        "external_budget_policy_mismatch",
      );
    });
  }
  async run(fn) {
    const id = randomUUID();
    this.store.transaction(() => {
      const p = this.store.get(
        "SELECT * FROM external_budget_policy WHERE name=?",
        this.name,
      );
      if (this.windowMs && this.now() >= p.started + this.windowMs) {
        this.store.run(
          "UPDATE external_budgets SET used=0 WHERE name=?",
          this.name,
        );
        this.store.run(
          "UPDATE external_budget_policy SET started=? WHERE name=?",
          this.now(),
          this.name,
        );
      }
      requireThat(
        this.store.get(
          "SELECT count(*) n FROM external_work WHERE name=?",
          this.name,
        ).n < this.concurrency,
        "external_concurrency_exhausted",
        429,
      );
      const r = this.store.run(
        "UPDATE external_budgets SET used=used+1 WHERE name=? AND used<?",
        this.name,
        this.limit,
      );
      requireThat(r.changes === 1, "external_budget_exhausted", 429);
      this.store.run("INSERT INTO external_work VALUES(?,?)", id, this.name);
    });
    try {
      return await fn();
    } finally {
      this.store.run("DELETE FROM external_work WHERE id=?", id);
    }
  }
}
