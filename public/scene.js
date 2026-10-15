/* Original vector scene: no external game assets, libraries or network resources. */
class AtelierScene {
  constructor(canvas, onInteract) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onInteract = onInteract;
    this.player = { x: 110, y: 350 };
    this.target = { ...this.player };
    this.state = {};
    this.keys = new Set();
    this.near = null;
    this.arrived = false;
    this.places = {
      shop: { x: 180, y: 250, label: "Rosalyn · Shop" },
      seal: { x: 420, y: 340, label: "Courier · Seal" },
      rumor: { x: 570, y: 190, label: "Archivist · Rumor" },
      guard: { x: 760, y: 235, label: "Gatekeeper" },
    };
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      this.target = {
        x: ((e.clientX - r.left) * 1000) / r.width,
        y: ((e.clientY - r.top) * 450) / r.height,
      };
    };
    window.addEventListener("keydown", (e) => {
      if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "w",
          "a",
          "s",
          "d",
          "e",
        ].includes(e.key)
      ) {
        e.preventDefault();
        this.keys.add(e.key);
        if (e.key === "e") this.interact();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key));
    window.addEventListener("blur", () => this.keys.clear());
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.move(dt);
      this.draw(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  walkTo(place) {
    const p = this.places[place];
    if (p) this.target = { x: p.x, y: p.y };
  }
  update(state) {
    this.state = state;
  }
  interact() {
    if (this.near) this.onInteract(this.near);
  }
  move(dt) {
    let dx = 0,
      dy = 0;
    if (this.keys.has("w") || this.keys.has("ArrowUp")) dy--;
    if (this.keys.has("s") || this.keys.has("ArrowDown")) dy++;
    if (this.keys.has("a") || this.keys.has("ArrowLeft")) dx--;
    if (this.keys.has("d") || this.keys.has("ArrowRight")) dx++;
    if (dx || dy)
      this.target = {
        x: this.player.x + dx * 100,
        y: this.player.y + dy * 100,
      };
    dx = this.target.x - this.player.x;
    dy = this.target.y - this.player.y;
    const distance = Math.hypot(dx, dy),
      step = Math.min(distance, dt * 270);
    if (distance > 2) {
      this.player.x += (dx / distance) * step;
      this.player.y += (dy / distance) * step;
    }
    this.player.x = Math.max(
      28,
      Math.min(this.state.canEnter ? 965 : 785, this.player.x),
    );
    this.player.y = Math.max(170, Math.min(415, this.player.y));
    const near =
      Object.keys(this.places).find(
        (k) =>
          Math.hypot(
            this.places[k].x - this.player.x,
            this.places[k].y - this.player.y,
          ) < 48,
      ) ?? null;
    if (near !== this.near) {
      this.near = near;
      const b = document.querySelector("#interact");
      b.disabled = !near;
      b.textContent = near
        ? `Talk to ${this.places[near].label.split(" · ")[0]}`
        : "Walk near someone to talk";
    }
    if (this.state.canEnter && this.player.x > 850 && !this.arrived) {
      this.arrived = true;
      document.querySelector("#dialogue-text").textContent =
        "You made it into the evening gathering. Your path was your choice: collected finery or borrowed clothes. The story stays free.";
    }
  }
  draw(now) {
    const c = this.ctx;
    c.clearRect(0, 0, 1000, 450);
    c.fillStyle = "#263c37";
    c.fillRect(0, 0, 1000, 450);
    c.fillStyle = "#355148";
    for (let y = 180; y < 450; y += 40)
      for (let x = y % 80 ? 20 : 0; x < 1000; x += 60) c.fillRect(x, y, 57, 37);
    c.fillStyle = "#bc9974";
    c.fillRect(50, 40, 260, 150);
    c.fillStyle = "#694c6e";
    c.beginPath();
    c.moveTo(30, 55);
    c.lineTo(180, 5);
    c.lineTo(330, 55);
    c.fill();
    c.fillStyle = "#e2cf9b";
    c.fillRect(75, 85, 65, 70);
    c.fillRect(220, 85, 65, 70);
    c.fillStyle = "#384d40";
    c.fillRect(155, 95, 50, 95);
    c.fillStyle = "#dac486";
    c.font = "18px Georgia";
    c.textAlign = "center";
    c.fillText("ROSALYN’S ATELIER", 180, 75);
    c.fillStyle = "#172b2a";
    c.fillRect(330, 0, 430, 120);
    c.fillStyle = "#bfcc9e";
    c.font = "15px system-ui";
    c.fillText("THE EVENING GATHERING", 520, 42);
    c.fillStyle = "#536850";
    c.fillRect(485, 70, 160, 55);
    c.fillStyle = "#b9aa80";
    for (let x = 495; x < 630; x += 18) c.fillRect(x, 82, 10, 30);
    c.fillStyle = "#1e302b";
    c.fillRect(820, 0, 180, 450);
    c.fillStyle = "#bfa77b";
    c.fillRect(810, 0, 18, 190);
    c.fillRect(810, 300, 18, 150);
    if (!this.state.canEnter) {
      c.strokeStyle = "#9b9f83";
      c.lineWidth = 5;
      for (let x = 813; x < 830; x += 8) {
        c.beginPath();
        c.moveTo(x, 190);
        c.lineTo(x, 300);
        c.stroke();
      }
    } else {
      c.fillStyle = "#d2f582";
      c.font = "17px Georgia";
      c.fillText("WELCOME", 910, 210);
    }
    for (const [key, p] of Object.entries(this.places)) {
      const npcY = p.y - 38;
      if (key === "shop")
        AtelierScene.avatar(c, p.x, npcY, "rosalyn-traveler", 0.9);
      else
        AtelierScene.avatar(
          c,
          p.x,
          npcY,
          key === "guard" ? "borrowed" : null,
          0.85,
        );
      c.fillStyle = "#f1eddb";
      c.font = "13px system-ui";
      c.fillText(p.label, p.x, p.y + 38);
      if (
        (key === "seal" && this.state.seal) ||
        (key === "rumor" && this.state.rumor)
      ) {
        c.fillStyle = "#d2f582";
        c.fillText("✓", p.x + 30, npcY);
      }
    }
    const outfit =
      this.state.equipped === "borrowed" && this.state.borrowed
        ? "borrowed"
        : this.state.owned?.includes(this.state.equipped)
          ? this.state.equipped
          : null;
    c.fillStyle = "#15241ecc";
    c.beginPath();
    c.ellipse(this.player.x, this.player.y + 14, 17, 6, 0, 0, Math.PI * 2);
    c.fill();
    AtelierScene.avatar(c, this.player.x, this.player.y, outfit, 1);
    c.strokeStyle = "#d2f582";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(this.player.x, this.player.y + 3, 25, 0, Math.PI * 2);
    c.stroke();
    if (this.near) {
      c.fillStyle = "#d2f582";
      c.font = "12px system-ui";
      c.fillText("E · TALK", this.player.x, this.player.y - 48);
    }
    c.fillStyle = "#e8d897";
    for (const x of [350, 680, 880]) {
      c.beginPath();
      c.arc(x, 80 + Math.sin(now / 1000 + x) * 4, 3, 0, Math.PI * 2);
      c.fill();
    }
  }
  static avatar(c, x, y, sku, scale = 1) {
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    const gala = sku === "rosalyn-gala",
      cloak = sku === "rosalyn-traveler";
    c.fillStyle = gala
      ? "#a38bdf"
      : cloak
        ? "#3ca699"
        : sku === "borrowed"
          ? "#b7bcae"
          : "#b07754";
    c.beginPath();
    c.moveTo(-12, -15);
    c.lineTo(12, -15);
    c.lineTo(gala ? 20 : 16, 15);
    c.lineTo(-16, 15);
    c.closePath();
    c.fill();
    if (gala) {
      c.strokeStyle = "#f4d47c";
      c.lineWidth = 3;
      c.stroke();
      c.fillStyle = "#f4d47c";
      c.font = "13px serif";
      c.fillText("✦", 1, 5);
    }
    if (cloak) {
      c.fillStyle = "#205e5b";
      c.beginPath();
      c.moveTo(-12, -14);
      c.lineTo(-24, 17);
      c.lineTo(2, 10);
      c.fill();
    }
    c.fillStyle = "#dfb48c";
    c.beginPath();
    c.arc(0, -26, 9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#293132";
    c.fillRect(-8, 15, 6, 8);
    c.fillRect(4, 15, 6, 8);
    c.restore();
  }
}
window.AtelierScene = AtelierScene;
