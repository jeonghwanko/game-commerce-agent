import { test } from "node:test";
import assert from "node:assert/strict";
import { GameCommerceClient } from "../public/game-client.js";
import { createWardrobeSample } from "../examples/game-host.js";
import { createSitesWorker } from "../sites/worker.js";
import { sqliteD1 } from "../sites/testing/d1-fixture.js";

function gate() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const state = (equipped = null) => ({
  equipped,
  owned: [],
  borrowed: !!equipped,
  seal: false,
  rumor: false,
});
const reply = (scope, body, status = 200) =>
  Response.json(body, { status, headers: { "x-commerce-scope": scope } });
function fake() {
  let scope = "account-a";
  const calls = [];
  let hook;
  const fetcher = async (path, options) => {
    const current = scope;
    calls.push({ path, options });
    const intercepted = hook?.(path, options, current);
    if (intercepted) return intercepted;
    if (path === "/api/session")
      return reply(current, { csrf: "test-only-csrf", scope: current });
    if (options.headers["X-Commerce-Scope"] !== current)
      return reply(current, { error: "account_changed" }, 409);
    return reply(current, state());
  };
  return {
    fetcher,
    calls,
    set scope(s) {
      scope = s;
    },
    set hook(h) {
      hook = h;
    },
  };
}

for (const phase of ["fetch", "json", "error"]) {
  test(`client: account switch rejects old ${phase} response including its returned Promise value`, async () => {
    const f = fake(),
      client = new GameCommerceClient({ fetcher: f.fetcher });
    await client.connect();
    const blocked = gate();
    f.hook = (path, _opts, scope) => {
      if (path !== "/api/game" || scope !== "account-a") return;
      if (phase === "json")
        return {
          ok: true,
          headers: new Headers({ "x-commerce-scope": scope }),
          json: () => blocked.promise,
        };
      return blocked.promise;
    };
    const pending = client.refresh();
    const rejected = assert.rejects(pending, /stale_account_request/);
    await Promise.resolve();
    client.disconnect();
    assert.equal(client.state, null);
    f.scope = "account-b";
    await client.connect();
    const current = await client.refresh();
    blocked.resolve(
      phase === "json"
        ? state("old-outfit")
        : reply(
            "account-a",
            phase === "error"
              ? { error: "session_required" }
              : state("old-outfit"),
            phase === "error" ? 401 : 200,
          ),
    );
    await rejected;
    assert.deepEqual(client.state, current);
    assert.equal(client.session.scope, "account-b");
  });
}

test("client: delayed session and equip cannot return previous account data or clear the new intent", async () => {
  const f = fake(),
    client = new GameCommerceClient({ fetcher: f.fetcher });
  const sessionGate = gate();
  f.hook = (path, _opts, scope) =>
    path === "/api/session" && scope === "account-a"
      ? sessionGate.promise
      : undefined;
  const first = assert.rejects(client.connect(), /stale_account_request/);
  f.scope = "account-b";
  await client.connect();
  sessionGate.resolve(reply("account-a", { scope: "account-a", csrf: "old" }));
  await first;
  const equipGate = gate();
  f.hook = (path) =>
    path === "/api/game/equip" ? equipGate.promise : undefined;
  const delayed = assert.rejects(
    client.equip("borrowed"),
    /stale_account_request/,
  );
  client.disconnect();
  f.scope = "account-c";
  await client.connect();
  equipGate.resolve(reply("account-b", state("borrowed")));
  await delayed;
  assert.equal(client.pendingEquip, null);
  assert.equal(client.session.scope, "account-c");
});

test("client: silent account change fails closed, ordinary diagnostics failures do not clear gameplay", async () => {
  const f = fake(),
    client = new GameCommerceClient({ fetcher: f.fetcher });
  await client.connect();
  await client.refresh();
  for (const status of [401, 403, 500, 503]) {
    f.hook = (path) =>
      path === "/api/analytics/funnel"
        ? reply("account-a", { error: "unavailable" }, status)
        : undefined;
    await assert.rejects(client.readFunnel());
    assert.equal(client.session.scope, "account-a");
    assert.ok(client.state);
  }
  f.hook = (path) =>
    path === "/api/analytics/funnel" ? Response.json([]) : undefined;
  await assert.rejects(client.readFunnel(), /account_changed/);
  assert.equal(client.session.scope, "account-a");
  f.scope = "account-b";
  await assert.rejects(client.refresh(), /account_changed/);
  assert.equal(client.session, null);
  assert.equal(client.state, null);
});

