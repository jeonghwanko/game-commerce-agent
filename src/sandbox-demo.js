// Operator-configured standalone test host. Not started by npm start.
import { Store } from "./store.js";
import { createApp } from "./server.js";
import { SandboxDemoHost } from "./demo-host.js";
const store = new Store(
  process.env.DATABASE_PATH ?? "./data/sandbox-demo.sqlite",
);
const origin = process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";
const demoHost = new SandboxDemoHost({
  store,
  origin,
  enabled: process.env.SANDBOX_DEMO_HOST_ENABLED === "true",
  user: process.env.DEMO_ACCESS_USER,
  password: process.env.DEMO_ACCESS_PASSWORD,
});
const { server } = createApp({
  store,
  origin,
  demoHost,
  authMode: "principal",
  identity: demoHost.identity,
});
server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () =>
  console.log(
    "Independent sandbox demo host listening on loopback; not private game integration.",
  ),
);
