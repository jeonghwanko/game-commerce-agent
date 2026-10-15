import { createHash, randomUUID } from "node:crypto";
import { requireThat } from "./catalog.js";
/** The host supplies a verifier backed by its existing server authentication.
 * This module never interprets bearer tokens, development headers, or userId input.
 * The verifier must reject revoked/expired sessions on EVERY request.
 */
export class AuthenticatedPrincipalAdapter {
  constructor({ issuer, resolveVerifiedPrincipal }) {
    requireThat(
      typeof issuer === "string" &&
        issuer.length > 0 &&
        typeof resolveVerifiedPrincipal === "function",
      "principal_adapter_required",
    );
    this.issuer = issuer;
    this.resolveVerifiedPrincipal = resolveVerifiedPrincipal;
  }
  async resolve(req, store) {
    const p = await this.resolveVerifiedPrincipal(req);
    requireThat(
      p?.authenticated === true &&
        p.issuer === this.issuer &&
        typeof p.subject === "string" &&
        p.subject.length > 0 &&
        p.subject.length <= 256 &&
        Number.isSafeInteger(p.expiresAt) &&
        p.expiresAt > Date.now() &&
        typeof p.csrfToken === "string" &&
        p.csrfToken.length >= 24,
      "authenticated_principal_required",
      401,
    );
    const identityHash = createHash("sha256")
      .update(JSON.stringify([p.issuer, p.subject]))
      .digest("hex");
    store.run(
      "INSERT OR IGNORE INTO principals VALUES(?,?)",
      identityHash,
      randomUUID(),
    );
    return {
      user_id: store.get(
        "SELECT user_id FROM principals WHERE identity_hash=?",
        identityHash,
      ).user_id,
      csrf: p.csrfToken,
      expires: p.expiresAt,
    };
  }
}
