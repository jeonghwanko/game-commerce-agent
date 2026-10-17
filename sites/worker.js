import { catalog, requireThat, CommerceError } from "../src/catalog.js";
import { sitesAIMode, sitesRecommend } from "./ai.js";
import { lookPreviews } from "../src/story-preview.js";
import { PayPalSandboxProvider, SANDBOX } from "../src/providers/paypal.js";
import { D1Ledger, D1WindowBudget, uuid } from "./d1.js";
import { D1Commerce } from "./commerce.js";
import { D1Game } from "./game.js";
import { D1MockProvider } from "./mock-provider.js";

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json = (data, status = 200) =>
  Response.json(data, { status, headers: responseHeaders });
const html = (body, status = 200) =>
  new Response(body, {
    status,
    headers: { ...responseHeaders, "content-type": "text/html; charset=utf-8" },
  });
async function readJSON(request) {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        requireThat(size <= 8192, "body_too_large", 413);
        chunks.push(value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes) || "{}");
    requireThat(
      body && typeof body === "object" && !Array.isArray(body),
      "invalid_json",
    );
    return body;
  } catch (e) {
    if (reader) await reader.cancel().catch(() => {});
    if (e instanceof CommerceError) throw e;
    throw new CommerceError("invalid_json");
  } finally {
    reader?.releaseLock();
  }
}
async function pseudonym(id) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`sites-principal:${id}`),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function session(s, user) {
  const csrf = uuid(),
    now = Date.now();
  await s.run(
    "INSERT INTO sites_sessions VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET csrf=excluded.csrf,expires=excluded.expires WHERE sites_sessions.expires<=?",
    user,
    csrf,
    now + 3600000,
    now,
  );
  return s.one("SELECT * FROM sites_sessions WHERE user_id=?", user);
}
function providerFor(s, env, fetcher) {
  const mode = env.PAYMENT_PROVIDER ?? "unconfigured";
  requireThat(
    ["mock", "unconfigured", "paypal-sandbox"].includes(mode),
    "invalid_payment_mode",
    503,
  );
  if (mode === "unconfigured") return null;
  if (mode === "mock") return new D1MockProvider(s);
  requireThat(
    env.SANDBOX_PAYMENTS_ENABLED === "true",
    "sandbox_requests_not_enabled",
    503,
  );
  requireThat(
    env.PAYPAL_BASE_URL === undefined || env.PAYPAL_BASE_URL === SANDBOX,
    "sandbox_only",
    503,
  );
  requireThat(
    env.PAYPAL_MERCHANT_ID === "XB5RWXEAFHG8J",
    "expected_merchant_required",
    503,
  );
  const origin = new URL(env.PUBLIC_ORIGIN);
  requireThat(
    origin.protocol === "https:" && origin.origin === env.PUBLIC_ORIGIN,
    "https_origin_required",
    503,
  );
  return new PayPalSandboxProvider(
    {
      oauthBasicAuthHeader: env.PAYPAL_OAUTH_BASIC_AUTH_HEADER,
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      merchantId: env.PAYPAL_MERCHANT_ID,
      webhookId: env.PAYPAL_WEBHOOK_ID,
      baseUrl: SANDBOX,
      origin: env.PUBLIC_ORIGIN,
      webhookBudget: new D1WindowBudget(s),
    },
    fetcher,
  );
}
// assets is supplied by the supported Sites build integration, never from a public
// ASSETS fallback before this handler. Unit tests inject local static bytes.
export function createSitesWorker({
  assets = {},
  fetcher = fetch,
  aiTimeoutMs = 10000,
} = {}) {
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url),
          path = url.pathname;
        requireThat(
          typeof env.PUBLIC_ORIGIN === "string" &&
            url.origin === env.PUBLIC_ORIGIN,
          "invalid_host",
          403,
        );
        requireThat(
          request.method === "GET" || request.method === "POST",
          "method_not_allowed",
          405,
        );
        // The only anonymous application API. No D1/mock signature bypass exists.
        if (path === "/api/paypal/webhooks" && request.method === "POST") {
          requireThat(
            env.PAYMENT_PROVIDER === "paypal-sandbox" &&
              env.SANDBOX_PAYMENTS_ENABLED === "true",
            "payments_not_configured",
            503,
          );
          const s = new D1Ledger(env.DB),
            p = providerFor(s, env, fetcher),
            commerce = new D1Commerce(s, p);
          await commerce.init();
          const o = await commerce.webhook(
            Object.fromEntries(request.headers),
            await readJSON(request),
          );
          return json({ status: o.status });
        }
        // These are injected by Sites dispatch, not identity claimed in cookies,
        // query/body, email, x-user-id or developer headers. Direct Worker ingress
        // must not be exposed; hosted spoof stripping must be verified before public.
        // Match the official getChatGPTUser() identity-presence contract. Email
        // is never an ownership key. Both headers are trusted only after Sites
        // dispatch; checking their presence is not proof against direct ingress.
        const id = request.headers.get("oai-authenticated-user-id"),
          email = request.headers.get("oai-authenticated-user-email");
        if (!id || !email) {
          if (path === "/" && request.method === "GET")
            return html(
              '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rosalyn · Sign in</title><main><h1>Rosalyn’s owner-only demo</h1><p>Game and orders require the owner’s ChatGPT login.</p><a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a></main></html>',
              401,
            );
          return json({ error: "chatgpt_login_required" }, 401);
        }
        // Non-game setup readout: lets the owner copy THEIR Site-scoped ID while
        // the Site is owner-private, then save it directly in Sites Settings.
        // This never binds the first visitor or awards access to the returned ID.
        if (path === "/api/setup/identity" && request.method === "GET")
          return json({
            siteUserId: id,
            configured: !!env.SITES_OWNER_USER_ID,
            notice:
              "Owner-only private setup: copy your Site-scoped ID into SITES_OWNER_USER_ID in Settings. This endpoint grants no access.",
          });
        requireThat(
          typeof env.SITES_OWNER_USER_ID === "string" &&
            env.SITES_OWNER_USER_ID.length > 0,
          "owner_configuration_required",
          503,
        );
        requireThat(id === env.SITES_OWNER_USER_ID, "owner_only", 403);
        requireThat(
          !url.searchParams.has("userId") && !url.searchParams.has("user_id"),
          "session_identity_only",
        );
        if (
          request.method === "GET" &&
          [
            "/",
            "/app.js",
            "/scene.js",
            "/game-client.js",
            "/style.css",
          ].includes(path)
        ) {
          const asset = assets[path];
          requireThat(asset, "site_assets_unavailable", 503);
          return new Response(asset, {
            headers: {
              ...responseHeaders,
              "content-type":
                path === "/"
                  ? "text/html; charset=utf-8"
                  : path.endsWith(".css")
                    ? "text/css"
                    : "text/javascript",
            },
          });
        }
        const s = new D1Ledger(env.DB),
          user = await pseudonym(id),
          sess = await session(s, user);
        requireThat(
          !request.headers.get("x-commerce-scope") ||
            request.headers.get("x-commerce-scope") === user,
          "account_changed",
          409,
        );
        const scopedJSON = (data, status = 200) =>
          Response.json(data, {
            status,
            headers: { ...responseHeaders, "x-commerce-scope": user },
          });
        const game = new D1Game(s),
          mode = env.PAYMENT_PROVIDER ?? "unconfigured";
        requireThat(
          ["mock", "unconfigured", "paypal-sandbox"].includes(mode),
          "invalid_payment_mode",
          503,
        );
        if (mode === "unconfigured")
          requireThat(
            !(await s.one(
              "SELECT value FROM sites_environment WHERE key='provider'",
            )),
            "database_provider_or_merchant_mismatch",
            409,
          );
        else {
          if (mode === "paypal-sandbox")
            requireThat(
              env.PAYPAL_MERCHANT_ID === "XB5RWXEAFHG8J",
              "expected_merchant_required",
              503,
            );
          await s.bindProvider(
            mode,
            mode === "paypal-sandbox" ? env.PAYPAL_MERCHANT_ID : undefined,
          );
        }
        // Do not read PayPal credentials during the free/session/preview flow.
        const payment = async () => {
          const p = providerFor(s, env, fetcher);
          requireThat(p, "payments_not_configured", 503);
          const c = new D1Commerce(s, p);
          await c.init();
          return c;
        };
        if (request.method === "GET") {
          if (path === "/api/session")
            return scopedJSON({
              csrf: sess.csrf,
              scope: user,
              paymentMode: mode,
              aiMode: sitesAIMode(env),
              authMode: "principal",
              gameHost: "independent-sandbox-demo",
            });
          if (path === "/api/commerce/catalog") return scopedJSON(catalog);
          if (path === "/api/game") {
            const state = await game.state(user);
            return scopedJSON({
              ...state,
              previews: lookPreviews(state, catalog),
            });
          }
          if (path === "/api/commerce/entitlements")
            return scopedJSON((await game.state(user)).entitlements);
          if (path === "/api/commerce/orders")
            return scopedJSON(
              await s.all(
                "SELECT id,sku,amount,currency,status FROM sites_orders WHERE user_id=? ORDER BY created DESC LIMIT 20",
                user,
              ),
            );
          if (path === "/api/analytics/funnel")
            return scopedJSON(
              await s.all(
                "SELECT name,count(*) count FROM sites_events WHERE user_id=? GROUP BY name",
                user,
              ),
            );
        }
        const order = path.match(
          /^\/api\/commerce\/orders\/([a-f0-9-]{36})(?:\/(capture|cancel|resume|mock-approve))?$/,
        );
        if (order && request.method === "GET" && !order[2]) {
          const c = await payment();
          return scopedJSON(c.view(await c.owned(user, order[1])));
        }
        if (request.method === "POST") {
          requireThat(
            request.headers.get("origin") === env.PUBLIC_ORIGIN &&
              request.headers.get("x-csrf-token") === sess.csrf &&
              sess.expires > Date.now(),
            "csrf_rejected",
            403,
          );
          requireThat(
            request.headers.get("content-type")?.startsWith("application/json"),
            "json_required",
            415,
          );
          const b = await readJSON(request);
          requireThat(
            !("userId" in b) && !("user_id" in b),
            "session_identity_only",
          );
          if (path === "/api/commerce/agent/recommend") {
            requireThat(
              typeof b.goal === "string" &&
                b.goal.trim().length > 0 &&
                b.goal.length <= 500,
              "invalid_goal",
            );
            requireThat(
              Number.isSafeInteger(b.budgetMinor) &&
                b.budgetMinor >= 0 &&
                b.budgetMinor <= 100000,
              "invalid_budget",
            );
            return scopedJSON(
              await sitesRecommend(
                s,
                env,
                user,
                b,
                await game.state(user),
                fetcher,
                aiTimeoutMs,
                () => game.state(user),
              ),
            );
          }
          if (path === "/api/game/interact")
            return scopedJSON(await game.begin(user, b.npc));
          if (path === "/api/game/quest")
            return scopedJSON(await game.quest(user, b));
          if (path === "/api/game/equip")
            return scopedJSON(await game.equip(user, b.sku, b.requestId));
          if (path === "/api/commerce/quotes")
            return scopedJSON(await (await payment()).quote(user, b.sku), 201);
          if (path === "/api/commerce/orders")
            return scopedJSON(await (await payment()).create(user, b), 201);
          if (order) {
            const c = await payment(),
              id = order[1];
            if (order[2] === "capture")
              return scopedJSON(await c.capture(user, id));
            if (order[2] === "cancel")
              return scopedJSON(await c.cancel(user, id));
            if (order[2] === "resume")
              return scopedJSON(await c.resume(user, id, b));
            if (order[2] === "mock-approve") {
              requireThat(mode === "mock", "mock_disabled", 404);
              const o = await c.owned(user, id);
              requireThat(
                o.status === "APPROVAL_PENDING",
                "order_not_approvable",
                409,
              );
              await c.p.approve(o.provider_id);
              await c.capture(user, id);
              return scopedJSON(
                await c.settle(
                  id,
                  await c.p.inspect(o.provider_id),
                  `mock-${id}`,
                ),
              );
            }
          }
        }
        return json({ error: "not_found" }, 404);
      } catch (e) {
        return json(
          { error: e instanceof CommerceError ? e.code : "operation_failed" },
          e instanceof CommerceError ? e.status : 500,
        );
      }
    },
  };
}
export default createSitesWorker();
