import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { Store } from "../src/store.js";
import { ExternalWorkBudget } from "../src/budget.js";
import { costLimitedFetch, AI_MODEL } from "../src/ai-cost.js";
import { deliverOutbox } from "../src/outbox.js";
const temp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gca-durable-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "ledger.sqlite");
};
test("8 actual workers share attempt ceiling and concurrency reservations", async (t) => {
  const path = temp(t);
  const setup = new Store(path);
  setup.close();
  const source = `const {parentPort,workerData}=require('node:worker_threads');(async()=>{
 const {Store}=await import(workerData.store);const {ExternalWorkBudget}=await import(workerData.budget);const s=new Store(workerData.path);const b=new ExternalWorkBudget(s,{name:'stress',limit:10,concurrency:2});let calls=0,maxActive=0;
 for(let i=0;i<20;i++){try{await b.run(async()=>{calls++;maxActive=Math.max(maxActive,s.get('SELECT count(*) n FROM external_work').n);await new Promise(r=>setTimeout(r,5));});}catch(e){if(!/external_(budget|concurrency)_exhausted/.test(e.message))throw e;}await new Promise(r=>setTimeout(r,2));}s.close();parentPort.postMessage({calls,maxActive});})().catch(e=>{throw e});`;
  const results = await Promise.all(
    Array.from(
      { length: 8 },
      () =>
        new Promise((resolve, reject) => {
          const w = new Worker(source, {
            eval: true,
            workerData: {
              path,
              store: new URL("../src/store.js", import.meta.url).href,
              budget: new URL("../src/budget.js", import.meta.url).href,
            },
          });
          w.once("message", resolve);
          w.once("error", reject);
        }),
    ),
  );
  assert.equal(
    results.reduce((n, r) => n + r.calls, 0),
    10,
  );
  assert.ok(results.every((r) => r.maxActive <= 2));
  const s = new Store(path);
  assert.equal(
    s.get("SELECT used FROM external_budgets WHERE name='stress'").used,
    10,
  );
  assert.equal(s.get("SELECT count(*) n FROM external_work").n, 0);
  assert.throws(
    () =>
      new ExternalWorkBudget(s, { name: "stress", limit: 11, concurrency: 2 }),
    /policy_mismatch/,
  );
  s.close();
});
test("orphan reservation remains fail-closed across restart and window reset", async (t) => {
  const path = temp(t);
  let now = 0,
    s = new Store(path);
  new ExternalWorkBudget(s, {
    name: "w",
    limit: 1,
    concurrency: 1,
    windowMs: 60000,
    now: () => now,
  });
  s.run("INSERT INTO external_work VALUES('crashed','w')");
  s.close();
  now = 60001;
  s = new Store(path);
  const b = new ExternalWorkBudget(s, {
    name: "w",
    limit: 1,
    concurrency: 1,
    windowMs: 60000,
    now: () => now,
  });
  await assert.rejects(
    b.run(async () => {}),
    /concurrency/,
  );
  // Operator procedure after ALL workers stopped: remove only orphan reservations.
  s.run("DELETE FROM external_work WHERE id='crashed'");
  await b.run(async () => {});
  s.close();
});
test("AI $5 reservation cap survives restart; rejected payloads never call transport", async (t) => {
  const path = temp(t);
  let calls = 0;
  const opts = {
    body: JSON.stringify({
      model: AI_MODEL,
      max_completion_tokens: 250,
      tool_choice: "none",
      messages: [{ role: "user", content: "hello" }],
    }),
  };
  for (let restart = 0; restart < 2; restart++) {
    const s = new Store(path);
    const f = costLimitedFetch(
      s,
      async () => {
        calls++;
        return {};
      },
      () => Date.parse("2026-10-15"),
    );
    for (let i = 0; i < 50; i++)
      await f("https://api.openai.com/v1/chat/completions", opts);
    await assert.rejects(f("https://evil.test", opts), /cost_policy/);
    if (restart)
      await assert.rejects(
        f("https://api.openai.com/v1/chat/completions", opts),
        /budget_exhausted/,
      );
    s.close();
  }
  assert.equal(calls, 100);
});
test("outbox crash after sink acceptance, restart and concurrent delivery deduplicate 100 events", async (t) => {
  const path = temp(t);
  let s = new Store(path);
  for (let i = 0; i < 100; i++) s.event("pseudonym", "shop_opened");
  const accepted = new Set();
  let crash = true;
  const sink = {
    accept: async (e) => {
      assert.deepEqual(Object.keys(e).sort(), [
        "at",
        "id",
        "name",
        "order_id",
        "user_id",
      ]);
      accepted.add(e.id);
      if (crash) {
        crash = false;
        throw new Error("sink accepted, response lost");
      }
    },
  };
  await assert.rejects(deliverOutbox(s, sink));
  assert.equal(s.outbox().length, 100);
  s.close();
  s = new Store(path);
  const second = new Store(path);
  await Promise.all([deliverOutbox(s, sink), deliverOutbox(second, sink)]);
  assert.equal(accepted.size, 100);
  assert.equal(s.outbox().length, 0);
  s.close();
  second.close();
});
