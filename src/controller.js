// Player input: camera, selection, control groups, the command card and
// turning clicks into game commands.

import { TILE, PLAYER, UNITS, BUILDINGS, RESEARCH, BUILD_MENU } from './config.js';
import { clamp } from './util.js';
import { isEntityVisible } from './renderer.js';

const SCROLL_SPEED = 900;
const EDGE = 10;

export class Controller {
  constructor(game, canvas, minimapCanvas, audio) {
    this.game = game;
    this.canvas = canvas;
    this.minimapCanvas = minimapCanvas;
    this.audio = audio;
    this.selection = [];
    this.mode = null; // { type: 'target', cmd } | { type: 'place', btype }
    this.menu = 'main';
    this.groups = new Map();
    this.lastGroupKey = { key: null, time: 0 };
    this.markers = [];
    this.alerts = [];
    this.hover = null;
    this.mouse = { x: 0, y: 0, cx: -1, cy: -1, inside: false, inWindow: false };
    this.drag = null;
    this.keys = new Set();
    this.lastClick = { id: 0, time: 0 };
    this.viewW = 800;
    this.viewH = 600;
    this.enabled = true;
    this.onMessage = () => {};
    this.onMenu = () => {};
    this.minimapDrag = false;

    const s = game.starts[PLAYER];
    this.camX = 0;
    this.camY = 0;
    this.centerOn((s.x + 2) * TILE, (s.y + 2) * TILE);
    this.bind();
  }

  // ---- camera ----------------------------------------------------------

  setViewSize(w, h) {
    this.viewW = w;
    this.viewH = h;
    this.clampCamera();
  }

  centerOn(px, py) {
    this.camX = px - this.viewW / 2;
    this.camY = py - this.viewH / 2;
    this.clampCamera();
  }

  clampCamera() {
    const maxX = this.game.map.w * TILE - this.viewW;
    const maxY = this.game.map.h * TILE - this.viewH;
    this.camX = maxX < 0 ? maxX / 2 : clamp(this.camX, 0, maxX);
    this.camY = maxY < 0 ? maxY / 2 : clamp(this.camY, 0, maxY);
  }

  update(dt) {
    let dx = 0;
    let dy = 0;
    if (this.enabled) {
      if (this.keys.has('ArrowLeft')) dx -= 1;
      if (this.keys.has('ArrowRight')) dx += 1;
      if (this.keys.has('ArrowUp')) dy -= 1;
      if (this.keys.has('ArrowDown')) dy += 1;
      if (this.mouse.inWindow && !this.drag && !this.minimapDrag) {
        // The edge zones extend past the battlefield into the page margins,
        // except on the left where the console sits.
        const { x, y } = this.mouse;
        const inX = x >= 0 && x <= this.viewW;
        const inY = y >= 0 && y <= this.viewH;
        if (inY && x >= 0 && x < EDGE) dx -= 1;
        if (inY && x > this.viewW - EDGE) dx += 1;
        if (inX && y < EDGE && y > -80) dy -= 1;
        if (inX && y > this.viewH - EDGE) dy += 1;
      }
    }
    if (dx || dy) {
      this.camX += dx * SCROLL_SPEED * dt;
      this.camY += dy * SCROLL_SPEED * dt;
      this.clampCamera();
    }
    for (const m of this.markers) m.t += dt;
    this.markers = this.markers.filter((m) => m.t < m.life);
    for (const a of this.alerts) a.t += dt;
    this.alerts = this.alerts.filter((a) => a.t < 4);
    this.pruneSelection();
    this.updateHover();
  }

  view(time) {
    return {
      camX: this.camX,
      camY: this.camY,
      viewW: this.viewW,
      viewH: this.viewH,
      time,
      selection: new Set(this.selection),
      hover: this.hover,
      markers: this.markers,
      alerts: this.alerts,
      dragRect: this.dragRect(),
      placement: this.placementPreview(),
    };
  }

  // ---- selection --------------------------------------------------------

  selected() {
    return this.selection.map((id) => this.game.get(id)).filter(Boolean);
  }

  ownSelectedUnits() {
    return this.selected().filter((e) => e.kind === 'unit' && e.owner === PLAYER && !e.hidden);
  }

