// Core simulation. Has no DOM dependencies so it runs headless in tests.

import {
  T,
  MAP_SIZE,
  UNITS,
  BUILDINGS,
  RESEARCH,
  DIFFICULTY,
  MINE_GOLD,
  MAX_FOOD,
  MAX_QUEUE,
  PLAYER,
  ENEMY,
  NEUTRAL,
  START_RESOURCES,
  TILE,
} from './config.js';
import { mulberry32, rectDist, rectRectDist } from './util.js';
import { generateMap } from './map.js';
import { PathFinder } from './pathfinding.js';
import { Unit } from './unit.js';
import { Building } from './building.js';
import { Fog } from './fog.js';
import { AIController } from './ai.js';

class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.gold = START_RESOURCES.gold;
    this.wood = START_RESOURCES.wood;
    this.food = 0;
    this.foodCap = 0;
    this.unitCount = 0;
    this.buildingCount = 0;
    this.upgrades = { weapons: 0, armor: 0 };
    this.researching = {};
    this.lastAlert = -100;
    this.lastHit = null;
    this.stats = {
      goldMined: 0,
      woodHarvested: 0,
      unitsTrained: 0,
      unitsLost: 0,
      kills: 0,
      buildingsBuilt: 0,
      buildingsLost: 0,
      razed: 0,
    };
  }
}

export class Game {
  constructor(opts = {}) {
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.difficulty = opts.difficulty || 'normal';
    this.rng = mulberry32(this.seed);
    const gen = generateMap(this.rng, opts.mapSize || MAP_SIZE);
    this.map = gen.map;
    this.starts = gen.starts;
    const n = this.map.w * this.map.h;

    this.time = 0;
    this.tick = 0;
    this.units = [];
    this.buildings = [];
    this.entities = new Map();
    this.nextId = 1;
    this.unitGrid = new Int32Array(n);
    this.buildingGrid = new Int32Array(n);
    this.pathfinder = new PathFinder(this.map.w, this.map.h);
    this.projectiles = [];
    this.effects = [];
    this.events = [];
    this.players = [new Player(PLAYER, 'You'), new Player(ENEMY, 'Enemy')];
    this.fog = new Fog(this.map.w, this.map.h);
    this.winner = null;
    this.needsCleanup = false;
    this.revealMap = !!opts.revealMap;

    for (const m of gen.mines) {
      const mine = this.addBuilding('goldmine', NEUTRAL, m.x, m.y);
      mine.gold = MINE_GOLD;
    }
    for (const owner of [PLAYER, ENEMY]) {
      const s = gen.starts[owner];
      const hall = this.addBuilding('townhall', owner, s.x, s.y);
      const mine = this.nearestMine(s.x + 2, s.y + 2, 20);
      const toward = mine ? this.centerTile(mine) : { x: s.x + 2, y: s.y + 6 };
      for (let i = 0; i < 3; i++) {
        const spot = this.findFreeTileAround(hall.rect(), toward.x, toward.y, 4);
        if (spot) this.addUnit('peasant', owner, spot.x, spot.y);
      }
    }

    this.ai = opts.ai === false ? [] : [new AIController(this, ENEMY, this.difficulty)];
    if (opts.playerAI) this.ai.push(new AIController(this, PLAYER, opts.playerAI));
    this.updatePlayers();
    this.updateFog();
  }

  updateFog() {
    if (this.revealMap) this.fog.revealAll();
    else this.fog.update(this, PLAYER);
  }

  // ---- entity bookkeeping ---------------------------------------------

  get(id) {
    return id ? this.entities.get(id) : undefined;
  }

  addUnit(type, owner, x, y) {
    const u = new Unit(this.nextId++, type, owner, x, y);
    this.units.push(u);
    this.entities.set(u.id, u);
    this.occupy(u, x, y);
    return u;
  }

  addBuilding(type, owner, x, y) {
    const b = new Building(this.nextId++, type, owner, x, y);
    this.buildings.push(b);
    this.entities.set(b.id, b);
    for (let ty = y; ty < y + b.size; ty++) {
      for (let tx = x; tx < x + b.size; tx++) this.buildingGrid[ty * this.map.w + tx] = b.id;
    }
    return b;
  }

