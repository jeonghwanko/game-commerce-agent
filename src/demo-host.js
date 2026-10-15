import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthenticatedPrincipalAdapter } from "./identity.js";
import { requireThat } from "./catalog.js";
const digest = (s) => createHash("sha256").update(s).digest();
/** Explicit independent sandbox host, never an adapter for the private game.
 * An operator must supply an existing test identity and access password. No signup,
 * anonymous principal issuance, credential discovery, or automatic provisioning.
 */
export class SandboxDemoHost {
  name = "independent-sandbox-demo";
  constructor({ store, enabled, user, password, origin, now = Date.now }) {
    requireThat(enabled === true, "sandbox_demo_explicit_enable_required");
    requireThat(
      process.env.NODE_ENV !== "production",
      "sandbox_demo_not_production",
    );
    requireThat(
      typeof user === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(user) &&
        typeof password === "string" &&
        password.length >= 24,
      "sandbox_demo_access_configuration_required",
    );
    const url = new URL(origin);
    requireThat(
      url.protocol === "https:" ||
        ["127.0.0.1", "localhost"].includes(url.hostname),
      "sandbox_demo_https_required",
    );
    this.s = store;
    this.now = now;
    // Only digests survive construction; request errors never contain credentials.
    const expected = digest(
      "Basic " + Buffer.from(user + ":" + password).toString("base64"),
    );
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS demo_host_sessions (subject TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS demo_challenges (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, quest TEXT NOT NULL, expires INTEGER NOT NULL)",
    );
    this.identity = new AuthenticatedPrincipalAdapter({
      issuer: this.name,
      resolveVerifiedPrincipal: async (req) => {
        const received = req.headers.authorization;
        requireThat(
          typeof received === "string" &&
            received.length <= 8192 &&
            timingSafeEqual(digest(received), expected),
          "demo_access_required",
          401,
        );
        let session = store.get(
          "SELECT * FROM demo_host_sessions WHERE subject=?",
          user,
        );
        if (!session || session.expires <= now()) {
          session = {
            csrf: randomBytes(24).toString("hex"),
            expires: now() + 3600000,
          };
          store.run(
            "INSERT INTO demo_host_sessions VALUES(?,?,?) ON CONFLICT(subject) DO UPDATE SET csrf=excluded.csrf,expires=excluded.expires",
            user,
            session.csrf,
            session.expires,
          );
        }
        return {
          authenticated: true,
          issuer: this.name,
          subject: user,
          expiresAt: session.expires,
          csrfToken: session.csrf,
        };
      },
    });
  }
  begin(user, npc) {
    const quest = { shop: "borrowed", seal: "seal", rumor: "rumor" }[npc];
    requireThat(quest, "unknown_demo_npc");
    const token = randomBytes(24).toString("hex");
    this.s.transaction(() => {
      this.s.run(
        "DELETE FROM demo_challenges WHERE user_id=? OR expires<=?",
        user,
        this.now(),
      );
      this.s.run(
        "INSERT INTO demo_challenges VALUES(?,?,?,?)",
        token,
        user,
        quest,
        this.now() + 120000,
      );
    });
    return { challenge: token, quest };
  }
  complete(user, body, game) {
    return this.s.transaction(() => {
      const row = this.s.get(
        "SELECT * FROM demo_challenges WHERE token=? AND user_id=? AND expires>?",
        typeof body.challenge === "string" ? body.challenge : "",
        user,
        this.now(),
      );
      requireThat(
        row && row.quest === body.quest,
        "demo_dialogue_required",
        409,
      );
      this.s.run("DELETE FROM demo_challenges WHERE token=?", row.token);
      // Quest state comes only from this server allowlist, never client flags or ownership.
      return game.quest(user, row.quest);
    });
  }
}
