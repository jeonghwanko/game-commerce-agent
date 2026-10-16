const $ = (s) => document.querySelector(s);
let session;
let activeOrder;
let pendingOrder;
let busy = false;
let gameSnapshot;
let previewSku;
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
    const dialogue =
      session.gameHost === "independent-sandbox-demo" &&
      ["shop", "seal", "rumor"].includes(place)
        ? await api("/api/game/interact", { npc: place })
        : {};
    if (place === "shop") {
      $("#shop-panel").hidden = false;
      $("#goal").focus();
      $("#dialogue-text").textContent =
        "Rosalyn: Let’s solve your goal. The gala coat has gold star embroidery; the traveler’s cloak has a flowing teal cape. Borrowed formal clothes pass the same dress check, for free.";
      actions.append(
        button("Borrow formal clothes · Free", async () => {
          await api("/api/game/quest", { quest: "borrowed", ...dialogue });
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
            await api("/api/game/quest", { quest: place, ...dialogue });
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
  .forEach((b) => (b.onclick = () => walk(b.dataset.walk)));
$("#interact").onclick = () => scene.interact();
function walk(place) {
  scene.walkTo(place);
  $("#world").focus();
}
function preview(sku) {
  previewSku = sku;
  for (const [id, look] of [
    ["#preview", sku],
    ["#loan-preview", "borrowed"],
  ]) {
    const c = $(id).getContext("2d");
    c.clearRect(0, 0, 240, 140);
    c.fillStyle = "#172922";
    c.fillRect(0, 0, 240, 140);
    c.textAlign = "center";
    AtelierScene.avatar(c, 120, 80, look, 2);
  }
  const look = scene.state.previews?.find((p) => p.sku === sku);
  $("#preview-caption").textContent =
    `${names[sku]} · ${sku === "borrowed" ? "Free loan, not owned" : "Optional permanent collection"}`;
  $("#look-reactions").replaceChildren();
  if (look)
    $("#look-reactions").append(
      text("h3", "If you choose this look"),
      text(
        "p",
        session.paymentMode === "mock"
          ? "MOCK REHEARSAL · No PayPal payment or live AI dialogue"
          : "Independent fixture · Conditional preview only",
        "eyebrow",
      ),
      text(
        "p",
        "Authored fixture reactions based on server state — not live AI dialogue. Preview changes no wardrobe, payment or quest state.",
        "controls",
      ),
      text("p", look.condition),
      text("p", `Rosalyn: ${look.rosalyn}`),
      text("p", `Gatekeeper: ${look.guard}`),
      text(
        "p",
        `What changes: appearance${look.dressCheck ? " and the formal dress check" : " only; the dress check still fails"}. Seal and password progress remain unchanged.`,
      ),
    );
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
function savedSummary(g) {
  const effective =
    g.equipped === "borrowed" ? g.borrowed : g.owned.includes(g.equipped);
  return `Wearing: ${effective ? names[g.equipped] : "your starting clothes"}. Owned collection: ${g.owned.length ? g.owned.map((sku) => names[sku]).join(", ") : "none"}. Free loan: ${g.borrowed ? "available, not owned" : "not borrowed yet"}.`;
}
async function wear(sku) {
  await api("/api/game/equip", { sku });
  await refresh();
  $("#world").focus();
}
function storyStep(g) {
  $("#progress-summary").textContent =
    `${savedSummary(g)} Gate checks: ${[g.formal, g.seal, g.rumor].filter(Boolean).length} of 3 complete.`;
  const next = $("#next-step");
  next.replaceChildren();
  if (!g.formal) {
    if (g.owned.includes("rosalyn-gala"))
      next.append(
        button("Wear your owned Gala · No purchase", () =>
          wear("rosalyn-gala"),
        ),
      );
    else if (g.borrowed)
      next.append(button("Wear your free loan", () => wear("borrowed")));
    else
      next.append(button("Visit Rosalyn for a free loan", () => walk("shop")));
  } else if (!g.seal)
    next.append(
      button("Next: visit the courier · Free seal", () => walk("seal")),
    );
  else if (!g.rumor)
    next.append(
      button("Next: visit the archivist · Free password", () => walk("rumor")),
    );
  else
    next.append(
      button("Your story path is ready · Meet the guard", () => walk("guard")),
    );
}
async function refresh() {
  const [g, f] = await Promise.all([
    api("/api/game"),
    api("/api/analytics/funnel"),
  ]);
  const snapshot = JSON.stringify(g);
  if (gameSnapshot && gameSnapshot !== snapshot) {
    $("#comparison").hidden = true;
    $("#comparison").replaceChildren();
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
  $("#preview-options").replaceChildren(
    ...g.previews.map((p) =>
      button(`Preview ${p.name} only`, () => previewOnly(p.sku)),
    ),
  );
  if (previewSku) preview(previewSku);
  storyStep(g);
  $("#wardrobe").replaceChildren();
  for (const sku of [...g.owned, ...(g.borrowed ? ["borrowed"] : [])])
    $("#wardrobe").append(
      button(`Wear ${names[sku]}${g.equipped === sku ? " ✓" : ""}`, () =>
        wear(sku),
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
function resetFittingRoom() {
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
  $("#purchase-panel").hidden = false;
}
async function previewOnly(sku) {
  resetFittingRoom();
  await refresh();
  preview(sku);
  $("#quote").textContent =
    "Preview only — no quote, order or ownership is created. Return to Rosalyn’s plan to review an optional purchase.";
  $("#status").textContent =
    "Compare the looks and NPC reactions. The free story path is always available.";
  $("#quote").focus();
}
async function select(p) {
  resetFittingRoom();
  await refresh();
  preview(p.sku);
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
    "CREATING",
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
  if (o.status === "CREATING") {
    $("#quote").append(
      text(
        "p",
        "This purchase was already confirmed. Resume uses the same original quote and order request; it does not change its price or start a second purchase. A quote expiry does not erase saved consent. Recovery older than five hours needs operator review.",
      ),
    );
    $("#checkout").append(
      button(`Resume confirmed purchase · ${price(o)}`, async () =>
        showOrder(
          await api(`/api/commerce/orders/${o.id}/resume`, {
            confirm: true,
            sku: o.sku,
            amount: o.amount,
            currency: o.currency,
            version: o.version,
          }),
        ),
      ),
      button("Cancel checkout", async () =>
        showOrder(await api(`/api/commerce/orders/${o.id}/cancel`, {})),
      ),
      button("Refresh saved status", async () =>
        showOrder(await api(`/api/commerce/orders/${o.id}`)),
      ),
    );
  }
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
    $("#status").textContent =
      session.paymentMode === "mock"
        ? "Mock purchase completed. Your outfit is in the wardrobe; no PayPal payment occurred."
        : "Verified purchase completed. Your outfit is in the wardrobe.";
  if (o.status === "AWAITING_WEBHOOK")
    $("#status").textContent =
      session.paymentMode === "mock"
        ? "Capture checked. Waiting for a verified simulated webhook (MOCK); no outfit granted yet."
        : "Capture checked. Waiting for a verified PayPal webhook; no outfit granted yet.";
  await refresh();
  if (o.status === "GRANTED" && scene.state.owned.includes(o.sku))
    $("#checkout").append(
      button(`Wear purchased ${names[o.sku]}`, () => wear(o.sku)),
    );
  $("#quote").focus();
}
function comparePaths(comparison) {
  const panel = $("#comparison");
  panel.replaceChildren();
  panel.hidden = !comparison;
  if (!comparison) return;
  panel.append(
    text("h3", "Compare paths to the gathering"),
    text(
      "p",
      session.paymentMode === "mock"
        ? "MOCK REHEARSAL · Server-checked options, simulated payment"
        : "Independent fixture · Server-checked options",
      "eyebrow",
    ),
    text(
      "p",
      `Budget ${price(comparison.budget)}. Costs below are additional costs now, not estimated savings.`,
    ),
  );
  for (const option of comparison.options) {
    const row = text("article", "", "comparison-option");
    const category = {
      owned: "Already owned",
      free_loan: "Free loan",
      optional_purchase: "Optional collectible",
      held: "Purchase on hold",
    }[option.access];
    row.append(
      text("h4", `${option.name} · ${category}`),
      text(
        "p",
        option.additionalCost
          ? `Additional cost: ${price(option.additionalCost)}${option.withinBudget ? " · within budget" : " · above budget"}`
          : "Unavailable while on hold. Do not buy again.",
      ),
      text(
        "p",
        `If available and worn: ${option.dressCheck ? "dress check passes" : "dress check does not pass"}. Still needed: ${option.remaining.length ? option.remaining.join(", ") : "no further gate conditions"}.`,
      ),
      ...(option.access === "optional_purchase" && !option.suggestedPurchase
        ? [
            text(
              "p",
              "No purchase suggested for this plan. You may still compare its appearance.",
            ),
          ]
        : []),
      button(`Compare ${option.name}`, () => previewOnly(option.sku)),
    );
    panel.append(row);
  }
  panel.append(
    text(
      "p",
      `After completing all listed plan actions: ${comparison.afterPlan.canEnter ? "the gate conditions would be met" : "entry is not yet assured; review the remaining conditions"}. This is a projection, not a reward. Merely reviewing or buying a look never grants the seal or password.`,
    ),
  );
  panel.append(
    text(
      "p",
      comparison.freeQuestActions.length
        ? `Remaining free quest steps: ${comparison.freeQuestActions.map((a) => a.label).join(" ")}`
        : "No missing free quest actions in this plan. Your current quest flags remain unchanged until you complete a quest.",
    ),
  );
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
      text(
        "p",
        `Budget: USD ${(Math.round(Number($("#budget").value) * 100) / 100).toFixed(2)} · ${savedSummary(scene.state)}`,
        "plan-context",
      ),
    );
    for (const action of result.plan.actions) {
      const step = text("div", "", "plan-step");
      step.append(text("p", action.label));
      if (action.type === "equip") {
        // A loan may still need to be borrowed; the server remains authoritative.
        if (action.sku !== "borrowed" || scene.state.borrowed)
          step.append(
            button(`Wear ${names[action.sku]} now`, () => wear(action.sku)),
          );
      } else if (action.type === "borrow")
        step.append(button("Visit Rosalyn · Free loan", () => walk("shop")));
      else if (action.type === "quest")
        step.append(
          button(
            action.quest === "seal"
              ? "Visit the courier · Free"
              : "Visit the archivist · Free",
            () => walk(action.quest),
          ),
        );
      $("#plan").append(step);
    }
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
    comparePaths(result.comparison);
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
  $("#restore-summary").textContent =
    `Server-saved wardrobe and quest progress loaded for this session. ${savedSummary(scene.state)} Reopening starts you in the courtyard; movement and typed goals are not saved. Keep the same unexpired browser session to resume.`;
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
      [
        "CREATING",
        "APPROVAL_PENDING",
        "CAPTURE_PENDING",
        "AWAITING_WEBHOOK",
      ].includes(o.status),
    );
    if (pending)
      await showOrder(await api(`/api/commerce/orders/${pending.id}`));
  }
}
$("#retry-connection").onclick = () => run(boot);
run(boot);
