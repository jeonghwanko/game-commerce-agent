// Public, framework-independent same-origin client. No private game/SDK code.
export class GameClientError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => {
  throw new GameClientError(code, status);
};

export class GameCommerceClient {
  constructor({
    fetcher = (...args) => fetch(...args),
    onReset = () => {},
    timeoutMs = 15000,
  } = {}) {
    Object.assign(this, { fetcher, onReset, timeoutMs });
    this.epoch = 0;
    this.readSequence = 0;
    this.session = null;
    this.state = null;
    this.pendingEquip = null;
    this.equipping = null;
  }
  assertCurrent(epoch) {
    if (epoch !== this.epoch) fail("stale_account_request");
  }
  reset() {
    this.epoch++;
    this.readSequence++;
    this.session = null;
    this.state = null;
    this.pendingEquip = null;
    this.equipping = null;
    this.onReset();
  }
  // The host MUST call synchronously on logout/account change, before awaiting
  // its login flow. Aborting fetch alone cannot prevent a late response leak.
  disconnect() {
    this.reset();
  }
  async connect() {
    const pending = this.pendingEquip;
    this.reset();
    this.pendingEquip = pending;
    const epoch = this.epoch;
    const session = await this.send("/api/session", undefined, epoch, null);
    this.assertCurrent(epoch);
    if (
      !session ||
      typeof session.scope !== "string" ||
      !session.scope ||
      typeof session.csrf !== "string" ||
      !session.csrf
    )
      fail("invalid_game_session");
    this.session = Object.freeze({ ...session });
    // A transport reconnect can retain intent for explicit same-account retry.
    // A logout/switch discards it; no pending intent crosses accounts.
    this.pendingEquip = pending?.scope === session.scope ? pending : null;
    return this.session;
  }
  async send(path, data, epoch, session, diagnostic = false) {
    this.assertCurrent(epoch);
    const url = new URL(path, "https://same-origin.invalid");
    if (
      !path.startsWith("/api/") ||
      !url.pathname.startsWith("/api/") ||
      url.origin !== "https://same-origin.invalid" ||
      url.hash
    )
      fail("same_origin_api_required");
    let response, out;
    try {
      response = await this.fetcher(path, {
        method: data === undefined ? "GET" : "POST",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          ...(session ? { "X-Commerce-Scope": session.scope } : {}),
          ...(data === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "X-CSRF-Token": session.csrf,
              }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      this.assertCurrent(epoch);
      out = await response.json();
      this.assertCurrent(epoch);
    } catch (e) {
      this.assertCurrent(epoch);
      throw e;
    }
    if (!response.ok) {
      if (
        !diagnostic &&
        (([401, 403].includes(response.status) &&
          out.error !== "entitlement_required") ||
          out.error === "account_changed")
      )
        this.reset();
      fail(out.error ?? "game_request_failed", response.status);
    }
    const scope = response.headers.get("x-commerce-scope");
    if (!scope || scope !== (session?.scope ?? out.scope)) {
      if (!diagnostic) this.reset();
      fail("account_changed", 409);
    }
    return out;
  }
  request(path, data) {
    if (!this.session)
      return Promise.reject(new GameClientError("game_not_connected"));
    return this.send(path, data, this.epoch, this.session);
  }
  readFunnel() {
    if (!this.session)
      return Promise.reject(new GameClientError("game_not_connected"));
    // A failing diagnostic endpoint cannot invalidate the playable session.
    return this.send(
      "/api/analytics/funnel",
      undefined,
      this.epoch,
      this.session,
      true,
    );
  }
  async refresh() {
    const epoch = this.epoch,
      sequence = ++this.readSequence;
    const state = await this.request("/api/game");
    this.assertCurrent(epoch);
    if (sequence !== this.readSequence) fail("stale_game_state");
    // The host receives only current-scope results, including the Promise value.
    this.state = structuredClone(state);
    return structuredClone(state);
  }
  async equip(sku) {
    if (!this.session) fail("game_not_connected");
    if (this.equipping) fail("equip_in_progress");
    if (this.pendingEquip && this.pendingEquip.sku !== sku)
      fail("equip_recovery_required");
    const epoch = this.epoch;
    const intent =
      this.pendingEquip ??
      Object.freeze({
        scope: this.session.scope,
        sku,
        requestId: crypto.randomUUID(),
      });
    this.pendingEquip = intent;
    this.equipping = intent;
    this.readSequence++; // Invalidate reads started before this mutation.
    try {
      await this.request("/api/game/equip", {
        sku,
        requestId: intent.requestId,
      });
      this.assertCurrent(epoch);
      this.pendingEquip = null;
      return await this.refresh();
    } catch (e) {
      this.assertCurrent(epoch);
      // Clear only definitive rejection, never a lost/500/timeout response.
      if (e.status >= 400 && e.status < 500 && e.status !== 429)
        this.pendingEquip = null;
      throw e;
    } finally {
      if (this.epoch === epoch && this.equipping === intent)
        this.equipping = null;
    }
  }
  recoverEquip() {
    if (!this.pendingEquip || this.pendingEquip.scope !== this.session?.scope)
      return Promise.reject(new GameClientError("no_pending_equip"));
    return this.equip(this.pendingEquip.sku);
  }
}
