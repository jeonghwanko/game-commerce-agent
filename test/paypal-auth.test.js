import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { PayPalSandboxProvider, SANDBOX } from "../src/providers/paypal.js";
const common = {
  webhookId: "stub-webhook",
  merchantId: "stub-merchant",
  origin: "http://localhost:3000",
};
test("opaque full Authorization placeholder is passed unchanged only to fixed Sandbox token endpoint", async () => {
  const placeholder = "  opaque-placeholder:+/=%DO-NOT-TRANSFORM  ";
  const calls = [];
  const p = new PayPalSandboxProvider(
    { ...common, oauthBasicAuthHeader: placeholder },
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.endsWith("/token")
            ? { access_token: "stub-access-token" }
            : { id: "ORDER" },
      };
    },
  );
  await p.request("/v2/checkout/orders/ORDER");
  assert.equal(calls[0].url, SANDBOX + "/v1/oauth2/token");
  assert.equal(calls[0].options.headers.Authorization, placeholder);
  assert.equal(calls[0].options.body, "grant_type=client_credentials");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(
    calls[1].options.headers.Authorization,
    "Bearer stub-access-token",
  );
  assert.ok(!JSON.stringify(calls[1]).includes(placeholder));
  assert.ok(!JSON.stringify(p).includes(placeholder));
  assert.ok(!inspect(p).includes(placeholder));
  assert.ok(!JSON.stringify(p.config).includes(placeholder));
  assert.match(inspect(p), /REDACTED/);
});
test("opaque-header mode conflicts with complete or partial client credentials and rejects header injection", () => {
  for (const pair of [
    { clientId: "stub" },
    { clientSecret: "stub" },
    { clientId: "stub", clientSecret: "stub" },
  ])
    assert.throws(
      () =>
        new PayPalSandboxProvider({
          ...common,
          ...pair,
          oauthBasicAuthHeader: "placeholder",
        }),
      /auth_modes_conflict/,
    );
  for (const header of ["bad\r\nx:evil", "bad\0value"])
    assert.throws(
      () =>
        new PayPalSandboxProvider({ ...common, oauthBasicAuthHeader: header }),
      /invalid_paypal_auth_header/,
    );
  assert.throws(
    () => new PayPalSandboxProvider({ ...common, oauthBasicAuthHeader: "" }),
    /configuration_required/,
  );
  for (const baseUrl of [
    "https://api-m.paypal.com",
    "https://evil.invalid",
    "https://api-m.sandbox.paypal.com/redirect",
  ])
    assert.throws(
      () =>
        new PayPalSandboxProvider({
          ...common,
          baseUrl,
          oauthBasicAuthHeader: "placeholder",
        }),
      /sandbox_only/,
    );
});
test("client-pair mode remains Basic, with no client_secret_post body", async () => {
  let options;
  const p = new PayPalSandboxProvider(
    { ...common, clientId: "synthetic-id", clientSecret: "synthetic-secret" },
    async (url, o) => {
      options = o;
      return { ok: true, json: async () => ({ access_token: "stub" }) };
    },
  );
  await p.token();
  assert.equal(
    options.headers.Authorization,
    "Basic " + Buffer.from("synthetic-id:synthetic-secret").toString("base64"),
  );
  assert.equal(options.body, "grant_type=client_credentials");
  assert.ok(!inspect(p).includes("synthetic-secret"));
  assert.ok(!JSON.stringify(p).includes("synthetic-secret"));
});
test("token redirect/transport failures are sanitized and never retry another destination", async () => {
  let calls = 0;
  const placeholder = "synthetic-sensitive-placeholder";
  const p = new PayPalSandboxProvider(
    { ...common, oauthBasicAuthHeader: placeholder },
    async (url, opts) => {
      calls++;
      assert.equal(url, SANDBOX + "/v1/oauth2/token");
      assert.equal(opts.redirect, "error");
      throw new Error("redirect attempted " + placeholder);
    },
  );
  await assert.rejects(
    p.token(),
    (e) =>
      e.message === "paypal_auth_transport_failed" &&
      !String(e.stack).includes(placeholder),
  );
  assert.equal(calls, 1);
});
test("untrusted bearer tokens are rejected before header construction without leaking values", async () => {
  for (const access_token of [
    null,
    123,
    "",
    "x".repeat(4097),
    "secret\r\ninjected",
    "secret value",
    "secret\tvalue",
    "secret\u007fvalue",
    "secret\u0085value",
  ]) {
    let calls = 0;
    const p = new PayPalSandboxProvider(
      { ...common, oauthBasicAuthHeader: "synthetic" },
      async () => {
        calls++;
        return Response.json({ access_token });
      },
    );
    await assert.rejects(
      p.request("/v2/checkout/orders/ORDER"),
      (e) =>
        e.code === "paypal_invalid_token" &&
        e.message === "paypal_invalid_token" &&
        e.cause === undefined,
    );
    assert.equal(calls, 1);
  }
});
test("API transport and JSON failures expose fixed errors, never token or upstream text", async () => {
  for (const failure of ["transport", "json", "shape", "decline-shape"]) {
    const secret = "synthetic-sensitive-token";
    const p = new PayPalSandboxProvider(
      { ...common, oauthBasicAuthHeader: "synthetic" },
      async (url) => {
        if (url.endsWith("/token"))
          return Response.json({ access_token: secret });
        if (failure === "transport") throw new Error(secret);
        if (failure === "json")
          return {
            ok: true,
            json: async () => {
              throw new Error(secret);
            },
          };
        if (failure === "shape") return Response.json(null);
        return Response.json({ details: secret }, { status: 422 });
      },
    );
    await assert.rejects(p.request("/v2/checkout/orders/ORDER"), (e) => {
      assert.equal(e.name, "Error");
      assert.equal(e.status, 502);
      assert.ok(
        [
          "paypal_transport_failed",
          "paypal_response_failed",
          "paypal_request_failed",
        ].includes(e.code),
      );
      assert.ok(!inspect(e).includes(secret));
      return true;
    });
  }
});
