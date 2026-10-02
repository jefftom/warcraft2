// Fog of war for one player: tiles are unexplored, explored, or visible now.

export class Fog {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.visible = new Uint8Array(w * h);
    this.explored = new Uint8Array(w * h);
    this.version = 0;
  }

  reveal(cx, cy, r) {
    const { w, h, visible, explored } = this;
    const r2 = r * r + r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) {
          const i = y * w + x;
          visible[i] = 1;
          explored[i] = 1;
        }
      }
    }
  }

  update(game, owner) {
    this.visible.fill(0);
    for (const u of game.units) {
      if (u.owner !== owner || u.dead || u.hidden) continue;
      this.reveal(u.tx, u.ty, u.def.sight);
    }
    for (const b of game.buildings) {
      if (b.owner !== owner || b.dead) continue;
      const sight = b.constructing ? 2 : b.def.sight;
      this.reveal(b.x + (b.size - 1) / 2, b.y + (b.size - 1) / 2, sight + b.size / 2);
    }
    for (const b of game.buildings) {
      if (b.seen) continue;
      if (this.rectVisible(b.rect())) b.seen = true;
    }
    this.version++;
  }

  isVisible(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.visible[y * this.w + x] === 1;
  }

  isExplored(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.explored[y * this.w + x] === 1;
  }

  rectVisible(r) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.isVisible(x, y)) return true;
    return false;
  }

  rectExplored(r) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.isExplored(x, y)) return true;
    return false;
  }

  revealAll() {
    this.visible.fill(1);
    this.explored.fill(1);
    this.version++;
  }
}
