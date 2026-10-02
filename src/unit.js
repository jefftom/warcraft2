// Units move tile-to-tile (one unit per tile, like the classics) and run a
// small state machine driven by their current order.

import { TILE, UNITS, BUILDINGS, MINE_TIME, CHOP_TIME, DEPOSIT_TIME, CARRY_AMOUNT } from './config.js';
import { rectDist } from './util.js';

export const NAV = {
  ARRIVED: 'arrived',
  MOVING: 'moving',
  BLOCKED: 'blocked',
  WAITING: 'waiting',
  UNREACHABLE: 'unreachable',
};

export class Unit {
  constructor(id, type, owner, tx, ty) {
    this.id = id;
    this.kind = 'unit';
    this.type = type;
    this.def = UNITS[type];
    this.owner = owner;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.dead = false;

    this.tx = tx;
    this.ty = ty;
    this.x = (tx + 0.5) * TILE;
    this.y = (ty + 0.5) * TILE;
    this.moving = false;
    this.fromX = tx;
    this.fromY = ty;
    this.toX = tx;
    this.toY = ty;
    this.stepProgress = 0;
    this.stepLen = 1;
    this.leftover = 0;

    this.order = null;
    this.path = null;
    this.pathIndex = 0;
    this.pathFinal = false;
    this.navKey = '';
    this.repathTimer = 0;
    this.blockedTime = 0;
    this.navFails = 0;
    this.avoidUnits = false;

    this.cooldown = 0;
    this.scanTimer = 0;
    this.nudgeCooldown = 0;
    this.timer = 0;
    this.carry = null;
    this.lastHarvest = null;
    this.hidden = false;
    this.inside = 0;

    // Presentation state.
    this.facing = 1;
    this.dirX = 0;
    this.dirY = 1;
    this.walkAnim = 0;
    this.attackAnim = 0;
    this.workAnim = 0;
    this.flash = 0;
  }

  rect() {
    return { x: this.tx, y: this.ty, w: 1, h: 1 };
  }

  get isWorker() {
    return !!this.def.worker;
  }

  get isMilitary() {
    return !this.def.worker;
  }

  canAttack() {
    return this.def.damage > 0;
  }

  isIdle() {
    return !this.order && !this.moving && !this.hidden;
  }

  // ---- order management -------------------------------------------------

  setOrder(game, order) {
    const old = this.order;
    if (old && old !== order) this.cancelOrder(game, old);
    this.order = order;
    this.resetNav();
    if (order && order.type === 'harvest' && order.res) {
      this.lastHarvest = { res: order.res, mine: order.mine, tx: order.tx, ty: order.ty };
    }
  }

  finishOrder() {
    const next = this.order && this.order.next;
    this.order = next || null;
    this.resetNav();
  }

  cancelOrder(game, order) {
    if (order.type === 'build' && order.paid) {
      order.paid = false;
      game.refund(this.owner, BUILDINGS[order.btype].cost, 1);
    }
  }

  resetNav() {
    this.path = null;
    this.pathIndex = 0;
    this.blockedTime = 0;
    this.navFails = 0;
    this.repathTimer = 0;
    this.avoidUnits = false;
  }

  // ---- per-tick update ---------------------------------------------------

  update(game, dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.attackAnim > 0) this.attackAnim -= dt;
    if (this.nudgeCooldown > 0) this.nudgeCooldown -= dt;
    if (this.flash > 0) this.flash -= dt;

    if (this.hidden) {
      this.updateHidden(game, dt);
      return;
    }
    if (this.moving) {
      this.advanceStep(game, dt);
      if (this.moving) return;
    }

