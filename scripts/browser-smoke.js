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
const handler = server.listeners("request")[0];
server.removeAllListeners("request");
let failInitialSession = true;
server.on("request", (req, res) => {
  if (req.url === "/api/session" && failInitialSession) {
    failInitialSession = false;
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "simulated_session_unavailable" }));
    return;
  }
  handler(req, res);
});
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
    throw new Error(
      `UI timeout: ${expression}; ${JSON.stringify(await evaluate("({near:scene.near,target:scene.target,player:scene.player,focus:document.activeElement?.outerHTML})"))}`,
    );
  };
  const click = async (label) => {
    await wait("true");
    const point = await evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(label)}) && !b.disabled && b.getClientRects().length); if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await call(
      "Input.dispatchMouseEvent",
      { type: "mousePressed", button: "left", clickCount: 1, ...point },
      sessionId,
    );
    await call(
      "Input.dispatchMouseEvent",
      { type: "mouseReleased", button: "left", clickCount: 1, ...point },
      sessionId,
    );
  };
  const typeGoal = async (text, budget) => {
    await evaluate(
      "document.querySelector('#goal').focus(); document.querySelector('#goal').select()",
    );
    await call("Input.insertText", { text }, sessionId);
    await evaluate(
      "document.querySelector('#budget').focus(); document.querySelector('#budget').select()",
    );
    await call("Input.insertText", { text: budget }, sessionId);
  };
  await call("Page.navigate", { url: origin }, sessionId);
  await wait("!document.querySelector('#global-error').hidden");
  assert.equal(
    await evaluate("document.querySelector('[data-walk]').disabled"),
    true,
  );
  await click("Retry connection");
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
  await click("I confirm");
  await wait(
    "document.querySelector('#checkout').textContent.includes('Simulate buyer')",
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 0);
  assert.equal(store.get("SELECT count(*) n FROM orders").n, 1);
  // Regression: selecting another quote must detach all previous payment controls.
  await typeGoal("travel cloak", "1.00");
  await click("Recommend outfits");
  await wait(
    "document.querySelector('#products').textContent.includes('Traveler')",
  );
  await click("Review purchase");
  await wait(
    "document.querySelector('#quote').textContent.includes('USD 0.99')",
  );
  assert.equal(
    await evaluate("document.querySelector('#checkout').children.length"),
    0,
    "new quote retains old order payment buttons",
  );
  await click("Return to pending purchase");
  await wait(
    "document.querySelector('#quote').textContent.includes('USD 1.99')",
  );
  assert.equal(
    await evaluate("document.querySelector('#checkout').dataset.orderId"),
    store.get("SELECT id FROM orders LIMIT 1").id,
  );
  await click("Retry payment check");
  await wait(
    "document.querySelector('#status').textContent.includes('buyer_approval_required')",
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 0);
  await click("Simulate buyer");
  await wait(
    "document.querySelector('#status').textContent.includes('operation_failed')",
  );
  await click("Retry payment check");
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
  await click("Refresh saved status");
  await wait(
    "document.querySelector('#wardrobe').textContent.includes('Rosalyn Gala Outfit')",
  );
  await click("Wear Rosalyn Gala Outfit");
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
  await click("Enter the gathering");
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
  await typeGoal("travel cloak", "1.00");
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
    "document.querySelector('#status').textContent.includes('Purchase cancelled')",
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 1);
  const cancelled = store.get("SELECT id FROM orders WHERE status='CANCELLED'");
  await call(
    "Page.navigate",
    { url: `${origin}/?order=${cancelled.id}&result=approved` },
    sessionId,
  );
  await wait(
    "document.querySelector('#status')?.textContent.includes('Purchase cancelled')",
  );
  assert.equal(
    await evaluate("document.querySelector('#checkout').children.length"),
    0,
  );
  // Mobile pointer layout and 200% reflow, followed by a Tab/Enter-only free route.
  await call(
    "Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    sessionId,
  );
  await call(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
    sessionId,
  );
  const key = async (key, code = key, modifiers = 0) => {
    await call(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key,
        code,
        modifiers,
        text: key === "Enter" ? "\r" : undefined,
        windowsVirtualKeyCode: key === "Tab" ? 9 : 13,
      },
      sessionId,
    );
    await call(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key,
        code,
        modifiers,
        windowsVirtualKeyCode: key === "Tab" ? 9 : 13,
      },
      sessionId,
    );
  };
  const tabActivate = async (label) => {
    await wait("true");
    for (let i = 0; i < 100; i++) {
      await wait("true");
      if (
        await evaluate(
          `document.activeElement?.tagName==='BUTTON' && document.activeElement.textContent.includes(${JSON.stringify(label)}) && !document.activeElement.disabled`,
        )
      ) {
        await key("Enter");
        return;
      }
      const reverse = await evaluate(
        `(()=>{const target=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)})&&!b.disabled);return !!(target && document.activeElement.compareDocumentPosition(target)&2);})()`,
      );
      await key("Tab", "Tab", reverse ? 8 : 0);
    }
    throw new Error("Tab unreachable: " + label);
  };
  // A fresh browser session finishes the story entirely for free.
  await call("Network.clearBrowserCookies", {}, sessionId);
  await call("Page.navigate", { url: origin }, sessionId);
  await wait("document.querySelector('#mode')?.textContent.includes('MOCK')");
  assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
  await evaluate("document.documentElement.style.zoom='2'");
  assert.ok(
    await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    "200% reflow overflow",
  );
  await screenshot("mobile-200-percent");
  await evaluate("document.documentElement.style.zoom='1'");
  await tabActivate("Walk to shop");
  await wait("scene.near === 'shop'");
  await tabActivate("Talk to Rosalyn");
  await tabActivate("Recommend outfits");
  await wait("document.querySelectorAll('.product').length===1");
  await tabActivate("Borrow formal clothes");
  await wait(
    "document.querySelector('#wardrobe').textContent.includes('Free loan')",
  );
  assert.ok(
    await evaluate(
      "document.querySelector('#plan').textContent.includes('state changed')",
    ),
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.product').length"),
    0,
  );
  await tabActivate("Walk to courier");
  await wait("scene.near === 'seal'");
  await tabActivate("Talk to Courier");
  await tabActivate("Accept the seal");
  await tabActivate("Walk to archivist");
  await wait("scene.near === 'rumor'");
  await tabActivate("Talk to Archivist");
  await tabActivate("Remember the rumor");
  await tabActivate("Walk to guard");
  await wait("scene.near === 'guard'");
  await tabActivate("Talk to Gatekeeper");
  await tabActivate("Enter the gathering");
  await wait("scene.arrived === true");
  assert.equal(store.get("SELECT count(*) n FROM orders").n, 2);
  console.log(
    "PASS Chromium pointer purchase/quote isolation/recovery; mobile 390px and CSS 200% reflow; Tab/Enter free completion; global session error/retry; reduced motion. Mock rehearsal only.",
  );
} finally {
  socket?.close();
  browser.kill();
  await new Promise((r) => server.close(r));
  store.close();
  await new Promise((r) =>
    browser.exitCode !== null ? r() : browser.once("exit", r),
  );
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
