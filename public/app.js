const $ = (s) => document.querySelector(s);
let session;
let activeOrder;
let pendingOrder;
let busy = false;
let gameSnapshot;
const names = {
  "rosalyn-gala": "Rosalyn Gala Outfit",
  "rosalyn-traveler": "Traveler’s Cloak",
  borrowed: "Borrowed formal clothes · Free loan",
};
const statuses = {
  APPROVAL_PENDING: "Awaiting your approval",
  CAPTURE_PENDING: "Payment outcome being checked",
  AWAITING_WEBHOOK: "Waiting for verified payment notification",
  GRANTED: "Outfit added to wardrobe",
  REVIEW: "Purchase on hold — outfit unavailable",
  CANCELLED: "Purchase cancelled",
  FAILED: "Payment unsuccessful",
  CREATING: "Preparing purchase",
};
const scene = new AtelierScene($("#world"), (place) =>
  run(async () => {
    const actions = $("#dialogue-actions");
    actions.replaceChildren();
    if (place === "shop") {
      $("#shop-panel").hidden = false;
      $("#goal").focus();
      $("#dialogue-text").textContent =
        "Rosalyn: Let’s solve your goal. The gala coat has gold star embroidery; the traveler’s cloak has a flowing teal cape. Borrowed formal clothes pass the same dress check, for free.";
      actions.append(
        button("Borrow formal clothes · Free", async () => {
          await api("/api/game/quest", { quest: "borrowed" });
          await api("/api/game/equip", { sku: "borrowed" });
          await refresh();
          $("#dialogue-text").textContent =
            "Rosalyn: A free loan, separate from your owned collection. Check the gate checklist for any remaining quests.";
        }),
      );
    } else if (place === "seal" || place === "rumor") {
      $("#dialogue-text").textContent =
        place === "seal"
          ? "Courier: Take this invitation seal to the gatekeeper. It is yours, no purchase required."
          : "Archivist: The password is ‘The moon wears silver.’ Remember it at the gate. No purchase required.";
      actions.append(
        button(
          place === "seal"
            ? "Accept the seal · Free"
            : "Remember the rumor · Free",
          async () => {
            await api("/api/game/quest", { quest: place });
            await refresh();
            actions.replaceChildren();
          },
        ),
      );
    } else {
      const state = await api("/api/game");
      $("#dialogue-text").textContent = state.canEnter
        ? "Gatekeeper: Your clothes, seal and rumor are in order. The gate is open; walk through!"
        : `Gatekeeper: ${state.reaction}`;
    }
  }),
);
document
  .querySelectorAll("[data-walk]")
  .forEach((b) => (b.onclick = () => scene.walkTo(b.dataset.walk)));
