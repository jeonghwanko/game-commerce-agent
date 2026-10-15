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
