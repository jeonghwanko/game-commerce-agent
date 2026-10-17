const $ = (s) => document.querySelector(s);
let session;
let activeOrder;
let pendingOrder;
let busy = false;
let gameSnapshot;
let previewSku;
let lastRecommendation;
let pendingRecommendation;
let gameClient;
let funnelSequence = 0;
const gameClientReady = import("/game-client.js").then(
  ({ GameCommerceClient }) => {
    gameClient = new GameCommerceClient({ onReset: resetAccountView });
    return gameClient;
  },
);
function resetAccountView() {
  if (session) {
    $("#goal").value = "";
    $("#budget").value = "3.00";
  }
  session = undefined;
  activeOrder = pendingOrder = previewSku = gameSnapshot = undefined;
  lastRecommendation = pendingRecommendation = undefined;
  funnelSequence++;
  scene.update({
    owned: [],
    entitlements: [],
    previews: [],
    equipped: null,
    borrowed: false,
    seal: false,
    rumor: false,
    formal: false,
    canEnter: false,
  });
  scene.player = { x: 110, y: 350 };
  scene.target = { ...scene.player };
  scene.arrived = false;
  scene.near = null;
  scene.keys.clear();
  for (const id of [
    "choices",
    "choice-goal",
    "choice-note",
    "plan",
    "products",
    "comparison",
    "checkout",
    "quote",
    "purchase-details",
    "pending-purchase",
    "wardrobe",
    "dialogue-actions",
    "dialogue-text",
    "requirements",
    "guard",
    "restore-summary",
    "progress-summary",
    "next-step",
    "preview-options",
    "look-reactions",
    "preview-caption",
    "preview-brief",
    "status",
    "funnel",
    "alternative",
    "ai-result-status",
  ])
    $(`#${id}`).replaceChildren();
  delete $("#checkout").dataset.orderId;
  for (const id of ["preview", "loan-preview"])
    $(`#${id}`).getContext("2d").clearRect(0, 0, 240, 140);
  $("#choice-step").hidden = $("#browse-step").hidden = true;
  $("#recommend").hidden = false;
  $("#plan-details").hidden = $("#comparison").hidden = true;
  $("#ai-notice").hidden = true;
  $("#ai-notice").textContent = "";
  $("#mode").textContent = "Connecting…";
  showStage("shop");
  syncControls();
}
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
      ["seal", "rumor"].includes(place)
        ? await api("/api/game/interact", { npc: place })
        : {};
    if (place === "shop") {
      openGoal();
      $("#goal").focus();
      $("#dialogue-text").textContent =
        "Rosalyn: Borrow for free, or choose a look you love.";
      actions.append(
        button("Preview a free loan", () => previewAccess("borrowed")),
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
  showStage("world");
  scene.walkTo(place);
  $("#world").focus();
}
function showStage(stage) {
  for (const name of ["shop", "purchase", "world"])
    $(`#${name}-panel`).hidden = name !== stage;
  $("#switch-view").textContent =
    stage === "world" ? "Ask Rosalyn" : "Courtyard";
}
function openGoal() {
  showStage("shop");
  $("#recommend").hidden = false;
  $("#choice-step").hidden = true;
  $("#browse-step").hidden = true;
  $("#plan-details").open = false;
  $("#goal").focus();
}
function renderChoices() {
  if (!lastRecommendation) {
    openGoal();
    return;
  }
  showStage("shop");
  $("#recommend").hidden = true;
  $("#choice-step").hidden = false;
  $("#browse-step").hidden = true;
  $("#plan-details").hidden = false;
  $("#plan-details").open = false;
  $("#choice-goal").textContent = $("#goal").value;
  const g = scene.state;
  const ko = lastRecommendation.dialogue?.language === "ko";
  $("#choice-step").lang = ko ? "ko" : "en";
  const ownedFormal = g.previews.find(
    (p) => p.access === "owned" && p.dressCheck,
  );
  const story = lastRecommendation.plan.goal === "guard";
  const offerFormal =
    story &&
    !lastRecommendation.interpretation.clarify &&
    !lastRecommendation.interpretation.avoidStyles.includes("formal");
  const ownedChoice = lastRecommendation.plan.actions.find(
    (a) => ["equip", "keep_owned"].includes(a.type) && g.owned.includes(a.sku),
  );
  $("#choice-note").textContent =
    lastRecommendation.dialogue?.text ??
    (offerFormal
      ? "The same story is open for free. Buying is optional."
      : (lastRecommendation.plan.actions[0]?.label ??
        "Choose your next step."));
  $("#ai-result-status").textContent =
    lastRecommendation.ai?.notice ??
    (lastRecommendation.mode === "openai"
      ? "AI interpreted your goal; game rules checked the choices."
      : "Offline guide · no AI call.");
  const freeLabel =
    ownedChoice || (offerFormal && ownedFormal)
      ? ko
        ? "보유한 옷 입기 · 무료"
        : "Wear what I own · Free"
      : offerFormal
        ? ko
          ? "무료로 빌리기"
          : "Borrow for free"
        : ko
          ? "지금 옷 유지 · 무료"
          : "Keep my outfit · Free";
  const canBrowse = lastRecommendation.products.length > 0;
  $("#choices").replaceChildren(
    button(freeLabel, () =>
      ownedChoice
        ? previewAccess(ownedChoice.sku)
        : offerFormal
          ? previewAccess(ownedFormal?.sku ?? "borrowed")
          : showStage("world"),
    ),
    button(
      canBrowse
        ? ko
          ? "원하는 옷 살펴보기 · 구매는 선택"
          : "Find a look to buy · Optional"
        : ko
          ? "안뜰 둘러보기 · 무료"
          : "Explore the courtyard · Free",
      () => {
        if (!canBrowse) {
          showStage("world");
          return;
        }
        $("#choice-step").hidden = true;
        $("#browse-step").hidden = false;
        $("#browse-step h1").tabIndex = -1;
        $("#browse-step h1").focus();
      },
    ),
  );
  $("#choices button").focus();
}
async function previewAccess(sku) {
  resetFittingRoom();
  await refresh();
  preview(sku);
  const g = scene.state;
  const available = sku === "borrowed" || g.owned.includes(sku);
  $("#quote").replaceChildren(
    text("h3", names[sku]),
    text("p", "USD 0.00 · No purchase", "price"),
  );
  if (available)
    $("#quote").append(
      button(
        sku === "borrowed" && !g.borrowed
          ? "Confirm free loan & wear"
          : "Confirm & wear",
        async () => {
          if (sku === "borrowed" && !scene.state.borrowed) {
            const dialogue =
              session.gameHost === "independent-sandbox-demo"
                ? await api("/api/game/interact", { npc: "shop" })
                : {};
            await api("/api/game/quest", { quest: "borrowed", ...dialogue });
          }
          await wear(sku);
        },
      ),
    );
  else
    $("#quote").append(
      text(
        "p",
        "This outfit is unavailable. Restore your wardrobe to check its status.",
      ),
    );
  $("#status").textContent = "Preview only. Nothing changed.";
  $("#quote").focus();
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
    `Preview only · ${look?.access === "owned" ? "Already owned" : sku === "borrowed" ? "Free loan, not owned" : look?.access === "held" ? "Unavailable — on hold" : "Not owned"}`;
  $("#preview-brief").textContent = look
    ? `${look.dressCheck ? "Formal clothes ✓" : "Cosmetic only · not formal"}. ${look.remaining.length ? "Still need: " + [!look.afterWearing.formal && "formal clothes", !look.afterWearing.seal && "seal", !look.afterWearing.rumor && "password"].filter(Boolean).join(" + ") : "Ready for entry when worn"}.`
    : "Preview only. Nothing has changed.";
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
  return gameClient.request(path, data);
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
      "Could not finish. Restore saved progress before trying again.";
    $("#error-code").textContent = e.message;
    $("#status").textContent =
      "Not confirmed. Your saved purchase may still be recoverable.";
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
  await gameClient.equip(sku);
  await refresh();
  showStage("world");
  $("#world").focus();
}
function storyStep(g) {
  $("#progress-summary").textContent =
    `${[g.formal, g.seal, g.rumor].filter(Boolean).length} of 3 checks complete · ${g.owned.length} owned looks · ${g.borrowed ? "free loan available" : "free loan available at Rosalyn’s"}`;
  const next = $("#next-step");
  next.replaceChildren();
  if (!g.formal) {
    if (g.owned.includes("rosalyn-gala"))
      next.append(
        button("Wear your owned Gala · No purchase", () =>
          previewAccess("rosalyn-gala"),
        ),
      );
    else if (g.borrowed)
      next.append(
        button("Wear your free loan", () => previewAccess("borrowed")),
      );
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
  const g = await gameClient.refresh();
  const snapshot = JSON.stringify(g);
  if (gameSnapshot && gameSnapshot !== snapshot) {
    lastRecommendation = undefined;
    $("#choice-step").hidden = true;
    $("#browse-step").hidden = true;
    $("#recommend").hidden = false;
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
        previewAccess(sku),
      ),
    );
  if (gameClient.pendingEquip)
    $("#wardrobe").append(
      button("Recover pending outfit change", async () => {
        await gameClient.recoverEquip();
        await refresh();
      }),
    );
  $("#guard").textContent = g.canEnter
    ? "Guard: All three checks pass. Welcome inside!"
    : `Guard: ${g.reaction}`;
  $("#requirements").textContent =
    `Formal outfit ${g.formal ? "✓" : "○"} · Seal ${g.seal ? "✓" : "○"} · Rumor ${g.rumor ? "✓" : "○"}`;
  // Diagnostics must never delay initial rendering, choices, equip or quests.
  void refreshFunnel();
}
async function refreshFunnel() {
  const sequence = ++funnelSequence,
    epoch = gameClient.epoch;
  const current = () =>
    sequence === funnelSequence && epoch === gameClient.epoch;
  try {
    const f = await gameClient.readFunnel();
    if (current())
      $("#funnel").replaceChildren(
        ...f.map((e) => text("span", `${e.name}: ${e.count}`, "metric")),
      );
  } catch {
    if (current())
      $("#funnel").textContent =
        "Analytics unavailable. Game progress is still available.";
  }
}
function resetFittingRoom() {
  const previous = pendingOrder;
  pendingOrder = previous;
  activeOrder = undefined;
  delete $("#checkout").dataset.orderId;
  $("#checkout").replaceChildren();
  $("#quote").replaceChildren();
  $("#purchase-details").replaceChildren();
  $("#look-details").open = false;
  $("#pending-purchase").replaceChildren();
  if (previous)
    $("#pending-purchase").append(
      button("Return to pending purchase", async () =>
        showOrder(await api(`/api/commerce/orders/${previous}`)),
      ),
    );
  showStage("purchase");
}
async function previewOnly(sku) {
  resetFittingRoom();
  await refresh();
  preview(sku);
  $("#quote").textContent =
    "Preview only. Return to your choices to wear or buy.";
  $("#status").textContent = "Nothing changed. Buying is optional.";
  $("#quote").focus();
}
async function select(p) {
  resetFittingRoom();
  await refresh();
  preview(p.sku);
  if (session.paymentMode === "unconfigured") {
    $("#quote").textContent =
      "Preview only. Sandbox payments are not configured; the free story route remains available.";
    $("#status").textContent = "No payment request was sent.";
    $("#quote").focus();
    return;
  }
  const q = await api("/api/commerce/quotes", { sku: p.sku });
  $("#quote").replaceChildren(
    text("h3", p.name),
    text("p", price(q), "price"),
    text("p", "Optional cosmetic · one permanent outfit", "hint"),
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
  $("#purchase-details").append(
    text("p", p.description),
    text("p", `Quote expires ${new Date(q.expires).toLocaleTimeString()}.`),
  );
  $("#status").textContent = "Not purchased or equipped yet.";
  $("#quote").focus();
}
async function showOrder(o) {
  showStage("purchase");
  $("#purchase-details").replaceChildren();
  $("#look-details").open = false;
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
    $("#purchase-details").replaceChildren(
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
        button("Complete mock payment", async () => {
          const result = await api(
            `/api/commerce/orders/${o.id}/mock-approve`,
            {},
          );
          await showOrder(result);
        }),
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
        ? "Mock purchase completed · No PayPal payment."
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
    const input = {
      goal: $("#goal").value,
      budgetMinor: Math.round(Number($("#budget").value) * 100),
    };
    const signature = JSON.stringify(input);
    if (pendingRecommendation?.signature !== signature)
      pendingRecommendation = { signature, requestId: crypto.randomUUID() };
    let result;
    try {
      result = await api("/api/commerce/agent/recommend", {
        ...input,
        requestId: pendingRecommendation.requestId,
      });
    } catch (e) {
      if (e.message === "ai_request_conflict")
        pendingRecommendation = undefined;
      throw e;
    }
    if (result.ai?.reason !== "ai_request_pending")
      pendingRecommendation = undefined;
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
            button(`Wear ${names[action.sku]} now`, () =>
              previewAccess(action.sku),
            ),
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
        text("p", price(p), "price"),
        button("Preview / Review purchase", () => select(p)),
      );
      $("#products").append(card);
    }
    if (!result.products.length)
      $("#products").append(
        text(
          "p",
          "Nothing to buy for this goal and budget. Your free route remains available.",
        ),
      );
    $("#alternative").textContent = result.freeAlternative;
    comparePaths(result.comparison);
    await refresh();
    lastRecommendation = result;
    renderChoices();
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
  await gameClientReady;
  session = await gameClient.connect();
  $("#global-error").hidden = true;
  $("#ai-notice").textContent =
    session.aiMode === "openai"
      ? "Your goal and minimal game context are sent to OpenAI for this recommendation."
      : "Offline demo recommendations. No AI API is called.";
  $("#ai-notice").hidden = false;
  $("#mode").textContent =
    `${session.paymentMode.toUpperCase()} · ${session.aiMode === "openai" ? "AI REQUESTS ENABLED" : "OFFLINE GUIDE"}${session.paymentMode === "mock" ? " · REHEARSAL" : ""}`;
  await refresh();
  $("#restore-summary").textContent =
    `Server-saved wardrobe and quest progress loaded for this session. ${savedSummary(scene.state)} Reopening starts you in the courtyard; movement and typed goals are not saved. Keep the same unexpired browser session to resume.`;
  showStage(
    scene.state.owned.length ||
      scene.state.borrowed ||
      scene.state.seal ||
      scene.state.rumor
      ? "world"
      : "shop",
  );
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
$("#switch-view").onclick = () =>
  $("#world-panel").hidden ? showStage("world") : openGoal();
$("#change-goal").onclick = openGoal;
$("#back-choices").onclick = renderChoices;
$("#back-preview").onclick = renderChoices;
$("#retry-connection").onclick = () => run(boot);
run(boot);
