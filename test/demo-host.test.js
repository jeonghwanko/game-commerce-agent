import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { SandboxDemoHost } from "../src/demo-host.js";
import { createApp } from "../src/server.js";
const password = "synthetic-test-password-never-real";
const authorization =
  "Basic " + Buffer.from("player:" + password).toString("base64");
test("explicit principal demo host supports free route with AI enabled stub and no anonymous bypass", async () => {
  const store = new Store();
  const origin = "http://127.0.0.1:3146";
  const demoHost = new SandboxDemoHost({
    store,
    origin,
    enabled: true,
    user: "player",
    password,
  });
  let calls = 0;
  const app = createApp({
    store,
    origin,
    demoHost,
    authMode: "principal",
    identity: demoHost.identity,
    aiAccessEnabled: true,
    aiCallLimit: 1,
    recommender: {
      mode: "openai",
      recommend: async () => {
        calls++;
        return { products: [], plan: { actions: [] } };
      },
    },
  });
  await new Promise((r) => app.server.listen(3146, "127.0.0.1", r));
  try {
    const denied = await fetch(origin + "/api/session");
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate"), /Independent Sandbox/);
    const session = await (
      await fetch(origin + "/api/session", { headers: { authorization } })
    ).json();
    assert.equal(session.authMode, "principal");
    assert.equal(session.gameHost, "independent-sandbox-demo");
    const post = async (path, body) =>
      fetch(origin + path, {
        method: "POST",
        headers: {
          authorization,
          origin,
          "content-type": "application/json",
          "x-csrf-token": session.csrf,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post("/api/game/quest", { quest: "seal", seal: true })).status,
      409,
    );
    const challenge = await (
      await post("/api/game/interact", { npc: "seal" })
    ).json();
    assert.equal(
      (await post("/api/game/quest", { ...challenge, quest: "rumor" })).status,
      409,
    );
    assert.equal((await post("/api/game/quest", challenge)).status, 200);
    assert.equal((await post("/api/game/quest", challenge)).status, 409);
    for (const npc of ["shop", "rumor"]) {
      const q = await (await post("/api/game/interact", { npc })).json();
      assert.equal((await post("/api/game/quest", q)).status, 200);
    }
    const g = await (await post("/api/game/equip", { sku: "borrowed" })).json();
    assert.equal(g.canEnter, true);
    assert.deepEqual(g.owned, []);
    assert.equal(
      (
        await post("/api/commerce/agent/recommend", {
          goal: "enter",
          budgetMinor: 0,
        })
      ).status,
      200,
    );
    assert.equal(calls, 1);
    assert.equal(
      (
        await post("/api/commerce/agent/recommend", {
          goal: "enter",
          budgetMinor: 0,
        })
      ).status,
      429,
    );
    assert.equal(store.get("SELECT count(*) n FROM sessions").n, 0);
    const again = new SandboxDemoHost({
      store,
      origin,
      enabled: true,
      user: "player",
      password,
    });
    assert.deepEqual(
      await again.identity.resolve({ headers: { authorization } }, store),
      await demoHost.identity.resolve({ headers: { authorization } }, store),
    );
    assert.throws(
      () => createApp({ store, origin }),
      /database_game_host_mismatch/,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    store.close();
  }
});
test("demo dialogue requires correct principal and expiry; explicit enable and access configuration fail closed", () => {
  const store = new Store();
  let now = 1000;
  const cfg = {
    store,
    origin: "http://127.0.0.1:3000",
    enabled: true,
    user: "player",
    password,
    now: () => now,
  };
  try {
    assert.throws(
      () => new SandboxDemoHost({ ...cfg, enabled: false }),
      /explicit_enable/,
    );
    assert.throws(
      () => new SandboxDemoHost({ ...cfg, password: undefined }),
      /configuration/,
    );
    const h = new SandboxDemoHost(cfg);
    const q = h.begin("alice", "shop");
    assert.throws(() => h.complete("bob", q, {}), /dialogue_required/);
    now += 120001;
    assert.throws(() => h.complete("alice", q, {}), /dialogue_required/);
  } finally {
    store.close();
  }
});
test("standalone demo refuses production even with configured test credentials", () => {
  const old = process.env.NODE_ENV;
  const store = new Store();
  try {
    process.env.NODE_ENV = "production";
    assert.throws(
      () =>
        new SandboxDemoHost({
          store,
          origin: "https://demo.invalid",
          enabled: true,
          user: "player",
          password,
        }),
      /sandbox_demo_not_production/,
    );
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
    store.close();
  }
});
