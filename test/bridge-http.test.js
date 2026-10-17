import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/server.js";
import { Store } from "../src/store.js";
import { MockProvider } from "../src/providers/mock.js";
import { Recommender } from "../src/recommend.js";
import { sqliteD1 } from "../sites/testing/d1-fixture.js";
import { createSitesWorker } from "../sites/worker.js";

test("Node HTTP: scope is checked before a new account's mutation, even with valid CSRF", async (t) => {
  const store = new Store();
  let current = "opaque-a";
  const origin = "http://localhost:3000";
  const { server, game } = createApp({
    store,
    origin,
    authMode: "principal",
    identity: {
      resolve: async () => ({
        user_id: current,
        csrf: "synthetic-test-csrf",
        expires: Date.now() + 60000,
      }),
    },
    provider: new MockProvider(store),
    recommender: new Recommender({ mode: "mock" }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.close();
  });
  function call(path, data, scope) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path,
          method: data === undefined ? "GET" : "POST",
          headers: {
            Host: "localhost:3000",
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": "synthetic-test-csrf",
            ...(scope ? { "X-Commerce-Scope": scope } : {}),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (data) => {
            body += data;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(body),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  const a = await call("/api/session");
  assert.equal(a.body.scope, a.headers["x-commerce-scope"]);
  current = "opaque-b";
  game.quest(current, "borrowed");
  const stale = await call(
    "/api/game/equip",
    { sku: "borrowed" },
    a.body.scope,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "account_changed");
  assert.equal(game.state(current).equipped, null);
  const b = await call("/api/session");
  assert.notEqual(b.body.scope, a.body.scope);
  assert.equal(
    (await call("/api/game/equip", { sku: "borrowed" }, b.body.scope)).status,
    200,
  );
});

test("Sites HTTP: wrong scope rejects before equip and outbox has no public/owner HTTP drain or ACK", async () => {
  const db = sqliteD1(),
    origin = "https://local.invalid";
  try {
    const env = {
      DB: db,
      PUBLIC_ORIGIN: origin,
      SITES_OWNER_USER_ID: "fixture-owner",
    };
    const worker = createSitesWorker({
      fetcher: () => {
        throw Error("external_network_forbidden");
      },
    });
    let csrf;
    const call = (path, body, extra = {}) =>
      worker.fetch(
        new Request(origin + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "oai-authenticated-user-id": env.SITES_OWNER_USER_ID,
            "oai-authenticated-user-email": "fixture@example.invalid",
            origin,
            "content-type": "application/json",
            ...(csrf ? { "x-csrf-token": csrf } : {}),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        env,
      );
    const session = await (await call("/api/session")).json();
    csrf = session.csrf;
    const challenge = await (
      await call("/api/game/interact", { npc: "shop" })
    ).json();
    await call("/api/game/quest", challenge);
    assert.equal(
      (
        await call(
          "/api/game/equip",
          { sku: "borrowed" },
          { "x-commerce-scope": "previous-account" },
        )
      ).status,
      409,
    );
    assert.equal((await (await call("/api/game")).json()).equipped, null);
    for (const path of [
      "/api/outbox",
      "/api/analytics/outbox",
      "/api/analytics/ack",
    ]) {
      assert.equal((await call(path)).status, 404);
      assert.equal((await call(path, { ids: ["guessed"] })).status, 404);
      assert.equal(
        (await call(path, undefined, { "oai-authenticated-user-id": "" }))
          .status,
        401,
      );
    }
  } finally {
    db.close();
  }
});
