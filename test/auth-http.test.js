import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Store } from "../src/store.js";
import { createApp } from "../src/server.js";
import { AuthenticatedPrincipalAdapter } from "../src/identity.js";
const confirm = (q) => ({
  quoteId: q.id,
  sku: q.sku,
  amount: q.amount,
  currency: q.currency,
  version: q.version,
  confirm: true,
});
test("HTTP principal re-login restores purchases; spoofed headers and revoked host sessions are rejected", async (t) => {
  const s = new Store();
  const sessions = new Map([
    [
      "login-one",
      {
        authenticated: true,
        issuer: "host",
        subject: "account",
        expiresAt: Date.now() + 100000,
        csrfToken: "1".repeat(24),
      },
    ],
  ]);
  const identity = new AuthenticatedPrincipalAdapter({
    issuer: "host",
    resolveVerifiedPrincipal: async (req) =>
      sessions.get(req.headers.cookie?.split("=")[1]),
  });
  let aiCalls = 0;
  const recommender = {
    mode: "openai",
    recommend: async () => {
      aiCalls++;
      return { products: [], plan: { actions: [] } };
    },
  };
  const { server, commerce } = createApp({
    store: s,
    authMode: "principal",
    identity,
    recommender,
    aiAccessEnabled: true,
    aiCallLimit: 1,
    origin: "http://localhost:3000",
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    s.close();
  });
  async function request(
    path,
    {
      cookie = "host_session=login-one",
      method = "GET",
      data,
      headers = {},
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path,
          method,
          headers: {
            Host: "localhost:3000",
            Cookie: cookie,
            Origin: "http://localhost:3000",
            "Content-Type": "application/json",
            "X-CSRF-Token":
              sessions.get(cookie.split("=")[1])?.csrfToken ?? "fake",
            ...headers,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () =>
            resolve({ status: res.statusCode, body: JSON.parse(body) }),
          );
        },
      );
      req.on("error", reject);
      req.end(data ? JSON.stringify(data) : undefined);
    });
  }
  assert.equal(
    (
      await request("/api/session", {
        cookie: "",
        headers: { "x-user-id": "account", "x-dev-user": "account" },
      })
    ).status,
    401,
  );
  await request("/api/session");
  const user = s.get("SELECT user_id FROM principals").user_id;
  const o = await commerce.create(
    user,
    confirm(commerce.quote(user, "rosalyn-gala")),
  );
  await commerce.p.approve(o.provider_id);
  const paid = await commerce.p.capture(o.provider_id);
  commerce.settle(o.id, paid, "stub-verified");
  assert.equal(
    (await request("/api/commerce/entitlements")).body[0].status,
    "active",
  );
  sessions.delete("login-one");
  sessions.set("login-two", {
    authenticated: true,
    issuer: "host",
    subject: "account",
    expiresAt: Date.now() + 100000,
    csrfToken: "2".repeat(24),
  });
  assert.equal((await request("/api/commerce/entitlements")).status, 401);
  assert.equal(
    (
      await request("/api/commerce/entitlements", {
        cookie: "host_session=login-two",
      })
    ).body[0].sku,
    "rosalyn-gala",
  );
  assert.equal(
    (
      await request("/api/game/quest", {
        cookie: "host_session=login-two",
        method: "POST",
        data: { quest: "seal" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request("/api/commerce/agent/recommend", {
        cookie: "host_session=login-two",
        method: "POST",
        data: { goal: "guard", budgetMinor: 300 },
      })
    ).status,
    200,
  );
  sessions.set("new-player", {
    authenticated: true,
    issuer: "host",
    subject: "other-account",
    expiresAt: Date.now() + 100000,
    csrfToken: "3".repeat(24),
  });
  assert.equal(
    (
      await request("/api/commerce/agent/recommend", {
        cookie: "host_session=new-player",
        method: "POST",
        data: { goal: "guard", budgetMinor: 300 },
      })
    ).status,
    429,
  );
  assert.equal(aiCalls, 1);
  assert.equal(
    (
      await request("/api/commerce/entitlements", {
        cookie: "host_session=new-player",
      })
    ).body.length,
    0,
  );
});