  pruneSelection() {
    const before = this.selection.length;
    this.selection = this.selection.filter((id) => {
      const e = this.game.get(id);
      return e && !e.dead && !e.hidden && (e.owner === PLAYER || isEntityVisible(this.game, e));
    });
    if (before !== this.selection.length && this.selection.length === 0) {
      this.menu = 'main';
      this.mode = null;
    }
  }

  setSelection(entities, add = false) {
    const ids = entities.map((e) => e.id);
    if (add) {
      for (const id of ids) if (!this.selection.includes(id)) this.selection.push(id);
    } else {
      this.selection = ids;
    }
    this.menu = 'main';
    this.mode = null;
    if (entities.some((e) => e.owner === PLAYER)) this.audio.play('select');
  }

  entityAt(px, py) {
    const g = this.game;
    let best = null;
    let bestY = -Infinity;
    for (const u of g.units) {
      if (!isEntityVisible(g, u)) continue;
      const r = u.type === 'knight' ? 16 : 11;
      if (px >= u.x - r && px <= u.x + r && py >= u.y - 20 && py <= u.y + 13 && u.y > bestY) {
        best = u;
        bestY = u.y;
      }
    }
    if (best) return best;
    for (const b of g.buildings) {
      if (!isEntityVisible(g, b)) continue;
      const x0 = b.x * TILE;
      const y0 = b.y * TILE - 16;
      const s = b.size * TILE;
      if (px >= x0 && px < x0 + s && py >= y0 && py < y0 + s + 16) return b;
    }
    return null;
  }

  boxSelect(x0, y0, x1, y1, add) {
    const g = this.game;
    const minX = Math.min(x0, x1) + this.camX;
    const maxX = Math.max(x0, x1) + this.camX;
    const minY = Math.min(y0, y1) + this.camY;
    const maxY = Math.max(y0, y1) + this.camY;
    const units = g.units.filter(
      (u) => u.owner === PLAYER && !u.hidden && !u.dead && u.x >= minX - 8 && u.x <= maxX + 8 && u.y >= minY - 12 && u.y <= maxY + 10,
    );
    if (units.length) {
      this.setSelection(units, add);
    } else if (!add) {
      const e = this.entityAt((minX + maxX) / 2, (minY + maxY) / 2);
      this.setSelection(e ? [e] : []);
    }
  }

  selectSameType(e) {
    const g = this.game;
    const list = (e.kind === 'unit' ? g.units : g.buildings).filter(
      (o) =>
        o.owner === PLAYER &&
        o.type === e.type &&
        !o.hidden &&
        !o.dead &&
        (o.kind === 'unit' ? o.x : o.px) >= this.camX &&
        (o.kind === 'unit' ? o.x : o.px) <= this.camX + this.viewW &&
        (o.kind === 'unit' ? o.y : o.py) >= this.camY &&
        (o.kind === 'unit' ? o.y : o.py) <= this.camY + this.viewH,
    );
    this.setSelection(e.kind === 'unit' ? list : [e]);
  }

  // ---- input binding ---------------------------------------------------------

