import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { Store } from "../src/store.js";
test("real HTTP server restart restores pending order, session, grant and equipped state; held right removes effect", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gca-restart-"));
  const path = join(dir, "db.sqlite");
  let app,
    cookie = "",
    csrf;
  const start = async () => {
    app = createApp({
      store: new Store(path),
      origin: "http://localhost:3000",
    });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  };
  const stop = async () => {
    await new Promise((r) => app.server.close(r));
    app.store.close();
  };
  const request = (path, data) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: app.server.address().port,
          path,
          method: data ? "POST" : "GET",
          headers: {
            Host: "localhost:3000",
            Origin: "http://localhost:3000",
            Cookie: cookie,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf ?? "",
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (d) => (raw += d));
          res.on("end", () => {
            if (res.headers["set-cookie"])
              cookie = res.headers["set-cookie"][0].split(";")[0];
            const body = JSON.parse(raw);
            res.statusCode >= 200 && res.statusCode < 300
              ? resolve(body)
              : reject(new Error(JSON.stringify(body)));
          });
        },
      );
      req.on("error", reject);
      req.end(data ? JSON.stringify(data) : undefined);
    });
  try {
    await start();
    csrf = (await request("/api/session")).csrf;
    const q = await request("/api/commerce/quotes", { sku: "rosalyn-gala" });
    const originalCreate = app.commerce.p.create.bind(app.commerce.p);
    app.commerce.p.create = async (...args) => {
      await originalCreate(...args);
      throw new Error("lost response");
    };
    await assert.rejects(
      request("/api/commerce/orders", {
        quoteId: q.id,
        sku: q.sku,
        amount: q.amount,
        currency: q.currency,
        version: q.version,
        confirm: true,
      }),
      /operation_failed/,
    );
    const o = app.store.get("SELECT * FROM orders");
    assert.equal(o.status, "CREATING");
    app.store.run("UPDATE quotes SET expires=0 WHERE id=?", q.id);
    await stop();
    await start();
    assert.equal((await request("/api/session")).csrf, csrf);
    assert.equal((await request("/api/commerce/orders"))[0].status, "CREATING");
    assert.equal(
      (
        await request("/api/commerce/orders/" + o.id + "/resume", {
          confirm: true,
          sku: o.sku,
          amount: o.amount,
          currency: o.currency,
          version: o.version,
        })
      ).status,
      "APPROVAL_PENDING",
    );
    assert.equal(app.store.get("SELECT count(*) n FROM mock_orders").n, 1);
    await request("/api/commerce/orders/" + o.id + "/mock-approve", {});
    await request("/api/game/equip", { sku: o.sku });
    await stop();
    await start();
    assert.equal(
      (await request("/api/commerce/orders/" + o.id)).status,
      "GRANTED",
    );
    assert.equal((await request("/api/game")).formal, true);
    const stored = app.store.get("SELECT * FROM orders WHERE id=?", o.id);
    app.commerce.p.verifyWebhook = async () => true;
    await app.commerce.webhook(
      {},
      {
        id: "restart-reversed",
        event_type: "PAYMENT.CAPTURE.REVERSED",
        resource_type: "refund",
        resource: {
          id: "REFUND-RESTART",
          links: [
            {
              rel: "up",
              href:
                "https://api-m.sandbox.paypal.com/v2/payments/captures/" +
                stored.capture_id,
            },
          ],
        },
      },
    );
    const g = await request("/api/game");
    assert.equal(g.formal, false);
    assert.equal(g.owned.length, 0);
    await request("/api/game/quest", { quest: "borrowed" });
    await request("/api/game/equip", { sku: "borrowed" });
    assert.equal((await request("/api/game")).formal, true);
    assert.equal((await request("/api/game")).owned.length, 0);
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
