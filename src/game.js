import { product, requireThat } from "./catalog.js";
import { entitlementViews } from "./entitlements.js";
import { equipRequestId } from "./equip-request.js";
import { randomUUID } from "node:crypto";
export class GameBridge {
  constructor(store) {
    this.s = store;
  }
  state(user) {
    this.s.run("INSERT OR IGNORE INTO game(user_id) VALUES(?)", user);
    const g = this.s.get("SELECT * FROM game WHERE user_id=?", user);
    const entitlements = entitlementViews(this.s, user);
    const owned = entitlements
      .filter((e) => e.status === "active")
      .map((e) => e.sku);
    const equipped =
      g.equipped === "borrowed" && g.borrowed
        ? "borrowed"
        : owned.includes(g.equipped)
          ? g.equipped
          : null;
    const formal =
      equipped === "borrowed" ||
      (owned.includes(equipped) && product(equipped).effect === "formal");
    return {
      equipped,
      seal: !!g.seal,
      rumor: !!g.rumor,
      borrowed: !!g.borrowed,
      owned,
      entitlements,
      formal,
      canEnter: formal && !!g.seal && !!g.rumor,
      reaction:
        [
          !formal && "formal clothes (free loan available)",
          !g.seal && "the invitation seal",
          !g.rumor && "the password",
        ]
          .filter(Boolean)
          .join(", ") || "All checks complete.",
    };
  }
  quest(user, quest) {
    requireThat(["seal", "rumor", "borrowed"].includes(quest), "unknown_quest");
    this.state(user);
    const r = this.s.run(
      `UPDATE game SET ${quest}=1 WHERE user_id=? AND ${quest}=0`,
      user,
    );
    if (r.changes) this.s.observe(user, "free_quest_completed");
    return this.state(user);
  }
  equip(user, sku, requestId = randomUUID()) {
    equipRequestId(requestId);
    requireThat(typeof sku === "string", "entitlement_required", 403);
    const changed = this.s.transaction(() => {
      const receipt = this.s.get(
        "SELECT sku FROM equip_requests WHERE user_id=? AND request_id=?",
        user,
        requestId,
      );
      if (receipt) {
        requireThat(receipt.sku === sku, "equip_request_conflict", 409);
        return false;
      }
      const g = this.state(user);
      requireThat(
        sku === "borrowed" ? g.borrowed : g.owned.includes(sku),
        "entitlement_required",
        403,
      );
      this.s.run(
        "INSERT INTO equip_requests VALUES(?,?,?)",
        user,
        requestId,
        sku,
      );
      return (
        this.s.run(
          "UPDATE game SET equipped=? WHERE user_id=? AND equipped IS NOT ?",
          sku,
          user,
          sku,
        ).changes > 0
      );
    });
    if (changed) {
      this.s.observe(user, "item_equipped");
      this.s.observe(user, "npc_reaction_triggered");
    }
    return this.state(user);
  }
}
