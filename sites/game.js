import { product, requireThat } from "../src/catalog.js";
import { evaluateEntitlementFrom } from "../src/vendor/onesub/entitlements.js";
import { uuid } from "./d1.js";
import { equipRequestId } from "../src/equip-request.js";
const active =
  "e.status='active' AND o.status='GRANTED' AND o.capture_verified=1 AND o.webhook_verified=1 AND o.review=0 AND NOT EXISTS(SELECT 1 FROM sites_verified_events v WHERE v.provider=o.provider AND v.type IN ('PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED') AND (v.provider_id=o.provider_id OR v.capture_id=o.capture_id))";
export class D1Game {
  constructor(s, now = Date.now) {
    Object.assign(this, { s, now });
  }
  async state(user) {
    await this.s.run(
      "INSERT OR IGNORE INTO sites_game(user_id) VALUES(?)",
      user,
    );
    // One SQL snapshot: an interleaved refund must not combine pre-refund
    // rights with post-refund equipment (or vice versa).
    const rows = await this.s.all(
      `SELECT g.*, e.sku, CASE WHEN ${active} THEN 1 ELSE 0 END verified FROM sites_game g LEFT JOIN sites_entitlements e ON e.user_id=g.user_id LEFT JOIN sites_orders o ON o.id=e.source_order_id AND o.user_id=g.user_id WHERE g.user_id=?`,
      user,
    );
    const g = rows[0],
      records = rows.filter((r) => r.sku);
    const purchases = records
      .filter((r) => r.verified)
      .map((r) => ({ productId: r.sku, type: "non_consumable" }));
    const entitlements = records.map((r) => ({
      sku: r.sku,
      status: evaluateEntitlementFrom([], purchases, { productIds: [r.sku] })
        .active
        ? "active"
        : "held",
    }));
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
      borrowed: !!g.borrowed,
      seal: !!g.seal,
      rumor: !!g.rumor,
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
  async begin(user, npc) {
    const quest = { shop: "borrowed", seal: "seal", rumor: "rumor" }[npc];
    requireThat(quest, "unknown_demo_npc");
    const token = uuid();
    await this.s.batch([
      [
        "DELETE FROM sites_challenges WHERE user_id=? OR expires<=?",
        user,
        this.now(),
      ],
      [
        "INSERT INTO sites_challenges VALUES(?,?,?,?)",
        token,
        user,
        quest,
        this.now() + 120000,
      ],
    ]);
    return { challenge: token, quest };
  }
  async quest(user, { quest, challenge }) {
    requireThat(
      ["borrowed", "seal", "rumor"].includes(quest) &&
        typeof challenge === "string",
      "demo_dialogue_required",
      409,
    );
    await this.state(user);
    const changes = await this.s.batch([
      [
        `UPDATE sites_game SET ${quest}=1 WHERE user_id=? AND EXISTS(SELECT 1 FROM sites_challenges WHERE token=? AND user_id=? AND quest=? AND expires>?)`,
        user,
        challenge,
        user,
        quest,
        this.now(),
      ],
      [
        "DELETE FROM sites_challenges WHERE token=? AND user_id=? AND quest=?",
        challenge,
        user,
        quest,
      ],
    ]);
    requireThat(changes[0].meta.changes === 1, "demo_dialogue_required", 409);
    await this.s.observe(
      user,
      "free_quest_completed",
      null,
      `quest:${challenge}`,
    );
    return this.state(user);
  }
  async equip(user, sku, requestId = uuid()) {
    equipRequestId(requestId);
    requireThat(typeof sku === "string", "entitlement_required", 403);
    // Receipt creation, the entitlement predicate and equipment write share a
    // transaction. changes() gates the write to the winner of this request ID.
    const r = await this.s.batch([
      ["INSERT OR IGNORE INTO sites_game(user_id) VALUES(?)", user],
      [
        `INSERT OR IGNORE INTO sites_equip_requests SELECT ?,?,? FROM sites_game WHERE user_id=? AND ((?='borrowed' AND borrowed=1) OR EXISTS(SELECT 1 FROM sites_entitlements e JOIN sites_orders o ON o.id=e.source_order_id WHERE e.user_id=? AND o.user_id=? AND e.sku=? AND ${active}))`,
        user,
        requestId,
        sku,
        user,
        sku,
        user,
        user,
        sku,
      ],
      [
        "UPDATE sites_game SET equipped=? WHERE changes()=1 AND user_id=? AND equipped IS NOT ?",
        sku,
        user,
        sku,
      ],
    ]);
    const receipt = await this.s.one(
      "SELECT sku FROM sites_equip_requests WHERE user_id=? AND request_id=?",
      user,
      requestId,
    );
    requireThat(receipt, "entitlement_required", 403);
    requireThat(receipt.sku === sku, "equip_request_conflict", 409);
    if (r[2].meta.changes) {
      await this.s.observe(
        user,
        "item_equipped",
        null,
        `equip:${user}:${requestId}`,
      );
      await this.s.observe(
        user,
        "npc_reaction_triggered",
        null,
        `reaction:${user}:${requestId}`,
      );
    }
    // Replays return current authority, never the old response stored at equip.
    return this.state(user);
  }
}