  occupy(u, x, y) {
    this.unitGrid[y * this.map.w + x] = u.id;
  }

  release(u, x, y) {
    const i = y * this.map.w + x;
    if (this.unitGrid[i] === u.id) this.unitGrid[i] = 0;
  }

  unitAt(x, y) {
    if (!this.map.inBounds(x, y)) return null;
    const id = this.unitGrid[y * this.map.w + x];
    return id ? this.entities.get(id) || null : null;
  }

  buildingAt(x, y) {
    if (!this.map.inBounds(x, y)) return null;
    const id = this.buildingGrid[y * this.map.w + x];
    return id ? this.entities.get(id) || null : null;
  }

  isPassable(x, y) {
    return this.map.isWalkable(x, y) && this.buildingGrid[y * this.map.w + x] === 0;
  }

  centerTile(e) {
    if (e.kind === 'building') return { x: e.x + Math.floor(e.size / 2), y: e.y + Math.floor(e.size / 2) };
    return { x: e.tx, y: e.ty };
  }

  isHostile(a, b) {
    return a.owner !== b.owner && a.owner >= 0 && b.owner >= 0;
  }

  // ---- queries ------------------------------------------------------------

  findPath(unit, rect, range, avoidUnits) {
    const w = this.map.w;
    let passable;
    if (avoidUnits) {
      passable = (x, y) => {
        if (!this.isPassable(x, y)) return false;
        const id = this.unitGrid[y * w + x];
        if (id && id !== unit.id) {
          const d = Math.max(Math.abs(x - unit.tx), Math.abs(y - unit.ty));
          if (d <= 5) {
            const o = this.entities.get(id);
            if (o && (!o.moving || d <= 1)) return false;
          }
        }
        return true;
      };
    } else {
      passable = (x, y) => this.isPassable(x, y);
    }
    return this.pathfinder.find(unit.tx, unit.ty, rect, range, passable);
  }

