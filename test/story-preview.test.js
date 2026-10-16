import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { lookPreviews, storyComparison } from "../src/story-preview.js";
import { planGoal } from "../src/planner.js";
import { catalog } from "../src/catalog.js";
import { Store } from "../src/store.js";
import { createApp } from "../src/server.js";
import { Recommender } from "../src/recommend.js";
import { MockProvider } from "../src/providers/mock.js";
const state = {
  owned: [],
  entitlements: [],
  equipped: null,
  formal: false,
  borrowed: false,
  seal: false,
  rumor: false,
};
const story = {
  goals: ["story"],
  style: "formal",
  avoidStyles: [],
  spending: "free",
  clarify: false,
};

test("preview: loan and Gala share dress-code parity; cloak cannot pass; no free quest is projected as awarded", () => {
  for (const seal of [false, true])
    for (const rumor of [false, true]) {
      const input = structuredClone({ ...state, seal, rumor });
      const before = structuredClone(input);
      const [loan, gala, cloak] = lookPreviews(input, catalog);
      assert.equal(loan.afterWearing.canEnter, seal && rumor);
      assert.equal(gala.afterWearing.canEnter, loan.afterWearing.canEnter);
      assert.equal(cloak.afterWearing.canEnter, false);
      assert.equal(cloak.dressCheck, false);
      for (const look of [loan, gala, cloak]) {
        assert.equal(look.afterWearing.seal, seal);
        assert.equal(look.afterWearing.rumor, rumor);
        assert.equal(
          look.remaining.some((s) => s.includes("invitation seal")),
          !seal,
        );
        assert.equal(
          look.remaining.some((s) => s.includes("password")),
          !rumor,
        );
        assert.ok(look.rosalyn.length > 20 && look.guard.length > 20);
      }
      assert.deepEqual(input, before);
    }
});

test("comparison: owned costs zero now, free loan remains separate, optional catalog prices and budget are exact", () => {
  const context = {
    ...state,
    owned: ["rosalyn-gala"],
    entitlements: [{ sku: "rosalyn-gala", status: "active" }],
  };
  const plan = planGoal(story, 50, context, catalog);
  const before = structuredClone(plan);
  const comparison = storyComparison(plan, context, catalog, 50);
  const [loan, gala, cloak] = comparison.options;
  assert.equal(loan.access, "free_loan");
  assert.equal(gala.access, "owned");
  assert.equal(loan.additionalCost.amount, 0);
  assert.equal(gala.additionalCost.amount, 0);
  assert.equal(cloak.additionalCost.amount, 99);
  assert.equal(cloak.withinBudget, false);
  assert.deepEqual(comparison.afterPlan, plan.projected);
  assert.deepEqual(
    comparison.freeQuestActions,
    plan.actions.filter((a) => a.type === "quest"),
  );
  assert.deepEqual(plan, before);
  assert.ok(
    comparison.options.every((p) => !p.suggestedPurchase),
    "free preference cannot recommend a purchase",
  );
  assert.equal(JSON.stringify(comparison).includes("savings"), false);
});

test("comparison: optional Gala and cloak show catalog prices without a speculative purchase grant", () => {
  const plan = planGoal(
    { ...story, spending: "optional" },
    199,
    state,
    catalog,
  );
  const comparison = storyComparison(plan, state, catalog, 199);
  assert.deepEqual(
    comparison.options.map((p) => p.additionalCost.amount),
    [0, 199, 99],
  );
  assert.equal(comparison.afterPlan.equipped, "borrowed");
  assert.equal(comparison.afterPlan.canEnter, true);
  assert.equal(comparison.options[1].afterWearing.canEnter, false);
  assert.equal(comparison.options[1].suggestedPurchase, true);
  assert.equal(comparison.options[2].suggestedPurchase, false);
});

test("comparison: held rights are unavailable, not re-sold or treated as owned; unsupported plans have no comparison", () => {
  const context = {
    ...state,
    entitlements: [{ sku: "rosalyn-gala", status: "held" }],
  };
  const plan = planGoal(story, 300, context, catalog);
  const gala = storyComparison(plan, context, catalog, 300).options[1];
  assert.equal(gala.access, "held");
  assert.equal(gala.additionalCost, null);
  assert.equal(gala.withinBudget, false);
  assert.equal(gala.suggestedPurchase, false);
  assert.match(gala.guard, /cannot count/);
  assert.equal(
    storyComparison({ ...plan, goal: "unsupported" }, context, catalog, 300),
    null,
  );
});

test("HTTP: repeated preview reads and mock comparison do not award rights, quests, quotes or orders", async (t) => {
  const store = new Store();
  const app = createApp({
    store,
    provider: new MockProvider(store),
    recommender: new Recommender({ mode: "mock" }),
    origin: "http://localhost:3000",
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    store.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  // Native loopback HTTP keeps this test independent of any global fetch proxy.
  const local = (url, options = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method: options.method ?? "GET",
          headers: { Host: "localhost:3000", ...options.headers },
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: { get: (name) => res.headers[name]?.[0] },
              json: async () => JSON.parse(raw),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  const initial = await local(base + "/api/session", {
    headers: { Host: "localhost:3000" },
  });
  const cookie = initial.headers.get("set-cookie").split(";")[0];
  const session = await initial.json();
  const read = () =>
    local(base + "/api/game", {
      headers: { Cookie: cookie, Host: "localhost:3000" },
    }).then((r) => r.json());
  await read();
  const snapshot = () =>
    JSON.stringify(
      ["game", "orders", "quotes", "entitlements"].map((table) =>
        store.all(`SELECT * FROM ${table}`),
      ),
    );
  const before = snapshot();
  for (let i = 0; i < 3; i++) {
    const g = await read();
    assert.equal(g.previews.length, 3);
    assert.equal(g.borrowed, false);
    assert.equal(g.formal, false);
    assert.equal(g.seal, false);
    assert.equal(g.rumor, false);
    assert.deepEqual(g.owned, []);
  }
  const response = await local(base + "/api/commerce/agent/recommend", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrf,
    },
    body: JSON.stringify({
      goal: "enter the evening gathering for free",
      budgetMinor: 0,
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.products, []);
  assert.deepEqual(result.comparison.afterPlan, result.plan.projected);
  assert.equal(result.comparison.options[1].withinBudget, false);
  assert.equal(snapshot(), before);
});

test("mock demo: Korean gathering goal keeps the free formal route and optional catalog purchase separate", async () => {
  const result = await new Recommender({ mode: "mock" }).recommend(
    { goal: "무도회에 가고 싶어", budgetMinor: 300 },
    state,
  );
  assert.equal(result.plan.goal, "guard");
  assert.equal(
    result.plan.actions.some((a) => a.type === "borrow"),
    true,
  );
  assert.equal(result.plan.projected.canEnter, true);
  assert.deepEqual(
    result.products.map((p) => p.sku),
    ["rosalyn-gala"],
  );
  assert.equal(state.borrowed, false);
  assert.deepEqual(state.owned, []);
});
