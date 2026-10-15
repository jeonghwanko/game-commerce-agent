import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { costLimitedFetch, AI_MODEL } from "../src/ai-cost.js";
const url = "https://api.openai.com/v1/chat/completions";
const opts = () => ({
  body: JSON.stringify({
    model: AI_MODEL,
    max_completion_tokens: 250,
    tool_choice: "none",
  }),
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));
test("header-first real Response keeps one slot until delayed JSON completes", async () => {
  const s = new Store();
  let controller,
    calls = 0;
  const ready = deferred();
  const f = costLimitedFetch(
    s,
    async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(c) {
            controller = c;
            ready.resolve();
          },
        }),
      );
    },
    () => Date.parse("2026-10-15"),
  );
  const first = f(url, opts());
  await ready.promise;
  await tick();
  assert.equal(s.get("SELECT count(*) n FROM external_work").n, 1);
  await assert.rejects(f(url, opts()), /concurrency_exhausted/);
  assert.equal(calls, 1);
  controller.enqueue(new TextEncoder().encode('{"ok":true}'));
  controller.close();
  assert.deepEqual(await (await first).json(), { ok: true });
  assert.equal(s.get("SELECT count(*) n FROM external_work").n, 0);
  s.close();
});
test("abort retains reservation until stream cancellation completes", async () => {
  const s = new Store(),
    ready = deferred(),
    cancelled = deferred(),
    release = deferred(),
    ac = new AbortController();
  const f = costLimitedFetch(
    s,
    async () =>
      new Response(
        new ReadableStream({
          start() {
            ready.resolve();
          },
          cancel() {
            cancelled.resolve();
            return release.promise;
          },
        }),
      ),
    () => Date.parse("2026-10-15"),
  );
  const first = f(url, { ...opts(), signal: ac.signal });
  const rejected = assert.rejects(first, /abort/i);
  await ready.promise;
  await tick();
  ac.abort();
  await cancelled.promise;
  assert.equal(s.get("SELECT count(*) n FROM external_work").n, 1);
  await assert.rejects(f(url, opts()), /concurrency_exhausted/);
  release.resolve();
  await rejected;
  assert.equal(s.get("SELECT count(*) n FROM external_work").n, 0);
  s.close();
});
test("stream failure and malformed/oversized JSON consume attempts, release only after cleanup", async () => {
  const s = new Store();
  let mode = "failure";
  const f = costLimitedFetch(
    s,
    async () =>
      mode === "failure"
        ? new Response(
            new ReadableStream({
              pull(c) {
                c.error(new Error("body failed"));
              },
            }),
          )
        : new Response(mode === "oversize" ? "x".repeat(65537) : "not json"),
    () => Date.parse("2026-10-15"),
  );
  for (mode of ["failure", "malformed", "oversize"]) {
    await assert.rejects(f(url, opts()));
    assert.equal(s.get("SELECT count(*) n FROM external_work").n, 0);
  }
  assert.equal(
    s.get("SELECT used FROM external_budgets WHERE name='ai-usd5-v1'").used,
    3,
  );
  s.close();
});
