// Buildings: construction progress, production/research queues and towers.

import { TILE, BUILDINGS } from './config.js';
import { rectRectDist } from './util.js';

export class Building {
  constructor(id, type, owner, x, y) {
    this.id = id;
    this.kind = 'building';
    this.type = type;
    this.def = BUILDINGS[type];
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.size = this.def.size;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.dead = false;
    this.hidden = false;

    this.constructing = false;
    this.progress = 1;
    this.builder = 0;
    this.queue = [];
    this.rally = null;
    this.gold = 0;

    this.cooldown = 0;
    this.scanTimer = 0;
    this.target = 0;
    this.flash = 0;
    this.seen = false;
  }

  rect() {
    return { x: this.x, y: this.y, w: this.size, h: this.size };
  }

  get px() {
    return (this.x + this.size / 2) * TILE;
  }

  get py() {
    return (this.y + this.size / 2) * TILE;
  }

  get complete() {
    return !this.constructing;
  }

  canAttack() {
    return !!this.def.attack && !this.constructing;
  }

  update(game, dt) {
    if (this.flash > 0) this.flash -= dt;
    if (this.constructing) {
      const rate = dt / this.def.time;
      this.progress = Math.min(1, this.progress + rate);
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.9 * rate);
      if (this.progress >= 1) game.completeConstruction(this);
      return;
    }
    if (this.queue.length) {
      const item = this.queue[0];
      item.elapsed = Math.min(item.time, item.elapsed + dt);
      if (item.elapsed >= item.time) {
        if (item.kind === 'unit') {
          if (game.spawnTrained(this, item.type)) this.queue.shift();
        } else {
          this.queue.shift();
          game.completeResearch(this.owner, item.type);
        }
      }
    }
    if (this.def.attack) this.updateTower(game, dt);
  }

  updateTower(game, dt) {
    const atk = this.def.attack;
    if (this.cooldown > 0) this.cooldown -= dt;
    let t = this.target ? game.get(this.target) : null;
    if (!t || t.dead || t.hidden || rectRectDist(this.rect(), t.rect()) > atk.range) {
      this.target = 0;
      t = null;
      this.scanTimer -= dt;
      if (this.scanTimer > 0) return;
      this.scanTimer = 0.3;
      t = game.findTarget(this, atk.range);
      if (!t) return;
      this.target = t.id;
    }
    if (this.cooldown <= 0) {
      this.cooldown = atk.cooldown;
      game.spawnProjectile(this, t, 'bolt');
    }
  }
}