test("client: newer state wins; no external-origin request or stale state return", async () => {
  const f = fake(),
    client = new GameCommerceClient({ fetcher: f.fetcher });
  await client.connect();
  const delayed = gate();
  let reads = 0;
  f.hook = (path) =>
    path === "/api/game" && ++reads === 1 ? delayed.promise : undefined;
  const first = assert.rejects(client.refresh(), /stale_game_state/);
  const newer = await client.refresh();
  delayed.resolve(reply("account-a", state("stale")));
  await first;
  assert.deepEqual(client.state, newer);
  await assert.rejects(
    client.request("https://provider.invalid/api/game"),
    /same_origin_api_required/,
  );
  await assert.rejects(
    client.request("/api/../../outside"),
    /same_origin_api_required/,
  );
});

test("client + Sites: lost equip response, reconnect and explicit retry use one receipt/event; host progress remains separate", async (t) => {
  const db = sqliteD1();
  t.after(() => db.close());
  const origin = "https://fixture.invalid";
  const env = {
    PUBLIC_ORIGIN: origin,
    SITES_OWNER_USER_ID: "synthetic-owner",
    DB: db,
  };
  let worker = createSitesWorker({
    fetcher: () => {
      throw Error("external_network_forbidden");
    },
  });
  let lose = true,
    loseSession = false;
  const keys = [];
  const fetcher = async (path, options) => {
    if (path === "/api/session" && loseSession) {
      loseSession = false;
      throw Error("reconnect_unavailable");
    }
    const response = await worker.fetch(
      new Request(origin + path, {
        ...options,
        headers: {
          ...options.headers,
          origin,
          "oai-authenticated-user-id": env.SITES_OWNER_USER_ID,
          "oai-authenticated-user-email": "synthetic@example.invalid",
        },
      }),
      env,
    );
    if (path === "/api/game/equip") {
      keys.push(JSON.parse(options.body).requestId);
      if (lose) {
        lose = false;
        throw Error("lost_equip_response");
      }
    }
    return response;
  };
  const host = {
    gold: 42,
    seal: true,
    rumor: true,
    saveSlot: "existing-save",
    commerce: null,
  };
  const sample = createWardrobeSample({
    fetcher,
    setCommerceAppearance: (view) => {
      host.commerce = view;
    },
  });
  await sample.reconnect();
  const challenge = await sample.client.request("/api/game/interact", {
    npc: "shop",
  });
  await sample.client.request("/api/game/quest", challenge);
  await assert.rejects(sample.equip("borrowed"), /lost_equip_response/);
  assert.ok(sample.client.pendingEquip);
  await assert.rejects(sample.equip("rosalyn-gala"), /equip_recovery_required/);
  worker = createSitesWorker({
    fetcher: () => {
      throw Error("external_network_forbidden");
    },
  });
  loseSession = true;
  await assert.rejects(sample.reconnect(), /reconnect_unavailable/);
  assert.equal(sample.client.pendingEquip.requestId, keys[0]);
  assert.equal((await sample.reconnect()).equipped, "borrowed");
  await sample.recoverEquip();
  assert.equal(keys[0], keys[1]);
  assert.equal(
    db.sqlite.prepare("SELECT count(*) n FROM sites_equip_requests").get().n,
    1,
  );
  assert.equal(
    db.sqlite
      .prepare("SELECT count(*) n FROM sites_events WHERE name='item_equipped'")
      .get().n,
    1,
  );
  assert.deepEqual(
    { ...host, commerce: null },
    {
      gold: 42,
      seal: true,
      rumor: true,
      saveSlot: "existing-save",
      commerce: null,
    },
  );
  sample.accountChanging();
  assert.deepEqual(host.commerce, { equipped: null, activeSkus: [] });
  env.SITES_OWNER_USER_ID = "synthetic-other-owner"; // Local fixture only.
  assert.deepEqual(await sample.reconnect(), {
    equipped: null,
    activeSkus: [],
  });
  await assert.rejects(sample.recoverEquip(), /no_pending_equip/);
});
