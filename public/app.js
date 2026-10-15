const $ = (s) => document.querySelector(s);
let session;
let activeOrder;
let busy = false;
const text = (tag, value, className) => {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
};
function button(label, action) {
  const b = text("button", label);
  b.type = "button";
  b.onclick = () => run(action);
  return b;
}
async function api(path, data) {
  const r = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers:
      data === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error);
  return out;
}
async function run(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    $("#status").textContent =
      `Could not complete: ${e.message}. No entitlement is granted without verification.`;
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
const price = (p) => `${p.currency} ${(p.amount / 100).toFixed(2)}`;
async function refresh() {
  const [g, f] = await Promise.all([
    api("/api/game"),
    api("/api/analytics/funnel"),
  ]);
  $("#wardrobe").replaceChildren();
  for (const sku of [...g.owned, ...(g.borrowed ? ["borrowed"] : [])])
    $("#wardrobe").append(
      button(`Wear ${sku}${g.equipped === sku ? " ✓" : ""}`, async () => {
        await api("/api/game/equip", { sku });
        await refresh();
      }),
    );
  $("#guard").textContent = g.canEnter
    ? "Guard: All three checks pass. Welcome inside!"
    : `Guard: ${g.reaction}`;
  $("#requirements").textContent =
    `Formal outfit ${g.formal ? "✓" : "○"} · Seal ${g.seal ? "✓" : "○"} · Rumor ${g.rumor ? "✓" : "○"}`;
  $("#funnel").replaceChildren(
    ...f.map((e) => text("span", `${e.name}: ${e.count}`, "metric")),
  );
}
async function select(p) {
  const q = await api("/api/commerce/quotes", { sku: p.sku });
  $("#quote").replaceChildren(
    text("h3", p.name),
    text("p", p.description),
    text("p", price(q), "price"),
    text(
      "p",
      `One permanent cosmetic outfit. Quote expires ${new Date(q.expires).toLocaleTimeString()}. Seal and rumor quests remain required.`,
    ),
    button(`I confirm ${price(q)} for ${p.name}`, async () => {
      const o = await api("/api/commerce/orders", {
        quoteId: q.id,
        sku: q.sku,
        amount: q.amount,
        currency: q.currency,
        version: q.version,
        confirm: true,
      });
      await showOrder(o);
    }),
  );
  $("#status").textContent =
    "Review the product, amount, and currency before confirming.";
}
async function showOrder(o) {
  activeOrder = o.id;
  $("#checkout").replaceChildren();
  $("#status").textContent = `Order ${o.status}`;
  if (o.status === "APPROVAL_PENDING") {
    if (session.paymentMode === "mock")
      $("#checkout").append(
        button(
          "Simulate buyer approval + verified webhook (MOCK)",
          async () => {
            const result = await api(
              `/api/commerce/orders/${o.id}/mock-approve`,
              {},
            );
            await showOrder(result);
          },
        ),
      );
    else {
      const a = text("a", "Continue to PayPal Sandbox", "action");
      a.href =
        o.approvalUrl ??
        `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(o.provider_id)}`;
      $("#checkout").append(a);
    }
    $("#checkout").append(
      button("Cancel checkout", async () => {
        await showOrder(await api(`/api/commerce/orders/${o.id}/cancel`, {}));
      }),
    );
  }
  if (
    ["APPROVAL_PENDING", "CAPTURE_PENDING", "AWAITING_WEBHOOK"].includes(
      o.status,
    )
  )
    $("#checkout").append(
      button("Verify / retry server capture", async () => {
        await showOrder(await api(`/api/commerce/orders/${o.id}/capture`, {}));
      }),
      button("Refresh verified status", async () => {
        await showOrder(await api(`/api/commerce/orders/${o.id}`));
      }),
    );
  if (o.status === "GRANTED")
    $("#quote").textContent = "Verified. Your outfit is in the wardrobe.";
  if (o.status === "AWAITING_WEBHOOK")
    $("#status").textContent =
      "Capture checked. Waiting for a verified PayPal webhook; no outfit granted yet.";
  await refresh();
}
$("#recommend").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const result = await api("/api/commerce/agent/recommend", {
      goal: $("#goal").value,
      budgetMinor: Math.round(Number($("#budget").value) * 100),
    });
    $("#products").replaceChildren();
    for (const p of result.products) {
      const card = text("div", "", "product");
      card.append(
        text("h3", p.name),
        text("p", p.description),
        text("p", price(p), "price"),
        button("Review purchase", () => select(p)),
      );
      $("#products").append(card);
    }
    if (!result.products.length)
      $("#products").append(
        text(
          "p",
          "No matching paid outfit within your budget. The free route is available.",
        ),
      );
    $("#alternative").textContent = result.freeAlternative;
    await refresh();
  });
};
document.querySelectorAll("[data-quest]").forEach(
  (b) =>
    (b.onclick = () =>
      run(async () => {
        await api("/api/game/quest", { quest: b.dataset.quest });
        await refresh();
      })),
);
run(async () => {
  session = await api("/api/session");
  $("#ai-notice").textContent =
    session.aiMode === "openai"
      ? "Your goal and minimal game context are sent to OpenAI for this recommendation."
      : "Offline demo recommendations. No AI API is called.";
  $("#mode").textContent =
    `${session.paymentMode.toUpperCase()} · AI: ${session.aiMode.toUpperCase()}`;
  await refresh();
  const params = new URLSearchParams(location.search);
  const id = params.get("order");
  if (id) {
    const o = await api(`/api/commerce/orders/${encodeURIComponent(id)}`);
    if (params.get("result") === "cancelled" && o.status === "APPROVAL_PENDING")
      await showOrder(await api(`/api/commerce/orders/${id}/cancel`, {}));
    else await showOrder(o);
    history.replaceState(null, "", "/");
  } else {
    const orders = await api("/api/commerce/orders");
    const pending = orders.find((o) =>
      ["APPROVAL_PENDING", "CAPTURE_PENDING", "AWAITING_WEBHOOK"].includes(
        o.status,
      ),
    );
    if (pending)
      await showOrder(await api(`/api/commerce/orders/${pending.id}`));
  }
});
