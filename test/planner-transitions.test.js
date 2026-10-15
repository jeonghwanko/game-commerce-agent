import { test } from "node:test";
import assert from "node:assert/strict";
import { planGoal } from "../src/planner.js";
import { catalog } from "../src/catalog.js";
import { baseContext } from "../fixtures/intent-evaluation.js";
const intent = (goals, style) => ({
  goals,
  style,
  avoidStyles: [],
  spending: "optional",
  clarify: false,
});
test("mixed story/collection plan preserves formal entry when Traveler is owned", () => {
  const p = planGoal(
    intent(["story", "collection"], "cloak"),
    300,
    {
      ...baseContext,
      formal: true,
      borrowed: true,
      equipped: "borrowed",
      owned: ["rosalyn-traveler"],
      seal: true,
      rumor: true,
    },
    catalog,
  );
  assert.ok(
    !p.actions.some((a) => a.type === "equip" && a.sku === "rosalyn-traveler"),
    "must not replace formal look before entering",
  );
  assert.equal(p.projected.canEnter, true);
});
test("equipping an owned Gala satisfies dress code without a redundant loan", () => {
  const p = planGoal(
    intent(["story"], "any"),
    300,
    { ...baseContext, owned: ["rosalyn-gala"], equipped: null },
    catalog,
  );
  assert.ok(
    p.actions.some((a) => a.type === "equip" && a.sku === "rosalyn-gala"),
  );
  assert.ok(
    !p.actions.some((a) => a.type === "borrow"),
    "loan must not overwrite owned Gala",
  );
  assert.equal(p.projected.equipped, "rosalyn-gala");
  assert.equal(p.projected.canEnter, true);
});
test("already worn owned formal needs neither a second equip nor a loan", () => {
  const context = {
    owned: ["rosalyn-gala"],
    entitlements: [{ sku: "rosalyn-gala", status: "active" }],
    equipped: "rosalyn-gala",
    formal: true,
    borrowed: false,
    seal: true,
    rumor: true,
  };
  const p = planGoal(
    {
      goals: ["story"],
      style: "any",
      spending: "optional",
      avoidStyles: [],
      clarify: false,
    },
    300,
    context,
    catalog,
  );
  assert.deepEqual(p.actions, []);
  assert.equal(p.projected.canEnter, true);
});
