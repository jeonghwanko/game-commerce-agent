import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";
import { Commerce } from "./commerce.js";
import { catalog, requireThat } from "./catalog.js";
import { MockProvider } from "./providers/mock.js";
import { PayPalSandboxProvider } from "./providers/paypal.js";
import { Recommender } from "./recommend.js";
import { GameBridge } from "./game.js";
const hash = (s) => createHash("sha256").update(s).digest("hex");
async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    requireThat(Buffer.byteLength(raw) <= 8192, "body_too_large", 413);
  }
  try {
    const parsed = JSON.parse(raw || "{}");
    requireThat(
      parsed && typeof parsed === "object" && !Array.isArray(parsed),
      "invalid_json",
    );
    return parsed;
  } catch {
    requireThat(false, "invalid_json");
  }
}
export function createApp({
  store = new Store(process.env.DATABASE_PATH ?? "./data/commerce.sqlite"),
  provider,
  recommender,
  origin = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000",
} = {}) {
  const mode = process.env.PAYMENT_PROVIDER ?? "mock";
  requireThat(
    ["mock", "paypal-sandbox"].includes(mode),
    "invalid_payment_mode",
  );
  provider ??=
    mode === "mock"
      ? new MockProvider(store)
      : new PayPalSandboxProvider({
          clientId: process.env.PAYPAL_CLIENT_ID,
          clientSecret: process.env.PAYPAL_CLIENT_SECRET,
          webhookId: process.env.PAYPAL_WEBHOOK_ID,
          baseUrl: process.env.PAYPAL_BASE_URL,
          origin,
        });
  recommender ??= new Recommender({
    mode: process.env.AI_PROVIDER ?? "mock",
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
  });
  const commerce = new Commerce(store, provider),
    game = new GameBridge(store);
  const inFlightAI = new Set();
  const rate = new Map();
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, origin);
      const path = url.pathname;
      requireThat(
        req.headers.host === new URL(origin).host,
        "invalid_host",
        403,
      );
      if (req.method === "POST" && path === "/api/paypal/webhooks") {
        const out = await commerce.webhook(req.headers, await body(req));
        return send(200, { status: out.status });
      }
      if (
        req.method === "GET" &&
        ["/", "/app.js", "/style.css"].includes(path)
      ) {
        const file = path === "/" ? "index.html" : path.slice(1);
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
        res.end(await readFile(new URL(`../public/${file}`, import.meta.url)));
        return;
      }
      const token = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("gca_session="))
        ?.slice(12);
      let session =
        token &&
        store.get(
          "SELECT * FROM sessions WHERE token_hash=? AND expires>?",
          hash(token),
          Date.now(),
        );
      if (req.method === "GET" && path === "/api/session") {
        if (!session) {
          const raw = randomBytes(32).toString("hex");
          session = {
            user_id: randomUUID(),
            csrf: randomBytes(24).toString("hex"),
            expires: Date.now() + 7 * 86400000,
          };
          store.run(
            "INSERT INTO sessions VALUES(?,?,?,?)",
            hash(raw),
            session.user_id,
            session.csrf,
            session.expires,
          );
          res.setHeader(
            "Set-Cookie",
            `gca_session=${raw}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${origin.startsWith("https:") ? "; Secure" : ""}`,
          );
          store.event(session.user_id, "shop_opened");
        }
        return send(200, {
          csrf: session.csrf,
          paymentMode: provider.name,
          aiMode: recommender.mode,
        });
      }
      requireThat(session, "session_required", 401);
      const user = session.user_id;
      requireThat(!url.searchParams.has("userId"), "session_identity_only");
      if (req.method === "POST") {
        requireThat(
          req.headers.origin === origin &&
            req.headers["x-csrf-token"] === session.csrf,
          "csrf_rejected",
          403,
        );
        requireThat(
          req.headers["content-type"]?.startsWith("application/json"),
          "json_required",
          415,
        );
        const now = Date.now();
        const counter = rate.get(user) ?? { at: now, n: 0 };
        if (now - counter.at > 60000) {
          counter.at = now;
          counter.n = 0;
        }
        counter.n++;
        rate.set(user, counter);
        requireThat(counter.n <= 60, "rate_limited", 429);
        if (rate.size > 10000)
          for (const [key, v] of rate) if (now - v.at > 60000) rate.delete(key);
      }
      if (req.method === "GET" && path === "/api/commerce/catalog")
        return send(200, catalog);
      if (req.method === "GET" && path === "/api/game")
        return send(200, game.state(user));
      if (req.method === "GET" && path === "/api/commerce/entitlements")
        return send(200, game.state(user).entitlements);
      if (req.method === "GET" && path === "/api/commerce/orders")
        return send(
          200,
          store.all(
            "SELECT id,sku,amount,currency,status FROM orders WHERE user_id=? ORDER BY created DESC LIMIT 20",
            user,
          ),
        );
      if (req.method === "GET" && path === "/api/analytics/funnel")
        return send(
          200,
          store.all(
            "SELECT name,count(*) count FROM events WHERE user_id=? GROUP BY name",
            user,
          ),
        );
      const match = path.match(
        /^\/api\/commerce\/orders\/([a-f0-9-]{36})(?:\/(capture|cancel|mock-approve))?$/,
      );
      if (match && req.method === "GET" && !match[2])
        return send(200, commerce.owned(user, match[1]));
      if (req.method === "POST") {
        const b = await body(req);
        requireThat(
          !("userId" in b) && !("user_id" in b),
          "session_identity_only",
        );
        if (path === "/api/commerce/quotes")
          return send(201, commerce.quote(user, b.sku));
        if (path === "/api/commerce/orders")
          return send(201, await commerce.create(user, b));
        if (path === "/api/commerce/agent/recommend") {
          requireThat(!inFlightAI.has(user), "recommendation_in_progress", 429);
          inFlightAI.add(user);
          try {
            store.event(user, "agent_query_submitted");
            const r = await recommender.recommend(b, game.state(user));
            if (r.products.length) store.event(user, "product_recommended");
            return send(200, r);
          } finally {
            inFlightAI.delete(user);
          }
        }
        if (path === "/api/game/equip")
          return send(200, game.equip(user, b.sku));
        if (path === "/api/game/quest")
          return send(200, game.quest(user, b.quest));
        if (match) {
          const id = match[1];
          if (match[2] === "cancel")
            return send(200, commerce.cancel(user, id));
          if (match[2] === "capture")
            return send(200, await commerce.capture(user, id));
          if (match[2] === "mock-approve") {
            requireThat(provider.name === "mock", "mock_disabled", 404);
            const o = commerce.owned(user, id);
            requireThat(
              o.status === "APPROVAL_PENDING",
              "order_not_approvable",
              409,
            );
            await provider.approve(o.provider_id);
            await commerce.capture(user, id);
            // Explicit offline simulation of a verified webhook; not a PayPal verification claim.
            return send(
              200,
              commerce.settle(
                id,
                await provider.inspect(o.provider_id),
                `mock-verified-${id}`,
              ),
            );
          }
        }
      }
      send(404, { error: "not_found" });
    } catch (e) {
      send(e.status ?? 500, {
        error:
          e.code && typeof e.code === "string" && !e.code.startsWith("ERR_")
            ? e.code
            : "operation_failed",
      });
    }
  });
  return { server, store, commerce, game };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { server } = createApp();
  server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () =>
    console.log(
      "Game Commerce Agent listening on loopback. See PUBLIC_ORIGIN; no deployment performed.",
    ),
  );
}
