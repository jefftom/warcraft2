// Computer opponent: runs an economy, follows a loose build order, trains an
// army, defends its base and sends growing attack waves at the enemy.

import { BUILDINGS, DIFFICULTY, MAX_FOOD, RESEARCH } from './config.js';
import { rectDist, rectRectDist } from './util.js';

export class AIController {
  constructor(game, owner, difficulty) {
    this.game = game;
    this.owner = owner;
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.timer = 1;
    this.wave = 0;
    this.attacking = false;
    this.waveIds = new Set();
    this.nextAttackTime = this.cfg.firstWave;
    this.saving = false;
    const s = game.starts[owner];
    this.home = { x: s.x + 2, y: s.y + 2 };
    const c = { x: game.map.w / 2, y: game.map.h / 2 };
    const dx = c.x - this.home.x;
    const dy = c.y - this.home.y;
    const len = Math.hypot(dx, dy) || 1;
    this.rally = { x: Math.round(this.home.x + (dx / len) * 8), y: Math.round(this.home.y + (dy / len) * 8) };
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.cfg.think;
    if (this.game.winner !== null) return;
    this.think();
  }

  think() {
    const g = this.game;
    const owner = this.owner;
    const units = g.units.filter((u) => !u.dead && u.owner === owner);
    const workers = units.filter((u) => u.isWorker);
    const army = units.filter((u) => !u.isWorker);
    const buildings = g.buildings.filter((b) => !b.dead && b.owner === owner);
    const halls = buildings.filter((b) => b.type === 'townhall' && !b.constructing);
    if (halls.length) this.home = g.centerTile(halls[0]);
    const ctx = { units, workers, army, buildings, halls };

    this.manageConstruction(ctx);
    this.manageWorkers(ctx);
    this.manageProduction(ctx);
    this.manageResearch(ctx);
    this.manageArmy(ctx);
  }

  count(ctx, type, completeOnly = false) {
    return ctx.buildings.filter((b) => b.type === type && (!completeOnly || !b.constructing)).length;
  }

  pendingBuilds(ctx, type) {
    return ctx.workers.filter((u) => u.order && u.order.type === 'build' && (!type || u.order.btype === type)).length;
  }

  // ---- economy ----------------------------------------------------------

  manageWorkers(ctx) {
    const g = this.game;
    let gold = 0;
    let wood = 0;
    for (const u of ctx.workers) {
      const res = u.order && u.order.type === 'harvest' ? u.order.res : null;
      if (res === 'gold') gold++;
      else if (res === 'wood') wood++;
    }
    const p = g.players[this.owner];
    let woodShare = 0.35;
    if (p.wood > 500 && p.wood > p.gold * 2) woodShare = 0.15;
    else if (p.wood < 150) woodShare = 0.5;
    // Shift a lumberjack to the mine when lumber is piling up.
    if (woodShare < 0.2 && wood > 2) {
      const mine = this.pickMine(ctx);
      const jack = ctx.workers.find((u) => !u.hidden && !u.carry && u.order && u.order.type === 'harvest' && u.order.res === 'wood');
      if (mine && jack) {
        g.commandHarvestGold([jack], mine);
        wood--;
        gold++;
      }
    }
    for (const u of ctx.workers) {
      if (!u.isIdle()) continue;
      if (u.carry) {
        g.commandReturn([u]);
        continue;
      }
      const wantWood = wood < Math.ceil((gold + wood + 1) * woodShare);
      const mine = this.pickMine(ctx);
      if (!wantWood && mine) {
        g.commandHarvestGold([u], mine);
        gold++;
      } else {
        const tree = g.findTreeNear(this.home.x, this.home.y, u, null, null, 18);
        if (tree) {
          g.commandHarvestWood([u], tree.x, tree.y);
          wood++;
        } else if (mine) {
          g.commandHarvestGold([u], mine);
          gold++;
        }
      }
    }
  }