  findFreeTileAround(rect, prefX, prefY, maxRing = 6) {
    for (let r = rect.w === 1 && rect.h === 1 ? 0 : 1; r <= maxRing; r++) {
      let best = null;
      let bestD = Infinity;
      for (let y = rect.y - r; y < rect.y + rect.h + r; y++) {
        for (let x = rect.x - r; x < rect.x + rect.w + r; x++) {
          if (rectDist(x, y, rect) !== r) continue;
          if (!this.isPassable(x, y) || this.unitGrid[y * this.map.w + x]) continue;
          const d = (x - prefX) ** 2 + (y - prefY) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x, y };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // Finds the most attractive hostile target within `radius` tiles.
  findTarget(src, radius) {
    const sr = src.rect();
    let best = null;
    let bestScore = Infinity;
    for (const u of this.units) {
      if (u.dead || u.hidden || !this.isHostile(src, u)) continue;
      const d = rectRectDist(sr, u.rect());
      if (d > radius) continue;
      const score = d + (u.isWorker ? 3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    for (const b of this.buildings) {
      if (b.dead || !this.isHostile(src, b)) continue;
      const d = rectRectDist(sr, b.rect());
      if (d > radius) continue;
      const score = d + (b.canAttack() ? 2 : 6);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  nearestDepot(owner, res, x, y) {
    let best = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== owner || b.constructing || !b.def.depot || !b.def.depot.includes(res)) continue;
      const d = rectDist(x, y, b.rect());
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  nearestMine(x, y, maxDist = Infinity) {
    let best = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.type !== 'goldmine' || b.gold <= 0) continue;
      const d = rectDist(x, y, b.rect());
      if (d < bestD && d <= maxDist) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  hasStandingSpot(x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && this.isPassable(x + dx, y + dy)) return true;
      }
    }
    return false;
  }

  findTreeNear(cx, cy, unit, bad = null, avoid = null, maxR = 14) {
    const ux = unit ? unit.tx : cx;
    const uy = unit ? unit.ty : cy;
    let best = null;
    let bestScore = Infinity;
    for (let y = cy - maxR; y <= cy + maxR; y++) {
      for (let x = cx - maxR; x <= cx + maxR; x++) {
        if (!this.map.isTree(x, y)) continue;
        const i = y * this.map.w + x;
        if (bad && bad.has(i)) continue;
        if (!this.hasStandingSpot(x, y)) continue;
        const score = Math.hypot(x - cx, y - cy) + 0.6 * Math.hypot(x - ux, y - uy) + (avoid && avoid.has(i) ? 3 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  }

  requirementsMet(owner, reqs) {
    if (!reqs) return true;
    return reqs.every((r) => this.buildings.some((b) => !b.dead && b.owner === owner && b.type === r && !b.constructing));
  }

  missingRequirements(owner, reqs) {
    if (!reqs) return [];
    return reqs.filter((r) => !this.buildings.some((b) => !b.dead && b.owner === owner && b.type === r && !b.constructing));
  }

  canAfford(owner, cost) {
    const p = this.players[owner];
    return p.gold >= (cost.gold || 0) && p.wood >= (cost.wood || 0);
  }

  affordMessage(owner, cost) {
    const p = this.players[owner];
    if (p.gold < (cost.gold || 0)) return 'Not enough gold.';
    if (p.wood < (cost.wood || 0)) return 'Not enough lumber.';
    return '';
  }

  spend(owner, cost) {
    const p = this.players[owner];
    p.gold -= cost.gold || 0;
    p.wood -= cost.wood || 0;
  }

  refund(owner, cost, fraction = 1) {
    const p = this.players[owner];
    p.gold += Math.floor((cost.gold || 0) * fraction);
    p.wood += Math.floor((cost.wood || 0) * fraction);
  }

  addResource(owner, type, amount) {
    const p = this.players[owner];
    if (type === 'gold') {
      p.gold += amount;
      p.stats.goldMined += amount;
    } else {
      p.wood += amount;
      p.stats.woodHarvested += amount;
    }
  }

  gatherBonus(owner) {
    return owner === ENEMY ? DIFFICULTY[this.difficulty].gatherBonus : 1;
  }

  canPlace(type, owner, x, y, ignoreUnit = null) {
    const def = BUILDINGS[type];
    const s = def.size;
    const { w, h } = this.map;
    if (x < 0 || y < 0 || x + s > w || y + s > h) return { ok: false, reason: 'bounds', message: "Can't build there." };
    const units = [];
    for (let ty = y; ty < y + s; ty++) {
      for (let tx = x; tx < x + s; tx++) {
        if (owner === PLAYER && !this.fog.isExplored(tx, ty)) {
          return { ok: false, reason: 'fog', message: 'You must explore that area first.' };
        }
        if (!this.map.isBuildable(tx, ty) || this.buildingGrid[ty * w + tx]) {
          return { ok: false, reason: 'blocked', message: "Can't build there." };
        }
        const u = this.unitAt(tx, ty);
        if (u && u !== ignoreUnit && !units.includes(u)) units.push(u);
      }
    }
    if (type === 'townhall') {
      const rect = { x, y, w: s, h: s };
      for (const b of this.buildings) {
        if (!b.dead && b.type === 'goldmine' && rectRectDist(rect, b.rect()) < 3) {
          return { ok: false, reason: 'mine', message: 'Too close to a gold mine.' };
        }
      }
    }
    if (units.length) return { ok: false, reason: 'units', units, message: 'Something is in the way.' };
    return { ok: true };
  }

  // ---- unit/building lifecycle -----------------------------------------

  enterBuilding(u, b) {
    this.release(u, u.tx, u.ty);
    u.hidden = true;
    u.inside = b.id;
    u.path = null;
  }

  ejectUnit(u, prefX, prefY) {
    if (!u.hidden) return true;
    const host = this.get(u.inside);
    const rect = host ? host.rect() : { x: u.tx, y: u.ty, w: 1, h: 1 };
    const spot = this.findFreeTileAround(rect, prefX, prefY, 8);
    if (!spot) return false;
    u.hidden = false;
    u.inside = 0;
    u.tx = spot.x;
    u.ty = spot.y;
    u.x = (spot.x + 0.5) * TILE;
    u.y = (spot.y + 0.5) * TILE;
    u.moving = false;
    u.faceTile(prefX, prefY);
    this.occupy(u, spot.x, spot.y);
    return true;
  }

  startConstruction(builder, type, x, y) {
    const b = this.addBuilding(type, builder.owner, x, y);
    b.constructing = true;
    b.progress = 0;
    b.hp = Math.max(1, Math.round(b.maxHp * 0.1));
    b.builder = builder.id;
    this.enterBuilding(builder, b);
    builder.order = { type: 'construct', building: b.id };
    builder.resetNav();
    this.emit({ type: 'sound', name: 'build', x: b.px, y: b.py, owner: b.owner });
    return b;
  }

  completeConstruction(b) {
    b.constructing = false;
    b.progress = 1;
    b.hp = Math.max(b.hp, Math.round(b.maxHp * 0.98));
    if (b.hp > b.maxHp) b.hp = b.maxHp;
    this.players[b.owner].stats.buildingsBuilt++;
    const u = this.get(b.builder);
    if (u && u.hidden && u.inside === b.id) {
      const c = this.centerTile(b);
      if (this.ejectUnit(u, c.x, b.y + b.size)) u.finishOrder();
    }
    this.emit({ type: 'sound', name: 'complete', x: b.px, y: b.py, owner: b.owner });
    this.message(b.owner, `${b.def.name} complete.`);
    this.addEffect({ type: 'dust', x: b.px, y: b.py, size: b.size, life: 0.8 });
  }

  cancelConstruction(b) {
    if (!b.constructing || b.dead) return;
    this.refund(b.owner, b.def.cost, 0.75);
    this.removeBuilding(b);
    this.addEffect({ type: 'dust', x: b.px, y: b.py, size: b.size, life: 0.8 });
  }

  removeBuilding(b) {
    b.dead = true;
    for (let ty = b.y; ty < b.y + b.size; ty++) {
      for (let tx = b.x; tx < b.x + b.size; tx++) {
        const i = ty * this.map.w + tx;
        if (this.buildingGrid[i] === b.id) this.buildingGrid[i] = 0;
      }
    }
    if (b.owner >= 0) {
      for (const item of b.queue) if (item.kind === 'research') this.players[b.owner].researching[item.type] = false;
    }
    b.queue.length = 0;
    this.needsCleanup = true;
  }

  kill(e, killerOwner = null) {
    if (e.dead) return;
    if (e.kind === 'unit') {
      e.dead = true;
      e.hp = 0;
      this.release(e, e.tx, e.ty);
      if (e.moving) {
        this.release(e, e.fromX, e.fromY);
        this.release(e, e.toX, e.toY);
      }
      this.needsCleanup = true;
      this.addEffect({ type: 'corpse', x: e.x, y: e.y, unitType: e.type, owner: e.owner, facing: e.facing, life: 18 });
      this.emit({ type: 'sound', name: 'death', x: e.x, y: e.y, owner: e.owner });
      if (e.owner >= 0) this.players[e.owner].stats.unitsLost++;
      if (killerOwner !== null && killerOwner >= 0) this.players[killerOwner].stats.kills++;
      return;
    }
    // Buildings.
    this.removeBuilding(e);
    e.hp = 0;
    if (e.type === 'goldmine') {
      this.addEffect({ type: 'rubble', x: e.px, y: e.py, size: e.size, life: 60 });
      if (e.seen) this.message(PLAYER, 'A gold mine has collapsed.');
      return;
    }
    this.addEffect({ type: 'explosion', x: e.px, y: e.py, size: e.size, life: 1.2 });
    this.addEffect({ type: 'rubble', x: e.px, y: e.py, size: e.size, life: 60 });
    this.emit({ type: 'sound', name: 'collapse', x: e.px, y: e.py, owner: e.owner });
    this.players[e.owner].stats.buildingsLost++;
    if (killerOwner !== null && killerOwner >= 0) this.players[killerOwner].stats.razed++;
  }

  harvestTree(x, y, amount) {
    if (!this.map.isTree(x, y)) return 0;
    const i = y * this.map.w + x;
    const take = Math.min(amount, this.map.wood[i]);
    this.map.wood[i] -= take;
    if (this.map.wood[i] <= 0) {
      this.map.set(x, y, T.STUMP);
      this.emit({ type: 'sound', name: 'treefall', x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
    }
    return take;
  }

  mineGold(mine, amount) {
    const take = Math.min(amount, mine.gold);
    mine.gold -= take;
    if (mine.gold <= 0) this.kill(mine);
    return take;
  }

  spawnTrained(b, type) {
    let prefX = b.x + Math.floor(b.size / 2);
    let prefY = b.y + b.size;
    if (b.rally) {
      prefX = b.rally.x;
      prefY = b.rally.y;
    }
    const spot = this.findFreeTileAround(b.rect(), prefX, prefY, 3);
    if (!spot) return false;
    const u = this.addUnit(type, b.owner, spot.x, spot.y);
    this.players[b.owner].stats.unitsTrained++;
    if (b.rally) {
      const target = b.rally.entity ? this.get(b.rally.entity) : null;
      if (target && !target.dead) {
        const c = this.centerTile(target);
        this.commandSmart([u], c.x, c.y, target);
      } else {
        this.commandSmart([u], b.rally.x, b.rally.y, null);
      }
    }
    this.emit({ type: 'sound', name: 'ready', x: u.x, y: u.y, owner: u.owner });
    return true;
  }

  completeResearch(owner, type) {
    const p = this.players[owner];
    p.upgrades[type]++;
    p.researching[type] = false;
    this.message(owner, `${RESEARCH[type].name} ${p.upgrades[type]} researched.`);
    this.emit({ type: 'sound', name: 'complete', owner });
  }

  // ---- combat --------------------------------------------------------------

  attackStats(src) {
    if (src.kind === 'building') return { damage: src.def.attack.damage, pierce: src.def.attack.pierce };
    const bonus = src.isMilitary ? 2 * this.players[src.owner].upgrades.weapons : 0;
    return { damage: src.def.damage + bonus, pierce: src.def.pierce };
  }

  armorOf(t) {
    if (t.kind === 'building') return t.def.armor;
    const bonus = t.isMilitary && t.owner >= 0 ? 2 * this.players[t.owner].upgrades.armor : 0;
    return t.def.armor + bonus;
  }

  dealDamage(attacker, target) {
    this.applyHit(target, this.attackStats(attacker), attacker.id, attacker.owner);
    this.emit({ type: 'sound', name: target.kind === 'building' ? 'hitBuilding' : 'hit', x: target.x, y: target.y, owner: attacker.owner });
  }

  applyHit(target, stats, attackerId, attackerOwner) {
    if (target.dead) return;
    const base = Math.max(0, stats.damage - this.armorOf(target)) + stats.pierce;
    const dmg = Math.max(1, Math.round(base * (0.5 + this.rng() * 0.5)));
    target.hp -= dmg;
    target.flash = 0.12;
    const px = target.kind === 'building' ? target.px : target.x;
    const py = target.kind === 'building' ? target.py : target.y;
    this.addEffect({ type: 'hit', x: px + (this.rng() - 0.5) * 10, y: py + (this.rng() - 0.5) * 10, life: 0.3 });

    if (target.owner >= 0) {
      const p = this.players[target.owner];
      const c = this.centerTile(target);
      p.lastHit = { time: this.time, x: c.x, y: c.y };
      if (this.time - p.lastAlert > 15) {
        p.lastAlert = this.time;
        this.emit({ type: 'alert', owner: target.owner, x: px, y: py });
        this.message(target.owner, target.kind === 'building' ? 'Your base is under attack!' : 'Your forces are under attack!');
      }
    }

    if (target.hp <= 0) {
      this.kill(target, attackerOwner);
      return;
    }
    if (target.kind === 'unit' && !target.order && target.canAttack()) {
      const a = this.get(attackerId);
      if (a && !a.dead && !a.hidden && this.isHostile(target, a)) {
        const c = this.centerTile(target);
        target.setOrder(this, { type: 'attack', target: a.id, leash: { x: c.x, y: c.y, d: 12 } });
      }
    }
  }

  spawnProjectile(src, target, kind) {
    const sx = src.kind === 'building' ? src.px : src.x;
    const sy = src.kind === 'building' ? src.py - 20 : src.y - 6;
    this.projectiles.push({
      kind,
      x: sx,
      y: sy,
      angle: 0,
      target: target.id,
      tx: target.kind === 'building' ? target.px : target.x,
      ty: target.kind === 'building' ? target.py : target.y,
      speed: kind === 'arrow' ? 430 : 380,
      stats: this.attackStats(src),
      owner: src.owner,
      src: src.id,
      dead: false,
    });
    this.emit({ type: 'sound', name: kind === 'arrow' ? 'bow' : 'bolt', x: sx, y: sy, owner: src.owner });
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      const t = this.get(p.target);
      const alive = t && !t.dead && !t.hidden;
      if (alive) {
        p.tx = t.kind === 'building' ? t.px : t.x;
        p.ty = t.kind === 'building' ? t.py : t.y;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const step = p.speed * dt;
      p.angle = Math.atan2(dy, dx);
      if (dist <= step) {
        p.dead = true;
        if (alive) this.applyHit(t, p.stats, p.src, p.owner);
      } else {
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
      }
    }
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  addEffect(e) {
    e.t = 0;
    this.effects.push(e);
  }

  updateEffects(dt) {
    let any = false;
    for (const e of this.effects) {
      e.t += dt;
      if (e.t >= e.life) any = true;
    }
    if (any) this.effects = this.effects.filter((e) => e.t < e.life);
  }

  // ---- commands (shared by the player's input and the AI) -----------------

  ownUnits(units, owner) {
    return units.filter((u) => u && !u.dead && !u.hidden && u.kind === 'unit' && u.owner === owner);
  }

  formationTiles(x, y, n, group) {
    const w = this.map.w;
    const groupIds = new Set(group.map((u) => u.id));
    let start = null;
    for (let r = 0; r <= 6 && !start; r++) {
      let bestD = Infinity;
      for (let ty = y - r; ty <= y + r; ty++) {
        for (let tx = x - r; tx <= x + r; tx++) {
          if (Math.max(Math.abs(tx - x), Math.abs(ty - y)) !== r || !this.isPassable(tx, ty)) continue;
          const d = (tx - x) ** 2 + (ty - y) ** 2;
          if (d < bestD) {
            bestD = d;
            start = { x: tx, y: ty };
          }
        }
      }
    }
    if (!start) return [];
    const tiles = [];
    const seen = new Set([start.y * w + start.x]);
    const queue = [start];
    for (let qi = 0; qi < queue.length && tiles.length < n && qi < 600; qi++) {
      const c = queue[qi];
      const occ = this.unitAt(c.x, c.y);
      if (!occ || groupIds.has(occ.id) || occ.moving) tiles.push(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        const i = ny * w + nx;
        if (seen.has(i) || !this.isPassable(nx, ny)) continue;
        seen.add(i);
        queue.push({ x: nx, y: ny });
      }
    }
    return tiles;
  }

  commandMove(units, x, y, attackMove = false) {
    if (!units.length) return;
    const make = (tx, ty) => (attackMove ? { type: 'attackMove', x: tx, y: ty } : { type: 'move', x: tx, y: ty });
    if (units.length === 1) {
      units[0].setOrder(this, make(x, y));
      return;
    }
    const tiles = this.formationTiles(x, y, units.length, units);
    const remaining = [...units];
    for (const t of tiles) {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = (remaining[i].tx - t.x) ** 2 + (remaining[i].ty - t.y) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      remaining.splice(bi, 1)[0].setOrder(this, make(t.x, t.y));
    }
    for (const u of remaining) u.setOrder(this, make(x, y));
  }

  commandAttack(units, target) {
    for (const u of units) {
      if (u.canAttack()) u.setOrder(this, { type: 'attack', target: target.id });
      else u.setOrder(this, { type: 'move', target: target.id, range: 1 });
    }
  }

  commandStop(units) {
    for (const u of units) u.setOrder(this, null);
  }

  commandHold(units) {
    for (const u of units) u.setOrder(this, { type: 'hold', target: 0 });
  }

  commandHarvestGold(workers, mine) {
    for (const u of workers) u.setOrder(this, { type: 'harvest', res: 'gold', mine: mine.id, phase: 'toResource' });
  }

  commandHarvestWood(workers, x, y) {
    const taken = new Set();
    for (const u of workers) {
      const tree = this.findTreeNear(x, y, u, null, taken, 10);
      if (!tree) continue;
      taken.add(tree.y * this.map.w + tree.x);
      u.setOrder(this, { type: 'harvest', res: 'wood', tx: tree.x, ty: tree.y, phase: 'toResource' });
    }
  }

  commandReturn(workers) {
    for (const u of workers) {
      if (!u.carry) continue;
      const last = u.lastHarvest || {};
      u.setOrder(this, { type: 'harvest', res: last.res, mine: last.mine, tx: last.tx, ty: last.ty, phase: 'toDepot' });
    }
  }

  // Right-click behaviour: decide what to do from what was clicked.
  commandSmart(units, x, y, target) {
    if (!units.length) return null;
    const owner = units[0].owner;
    const workers = units.filter((u) => u.isWorker);
    const others = units.filter((u) => !u.isWorker);
    if (target && !target.dead) {
      if (this.isHostile(units[0], target)) {
        this.commandAttack(units, target);
        return 'attack';
      }
      if (target.type === 'goldmine') {
        this.commandHarvestGold(workers, target);
        this.commandMove(others, x, y);
        return workers.length ? 'harvest' : 'move';
      }
      if (target.kind === 'building' && target.owner === owner && target.def.depot && !target.constructing) {
        const carriers = workers.filter((u) => u.carry && target.def.depot.includes(u.carry.type));
        for (const u of carriers) {
          const last = u.lastHarvest || {};
          u.setOrder(this, { type: 'harvest', res: last.res, mine: last.mine, tx: last.tx, ty: last.ty, phase: 'toDepot' });
        }
        const rest = units.filter((u) => !carriers.includes(u));
        for (const u of rest) u.setOrder(this, { type: 'move', target: target.id, range: 1 });
        return carriers.length ? 'harvest' : 'move';
      }
      for (const u of units) if (u !== target) u.setOrder(this, { type: 'move', target: target.id, range: 1 });
      return 'move';
    }
    if (this.map.isTree(x, y) && workers.length) {
      this.commandHarvestWood(workers, x, y);
      this.commandMove(others, x, y);
      return 'harvest';
    }
    this.commandMove(units, x, y);
    return 'move';
  }

  commandBuild(unit, type, x, y) {
    const def = BUILDINGS[type];
    const owner = unit.owner;
    if (!unit.isWorker || !def || def.neutral) return false;
    const missing = this.missingRequirements(owner, def.requires);
    if (missing.length) {
      this.message(owner, `Requires: ${missing.map((m) => BUILDINGS[m].name).join(', ')}.`);
      return false;
    }
    if (!this.canAfford(owner, def.cost)) {
      this.message(owner, this.affordMessage(owner, def.cost));
      return false;
    }
    const check = this.canPlace(type, owner, x, y, unit);
    if (!check.ok && check.reason !== 'units') {
      this.message(owner, check.message);
      return false;
    }
    this.spend(owner, def.cost);
    unit.setOrder(this, { type: 'build', btype: type, x, y, paid: true });
    return true;
  }

  train(b, type) {
    const owner = b.owner;
    const def = UNITS[type];
    if (b.dead || b.constructing || !def || !b.def.trains || !b.def.trains.includes(type)) return false;
    const missing = this.missingRequirements(owner, def.requires);
    if (missing.length) {
      this.message(owner, `Requires: ${missing.map((m) => BUILDINGS[m].name).join(', ')}.`);
      return false;
    }
    if (b.queue.length >= MAX_QUEUE) {
      this.message(owner, 'The training queue is full.');
      return false;
    }
    const p = this.players[owner];
    if (p.food + def.food > p.foodCap) {
      this.message(owner, p.foodCap >= MAX_FOOD ? 'Food limit reached.' : 'Not enough food. Build more Farms.');
      return false;
    }
    if (!this.canAfford(owner, def.cost)) {
      this.message(owner, this.affordMessage(owner, def.cost));
      return false;
    }
    this.spend(owner, def.cost);
    b.queue.push({ kind: 'unit', type, time: def.time, elapsed: 0 });
    p.food += def.food;
    return true;
  }

  research(b, type) {
    const owner = b.owner;
    const def = RESEARCH[type];
    if (b.dead || b.constructing || !def || !b.def.research || !b.def.research.includes(type)) return false;
    const p = this.players[owner];
    const level = p.upgrades[type];
    if (p.researching[type]) {
      this.message(owner, 'Already being researched.');
      return false;
    }
    if (level >= def.levels.length) {
      this.message(owner, 'Already fully upgraded.');
      return false;
    }
    if (b.queue.length >= MAX_QUEUE) {
      this.message(owner, 'The queue is full.');
      return false;
    }
    const cost = def.levels[level];
    if (!this.canAfford(owner, cost)) {
      this.message(owner, this.affordMessage(owner, cost));
      return false;
    }
    this.spend(owner, cost);
    b.queue.push({ kind: 'research', type, time: cost.time, elapsed: 0, cost });
    p.researching[type] = true;
    return true;
  }

  cancelQueueItem(b, index = b.queue.length - 1) {
    if (index < 0 || index >= b.queue.length) return;
    const [item] = b.queue.splice(index, 1);
    if (item.kind === 'unit') {
      this.refund(b.owner, UNITS[item.type].cost);
    } else {
      this.refund(b.owner, item.cost);
      this.players[b.owner].researching[item.type] = false;
    }
    this.updatePlayers();
  }

  setRally(b, x, y, target) {
    b.rally = { x, y, entity: target && target !== b ? target.id : 0 };
  }

  // ---- main loop -------------------------------------------------------------

  emit(e) {
    this.events.push(e);
  }

  message(owner, text) {
    if (owner === PLAYER && text) this.emit({ type: 'message', text });
  }

  updatePlayers() {
    for (const p of this.players) {
      p.food = 0;
      p.foodCap = 0;
      p.unitCount = 0;
      p.buildingCount = 0;
    }
    for (const u of this.units) {
      if (u.dead || u.owner < 0) continue;
      const p = this.players[u.owner];
      p.food += u.def.food;
      p.unitCount++;
    }
    for (const b of this.buildings) {
      if (b.dead || b.owner < 0) continue;
      const p = this.players[b.owner];
      p.buildingCount++;
      if (!b.constructing && b.def.food) p.foodCap += b.def.food;
      for (const q of b.queue) if (q.kind === 'unit') p.food += UNITS[q.type].food;
    }
    for (const p of this.players) p.foodCap = Math.min(MAX_FOOD, p.foodCap);
  }

  cleanup() {
    if (!this.needsCleanup) return;
    this.needsCleanup = false;
    for (const u of this.units) if (u.dead) this.entities.delete(u.id);
    for (const b of this.buildings) if (b.dead) this.entities.delete(b.id);
    this.units = this.units.filter((u) => !u.dead);
    this.buildings = this.buildings.filter((b) => !b.dead);
  }

  checkVictory() {
    if (this.winner !== null) return;
    const alive = [false, false];
    for (const u of this.units) if (!u.dead && u.owner >= 0) alive[u.owner] = true;
    for (const b of this.buildings) if (!b.dead && b.owner >= 0) alive[b.owner] = true;
    if (!alive[PLAYER]) this.winner = ENEMY;
    else if (!alive[ENEMY]) this.winner = PLAYER;
    if (this.winner !== null) this.emit({ type: 'gameOver', winner: this.winner });
  }

  // A player with no buildings left has nowhere to hide: their units are revealed.
  isExposed(owner) {
    return owner >= 0 && this.players[owner].buildingCount === 0;
  }

  update(dt) {
    this.time += dt;
    this.tick++;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.dead) u.update(this, dt);
    }
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (!b.dead) b.update(this, dt);
    }
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.cleanup();
    this.updatePlayers();
    for (const ai of this.ai) ai.update(dt);
    if (this.tick % 12 === 0) this.updateFog();
    if (this.tick % 30 === 0) this.checkVictory();
  }
}