  bind() {
    this.abort = new AbortController();
    const opt = { signal: this.abort.signal };
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    c.addEventListener('mousedown', (e) => this.onMouseDown(e), opt);
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), opt);
    window.addEventListener('mouseup', (e) => this.onMouseUp(e), opt);
    document.addEventListener(
      'mouseout',
      (e) => {
        if (!e.relatedTarget) this.mouse.inWindow = false;
      },
      opt,
    );
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        this.camX += e.deltaX;
        this.camY += e.deltaY;
        this.clampCamera();
      },
      { passive: false, signal: this.abort.signal },
    );

    const mm = this.minimapCanvas;
    mm.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    mm.addEventListener(
      'mousedown',
      (e) => {
        if (!this.enabled) return;
        const p = this.minimapPoint(e);
        if (e.button === 2) {
          const units = this.ownSelectedUnits();
          if (units.length) {
            this.game.commandMove(units, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
            this.audio.play('ack');
          }
          return;
        }
        if (this.mode && this.mode.type === 'target') {
          this.executeTarget(p.x, p.y, null, e.shiftKey);
          return;
        }
        this.minimapDrag = true;
        this.centerOn(p.x, p.y);
      },
      opt,
    );

    window.addEventListener('keydown', (e) => this.onKeyDown(e), opt);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key), opt);
    window.addEventListener('blur', () => this.keys.clear(), opt);
  }

  dispose() {
    this.abort.abort();
  }

  minimapPoint(e) {
    const r = this.minimapCanvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * this.game.map.w * TILE;
    const y = ((e.clientY - r.top) / r.height) * this.game.map.h * TILE;
    return { x, y };
  }

  canvasPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onMouseDown(e) {
    if (!this.enabled) return;
    this.audio.unlock();
    const p = this.canvasPoint(e);
    const wx = p.x + this.camX;
    const wy = p.y + this.camY;
    if (e.button === 2) {
      if (this.mode) {
        this.cancelMode();
        return;
      }
      this.rightClick(wx, wy);
      return;
    }
    if (e.button !== 0) return;
    if (this.mode && this.mode.type === 'place') {
      this.tryPlace(e.shiftKey);
      return;
    }
    if (this.mode && this.mode.type === 'target') {
      this.executeTarget(wx, wy, this.entityAt(wx, wy), e.shiftKey);
      return;
    }
    this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
  }

  onMouseMove(e) {
    const p = this.canvasPoint(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    this.mouse.cx = e.clientX;
    this.mouse.cy = e.clientY;
    this.mouse.inWindow = true;
    this.mouse.inside = p.x >= 0 && p.y >= 0 && p.x < this.viewW && p.y < this.viewH;
    if (this.drag) {
      this.drag.x1 = p.x;
      this.drag.y1 = p.y;
    }
    if (this.minimapDrag) {
      const mp = this.minimapPoint(e);
      this.centerOn(mp.x, mp.y);
    }
  }

  onMouseUp(e) {
    this.minimapDrag = false;
    if (!this.drag || e.button !== 0) return;
    const d = this.drag;
    this.drag = null;
    if (Math.abs(d.x1 - d.x0) > 5 || Math.abs(d.y1 - d.y0) > 5) {
      this.boxSelect(d.x0, d.y0, d.x1, d.y1, d.shift);
      return;
    }
    const wx = d.x0 + this.camX;
    const wy = d.y0 + this.camY;
    const ent = this.entityAt(wx, wy);
    if (!ent) {
      if (!d.shift) this.setSelection([]);
      return;
    }
    const now = performance.now();
    const double = this.lastClick.id === ent.id && now - this.lastClick.time < 350;
    this.lastClick = { id: ent.id, time: now };
    if ((double || d.ctrl) && ent.owner === PLAYER) {
      this.selectSameType(ent);
      return;
    }
    if (d.shift && ent.owner === PLAYER && ent.kind === 'unit') {
      const sel = this.selected();
      if (sel.some((s) => s.owner !== PLAYER || s.kind !== 'unit')) {
        this.setSelection([ent]);
      } else if (this.selection.includes(ent.id)) {
        this.selection = this.selection.filter((id) => id !== ent.id);
      } else {
        this.setSelection([ent], true);
      }
      return;
    }
    this.setSelection([ent]);
  }

  rightClick(wx, wy) {
    const g = this.game;
    const sel = this.selected();
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    if (!g.map.inBounds(tx, ty)) return;
    const target = this.entityAt(wx, wy);
    const units = this.ownSelectedUnits();
    if (units.length) {
      const what = g.commandSmart(units, tx, ty, target);
      const color = what === 'attack' ? '#ff5040' : what === 'harvest' ? '#ffd84a' : '#5aff6a';
      this.addMarker(target ? (target.kind === 'building' ? target.px : target.x) : wx, target ? (target.kind === 'building' ? target.py : target.y) : wy, color);
      this.audio.play('ack');
      return;
    }
    if (sel.length === 1 && sel[0].kind === 'building' && sel[0].owner === PLAYER && sel[0].def.trains) {
      g.setRally(sel[0], tx, ty, target);
      this.addMarker(wx, wy, '#5aff6a');
      this.audio.play('ack');
    }
  }

  addMarker(x, y, color) {
    this.markers.push({ x, y, color, t: 0, life: 0.6 });
  }

  cancelMode() {
    this.mode = null;
  }

  executeTarget(wx, wy, target, keep) {
    const g = this.game;
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    if (!g.map.inBounds(tx, ty)) return;
    const units = this.ownSelectedUnits();
    const cmd = this.mode.cmd;
    let color = '#5aff6a';
    if (cmd === 'move') {
      if (target && target.owner !== -1 && target !== units[0]) {
        for (const u of units) u.setOrder(g, { type: 'move', target: target.id, range: 1 });
      } else {
        g.commandMove(units, tx, ty);
      }
    } else if (cmd === 'attack') {
      color = '#ff5040';
      if (target && g.isHostile(units[0] || { owner: PLAYER }, target)) g.commandAttack(units, target);
      else g.commandMove(units, tx, ty, true);
    } else if (cmd === 'harvest') {
      color = '#ffd84a';
      const workers = units.filter((u) => u.isWorker);
      if (target && target.type === 'goldmine') g.commandHarvestGold(workers, target);
      else if (g.map.isTree(tx, ty)) g.commandHarvestWood(workers, tx, ty);
      else {
        this.say("Target a gold mine or trees.");
        return;
      }
    } else if (cmd === 'rally') {
      const b = this.selected()[0];
      if (b && b.kind === 'building') g.setRally(b, tx, ty, target);
    }
    this.addMarker(wx, wy, color);
    this.audio.play('ack');
    if (!keep) this.mode = null;
  }

  // ---- placement ---------------------------------------------------------------

  placementPreview() {
    if (!this.mode || this.mode.type !== 'place') return null;
    const g = this.game;
    const def = BUILDINGS[this.mode.btype];
    const x = Math.floor((this.mouse.x + this.camX) / TILE) - Math.floor((def.size - 1) / 2);
    const y = Math.floor((this.mouse.y + this.camY) / TILE) - Math.floor((def.size - 1) / 2);
    const builder = this.ownSelectedUnits().find((u) => u.isWorker);
    return {
      type: this.mode.btype,
      x,
      y,
      tileOk: (tx, ty) => {
        if (!g.map.inBounds(tx, ty) || !g.fog.isExplored(tx, ty)) return false;
        if (!g.map.isBuildable(tx, ty) || g.buildingAt(tx, ty)) return false;
        const u = g.unitAt(tx, ty);
        return !u || u === builder || u.owner === PLAYER;
      },
    };
  }

  tryPlace(keep) {
    const g = this.game;
    const pl = this.placementPreview();
    const workers = this.ownSelectedUnits().filter((u) => u.isWorker);
    if (!pl || !workers.length) {
      this.mode = null;
      return;
    }
    const size = BUILDINGS[pl.type].size;
    const cx = pl.x + size / 2;
    const cy = pl.y + size / 2;
    workers.sort((a, b) => Math.hypot(a.tx - cx, a.ty - cy) - Math.hypot(b.tx - cx, b.ty - cy));
    const builder = workers.find((u) => !(u.order && u.order.type === 'build')) || workers[0];
    if (g.commandBuild(builder, pl.type, pl.x, pl.y)) {
      this.audio.play('ack');
      this.addMarker((pl.x + size / 2) * TILE, (pl.y + size / 2) * TILE, '#5aff6a');
      if (!keep) {
        this.mode = null;
        this.menu = 'main';
      }
    }
  }

  dragRect() {
    const d = this.drag;
    if (!d || (Math.abs(d.x1 - d.x0) <= 5 && Math.abs(d.y1 - d.y0) <= 5)) return null;
    return { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
  }

  updateHover() {
    if (!this.mouse.inside || this.drag) {
      this.hover = null;
    } else {
      this.hover = this.entityAt(this.mouse.x + this.camX, this.mouse.y + this.camY);
    }
    let cursor = 'default';
    if (this.mode && this.mode.type === 'target') cursor = 'crosshair';
    else if (this.mode && this.mode.type === 'place') cursor = 'copy';
    else if (this.hover && this.ownSelectedUnits().length) {
      if (this.game.isHostile({ owner: PLAYER }, this.hover)) cursor = 'crosshair';
      else cursor = 'pointer';
    }
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  // ---- keyboard -----------------------------------------------------------------

  onKeyDown(e) {
    if (!this.enabled) {
      if (e.key === 'Escape') this.onMenu();
      return;
    }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    this.audio.unlock();
    const key = e.key;
    if (key.startsWith('Arrow')) {
      this.keys.add(key);
      e.preventDefault();
      return;
    }
    if (key === 'Escape') {
      if (this.mode) this.mode = null;
      else if (this.menu !== 'main') this.menu = 'main';
      else this.onMenu();
      return;
    }
    if (/^[0-9]$/.test(key)) {
      e.preventDefault();
      this.controlGroup(key, e.ctrlKey || e.metaKey);
      return;
    }
    if (key === ' ') {
      e.preventDefault();
      const sel = this.selected();
      if (sel.length) this.centerOnEntities(sel);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const letter = key.length === 1 ? key.toUpperCase() : '';
    if (!letter) return;
    const cmd = this.getCommands().find((c) => c.hotkey === letter);
    if (cmd) {
      e.preventDefault();
      this.runCommand(cmd);
    }
  }

  controlGroup(key, assign) {
    if (assign) {
      const own = this.selected().filter((s) => s.owner === PLAYER);
      this.groups.set(key, own.map((s) => s.id));
      this.say(`Group ${key} assigned.`);
      return;
    }
    const ids = (this.groups.get(key) || []).filter((id) => {
      const e = this.game.get(id);
      return e && !e.dead;
    });
    if (!ids.length) return;
    const now = performance.now();
    const visible = ids.map((id) => this.game.get(id)).filter((e) => !e.hidden);
    if (this.lastGroupKey.key === key && now - this.lastGroupKey.time < 400) {
      this.centerOnEntities(visible.length ? visible : ids.map((id) => this.game.get(id)));
    }
    this.lastGroupKey = { key, time: now };
    this.setSelection(visible);
  }

  centerOnEntities(list) {
    let x = 0;
    let y = 0;
    for (const e of list) {
      x += e.kind === 'building' ? e.px : e.x;
      y += e.kind === 'building' ? e.py : e.y;
    }
    this.centerOn(x / list.length, y / list.length);
  }

  say(text) {
    this.onMessage(text);
  }

  // ---- command card ----------------------------------------------------------------

  runCommand(cmd) {
    if (!cmd.enabled) {
      if (cmd.reason) this.say(cmd.reason);
      this.audio.play('error');
      return;
    }
    cmd.action();
  }

  getCommands() {
    const g = this.game;
    const sel = this.selected();
    if (!sel.length || sel[0].owner !== PLAYER) return [];
    const units = sel.filter((e) => e.kind === 'unit' && !e.hidden);
    const cmds = [];
    const target = (cmd) => () => {
      this.mode = { type: 'target', cmd };
    };

    if (units.length) {
      const workers = units.filter((u) => u.isWorker);
      if (this.menu === 'build' && workers.length) {
        for (const type of BUILD_MENU) {
          const def = BUILDINGS[type];
          const missing = g.missingRequirements(PLAYER, def.requires);
          cmds.push({
            id: `build-${type}`,
            hotkey: def.hotkey,
            label: `Build ${def.name}`,
            icon: { kind: 'building', type },
            cost: def.cost,
            desc: def.desc,
            enabled: missing.length === 0,
            reason: missing.length ? `Requires: ${missing.map((m) => BUILDINGS[m].name).join(', ')}.` : '',
            action: () => {
              this.mode = { type: 'place', btype: type };
            },
          });
        }
        cmds.push({ id: 'back', hotkey: 'X', label: 'Back', icon: { kind: 'glyph', type: 'back' }, enabled: true, action: () => (this.menu = 'main'), slot: 8 });
        return cmds;
      }
      cmds.push({ id: 'move', hotkey: 'M', label: 'Move', icon: { kind: 'glyph', type: 'move' }, enabled: true, action: target('move') });
      cmds.push({
        id: 'stop',
        hotkey: 'S',
        label: 'Stop',
        icon: { kind: 'glyph', type: 'stop' },
        enabled: true,
        action: () => {
          g.commandStop(units);
          this.audio.play('ack');
        },
      });
      cmds.push({ id: 'attack', hotkey: 'A', label: 'Attack', icon: { kind: 'glyph', type: 'attack' }, enabled: true, action: target('attack'), desc: 'Attack a target, or attack-move to a location, fighting enemies along the way.' });
      if (units.some((u) => !u.isWorker)) {
        cmds.push({
          id: 'hold',
          hotkey: 'H',
          label: 'Hold Position',
          icon: { kind: 'glyph', type: 'hold' },
          enabled: true,
          action: () => {
            g.commandHold(units.filter((u) => !u.isWorker));
            this.audio.play('ack');
          },
        });
      }
      if (workers.length) {
        cmds.push({ id: 'harvest', hotkey: 'G', label: 'Harvest', icon: { kind: 'glyph', type: 'harvest' }, enabled: true, action: target('harvest'), desc: 'Mine gold or chop lumber.' });
        const carrying = workers.some((u) => u.carry);
        cmds.push({
          id: 'return',
          hotkey: 'R',
          label: 'Return Goods',
          icon: { kind: 'glyph', type: 'return' },
          enabled: carrying,
          reason: 'Not carrying anything.',
          action: () => {
            g.commandReturn(workers);
            this.audio.play('ack');
          },
        });
        cmds.push({ id: 'build', hotkey: 'B', label: 'Build Structure', icon: { kind: 'glyph', type: 'build' }, enabled: true, action: () => (this.menu = 'build') });
      }
      return cmds;
    }

    if (sel.length !== 1 || sel[0].kind !== 'building') return [];
    const b = sel[0];
    if (b.constructing) {
      cmds.push({
        id: 'cancel-build',
        hotkey: 'X',
        label: 'Cancel Construction',
        icon: { kind: 'glyph', type: 'cancel' },
        desc: 'Refunds 75% of the cost.',
        enabled: true,
        action: () => g.cancelConstruction(b),
        slot: 8,
      });
      return cmds;
    }
    for (const type of b.def.trains || []) {
      const def = UNITS[type];
      const missing = g.missingRequirements(PLAYER, def.requires);
      cmds.push({
        id: `train-${type}`,
        hotkey: def.hotkey,
        label: `Train ${def.name}`,
        icon: { kind: 'unit', type },
        cost: { ...def.cost, food: def.food },
        desc: def.desc,
        enabled: missing.length === 0,
        reason: missing.length ? `Requires: ${missing.map((m) => BUILDINGS[m].name).join(', ')}.` : '',
        action: () => {
          if (g.train(b, type)) this.audio.play('ack');
          else this.audio.play('error');
        },
      });
    }
    for (const type of b.def.research || []) {
      const def = RESEARCH[type];
      const p = g.players[PLAYER];
      const level = p.upgrades[type];
      const maxed = level >= def.levels.length;
      const cost = def.levels[Math.min(level, def.levels.length - 1)];
      cmds.push({
        id: `research-${type}`,
        hotkey: def.hotkey,
        label: `${def.name} ${maxed ? '(complete)' : level + 1}`,
        icon: { kind: 'glyph', type: type === 'weapons' ? 'upWeapons' : 'upArmor' },
        cost: maxed ? null : { gold: cost.gold, wood: cost.wood },
        desc: def.desc,
        enabled: !maxed && !p.researching[type],
        reason: maxed ? 'Already fully upgraded.' : 'Already being researched.',
        action: () => {
          if (g.research(b, type)) this.audio.play('ack');
          else this.audio.play('error');
        },
      });
    }
    if (b.def.trains) {
      cmds.push({ id: 'rally', hotkey: 'Y', label: 'Set Rally Point', icon: { kind: 'glyph', type: 'rally' }, enabled: true, action: target('rally'), desc: 'New units will head here. You can also right-click.', slot: 6 });
    }
    if (b.queue.length) {
      cmds.push({
        id: 'cancel-queue',
        hotkey: 'X',
        label: 'Cancel Last',
        icon: { kind: 'glyph', type: 'cancel' },
        desc: 'Cancel the last item in the queue for a full refund.',
        enabled: true,
        action: () => g.cancelQueueItem(b),
        slot: 8,
      });
    }
    return cmds;
  }
}