  pickMine(ctx) {
    const g = this.game;
    let best = null;
    let bestD = Infinity;
    for (const hall of ctx.halls) {
      const c = g.centerTile(hall);
      const m = g.nearestMine(c.x, c.y, 14);
      if (!m) continue;
      const d = rectRectDist(hall.rect(), m.rect());
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  manageProduction(ctx) {
    const g = this.game;
    const p = g.players[this.owner];
    const queuedWorkers = ctx.halls.reduce((n, h) => n + h.queue.filter((q) => q.type === 'peasant').length, 0);
    if (ctx.workers.length + queuedWorkers < this.cfg.workers) {
      const hall = ctx.halls.find((h) => h.queue.length === 0);
      if (hall) g.train(hall, 'peasant');
    }
    if (this.saving && !this.underThreat) return;
    for (const b of ctx.buildings) {
      if (b.type !== 'barracks' || b.constructing || b.queue.length > 0) continue;
      const type = this.pickUnitType(ctx);
      if (!g.train(b, type) && type !== 'footman') g.train(b, 'footman');
      if (p.food >= p.foodCap) break;
    }
  }

  pickUnitType(ctx) {
    const g = this.game;
    const counts = { footman: 0, archer: 0, knight: 0 };
    for (const u of ctx.army) counts[u.type] = (counts[u.type] || 0) + 1;
    const total = ctx.army.length + 1;
    const canArcher = g.requirementsMet(this.owner, ['lumbermill']);
    const canKnight = g.requirementsMet(this.owner, ['blacksmith']);
    if (canKnight && counts.knight / total < 0.25) return 'knight';
    if (canArcher && counts.archer / total < 0.35) return 'archer';
    return 'footman';
  }

  manageResearch(ctx) {
    const g = this.game;
    const p = g.players[this.owner];
    if (this.saving || p.gold < 600 || p.wood < 250) return;
    const smith = ctx.buildings.find((b) => b.type === 'blacksmith' && !b.constructing && b.queue.length === 0);
    if (!smith) return;
    for (const r of ['weapons', 'armor']) {
      if (p.upgrades[r] < RESEARCH[r].levels.length && !p.researching[r]) {
        if (g.research(smith, r)) return;
      }
    }
  }

  // ---- construction -----------------------------------------------------

  manageConstruction(ctx) {
    const g = this.game;
    this.saving = false;
    const constructing = ctx.buildings.filter((b) => b.constructing).length + this.pendingBuilds(ctx);
    if (constructing >= 2 || ctx.workers.length < 3) return;

    const want = this.nextBuilding(ctx);
    if (!want) return;
    const def = BUILDINGS[want.type];
    if (!g.canAfford(this.owner, def.cost)) {
      this.saving = want.priority;
      return;
    }
    const spot = this.findBuildSpot(want.type, want.near || this.home);
    if (!spot) return;
    const builder = this.pickBuilder(ctx, spot);
    if (!builder) return;
    g.commandBuild(builder, want.type, spot.x, spot.y);
  }

  nextBuilding(ctx) {
    const g = this.game;
    const p = g.players[this.owner];
    const t = g.time;
    const n = (type) => this.count(ctx, type) + this.pendingBuilds(ctx, type);
    const farmsInProgress = ctx.buildings.filter((b) => b.type === 'farm' && b.constructing).length + this.pendingBuilds(ctx, 'farm');
    const barracksCount = n('barracks');

    if (p.foodCap < MAX_FOOD && p.foodCap - p.food <= 2 + barracksCount && farmsInProgress === 0) {
      return { type: 'farm', priority: true };
    }
    if (barracksCount === 0 && ctx.workers.length >= 5) return { type: 'barracks', priority: true };
    if (n('lumbermill') === 0 && this.count(ctx, 'barracks') > 0) return { type: 'lumbermill', priority: true };
    if (n('blacksmith') === 0 && g.requirementsMet(this.owner, ['barracks']) && ctx.army.length >= 4) {
      return { type: 'blacksmith', priority: false };
    }
    const towers = this.cfg.label === 'Hard' ? 2 : this.cfg.label === 'Normal' ? 1 : 0;
    if (n('tower') < towers && t > 200 && g.requirementsMet(this.owner, ['lumbermill'])) {
      return { type: 'tower', priority: false, near: this.rally };
    }
    if (barracksCount < 2 && this.cfg.label !== 'Easy' && t > 280 && p.gold > 350) {
      return { type: 'barracks', priority: false };
    }
    // Expand once the home mine is running low.
    const mine = this.pickMine(ctx);
    if ((!mine || mine.gold < 2500) && n('townhall') < 2 && t > 300) {
      const next = this.findExpansionMine(ctx);
      if (next) return { type: 'townhall', priority: true, near: g.centerTile(next) };
    }
    return null;
  }

  findExpansionMine(ctx) {
    const g = this.game;
    let best = null;
    let bestD = Infinity;
    for (const b of g.buildings) {
      if (b.dead || b.type !== 'goldmine' || b.gold < 3000) continue;
      if (ctx.halls.some((h) => rectRectDist(h.rect(), b.rect()) < 10)) continue;
      const d = rectDist(this.home.x, this.home.y, b.rect());
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  findBuildSpot(type, near) {
    const g = this.game;
    const size = BUILDINGS[type].size;
    const mines = g.buildings.filter((b) => !b.dead && b.type === 'goldmine');
    const halls = g.buildings.filter((b) => !b.dead && b.owner === this.owner && b.type === 'townhall');
    // Keep the lanes between halls and their mines clear.
    const lanes = [];
    for (const h of halls) {
      for (const m of mines) {
        if (rectRectDist(h.rect(), m.rect()) > 8) continue;
        const x0 = Math.min(h.x, m.x) - 1;
        const y0 = Math.min(h.y, m.y) - 1;
        const x1 = Math.max(h.x + h.size, m.x + m.size);
        const y1 = Math.max(h.y + h.size, m.y + m.size);
        lanes.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      }
    }
    const minR = type === 'townhall' ? 3 : 2;
    for (let r = minR; r <= 16; r++) {
      const candidates = [];
      for (let y = near.y - r; y <= near.y + r; y++) {
        for (let x = near.x - r; x <= near.x + r; x++) {
          if (Math.max(Math.abs(x - near.x), Math.abs(y - near.y)) !== r) continue;
          candidates.push({ x: x - Math.floor(size / 2), y: y - Math.floor(size / 2) });
        }
      }
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(g.rng() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      for (const c of candidates) {
        const rect = { x: c.x, y: c.y, w: size, h: size };
        const check = g.canPlace(type, this.owner, c.x, c.y);
        if (!check.ok && check.reason !== 'units') continue;
        if (type !== 'townhall' && lanes.some((l) => rectRectDist(l, rect) === 0)) continue;
        if (type !== 'townhall' && mines.some((m) => rectRectDist(m.rect(), rect) < 3)) continue;
        if (!this.hasMargin(rect)) continue;
        return c;
      }
    }
    return null;
  }

  // A one-tile ring of open ground around a building keeps paths from sealing.
  hasMargin(rect) {
    const g = this.game;
    for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
      for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
        if (rectDist(x, y, rect) !== 1) continue;
        if (!g.isPassable(x, y)) return false;
      }
    }
    return true;
  }

  pickBuilder(ctx, spot) {
    let best = null;
    let bestD = Infinity;
    for (const u of ctx.workers) {
      if (u.hidden || u.dead) continue;
      if (u.order && (u.order.type === 'build' || u.order.type === 'construct')) continue;
      const d = Math.hypot(u.tx - spot.x, u.ty - spot.y) + (u.carry ? 6 : 0);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  // ---- military ---------------------------------------------------------

  findThreat(ctx) {
    const g = this.game;
    let best = null;
    let bestD = Infinity;
    for (const e of g.units) {
      if (e.dead || e.hidden || e.owner === this.owner || e.owner < 0) continue;
      for (const b of ctx.buildings) {
        const d = rectDist(e.tx, e.ty, b.rect());
        if (d <= 10 && d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    return best;
  }

  pickAttackTarget(from) {
    const g = this.game;
    let best = null;
    let bestD = Infinity;
    for (const b of g.buildings) {
      if (b.dead || b.owner < 0 || b.owner === this.owner) continue;
      const d = rectDist(from.x, from.y, b.rect());
      if (d < bestD) {
        bestD = d;
        best = g.centerTile(b);
      }
    }
    if (best) return best;
    for (const u of g.units) {
      if (u.dead || u.hidden || u.owner < 0 || u.owner === this.owner) continue;
      const d = Math.hypot(u.tx - from.x, u.ty - from.y);
      if (d < bestD) {
        bestD = d;
        best = { x: u.tx, y: u.ty };
      }
    }
    return best;
  }

  manageArmy(ctx) {
    const g = this.game;
    const visible = ctx.army.filter((u) => !u.hidden);
    const threat = this.findThreat(ctx);
    this.underThreat = !!threat;

    if (threat) {
      // Everyone not already on a wave rushes home to defend.
      const defenders = visible.filter((u) => !this.waveIds.has(u.id) || rectDist(u.tx, u.ty, threat.rect()) < 16);
      const idle = defenders.filter((u) => !u.order || u.order.type === 'move');
      g.commandMove(idle, threat.tx, threat.ty, true);
      // Desperate times: peasants fight back when there is no army.
      if (defenders.length === 0) {
        const near = ctx.workers.filter((u) => !u.hidden && !u.carry && Math.hypot(u.tx - threat.tx, u.ty - threat.ty) < 6);
        for (const u of near) if (!u.order || u.order.type !== 'attack') g.commandAttack([u], threat);
      }
    }

    // Tidy up the active wave.
    for (const id of [...this.waveIds]) {
      const u = g.get(id);
      if (!u || u.dead) this.waveIds.delete(id);
    }
    if (this.attacking && this.waveIds.size === 0) {
      this.attacking = false;
      this.wave++;
      this.nextAttackTime = g.time + 45;
    }
    if (this.attacking) {
      for (const id of this.waveIds) {
        const u = g.get(id);
        if (!u || u.hidden || !u.isIdle()) continue;
        const target = this.pickAttackTarget({ x: u.tx, y: u.ty });
        if (target) g.commandMove([u], target.x, target.y, true);
      }
    }

    if (threat) return;
    const home = visible.filter((u) => !this.waveIds.has(u.id));
    for (const u of home) {
      if (u.isIdle() && Math.hypot(u.tx - this.rally.x, u.ty - this.rally.y) > 5) {
        g.commandMove([u], this.rally.x, this.rally.y);
      }
    }
    const waveSize = this.cfg.wave + this.wave * this.cfg.waveGrowth;
    if (!this.attacking && g.time >= this.nextAttackTime && home.length >= waveSize) {
      const target = this.pickAttackTarget(this.home);
      if (!target) return;
      this.attacking = true;
      for (const u of home) this.waveIds.add(u.id);
      g.commandMove(home, target.x, target.y, true);
    }
  }
}
