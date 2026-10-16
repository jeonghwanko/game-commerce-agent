// Import/check are inert. Only an explicit operator --start opens a listener.
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";
import { createApp } from "./server.js";
import { SandboxDemoHost } from "./demo-host.js";
import { catalog, requireThat } from "./catalog.js";
import { PayPalSandboxProvider, SANDBOX } from "./providers/paypal.js";
import { MockProvider } from "./providers/mock.js";
import { Recommender } from "./recommend.js";
import { ExternalWorkBudget } from "./budget.js";

// Public metadata only. Never inspect credentials, open the ledger or probe APIs.
export function sandboxReadiness() {
  return {
    readiness: "operator_configuration_required",
    actualProviderVerified: false,
    ai: "mock",
    sandboxApi: SANDBOX,
    products: catalog.map(({ sku, name, amount, currency }) => ({
      sku,
      name,
      amountMinor: amount,
      currency,
    })),
    merchantIdentity:
      "Operator-supplied Sandbox seller ID; no real ID in examples.",
    required: [
      "Existing Sandbox app Authorization (or client pair), supplied by user only",
      "PAYPAL_MERCHANT_ID: expected seller, independently checked by operator",
      "PAYPAL_WEBHOOK_ID: existing registration for this app",
      "PUBLIC_ORIGIN: existing approved HTTPS route including /api/paypal/webhooks",
      "SANDBOX_WEBHOOK_ROUTE_READY=true: operator attestation, not an automated check",
      "Existing DEMO_ACCESS_USER / DEMO_ACCESS_PASSWORD and separate persistent DATABASE_PATH",
      "Separate Sandbox buyer and explicit product/amount confirmation in the UI",
    ],
    grantRequires:
      "Verified server capture AND verified real completion webhook",
    blockedWithoutWebhook:
      "AWAITING_WEBHOOK; no ownership or paid outfit equip",
    startup: "--start --confirm-sandbox-requests (no startup API probe)",
  };
}

export function createSandboxDemo({
  env = process.env,
  store,
  fetcher = fetch,
  confirmSandboxRequests = false,
} = {}) {
  const mode = env.PAYMENT_PROVIDER ?? "mock";
  requireThat(
    ["mock", "paypal-sandbox"].includes(mode),
    "invalid_payment_mode",
  );
  requireThat(
    (env.AI_PROVIDER ?? "mock") === "mock",
    "payment_demo_ai_must_be_mock",
  );
  const origin = env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";
  if (mode === "paypal-sandbox") {
    requireThat(
      confirmSandboxRequests === true,
      "sandbox_requests_confirmation_required",
    );
    const url = new URL(origin);
    requireThat(
      url.protocol === "https:" && url.origin === origin,
      "sandbox_approved_https_origin_required",
    );
    requireThat(
      env.SANDBOX_WEBHOOK_ROUTE_READY === "true",
      "sandbox_webhook_route_not_ready",
    );
    requireThat(
      typeof env.DATABASE_PATH === "string" &&
        env.DATABASE_PATH.length > 0 &&
        env.DATABASE_PATH !== ":memory:",
      "sandbox_persistent_database_required",
    );
  }
  const ownedStore = !store;
  store ??= new Store(env.DATABASE_PATH ?? "./data/sandbox-demo.sqlite");
  try {
    const demoHost = new SandboxDemoHost({
      store,
      origin,
      enabled: env.SANDBOX_DEMO_HOST_ENABLED === "true",
      user: env.DEMO_ACCESS_USER,
      password: env.DEMO_ACCESS_PASSWORD,
    });
    const provider =
      mode === "mock"
        ? new MockProvider(store)
        : new PayPalSandboxProvider(
            {
              clientId: env.PAYPAL_CLIENT_ID,
              clientSecret: env.PAYPAL_CLIENT_SECRET,
              oauthBasicAuthHeader: env.PAYPAL_OAUTH_BASIC_AUTH_HEADER,
              webhookId: env.PAYPAL_WEBHOOK_ID,
              merchantId: env.PAYPAL_MERCHANT_ID,
              baseUrl: env.PAYPAL_BASE_URL,
              origin,
              webhookBudget: new ExternalWorkBudget(store, {
                name: "paypal-webhooks-window-v1",
                windowMs: 60000,
                limit: Number(env.WEBHOOK_WINDOW_VERIFY_LIMIT ?? 100),
                concurrency: 2,
              }),
            },
            fetcher,
          );
    const app = createApp({
      store,
      origin,
      demoHost,
      provider,
      recommender: new Recommender({ mode: "mock" }),
      authMode: "principal",
      identity: demoHost.identity,
    });
    return { ...app, store };
  } catch (error) {
    if (ownedStore) store.close();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) {
    console.log(JSON.stringify(sandboxReadiness(), null, 2));
  } else if (
    args[0] === "--start" &&
    (args.length === 1 ||
      (args.length === 2 && args[1] === "--confirm-sandbox-requests"))
  ) {
    try {
      const app = createSandboxDemo({
        confirmSandboxRequests: args[1] === "--confirm-sandbox-requests",
      });
      app.server.on("error", () => {
        console.error("sandbox_demo_listener_failed");
        app.store.close();
        process.exitCode = 1;
      });
      app.server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
        console.log(
          "Independent demo on loopback. AI is mock. Startup sent no provider requests.",
        );
      });
    } catch {
      // No config values or raw exceptions in CLI output.
      console.error(
        "sandbox_demo_start_blocked: review the operator checklist with --check",
      );
      process.exitCode = 1;
    }
  } else {
    console.error(
      "usage: sandbox-demo.js [--check | --start [--confirm-sandbox-requests]]",
    );
    process.exitCode = 1;
  }
}
