// Fake credentials only. No app server, provider, or real clipboard is used.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, copyFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";

const profile = await mkdtemp(join(tmpdir(), "offline-helper-browser-"));
let requests = 0;
const html = await readFile(resolve("tools/paypal-oauth-helper.html"));
const trap = createServer((req, res) => {
  if (req.url === "/helper.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  requests++;
  res.end("unexpected");
});
await new Promise((r) => trap.listen(0, "127.0.0.1", r));
const trapOrigin = `http://127.0.0.1:${trap.address().port}`;
const browser = spawn(
  process.env.CHROMIUM ?? "chromium",
  [
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Chromium startup timeout")),
      10000,
    );
    browser.on("error", reject);
    browser.stderr.on("data", (data) => {
      const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let next = 0;
  const pending = new Map();
  const network = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Network.requestWillBeSent")
      network.push(message.params.request.url);
    const p = pending.get(message.id);
    if (p) {
      pending.delete(message.id);
      message.error
        ? p.reject(new Error(message.error.message))
        : p.resolve(message.result);
    }
  };
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
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
  const send = (method, params) => call(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        "Browser evaluation failed: " + result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(
      `UI wait failed: ${expression}; ${JSON.stringify(await evaluate("({url:location.href,title:document.title,ready:document.readyState})"))}`,
    );
  };
  const key = async (key) => {
    const code = { Tab: 9, Enter: 13, Escape: 27 }[key];
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: key === "Enter" ? "\r" : undefined,
      key,
      code: key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    });
  };
  const click = async (id) => {
    const point = await evaluate(
      `(() => { const e=document.getElementById(${JSON.stringify(id)}); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); if(e.disabled || !r.width || !r.height)throw Error('Not interactive'); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
  };
  await send("Page.enable");
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    window.fakeCopies=[]; window.copyBehavior='success'; window.violations=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(value){
      window.fakeCopies.push(value);
      if(window.copyBehavior==='denied')return Promise.reject(new Error('FAKE private error'));
      if(window.copyBehavior==='delayed')return new Promise((resolve,reject)=>{window.finishCopy=resolve;window.failCopy=reject;});
      return Promise.resolve();
    }}});
    document.addEventListener('securitypolicyviolation', e=>window.violations.push(e.effectiveDirective));
  `,
  });
  const localFile = join(profile, "paypal-oauth-helper.html");
  await copyFile(resolve("tools/paypal-oauth-helper.html"), localFile);
  const fileMode = process.argv.includes("--file");
  const url = fileMode
    ? pathToFileURL(localFile).href
    : trapOrigin + "/helper.html";
  const nav = await send("Page.navigate", { url });
  assert.equal(
    nav.errorText,
    undefined,
    "Local file navigation: " + nav.errorText,
  );
  await wait(
    "document.readyState==='complete' && !!document.getElementById('clear')",
  );
  const fill = async () => {
    await click("client-id");
    await send("Input.insertText", { text: "fake-client" });
    await key("Tab");
    assert.equal(await evaluate("document.activeElement.id"), "client-secret");
    await send("Input.insertText", { text: "fake-secret" });
    await key("Tab");
    assert.equal(await evaluate("document.activeElement.id"), "generate");
    await key("Enter");
    assert.equal(await evaluate("document.activeElement.id"), "copy");
  };
  await fill();
  assert.equal(await evaluate("fakeCopies.length"), 0);
  assert.equal(await evaluate("document.getElementById('result').value"), "");
  await key("Enter");
  await wait(
    "fakeCopies.length===1 && !document.getElementById('copy').disabled",
  );
  assert.equal(
    await evaluate("fakeCopies[0]"),
    "Basic ZmFrZS1jbGllbnQ6ZmFrZS1zZWNyZXQ=",
  );
  await click("clear");
  assert.equal(await evaluate("document.activeElement.id"), "client-id");
  await click("generate");
  assert.equal(
    await evaluate(
      "document.getElementById('client-id').getAttribute('aria-invalid')",
    ),
    "true",
  );
  await click("clear");

  // Real pointer/keyboard actions on mobile, with 200% text zoom, and 195px reflow.
  for (const [width, fontSize] of [
    [390, 16],
    [390, 32],
    [195, 16],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.setFontSizes", {
      fontSizes: { standard: fontSize, fixed: fontSize },
    });
    await evaluate("window.copyBehavior='denied'");
    await fill();
    await key("Enter");
    await wait("!document.getElementById('manual').hidden");
    assert.equal(
      await evaluate("document.getElementById('fallback').hidden"),
      true,
    );
    await key("Tab");
    assert.equal(await evaluate("document.activeElement.id"), "manual");
    await key("Enter");
    assert.equal(await evaluate("document.activeElement.id"), "result");
    assert.equal(
      await evaluate("document.getElementById('result').value"),
      "Basic ZmFrZS1jbGllbnQ6ZmFrZS1zZWNyZXQ=",
    );
    assert.equal(
      await evaluate(
        "document.documentElement.scrollWidth<=window.innerWidth+1",
      ),
      true,
      `reflow ${width}/${fontSize}`,
    );
    if (fontSize === 32)
      assert.equal(
        await evaluate("getComputedStyle(document.documentElement).fontSize"),
        "32px",
      );
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    await writeFile(
      join(tmpdir(), `offline-helper-${width}-${fontSize}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
    await key("Tab");
    assert.equal(await evaluate("document.activeElement.id"), "hide");
    await key("Enter");
    assert.equal(await evaluate("document.getElementById('result').value"), "");
    await click("clear");
    assert.equal(
      await evaluate(
        "['client-id','client-secret','result'].every(id=>document.getElementById(id).value==='')",
      ),
      true,
    );
    await click("generate");
    assert.equal(
      await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
      true,
    );
    await click("clear");
  }
  // Synthetic paste only to supply raw CR/LF without touching the system clipboard.
  await evaluate(
    `(() => {const data=new DataTransfer();data.setData('text/plain','fake-client\\r\\n');document.getElementById('client-id').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`,
  );
  assert.equal(
    await evaluate("document.getElementById('client-id').value"),
    "",
  );
  assert.equal(
    await evaluate("document.getElementById('status').dataset.error"),
    "true",
  );
  await click("clear");
  await evaluate("window.copyBehavior='delayed'");
  await fill();
  await key("Enter");
  assert.equal(
    await evaluate("document.getElementById('copy').disabled"),
    true,
  );
  await click("clear");
  await evaluate("finishCopy()");
  assert.equal(
    await evaluate(
      "document.getElementById('copy').disabled && document.getElementById('manual').hidden && document.getElementById('result').value===''",
    ),
    true,
  );
  // Missing API, as on some file:// browsers.
  await evaluate(
    "Object.defineProperty(navigator,'clipboard',{value:undefined})",
  );
  await fill();
  await key("Enter");
  await wait("!document.getElementById('manual').hidden");
  await click("manual");
  await click("clear");
  assert.deepEqual(
    network.filter((u) => u !== url),
    [],
    "helper itself made no network requests",
  );
  assert.deepEqual(
    await evaluate("violations"),
    [],
    "helper's own inline hashes pass CSP",
  );

  // Hostile probes are test-only. Every target is a local tripwire, never an external host.
  await evaluate(`(() => {
    const target=${JSON.stringify(trapOrigin)};
    fetch(target+'/fetch').catch(()=>{});
    new Image().src=target+'/image';
    const script=document.createElement('script');script.src=target+'/script';document.body.append(script);
    const frame=document.createElement('iframe');frame.src=target+'/frame';document.body.append(frame);
    new FontFace('fake','url('+target+'/font)').load().catch(()=>{});
    try { new Worker(target+'/worker'); } catch {}
    try { new WebSocket(target.replace('http:','ws:')+'/ws'); } catch {}
    const form=document.createElement('form');form.action=target+'/submit';document.body.append(form);form.submit();
    const inline=document.createElement('script');inline.textContent='window.untrustedRan=true';document.body.append(inline);
  })()`);
  await wait(
    "violations.includes('connect-src') && violations.includes('img-src') && violations.includes('script-src-elem') && violations.includes('frame-src') && violations.includes('font-src') && violations.includes('worker-src') && violations.includes('form-action')",
  );
  assert.equal(requests, 0, "CSP probes never reached the HTTP tripwire");
  assert.equal(await evaluate("window.untrustedRan===undefined"), true);
  assert.equal(await evaluate("location.href"), url);
  await send("Page.reload");
  await wait(
    "document.readyState==='complete' && document.getElementById('copy').disabled",
  );
  assert.equal(
    await evaluate(
      "['client-id','client-secret','result'].every(id=>document.getElementById(id).value==='')",
    ),
    true,
  );
  console.log(
    `PASS helper (${fileMode ? "file://" : "loopback document; file:// requires separate verification"}): exact fake encoding; pointer/keyboard flow; denied/missing/delayed clipboard; raw CRLF rejection; clear/reload; 390px, 200% text zoom and 195px reflow; zero helper network requests; CSP fetch/image/script/frame/font/worker/form/WebSocket probes blocked.`,
  );
} finally {
  socket?.close();
  const exited = new Promise((r) => browser.once("exit", r));
  if (browser.exitCode === null) {
    browser.kill("SIGTERM");
    await exited;
  }
  await new Promise((r) => trap.close(r));
  await rm(profile, { recursive: true, force: true });
}
