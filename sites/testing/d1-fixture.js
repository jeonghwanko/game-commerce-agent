import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
// D1 contract fixture with real SQLite constraints/SQL and atomic batch rollback.
// NOT the hosted D1 runtime; every operation yields before touching SQLite.
export function sqliteD1(path = ":memory:", migrate = true) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  if (migrate) {
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0001_commerce.sql", import.meta.url),
        "utf8",
      ),
    );
    sqlite.exec(readFileSync(new URL("../migrations/0002_ai_requests.sql", import.meta.url), "utf8"));
  }
  const fixture = {
    sqlite,
    sessions: [],
    before: null,
    fail: null,
    withSession(constraint) {
      fixture.sessions.push(constraint);
      return fixture;
    },
    prepare(sql) {
      // No application transaction-control or schema statements may reach D1 prepare.
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|CREATE|ALTER|DROP)\b/i.test(sql))
        throw Error("runtime_schema_or_transaction_control_forbidden");
      const stmt = {
        sql,
        args: [],
        bind(...args) {
          return { ...stmt, args };
        },
        async first() {
          await fixture.before?.(sql);
          return sqlite.prepare(sql).get(...this.args) ?? null;
        },
        async all() {
          await fixture.before?.(sql);
          return {
            success: true,
            results: sqlite.prepare(sql).all(...this.args),
          };
        },
        async run() {
          await fixture.before?.(sql);
          return execute(this);
        },
      };
      return stmt;
    },
    async batch(statements) {
      await fixture.before?.("BATCH");
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(execute);
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      sqlite.close();
    },
  };
  function execute(stmt) {
    if (fixture.fail?.(stmt.sql)) throw Error("synthetic_SQL_failure");
    const r = sqlite.prepare(stmt.sql).run(...stmt.args);
    return { success: true, meta: { changes: r.changes }, results: [] };
  }
  return fixture;
}
