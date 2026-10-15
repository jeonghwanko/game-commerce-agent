import { product, requireThat } from "./catalog.js";
export class GameBridge {
  constructor(store) {
    this.s = store;
  }
  state(user) {
    this.s.run("INSERT OR IGNORE INTO game(user_id) VALUES(?)", user);
    const g = this.s.get("SELECT * FROM game WHERE user_id=?", user);
    const entitlements = this.s.all(
      "SELECT sku,status FROM entitlements WHERE user_id=?",
      user,
    );
    const owned = entitlements
      .filter((e) => e.status === "active")
      .map((e) => e.sku);
    const formal =
      (g.equipped === "borrowed" && !!g.borrowed) ||
      (owned.includes(g.equipped) && product(g.equipped).effect === "formal");
    return {
      equipped: g.equipped,
      seal: !!g.seal,
      rumor: !!g.rumor,
      borrowed: !!g.borrowed,
      owned,
      entitlements,
      formal,
      canEnter: formal && !!g.seal && !!g.rumor,
      reaction: formal
        ? "Smart clothes. I still need the seal and the correct rumor."
        : "Formal clothes, a seal, and the correct rumor are required.",
    };
  }
  quest(user, quest) {
    requireThat(["seal", "rumor", "borrowed"].includes(quest), "unknown_quest");
    this.state(user);
    this.s.run(`UPDATE game SET ${quest}=1 WHERE user_id=?`, user);
    this.s.event(user, "free_quest_completed");
    return this.state(user);
  }
  equip(user, sku) {
    const g = this.state(user);
    requireThat(
      sku === "borrowed" ? g.borrowed : g.owned.includes(sku),
      "entitlement_required",
      403,
    );
    this.s.run("UPDATE game SET equipped=? WHERE user_id=?", sku, user);
    this.s.event(user, "item_equipped");
    this.s.event(user, "npc_reaction_triggered");
    return this.state(user);
  }
}
