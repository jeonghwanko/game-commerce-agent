import { requireThat } from "./catalog.js";
/** Global (all sessions) durable attempt budget + bounded in-process concurrency.
 * Counts attempts even on timeout/failure. Restart cannot replenish the same DB.
 */
export class ExternalWorkBudget {
  constructor(store, { name, limit, concurrency = 2 }) {
    requireThat(
      Number.isInteger(limit) &&
        limit >= 0 &&
        Number.isInteger(concurrency) &&
        concurrency > 0 &&
        concurrency <= 8,
      "invalid_external_budget",
    );
    Object.assign(this, { store, name, limit, concurrency });
    this.active = 0;
  }
  async run(fn) {
    requireThat(
      this.active < this.concurrency,
      "external_concurrency_exhausted",
      429,
    );
    this.store.transaction(() => {
      this.store.run(
        "INSERT OR IGNORE INTO external_budgets VALUES(?,0)",
        this.name,
      );
      const r = this.store.run(
        "UPDATE external_budgets SET used=used+1 WHERE name=? AND used<?",
        this.name,
        this.limit,
      );
      requireThat(r.changes === 1, "external_budget_exhausted", 429);
    });
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
    }
  }
}
