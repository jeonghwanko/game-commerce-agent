import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const html = readFileSync(
  new URL("../tools/paypal-oauth-helper.html", import.meta.url),
  "utf8",
);
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function harness(clipboard = undefined) {
  const elements = new Map();
  const listeners = new Map();
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    elements.set(id, {
      value: "",
      hidden: ["manual", "fallback"].includes(id),
      disabled: id === "copy",
      textContent: "",
      dataset: {},
      attrs: {},
      listeners: {},
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      },
      setAttribute(key, value) {
        this.attrs[key] = value;
      },
      removeAttribute(key) {
        delete this.attrs[key];
      },
      focus() {
        this.focused = true;
      },
      select() {},
      reset() {},
    });
  }
  vm.runInNewContext(script, {
    document: { getElementById: (id) => elements.get(id) },
    navigator: { clipboard },
    window: { addEventListener: (type, fn) => listeners.set(type, fn) },
    btoa: (value) => Buffer.from(value, "latin1").toString("base64"),
  });
  const el = (id) => elements.get(id);
  const fire = (id, type, event = {}) =>
    el(id).listeners[type]({ preventDefault() {}, ...event });
  const generate = (id = "fake-client", secret = "fake-secret") => {
    el("client-id").value = id;
    el("client-secret").value = secret;
    fire("credentials", "submit");
  };
  return { el, fire, generate, listeners };
}

test("offline helper: inline hashes match and external resources/storage are absent", () => {
  for (const tag of ["script", "style"]) {
    const content = html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];
    const hash = createHash("sha256").update(content).digest("base64");
    assert.ok(html.includes(`${tag}-src 'sha256-${hash}'`));
  }
  for (const directive of [
    "default-src",
    "connect-src",
    "img-src",
    "font-src",
    "object-src",
    "frame-src",
    "worker-src",
    "base-uri",
    "form-action",
    "manifest-src",
  ])
    assert.ok(html.includes(`${directive} 'none'`));
  assert.doesNotMatch(html, /\b(?:src|href|action|ping)\s*=/i);
  assert.doesNotMatch(
    script,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|cookie|serviceWorker|console|eval)\b/,
  );
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|\bon\w+\s*=/i);
  assert.match(html, /id="client-id"\s+type="password"/);
  assert.match(html, /id="client-secret"\s+type="password"/);
});

test("offline helper: exact Basic encoding, secret colons, no auto copy, hidden result", async () => {
  const copies = [];
  const h = harness({ writeText: async (value) => copies.push(value) });
  for (const [id, secret] of [
    ["fake-client", "fake-secret"],
    ["a", "b:c"],
    ["FAKE_+/-=", "FAKE!#$%&'()*+,/:;<=>?@[\\]^_`{|}~"],
    ["a".repeat(4096), "b".repeat(4096)],
  ]) {
    const before = copies.length;
    h.generate(id, secret);
    assert.equal(copies.length, before);
    assert.equal(h.el("result").value, "");
    assert.equal(h.el("fallback").hidden, true);
    await h.fire("copy", "click");
    assert.equal(
      copies.at(-1),
      "Basic " + Buffer.from(`${id}:${secret}`, "ascii").toString("base64"),
    );
  }
});

test("offline helper: rejects empty, whitespace, controls, Unicode, oversized and ID colon without trimming", () => {
  const h = harness();
  for (const value of [
    "",
    " fake",
    "fake ",
    "fa ke",
    "fa\tke",
    "fake\r\n",
    "fake\0",
    "fake\x7f",
    "가짜",
    "fake\u00a0",
    "x".repeat(4097),
  ]) {
    for (const field of ["client-id", "client-secret"]) {
      h.generate(
        field === "client-id" ? value : "fake",
        field === "client-secret" ? value : "fake",
      );
      assert.equal(h.el("copy").disabled, true);
      assert.equal(h.el(field).value, value);
      assert.equal(h.el("status").dataset.error, "true");
      assert.ok(
        !h.el("status").textContent.includes(value) || value.length < 2,
      );
    }
  }
  h.generate("fake:id", "fake");
  assert.equal(h.el("copy").disabled, true);
});

test("offline helper: raw paste rejects CRLF before password normalization; invalid edits invalidate result", () => {
  const h = harness();
  for (const value of [
    "fake\n",
    "fake\r\n",
    " fake",
    "가짜",
    "x".repeat(4097),
  ]) {
    h.generate();
    let prevented = false;
    h.fire("client-id", "paste", {
      clipboardData: { getData: () => value },
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(h.el("client-id").value, "");
    assert.equal(h.el("copy").disabled, true);
  }
  h.generate();
  h.fire("client-secret", "input");
  assert.equal(h.el("copy").disabled, true);
  h.generate();
  let prevented = false;
  h.fire("client-id", "beforeinput", {
    data: "\n",
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(h.el("copy").disabled, true);
});

for (const [name, clipboard] of [
  ["unsupported", undefined],
  [
    "denied",
    {
      writeText: async () => {
        throw new Error("FAKE sensitive browser error");
      },
    },
  ],
]) {
  test(`offline helper: ${name} clipboard requires explicit fallback and supports hide/clear`, async () => {
    const h = harness(clipboard);
    h.generate();
    assert.equal(h.el("manual").hidden, true);
    await h.fire("copy", "click");
    assert.equal(h.el("manual").hidden, false);
    assert.equal(h.el("fallback").hidden, true);
    assert.doesNotMatch(h.el("status").textContent, /sensitive/);
    h.fire("manual", "click");
    assert.equal(
      h.el("result").value,
      "Basic ZmFrZS1jbGllbnQ6ZmFrZS1zZWNyZXQ=",
    );
    h.fire("hide", "click");
    assert.equal(h.el("result").value, "");
    h.fire("manual", "click");
    h.fire("clear", "click");
    for (const id of ["client-id", "client-secret", "result"])
      assert.equal(h.el(id).value, "");
    assert.equal(h.el("copy").disabled, true);
    assert.equal(h.el("manual").hidden, true);
    h.fire("manual", "click");
    await h.fire("copy", "click");
    assert.equal(h.el("result").value, "");
  });
}

for (const outcome of ["resolve", "reject"]) {
  test(`offline helper: clear during delayed clipboard ${outcome} cannot restore result/buttons`, async () => {
    let settle;
    const h = harness({
      writeText: () =>
        new Promise((resolve, reject) => {
          settle = outcome === "resolve" ? resolve : reject;
        }),
    });
    h.generate();
    const pending = h.fire("copy", "click");
    assert.equal(h.el("copy").disabled, true);
    h.fire("clear", "click");
    const status = h.el("status").textContent;
    settle();
    await pending;
    assert.equal(h.el("status").textContent, status);
    assert.equal(h.el("copy").disabled, true);
    assert.equal(h.el("manual").hidden, true);
    assert.equal(h.el("result").value, "");
  });
}

test("offline helper: page lifecycle and edits clear revealed output", async () => {
  const h = harness();
  for (const event of ["pagehide", "pageshow"]) {
    h.generate();
    await h.fire("copy", "click");
    h.fire("manual", "click");
    h.listeners.get(event)();
    for (const id of ["client-id", "client-secret", "result"])
      assert.equal(h.el(id).value, "");
    assert.equal(h.el("copy").disabled, true);
  }
  h.generate();
  await h.fire("copy", "click");
  h.fire("manual", "click");
  h.fire("client-id", "input");
  assert.equal(h.el("result").value, "");
  assert.equal(h.el("fallback").hidden, true);
});