    const o = this.order;
    if (!o) this.updateIdle(game, dt);
    else {
      switch (o.type) {
        case 'move':
          this.updateMove(game, dt, o);
          break;
        case 'attackMove':
          this.updateAttackMove(game, dt, o);
          break;
        case 'attack':
          this.updateAttack(game, dt, o);
          break;
        case 'hold':
          this.updateHold(game, dt, o);
          break;
        case 'harvest':
          this.updateHarvest(game, dt, o);
          break;
        case 'build':
          this.updateBuild(game, dt, o);
          break;
        default:
          this.finishOrder();
          break;
      }
    }
    this.leftover = 0;
  }

  updateIdle(game, dt) {
    if (!this.canAttack() || this.isWorker) return;
    this.scanTimer -= dt;
    if (this.scanTimer > 0) return;
    this.scanTimer = 0.3 + game.rng() * 0.15;
    const t = game.findTarget(this, this.def.sight + 1);
    if (t) {
      this.setOrder(game, { type: 'attack', target: t.id, leash: { x: this.tx, y: this.ty, d: 10 } });
    }
  }

  updateMove(game, dt, o) {
    let rect = o.rect;
    if (o.target) {
      const t = game.get(o.target);
      if (!t || t.dead || t.hidden) return this.finishOrder();
      rect = t.rect();
    }
    if (!rect) rect = { x: o.x, y: o.y, w: 1, h: 1 };
    const r = this.navigate(game, dt, rect, o.range || 0);
    if (r === NAV.ARRIVED || r === NAV.UNREACHABLE) return this.finishOrder();
    if (r === NAV.BLOCKED) {
      const remaining = this.path ? this.path.length - this.pathIndex : 0;
      if ((remaining <= 2 && this.blockedTime > 0.4) || this.blockedTime > 5) this.finishOrder();
    }
  }

  updateAttackMove(game, dt, o) {
    if (this.canAttack()) {
      this.scanTimer -= dt;
      if (this.scanTimer <= 0) {
        this.scanTimer = 0.25;
        const t = game.findTarget(this, this.def.sight + 1);
        if (t) {
          this.order = { type: 'attack', target: t.id, next: o };
          this.resetNav();
          return;
        }
      }
    }
    const r = this.navigate(game, dt, { x: o.x, y: o.y, w: 1, h: 1 }, o.range || 0);
    if (r === NAV.ARRIVED || r === NAV.UNREACHABLE) return this.finishOrder();
    if (r === NAV.BLOCKED) {
      const remaining = this.path ? this.path.length - this.pathIndex : 0;
      if ((remaining <= 3 && this.blockedTime > 0.6) || this.blockedTime > 6) this.finishOrder();
    }
  }

  updateAttack(game, dt, o) {
    const t = game.get(o.target);
    if (!t || t.dead || t.hidden || !game.isHostile(this, t)) return this.finishOrder();
    const range = this.def.range;
    const tr = t.rect();
    if (rectDist(this.tx, this.ty, tr) <= range) {
      this.path = null;
      this.blockedTime = 0;
      this.faceTowards(t);
      if (this.cooldown <= 0) this.performAttack(game, t);
      return;
    }
    if (o.leash) {
      const d = Math.max(Math.abs(this.tx - o.leash.x), Math.abs(this.ty - o.leash.y));
      if (d > o.leash.d) {
        this.setOrder(game, { type: 'move', x: o.leash.x, y: o.leash.y });
        return;
      }
    }
    const r = this.navigate(game, dt, tr, range);
    if (r === NAV.UNREACHABLE || (r === NAV.BLOCKED && this.blockedTime > 4)) this.finishOrder();
  }

  updateHold(game, dt, o) {
    if (!this.canAttack()) return;
    let t = o.target ? game.get(o.target) : null;
    if (!t || t.dead || t.hidden || rectDist(this.tx, this.ty, t.rect()) > this.def.range) {
      o.target = 0;
      this.scanTimer -= dt;
      if (this.scanTimer > 0) return;
      this.scanTimer = 0.25;
      t = game.findTarget(this, this.def.range);
      if (!t) return;
      o.target = t.id;
    }
    this.faceTowards(t);
    if (this.cooldown <= 0) this.performAttack(game, t);
  }

  performAttack(game, t) {
    this.cooldown = this.def.cooldown;
    this.attackAnim = 0.3;
    if (this.def.projectile) {
      game.spawnProjectile(this, t, this.def.projectile);
    } else {
      game.dealDamage(this, t);
    }
  }

  // ---- harvesting --------------------------------------------------------

  updateHarvest(game, dt, o) {
    if (o.phase === 'toDepot') {
      if (!this.carry) {
        if (!o.res) return this.finishOrder();
        o.phase = 'toResource';
        return;
      }
      const depot = game.nearestDepot(this.owner, this.carry.type, this.tx, this.ty);
      if (!depot) return; // wait until a depot exists
      const r = this.navigate(game, dt, depot.rect(), 1);
      if (r === NAV.ARRIVED) {
        game.enterBuilding(this, depot);
        o.phase = 'depositing';
        this.timer = DEPOSIT_TIME;
      } else if (r === NAV.UNREACHABLE) {
        this.finishOrder();
      }
      return;
    }

    if (o.phase === 'toResource') {
      if (this.carry) {
        o.phase = 'toDepot';
        return;
      }
      if (o.res === 'gold') {
        let mine = game.get(o.mine);
        if (!mine || mine.dead) {
          mine = game.nearestMine(this.tx, this.ty, 30);
          if (!mine) return this.finishOrder();
          o.mine = mine.id;
          this.lastHarvest = { res: 'gold', mine: mine.id };
        }
        const r = this.navigate(game, dt, mine.rect(), 1);
        if (r === NAV.ARRIVED) {
          game.enterBuilding(this, mine);
          o.phase = 'mining';
          this.timer = MINE_TIME / game.gatherBonus(this.owner);
        } else if (r === NAV.UNREACHABLE) {
          this.finishOrder();
        }
        return;
      }
      // Lumber.
      if (o.tx === undefined || !game.map.isTree(o.tx, o.ty)) {
        const tree = game.findTreeNear(o.tx ?? this.tx, o.ty ?? this.ty, this, o.bad);
        if (!tree) return this.finishOrder();
        o.tx = tree.x;
        o.ty = tree.y;
        this.lastHarvest = { res: 'wood', tx: tree.x, ty: tree.y };
        this.resetNav();
      }
      const r = this.navigate(game, dt, { x: o.tx, y: o.ty, w: 1, h: 1 }, 1);
      if (r === NAV.ARRIVED) {
        o.phase = 'chopping';
        this.timer = CHOP_TIME;
        this.workAnim = 0;
        this.faceTile(o.tx, o.ty);
      } else if (r === NAV.UNREACHABLE) {
        o.bad = o.bad || new Set();
        o.bad.add(o.ty * game.map.w + o.tx);
        o.tx = undefined;
        if (o.bad.size > 6) this.finishOrder();
      }
      return;
    }

    if (o.phase === 'chopping') {
      if (!game.map.isTree(o.tx, o.ty)) {
        o.phase = 'toResource';
        return;
      }
      const before = this.workAnim;
      this.workAnim += dt;
      if (Math.floor(before / 0.55) !== Math.floor(this.workAnim / 0.55)) {
        game.emit({ type: 'sound', name: 'chop', x: this.x, y: this.y, owner: this.owner });
      }
      this.timer -= dt * game.gatherBonus(this.owner);
      if (this.timer <= 0) {
        const got = game.harvestTree(o.tx, o.ty, CARRY_AMOUNT);
        if (got > 0) {
          this.carry = { type: 'wood', amount: got };
          o.phase = 'toDepot';
        } else {
          o.phase = 'toResource';
        }
      }
    }
  }

  updateHidden(game, dt) {
    const o = this.order;
    const host = game.get(this.inside);
    if (!host || host.dead) {
      // Our mine ran dry or the building was destroyed around us.
      if (game.ejectUnit(this, this.tx, this.ty)) {
        if (o && o.type === 'harvest' && o.res) o.phase = this.carry ? 'toDepot' : 'toResource';
        else this.finishOrder();
      }
      return;
    }
    if (o && o.type === 'construct') {
      if (!host.constructing && game.ejectUnit(this, host.x + Math.floor(host.size / 2), host.y + host.size)) this.finishOrder();
      return;
    }
    if (!o || o.type !== 'harvest') {
      if (game.ejectUnit(this, this.tx, this.ty)) this.finishOrder();
      return;
    }
    if (o.phase === 'mining') {
      this.timer -= dt;
      if (this.timer > 0) return;
      const mine = game.get(this.inside);
      if (mine && !mine.dead && !this.carry) {
        const got = game.mineGold(mine, CARRY_AMOUNT);
        if (got > 0) this.carry = { type: 'gold', amount: got };
      }
      const depot = game.nearestDepot(this.owner, 'gold', this.tx, this.ty);
      const target = depot ? game.centerTile(depot) : { x: this.tx, y: this.ty };
      if (game.ejectUnit(this, target.x, target.y)) o.phase = 'toDepot';
      return;
    }
    if (o.phase === 'depositing') {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.carry) {
        game.addResource(this.owner, this.carry.type, this.carry.amount);
        this.carry = null;
      }
      let target = { x: this.tx, y: this.ty };
      if (o.res === 'gold') {
        const mine = game.get(o.mine);
        if (mine && !mine.dead) target = game.centerTile(mine);
      } else if (o.res === 'wood' && o.tx !== undefined) {
        target = { x: o.tx, y: o.ty };
      }
      if (game.ejectUnit(this, target.x, target.y)) {
        if (o.res) o.phase = 'toResource';
        else this.finishOrder();
      }
    }
  }

  // ---- construction ------------------------------------------------------

  updateBuild(game, dt, o) {
    const def = BUILDINGS[o.btype];
    const rect = { x: o.x, y: o.y, w: def.size, h: def.size };
    const r = this.navigate(game, dt, rect, 1);
    if (r === NAV.UNREACHABLE) return this.failBuild(game, o, 'The building site cannot be reached.');
    if (r !== NAV.ARRIVED) {
      if (r === NAV.BLOCKED && this.blockedTime > 6) this.failBuild(game, o, 'The building site cannot be reached.');
      return;
    }
    const check = game.canPlace(o.btype, this.owner, o.x, o.y, this);
    if (!check.ok) {
      if (check.reason === 'units') {
        o.wait = (o.wait || 0) + dt;
        for (const u of check.units) if (u.owner === this.owner) u.nudge(game, this, rect);
        if (o.wait < 3) return;
        return this.failBuild(game, o, 'Something is in the way.');
      }
      return this.failBuild(game, o, check.message);
    }
    o.paid = false;
    game.startConstruction(this, o.btype, o.x, o.y);
  }

  failBuild(game, o, message) {
    if (o.paid) {
      o.paid = false;
      game.refund(this.owner, BUILDINGS[o.btype].cost, 1);
    }
    game.message(this.owner, message);
    this.finishOrder();
  }

  // ---- movement ----------------------------------------------------------

  navigate(game, dt, rect, range) {
    if (rectDist(this.tx, this.ty, rect) <= range) {
      this.path = null;
      this.blockedTime = 0;
      return NAV.ARRIVED;
    }
    const key = `${rect.x},${rect.y},${rect.w},${rect.h},${range}`;
    if (this.repathTimer > 0) this.repathTimer -= dt;
    const exhausted = !this.path || this.pathIndex >= this.path.length;

    if (exhausted && this.path && this.pathFinal && key === this.navKey) {
      // We walked as close as possible and the goal is still out of reach.
      this.path = null;
      return NAV.UNREACHABLE;
    }

    if (exhausted || (key !== this.navKey && this.repathTimer <= 0)) {
      if (this.repathTimer > 0) {
        if (exhausted) return NAV.WAITING;
      } else {
        const avoid = this.avoidUnits;
        this.avoidUnits = false;
        const res = game.findPath(this, rect, range, avoid);
        this.repathTimer = 0.35;
        this.navKey = key;
        this.path = res.path;
        this.pathIndex = 0;
        this.pathFinal = !res.reached && !avoid;
        if (res.path.length === 0) {
          this.path = null;
          if (!avoid) {
            this.navFails++;
            if (this.navFails >= 2) {
              this.navFails = 0;
              return NAV.UNREACHABLE;
            }
          }
          this.repathTimer = 0.5 + game.rng() * 0.3;
          return NAV.WAITING;
        }
        this.navFails = 0;
      }
    }

    const next = this.path[this.pathIndex];
    if (
      Math.abs(next.x - this.tx) > 1 ||
      Math.abs(next.y - this.ty) > 1 ||
      !game.isPassable(next.x, next.y) ||
      (next.x !== this.tx && next.y !== this.ty && (!game.isPassable(next.x, this.ty) || !game.isPassable(this.tx, next.y)))
    ) {
      this.path = null;
      this.repathTimer = 0;
      return NAV.WAITING;
    }

    const occ = game.unitAt(next.x, next.y);
    if (occ && occ !== this) {
      this.blockedTime += dt;
      if (occ.owner === this.owner && occ.isIdle()) occ.nudge(game, this, null);
      if (this.blockedTime > 0.35 && !occ.moving && this.repathTimer <= 0) {
        this.avoidUnits = true;
        this.path = null;
      }
      return NAV.BLOCKED;
    }

    this.blockedTime = 0;
    this.startStep(game, next.x, next.y);
    this.advanceStep(game, 0);
    return NAV.MOVING;
  }

  startStep(game, nx, ny) {
    this.fromX = this.tx;
    this.fromY = this.ty;
    this.toX = nx;
    this.toY = ny;
    game.occupy(this, nx, ny);
    this.moving = true;
    this.dirX = nx - this.tx;
    this.dirY = ny - this.ty;
    if (this.dirX !== 0) this.facing = this.dirX > 0 ? 1 : -1;
    this.stepLen = this.dirX !== 0 && this.dirY !== 0 ? Math.SQRT2 : 1;
    this.stepProgress = this.leftover / this.stepLen;
    this.leftover = 0;
    this.pathIndex++;
  }

  advanceStep(game, dt) {
    const speed = this.def.speed;
    this.stepProgress += (speed * dt) / this.stepLen;
    this.walkAnim += dt * speed;
    if (this.stepProgress >= 1) {
      this.leftover = Math.min(0.5, (this.stepProgress - 1) * this.stepLen);
      game.release(this, this.fromX, this.fromY);
      this.tx = this.toX;
      this.ty = this.toY;
      this.x = (this.tx + 0.5) * TILE;
      this.y = (this.ty + 0.5) * TILE;
      this.moving = false;
    } else {
      const p = this.stepProgress;
      this.x = (this.fromX + (this.toX - this.fromX) * p + 0.5) * TILE;
      this.y = (this.fromY + (this.toY - this.fromY) * p + 0.5) * TILE;
    }
  }

  // An idle friendly unit is asked to step aside so another can pass.
  nudge(game, requester, avoidRect) {
    if (!this.isIdle() || this.nudgeCooldown > 0) return;
    this.nudgeCooldown = 0.8;
    const blocked = new Set();
    if (requester && requester.path) {
      for (let i = requester.pathIndex; i < Math.min(requester.path.length, requester.pathIndex + 4); i++) {
        blocked.add(requester.path[i].y * game.map.w + requester.path[i].x);
      }
    }
    let best = null;
    let bestScore = -Infinity;
    for (let r = 1; r <= 3 && !best; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = this.tx + dx;
          const ny = this.ty + dy;
          if (!game.isPassable(nx, ny) || game.unitAt(nx, ny)) continue;
          if (blocked.has(ny * game.map.w + nx)) continue;
          if (avoidRect && rectDist(nx, ny, avoidRect) === 0) continue;
          let score = game.rng();
          if (requester) score += Math.hypot(nx - requester.tx, ny - requester.ty);
          if (score > bestScore) {
            bestScore = score;
            best = { x: nx, y: ny };
          }
        }
      }
    }
    if (best) this.setOrder(game, { type: 'move', x: best.x, y: best.y });
  }

  faceTowards(t) {
    const c = t.kind === 'building' ? { x: t.x + t.size / 2 - 0.5, y: t.y + t.size / 2 - 0.5 } : { x: t.tx, y: t.ty };
    this.faceTile(c.x, c.y);
  }

  faceTile(x, y) {
    const dx = x - this.tx;
    const dy = y - this.ty;
    if (dx !== 0) this.facing = dx > 0 ? 1 : -1;
    this.dirX = Math.sign(dx);
    this.dirY = Math.sign(dy);
  }
}
