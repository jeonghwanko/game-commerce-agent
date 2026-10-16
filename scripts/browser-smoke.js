// Uses an installed Chromium and native CDP; no browser package/download required.
import { spawn } from "node:child_process";
import http from "node:http";
import { createSitesWorker } from "../sites/worker.js";
import { sqliteD1 } from "../sites/testing/d1-fixture.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { createApp } from "../src/server.js";
import { SandboxDemoHost } from "../src/demo-host.js";
import { MockProvider } from "../src/providers/mock.js";
const dir = await mkdtemp(join(tmpdir(), "gca-browser-"));
const store = new Store();
const port = Number(process.env.BROWSER_TEST_PORT ?? 3137);
const origin = `http://127.0.0.1:${port}`;
const provider = new MockProvider(store);
const originalCreate = provider.create.bind(provider);
let failAfterCreate = true;
provider.create = async (...args) => {
  const result = await originalCreate(...args);
  if (failAfterCreate) {
    failAfterCreate = false;
    throw new Error("simulated lost create response");
  }
  return result;
};
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
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
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
          `document.readyState === 'complete' && typeof busy !== 'undefined' && !busy && (${expression})`,
        )
      )
        return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `UI timeout: ${expression}; ${JSON.stringify(await evaluate("({near:scene.near,target:scene.target,player:scene.player,focus:document.activeElement?.tagName})"))}`,
    );
  };
  const click = async (label) => {
    await wait("true");
    const point = await evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(label)}) && !b.disabled && b.checkVisibility()); if(!b)throw new Error('Missing button '+${JSON.stringify(label)});b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
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
  const typeInput = async (selector, text) => {
    const point = await evaluate(
      `(()=>{const b=document.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await call(
        "Input.dispatchMouseEvent",
        { type, button: "left", clickCount: 1, ...point },
        sessionId,
      );
    await call(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        modifiers: 2,
      },
      sessionId,
    );
    await call(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        modifiers: 2,
      },
      sessionId,
    );
    await call("Input.insertText", { text }, sessionId);
  };
  const typeGoal = async (text, budget) => {
    await typeInput("#goal", text);
    await typeInput("#budget", budget);
  };
  const act = async (label) => {
    await click(label);
    await wait("true");
  };
  const pointer = async (selector) => {
    await wait("true");
    const p = await evaluate(
      `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e?.checkVisibility())throw Error('Hidden control'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await call(
        "Input.dispatchMouseEvent",
        { type, button: "left", clickCount: 1, ...p },
        sessionId,
      );
    await wait("true");
  };
  const key = async (key, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"])
      await call(
        "Input.dispatchKeyEvent",
        {
          type,
          key,
          code: key,
          modifiers,
          text: type === "keyDown" && key === "Enter" ? "\r" : undefined,
          windowsVirtualKeyCode: key === "Tab" ? 9 : 13,
        },
        sessionId,
      );
  };
  const tabTo = async (selector) => {
    for (let i = 0; i < 100; i++) {
      await wait("true");
      if (
        await evaluate(
          `document.activeElement===document.querySelector(${JSON.stringify(selector)})`,
        )
      ) {
        await key("Enter");
        await wait("true");
        return;
      }
      const reverse = await evaluate(
        `!!(document.activeElement.compareDocumentPosition(document.querySelector(${JSON.stringify(selector)}))&2)`,
      );
      await key("Tab", reverse ? 8 : 0);
    }
    throw Error("Keyboard unreachable: " + selector);
  };
  const tabButton = async (label) => {
    const selector = await evaluate(
      `(() => { const all=[...document.querySelectorAll('button')];const b=all.find(e=>e.textContent.includes(${JSON.stringify(label)})&&e.checkVisibility()&&!e.disabled); if(!b)throw Error('Missing keyboard button');return 'button[data-test-index="'+all.indexOf(b)+'"]';})()`,
    );
    // Test identifiers do not change product state, focus or activation.
    await evaluate(
      "document.querySelectorAll('button').forEach((b,i)=>b.dataset.testIndex=i)",
    );
    await tabTo(selector);
  };
  const layout = async () => {
    assert.equal(
      await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
      true,
    );
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('button,input,canvas')].filter(e=>e.checkVisibility()).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).map(e=>e.id||e.textContent)",
      ),
      [],
    );
    assert.equal(
      await evaluate(
        "['shop','purchase','world'].filter(n=>!document.getElementById(n+'-panel').hidden).length",
      ),
      1,
      "one main stage at a time",
    );
  };
  const viewport = async (width, height = 900) =>
    call(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: width === 390 },
      sessionId,
    );
  const goal = async (text, budget) => {
    if (await evaluate("!document.getElementById('purchase-panel').hidden"))
      await pointer("#back-preview");
    if (await evaluate("!document.getElementById('world-panel').hidden"))
      await pointer("#switch-view");
    if (await evaluate("document.getElementById('recommend').hidden"))
      await pointer("#change-goal");
    if (!(await evaluate("document.getElementById('budget-details').open")))
      await pointer("#budget-details summary");
    await typeGoal(text, budget);
    await act("Show my choices");
    assert.equal(
      await evaluate("document.querySelectorAll('#choices>button').length"),
      2,
    );
    assert.equal(
      await evaluate("document.getElementById('plan-details').open"),
      false,
    );
    await layout();
  };
  const travel = async (place, walkLabel, talkLabel, keyboard = false) => {
    if (await evaluate("document.getElementById('world-panel').hidden"))
      await pointer("#switch-view");
    if (!(await evaluate("document.getElementById('travel-details').open")))
      keyboard
        ? await tabTo("#travel-details summary")
        : await pointer("#travel-details summary");
    keyboard ? await tabButton(walkLabel) : await act(walkLabel);
    await wait(`scene.near===${JSON.stringify(place)}`);
    keyboard ? await tabButton(talkLabel) : await act(talkLabel);
  };
  const completeStory = async (keyboard = false) => {
    for (const [place, walkLabel, talkLabel, accept] of [
      ["seal", "Walk to courier", "Talk to Courier", "Accept the seal"],
      ["rumor", "Walk to archivist", "Talk to Archivist", "Remember the rumor"],
    ]) {
      await travel(place, walkLabel, talkLabel, keyboard);
      keyboard ? await tabButton(accept) : await act(accept);
    }
    await travel("guard", "Walk to guard", "Talk to Gatekeeper", keyboard);
    keyboard
      ? await tabButton("Enter the gathering")
      : await act("Enter the gathering");
    await wait("scene.arrived===true");
  };
  const snapshot = () =>
    JSON.stringify(
      ["game", "orders", "entitlements"].map((t) =>
        store.all(`SELECT * FROM ${t}`),
      ),
    );
  await call("Page.navigate", { url: origin }, sessionId);
  await wait("!document.getElementById('global-error').hidden");
  await act("Restore saved progress");
  await viewport(1280);
  await goal("무도회에 가고 싶어", "3.00");
  assert.match(
    await evaluate("document.getElementById('choices').textContent"),
    /Borrow for free.*Find a look to buy/,
  );
  await screenshot("simple-desktop-choices");
  const before = snapshot();
  await act("Borrow for free");
  assert.equal(snapshot(), before, "choosing free only previews");
  assert.match(
    await evaluate("document.getElementById('quote').textContent"),
    /USD 0.00.*Confirm free loan/,
  );
  await pointer("#look-details summary");
  await act("Preview Traveler’s Cloak only");
  assert.equal(snapshot(), before);
  await pointer("#look-details summary");
  await act("Preview Rosalyn Gala Outfit only");
  assert.equal(snapshot(), before);
  assert.equal(store.get("SELECT count(*) n FROM quotes").n, 0);
  await pointer("#back-preview");
  await act("Find a look to buy");
  await act("Preview / Review purchase");
  assert.equal(snapshot(), before, "paid quote does not purchase or equip");
  await viewport(390, 844);
  await layout();
  assert.equal(
    await evaluate("document.getElementById('look-details').open"),
    false,
  );
  await screenshot("simple-mobile-preview");
  await act("I confirm");
  await wait(
    "document.getElementById('error-code').textContent==='operation_failed'",
  );
  assert.equal(
    store.get("SELECT status FROM orders LIMIT 1").status,
    "CREATING",
  );
  await call("Page.reload", {}, sessionId);
  await wait(
    "document.getElementById('checkout').textContent.includes('Resume confirmed purchase')",
  );
  await layout();
  await act("Resume confirmed purchase");
  assert.equal(store.get("SELECT count(*) n FROM orders").n, 1);
  await pointer("#look-details summary");
  await act("Preview Traveler’s Cloak only");
  assert.equal(
    await evaluate("document.getElementById('checkout').children.length"),
    0,
  );
  await act("Return to pending purchase");
  assert.match(
    await evaluate("document.getElementById('quote').textContent"),
    /USD 1.99/,
  );
  await goal("travel cloak", "1.00");
  await act("Find a look to buy");
  await act("Preview / Review purchase");
  assert.match(
    await evaluate("document.getElementById('quote').textContent"),
    /USD 0.99/,
  );
  assert.equal(
    await evaluate("document.getElementById('checkout').children.length"),
    0,
  );
  await act("Return to pending purchase");
  await act("Retry payment check");
  await wait(
    "document.getElementById('error-code').textContent==='buyer_approval_required'",
  );
  await act("Complete mock payment");
  await wait(
    "document.getElementById('error-code').textContent==='operation_failed'",
  );
  await act("Retry payment check");
  await wait(
    "document.getElementById('status').textContent.includes('Waiting for a verified')",
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 0);
  await call("Page.reload", {}, sessionId);
  await wait(
    "document.getElementById('status').textContent.includes('Waiting for a verified')",
  );
  const paymentPending = store.get("SELECT * FROM orders LIMIT 1");
  commerce.settle(
    paymentPending.id,
    await provider.inspect(paymentPending.provider_id),
    "mock-delayed-webhook",
  );
  await act("Refresh saved status");
  assert.match(
    await evaluate("document.getElementById('status').textContent"),
    /Mock purchase completed/,
  );
  assert.equal(
    await evaluate("scene.state.equipped"),
    null,
    "grant does not auto-equip",
  );
  await act("Wear purchased");
  assert.equal(await evaluate("scene.state.formal"), true);
  assert.equal(
    await evaluate("scene.state.canEnter"),
    false,
    "paid outfit cannot bypass free quests",
  );
  await viewport(1280);
  await completeStory();
  for (let i = 0; i < 2; i++) {
    await call("Page.reload", {}, sessionId);
    await wait("scene.state.canEnter===true");
    assert.equal(
      await evaluate("document.getElementById('world-panel').hidden"),
      false,
    );
    assert.equal(store.get("SELECT count(*) n FROM orders").n, 1);
  }
  await goal("enter the evening gathering for free", "0.00");
  assert.match(
    await evaluate("document.getElementById('choices').textContent"),
    /Wear what I own/,
  );
  assert.doesNotMatch(
    await evaluate("document.getElementById('choices').textContent"),
    /Borrow for free/,
  );
  const ownedBefore = snapshot();
  await act("Wear what I own");
  assert.equal(snapshot(), ownedBefore);
  assert.match(
    await evaluate("document.getElementById('preview-caption').textContent"),
    /Already owned/,
  );
  await act("Confirm & wear");
  assert.equal(
    await evaluate("scene.state.borrowed"),
    false,
    "owned path does not create an unnecessary loan",
  );
  await goal("travel cloak", "1.00");
  await act("Find a look to buy");
  await act("Preview / Review purchase");
  await act("I confirm");
  await act("Cancel checkout");
  assert.match(
    await evaluate("document.getElementById('status').textContent"),
    /Purchase cancelled/,
  );
  const cancelled = store.get("SELECT id FROM orders WHERE status='CANCELLED'");
  await call(
    "Page.navigate",
    { url: `${origin}/?order=${cancelled.id}&result=approved` },
    sessionId,
  );
  await wait(
    "document.getElementById('status').textContent.includes('Purchase cancelled')",
  );
  assert.equal(
    await evaluate("document.getElementById('checkout').children.length"),
    0,
  );
  assert.equal(store.get("SELECT count(*) n FROM entitlements").n, 1);
  // New player's free route: actual Tab/Enter, 390px and 200% CSS reflow.
  await call("Network.clearBrowserCookies", {}, sessionId);
  await call("Page.navigate", { url: origin }, sessionId);
  await wait("!!session");
  await viewport(390, 844);
  await call(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
    sessionId,
  );
  await evaluate("document.documentElement.style.zoom='2'");
  await tabButton("Show my choices");
  await layout();
  await tabButton("Borrow for free");
  await layout();
  assert.equal(await evaluate("scene.state.borrowed"), false);
  await tabTo("#look-details summary");
  await tabButton("Preview Traveler’s Cloak only");
  assert.match(
    await evaluate("document.getElementById('look-reactions').textContent"),
    /Gatekeeper:.*formal clothes/,
  );
  await tabTo("#back-preview");
  await tabButton("Borrow for free");
  await tabButton("Confirm free loan");
  assert.equal(
    await evaluate("scene.state.borrowed && scene.state.formal"),
    true,
  );
  assert.deepEqual(await evaluate("scene.state.owned"), []);
  await completeStory(true);
  await layout();
  for (let i = 0; i < 2; i++) {
    await call("Page.reload", {}, sessionId);
    await wait("scene.state.canEnter===true");
    await evaluate("document.documentElement.style.zoom='2'");
    await layout();
    assert.deepEqual(await evaluate("scene.state.owned"), []);
    assert.equal(store.get("SELECT count(*) n FROM orders").n, 2);
  }
  // The independent authenticated host still gets a server challenge only on free confirmation.
  const demoStore = new Store();
  const demoOrigin = `http://127.0.0.1:${port + 10}`;
  const demoPassword = "synthetic-browser-test-password";
  const demoHost = new SandboxDemoHost({
    store: demoStore,
    origin: demoOrigin,
    enabled: true,
    user: "browser-player",
    password: demoPassword,
  });
  const demo = createApp({
    store: demoStore,
    origin: demoOrigin,
    demoHost,
    authMode: "principal",
    identity: demoHost.identity,
  });
  await new Promise((r) => demo.server.listen(port + 10, "127.0.0.1", r));
  try {
    await call("Network.enable", {}, sessionId);
    await call(
      "Network.setExtraHTTPHeaders",
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from("browser-player:" + demoPassword).toString("base64"),
        },
      },
      sessionId,
    );
    await call("Page.navigate", { url: demoOrigin }, sessionId);
    await wait("session?.gameHost==='independent-sandbox-demo'");
    await tabButton("Show my choices");
    await tabButton("Borrow for free");
    assert.equal(demoStore.get("SELECT count(*) n FROM demo_challenges").n, 0);
    assert.equal(await evaluate("scene.state.borrowed"), false);
    await tabButton("Confirm free loan");
    await completeStory(true);
    assert.equal(demoStore.get("SELECT count(*) n FROM orders").n, 0);
    assert.equal(demoStore.get("SELECT count(*) n FROM entitlements").n, 0);
    assert.equal(demoStore.get("SELECT count(*) n FROM demo_challenges").n, 0);
  } finally {
    await new Promise((r) => demo.server.close(r));
    demoStore.close();
  }
  // Portable Sites adapter QA. These identity headers are synthetic, not a
  // claim that hosted ChatGPT dispatch or spoof stripping has been verified.
  const sitesDB = sqliteD1();
  const sitesOrigin = `http://127.0.0.1:${port + 11}`;
  const sitesAssets = Object.fromEntries(
    await Promise.all(
      ["/", "/app.js", "/scene.js", "/style.css"].map(async (path) => [
        path,
        await readFile(
          new URL(
            `../public/${path === "/" ? "index.html" : path.slice(1)}`,
            import.meta.url,
          ),
          "utf8",
        ),
      ]),
    ),
  );
  let sites = createSitesWorker({
    assets: sitesAssets,
    fetcher: () => {
      throw Error("provider_network_forbidden");
    },
  });
  const sitesEnv = {
    PUBLIC_ORIGIN: sitesOrigin,
    SITES_OWNER_USER_ID: "synthetic-site-owner",
    DB: sitesDB,
  };
  const sitesServer = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const response = await sites.fetch(
        new Request(sitesOrigin + req.url, {
          method: req.method,
          headers: req.headers,
          ...(body.length ? { body } : {}),
        }),
        sitesEnv,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(500);
      res.end("fixture_failed");
    }
  });
  await new Promise((r) => sitesServer.listen(port + 11, "127.0.0.1", r));
  try {
    assert.equal((await fetch(sitesOrigin + "/api/session")).status, 401);
    assert.equal(
      (
        await fetch(sitesOrigin + "/app.js", {
          headers: {
            "oai-authenticated-user-id": "other-user",
            "oai-authenticated-user-email": "other@example.invalid",
          },
        })
      ).status,
      403,
    );
    await call(
      "Network.setExtraHTTPHeaders",
      { headers: {
        "oai-authenticated-user-id": "synthetic-site-owner",
        "oai-authenticated-user-email": "owner@example.invalid",
      } },
      sessionId,
    );
    await call("Page.navigate", { url: sitesOrigin }, sessionId);
    await wait("session?.paymentMode==='unconfigured'");
    await viewport(390, 844);
    await evaluate("document.documentElement.style.zoom='2'");
    await tabButton("Show my choices");
    await tabButton("Find a look to buy");
    await tabButton("Preview / Review purchase");
    assert.match(
      await evaluate("document.getElementById('quote').textContent"),
      /not configured/,
    );
    assert.equal(
      await evaluate("document.querySelectorAll('#quote button').length"),
      0,
    );
    await layout();
    await tabTo("#back-preview");
    await tabButton("Borrow for free");
    await tabButton("Confirm free loan");
    await completeStory(true);
    sites = createSitesWorker({
      assets: sitesAssets,
      fetcher: () => {
        throw Error("provider_network_forbidden");
      },
    });
    await call("Page.reload", {}, sessionId);
    await wait("scene.state.canEnter===true");
    assert.deepEqual(await evaluate("scene.state.owned"), []);
    assert.equal(
      sitesDB.sqlite.prepare("SELECT count(*) n FROM sites_orders").get().n,
      0,
    );
    assert.equal(
      sitesDB.sqlite.prepare("SELECT count(*) n FROM sites_entitlements").get()
        .n,
      0,
    );
    assert.equal(
      sitesDB.sqlite.prepare("SELECT count(*) n FROM sites_quotes").get().n,
      0,
    );
    console.log(
      "PASS Sites Worker+D1 contract fixture: non-owner denial; unconfigured payment preview; 390px/200% and Tab/Enter free story; restart recovery. Synthetic identity, no hosted authentication or real payments.",
    );
  } finally {
    await new Promise((r) => sitesServer.close(r));
    sitesDB.close();
  }
  console.log(
    "PASS simplified goal → two choices → preview → explicit confirmation; free/owned/paid paths; no preview mutation; quote isolation; lost create/capture response and delayed notification; cancellation/reload/repeated restoration; desktop/390px/200% CSS reflow; Tab/Enter free route; authenticated demo. MOCK only.",
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
