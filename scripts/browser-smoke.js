// Uses an installed Chromium and native CDP; no browser package/download required.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { createApp } from "../src/server.js";
import { MockProvider } from "../src/providers/mock.js";
const dir = await mkdtemp(join(tmpdir(), "gca-browser-"));
const store = new Store();
const port = Number(process.env.BROWSER_TEST_PORT ?? 3137);
const origin = `http://127.0.0.1:${port}`;
const provider = new MockProvider(store);
const originalCapture = provider.capture.bind(provider);
let failAfterCapture = true;
provider.capture = async (...args) => {
  const remote = await originalCapture(...args);
  if (failAfterCapture) {
    failAfterCapture = false;
    throw new Error("simulated response timeout");
  }
  return remote;
};
const { server, commerce } = createApp({ store, origin, provider });
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const browser = spawn(
  process.env.CHROMIUM ?? "chromium",
  [
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${dir}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
try {
  const ws = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Chromium startup timeout")),
      10000,
    );
    browser.on("error", reject);
    browser.stderr.on("data", (d) => {
      const match = d.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  socket = new WebSocket(ws);
  await new Promise((r, j) => {
    socket.onopen = r;
    socket.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const d = JSON.parse(event.data);
    const p = pending.get(d.id);
    if (p) {
      pending.delete(d.id);
      d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result);
    }
  };
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await call(
    "Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  const screenshot = async (name) => {
    const metrics = await call("Page.getLayoutMetrics", {}, sessionId);
    const size = metrics.cssContentSize;
    const result = await call(
      "Page.captureScreenshot",
      {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
      },
      sessionId,
    );
    await writeFile(`/tmp/gca-${name}.png`, Buffer.from(result.data, "base64"));
  };
  const evaluate = async (expression) => {
    const r = await call(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (
        await evaluate(
          `(${expression}) && typeof busy !== 'undefined' && !busy`,
        )
      )
        return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`UI timeout: ${expression}`);
  };
  const click = async (label) => {
    await wait("true");
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`,
    );
  };
  await call("Page.navigate", { url: origin }, sessionId);
  await wait("document.querySelector('#mode')?.textContent.includes('MOCK')");
  await click("Walk to shop");
  await wait("scene.near === 'shop'");
  await click("Talk to Rosalyn");
  await click("Recommend outfits");
  await wait("document.querySelectorAll('.product').length===1");
  await click("Review purchase");
  await wait(
    "document.querySelector('#quote').textContent.includes('I confirm USD 1.99')",
  );
  assert.equal(store.get("SELECT count(*) n FROM orders").n, 0);
  await screenshot("mock-preview");
  await evaluate(
    "{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('I confirm'));b.click();b.click();}",
  );
  await wait(
    "document.querySelector('#checkout').textContent.includes('Simulate buyer')",
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 0);
  assert.equal(store.get("SELECT count(*) n FROM orders").n, 1);
  await click("Verify / retry");
  await wait(
    "document.querySelector('#status').textContent.includes('buyer_approval_required')",
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 0);
  await click("Simulate buyer");
  await wait(
    "document.querySelector('#status').textContent.includes('operation_failed')",
  );
  await click("Verify / retry");
  await wait(
    "document.querySelector('#status').textContent.includes('Waiting for a verified')",
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 0);
  await call("Page.reload", {}, sessionId);
  await wait(
    "document.querySelector('#status')?.textContent.includes('Waiting for a verified')",
  );
  await screenshot("mock-pending");
  const pendingOrder = store.get("SELECT * FROM orders LIMIT 1");
  commerce.settle(
    pendingOrder.id,
    await provider.inspect(pendingOrder.provider_id),
    "mock-delayed-webhook",
  );
  await click("Refresh verified status");
  await wait(
    "document.querySelector('#wardrobe').textContent.includes('rosalyn-gala')",
  );
  await click("Wear rosalyn-gala");
  await wait(
    "document.querySelector('#requirements').textContent.includes('Formal outfit ✓')",
  );
  assert.ok(
    !(await evaluate("document.querySelector('#guard').textContent")).includes(
      "Welcome inside",
    ),
  );
  await click("Walk to courier");
  await wait("scene.near === 'seal'");
  await click("Talk to Courier");
  await click("Accept the seal");
  await wait(
    "document.querySelector('#requirements').textContent.includes('Seal ✓')",
  );
  await click("Walk to archivist");
  await wait("scene.near === 'rumor'");
  await click("Talk to Archivist");
  await click("Remember the rumor");
  await wait(
    "document.querySelector('#guard').textContent.includes('Welcome inside')",
  );
  await click("Walk to guard");
  await wait("scene.near === 'guard'");
  await click("Talk to Gatekeeper");
  await wait(
    "document.querySelector('#dialogue-text').textContent.includes('gate is open')",
  );
  await evaluate("scene.target={x:900,y:235}");
  await wait("scene.arrived === true");
  await screenshot("mock-complete");
  await call("Page.reload", {}, sessionId);
  await wait(
    "document.querySelector('#guard')?.textContent.includes('Welcome inside')",
  );
  await click("Walk to shop");
  await wait("scene.near === 'shop'");
  await click("Talk to Rosalyn");
  const screenResult = await call(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true },
    sessionId,
  );
  await writeFile(
    "/tmp/gca-browser-smoke.png",
    Buffer.from(screenResult.data, "base64"),
  );
  // Second SKU exercises cancellation through actual rendered controls.
  await evaluate(
    "document.querySelector('#goal').value='travel cloak'; document.querySelector('#budget').value='1.00'",
  );
  await click("Recommend outfits");
  await wait(
    "document.querySelector('#products').textContent.includes('Traveler')",
  );
  await click("Review purchase");
  await wait(
    "document.querySelector('#quote').textContent.includes('I confirm USD 0.99')",
  );
  await click("I confirm");
  await wait(
    "document.querySelector('#checkout').textContent.includes('Cancel checkout')",
  );
  await click("Cancel checkout");
  await wait(
    "document.querySelector('#status').textContent.includes('CANCELLED')",
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 1);
  const cancelled = store.get("SELECT id FROM orders WHERE status='CANCELLED'");
  await call(
    "Page.navigate",
    { url: `${origin}/?order=${cancelled.id}&result=approved` },
    sessionId,
  );
  await wait(
    "document.querySelector('#status')?.textContent.includes('CANCELLED')",
  );
  assert.equal(
    await evaluate("document.querySelector('#checkout').children.length"),
    0,
  );
  // A fresh browser session finishes the story entirely for free.
  await call("Network.clearBrowserCookies", {}, sessionId);
  await call("Page.navigate", { url: origin }, sessionId);
  await wait("document.querySelector('#mode')?.textContent.includes('MOCK')");
  await click("Walk to shop");
  await wait("scene.near === 'shop'");
  await click("Talk to Rosalyn");
  await click("Borrow formal clothes");
  await click("Walk to courier");
  await wait("scene.near === 'seal'");
  await click("Talk to Courier");
  await click("Accept the seal");
  await click("Walk to archivist");
  await wait("scene.near === 'rumor'");
  await click("Talk to Archivist");
  await click("Remember the rumor");
  await click("Walk to guard");
  await wait("scene.near === 'guard'");
  await click("Talk to Gatekeeper");
  await evaluate("scene.target={x:900,y:235}");
  await wait("scene.arrived === true");
  assert.equal(store.get("SELECT count(*) n FROM orders").n, 2);
  console.log(
    "PASS Chromium: playable courtyard, preview, repeated confirmation, approval required, timeout retry, pending webhook, reload, outfit and NPC changes, cancellation return, complete free route. Screenshot: /tmp/gca-browser-smoke.png",
  );
} finally {
  socket?.close();
  browser.kill();
  await new Promise((r) => server.close(r));
  store.close();
  await new Promise((r) =>
    browser.exitCode !== null ? r() : browser.once("exit", r),
  );
  await rm(dir, { recursive: true, force: true });
}