$("#interact").onclick = () => scene.interact();
function preview(sku) {
  const c = $("#preview").getContext("2d");
  c.clearRect(0, 0, 240, 140);
  c.fillStyle = "#172922";
  c.fillRect(0, 0, 240, 140);
  c.textAlign = "center";
  AtelierScene.avatar(c, 120, 80, sku, 2);
}

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
    signal: AbortSignal.timeout(15000),
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
  const focused = document.activeElement;
  busy = true;
  syncControls();
  try {
    await fn();
    $("#global-error").hidden = true;
  } catch (e) {
    $("#global-error").hidden = false;
    $("#error-message").textContent =
      `Could not complete: ${e.message}. Retry connection to check saved progress. A failed request does not confirm a payment.`;
    $("#status").textContent = `Could not complete: ${e.message}`;
  } finally {
    busy = false;
    syncControls();
    if (
      document.activeElement === document.body &&
      focused?.isConnected &&
      !focused.disabled
    )
      focused.focus();
  }
}
function syncControls() {
  document.body.classList.toggle("busy", busy);
  document.querySelectorAll("button").forEach((b) => {
    b.disabled =
      busy ||
      (b.id !== "retry-connection" && !session) ||
      (b.id === "interact" && !scene.near) ||
      (b.dataset.walk === "exit" && !scene.state.canEnter);
  });
}
const price = (p) => `${p.currency} ${(p.amount / 100).toFixed(2)}`;
async function refresh() {
  const [g, f] = await Promise.all([
    api("/api/game"),
    api("/api/analytics/funnel"),
  ]);
  const snapshot = JSON.stringify(g);
  if (gameSnapshot && gameSnapshot !== snapshot) {
    $("#plan").replaceChildren(
      text(
        "p",
        "Your game state changed. Ask Rosalyn again for an updated plan.",
      ),
    );
    $("#products").replaceChildren();
    $("#alternative").textContent =
      "Your owned clothes and the free loan remain separate. Buying is optional.";
  }
  gameSnapshot = snapshot;
  scene.update(g);
  $("#wardrobe").replaceChildren();
  for (const sku of [...g.owned, ...(g.borrowed ? ["borrowed"] : [])])
    $("#wardrobe").append(
      button(
        `Wear ${names[sku]}${g.equipped === sku ? " ✓" : ""}`,
        async () => {
          await api("/api/game/equip", { sku });
          await refresh();
        },
      ),
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
  const previous = pendingOrder;
  pendingOrder = previous;
  activeOrder = undefined;
  delete $("#checkout").dataset.orderId;
  $("#checkout").replaceChildren();
  $("#quote").replaceChildren();
  $("#pending-purchase").replaceChildren();
  if (previous)
    $("#pending-purchase").append(
      button("Return to pending purchase", async () =>
        showOrder(await api(`/api/commerce/orders/${previous}`)),
      ),
    );
  preview(p.sku);
  $("#purchase-panel").hidden = false;
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
  $("#quote").focus();
}
async function showOrder(o) {
  $("#purchase-panel").hidden = false;
  $("#pending-purchase").replaceChildren();
  preview(o.sku);
  $("#quote").replaceChildren(
    text("h3", names[o.sku]),
    text("p", price(o), "price"),
    text(
      "p",
      `Your confirmed outfit purchase · ${statuses[o.status] ?? "Checking purchase"}`,
    ),
  );
  activeOrder = o.id;
  pendingOrder = [
    "APPROVAL_PENDING",
    "CAPTURE_PENDING",
    "AWAITING_WEBHOOK",
  ].includes(o.status)
    ? o.id
    : undefined;
  $("#checkout").dataset.orderId = o.id;
  $("#checkout").replaceChildren();
  $("#status").textContent =
    `Order ${statuses[o.status] ?? "Checking purchase"}`;
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
      a.onclick = (e) => {
        if (busy) e.preventDefault();
      };
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
      button("Retry payment check", async () => {
        await showOrder(await api(`/api/commerce/orders/${o.id}/capture`, {}));
      }),
      button("Refresh saved status", async () => {
        await showOrder(await api(`/api/commerce/orders/${o.id}`));
      }),
    );
  if (o.status === "GRANTED")
    $("#quote").textContent = "Verified. Your outfit is in the wardrobe.";
  if (o.status === "AWAITING_WEBHOOK")
    $("#status").textContent =
      session.paymentMode === "mock"
        ? "Capture checked. Waiting for a verified simulated webhook (MOCK); no outfit granted yet."
        : "Capture checked. Waiting for a verified PayPal webhook; no outfit granted yet.";
  await refresh();
  $("#quote").focus();
}
$("#recommend").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const result = await api("/api/commerce/agent/recommend", {
      goal: $("#goal").value,
      budgetMinor: Math.round(Number($("#budget").value) * 100),
    });
    $("#plan").replaceChildren(
      text("h3", "Your goal plan"),
      ...result.plan.actions.map((action) => text("p", action.label)),
    );
    $("#products").replaceChildren();
    for (const p of result.products) {
      const card = text("div", "", "product");
      card.append(
        text("h3", p.name),
        text("p", p.description),
        text("p", price(p), "price"),
        button("Preview / Review purchase", () => select(p)),
      );
      $("#products").append(card);
    }
    if (!result.products.length)
      $("#products").append(
        text("p", "No purchase suggested for this plan. See the reason above."),
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
async function boot() {
  session = await api("/api/session");
  $("#global-error").hidden = true;
  $("#ai-notice").textContent =
    session.aiMode === "openai"
      ? "Your goal and minimal game context are sent to OpenAI for this recommendation."
      : "Offline demo recommendations. No AI API is called.";
  $("#mode").textContent =
    `${session.paymentMode.toUpperCase()} · AI: ${session.aiMode.toUpperCase()}${session.paymentMode === "mock" ? " · REHEARSAL" : ""}`;
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
}
$("#retry-connection").onclick = () => run(boot);
run(boot);
