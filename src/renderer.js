// Draws the world from the player's point of view, plus the minimap.

import { TILE, T, PLAYER, NEUTRAL, TEAM_COLORS, BUILDINGS } from './config.js';
import {
  drawTileBase,
  drawTree,
  drawWaterShimmer,
  getBuildingSprite,
  drawConstruction,
  drawUnit,
  drawCorpse,
  drawRubble,
  drawFire,
  makeCanvas,
} from './sprites.js';
import { isEntityVisible } from './visibility.js';
import { clamp } from './util.js';

export { isEntityVisible };

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    const { w, h } = game.map;
    this.terrain = makeCanvas(w * TILE, h * TILE);
    this.tctx = this.terrain.getContext('2d');
    this.fogCanvas = makeCanvas(w, h);
    this.fctx = this.fogCanvas.getContext('2d');
    this.fogImage = this.fctx.createImageData(w, h);
    this.fogVersion = -1;
    this.camX = 0;
    this.camY = 0;
    this.buildTerrain();
  }

  resize(width, height) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.clampCamera();
  }

  dispose() {}

  // ---- view interface (shared with the 3D renderer) ----------------------
  // All world coordinates are game pixels: tile * TILE.

  centerOn(px, py) {
    this.camX = px - this.width / 2;
    this.camY = py - this.height / 2;
    this.clampCamera();
  }

  clampCamera() {
    const maxX = this.game.map.w * TILE - this.width;
    const maxY = this.game.map.h * TILE - this.height;
    this.camX = maxX < 0 ? maxX / 2 : clamp(this.camX, 0, maxX);
    this.camY = maxY < 0 ? maxY / 2 : clamp(this.camY, 0, maxY);
  }

  panBy(dx, dy) {
    this.camX += dx;
    this.camY += dy;
    this.clampCamera();
  }

  wheel(dx, dy) {
    this.panBy(dx, dy);
  }

  zoomBy() {}

  screenToWorld(sx, sy) {
    return { x: sx + this.camX, y: sy + this.camY };
  }

  worldToScreen(px, py) {
    return { x: px - this.camX, y: py - this.camY };
  }

  isOnScreen(px, py, margin = 0) {
    return px > this.camX - margin && px < this.camX + this.width + margin && py > this.camY - margin && py < this.camY + this.height + margin;
  }

  footprint() {
    const x0 = this.camX;
    const y0 = this.camY;
    const x1 = x0 + this.width;
    const y1 = y0 + this.height;
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  }

  pick(sx, sy) {
    const g = this.game;
    const px = sx + this.camX;
    const py = sy + this.camY;
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

  unitsInRect(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1) + this.camX;
    const maxX = Math.max(x0, x1) + this.camX;
    const minY = Math.min(y0, y1) + this.camY;
    const maxY = Math.max(y0, y1) + this.camY;
    return this.game.units.filter(
      (u) => isEntityVisible(this.game, u) && u.x >= minX - 8 && u.x <= maxX + 8 && u.y >= minY - 12 && u.y <= maxY + 10,
    );
  }

  buildTerrain() {
    const { map } = this.game;
    this.redrawRegion(0, 0, map.w - 1, map.h - 1);
    map.dirty.length = 0;
  }

  redrawRegion(x0, y0, x1, y1) {
    const { map } = this.game;
    const ctx = this.tctx;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(map.w - 1, x1);
    y1 = Math.min(map.h - 1, y1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    ctx.clip();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) drawTileBase(ctx, map, x, y);
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) if (map.isTree(x, y)) drawTree(ctx, map, x, y);
    }
    ctx.restore();
  }

  // Applies terrain changes (felled trees) to the cached terrain image.
  syncTerrain(minimap) {
    const { map } = this.game;
    if (!map.dirty.length) return;
    for (const i of map.dirty) {
      const x = i % map.w;
      const y = (i / map.w) | 0;
      this.redrawRegion(x - 1, y - 1, x + 1, y + 1);
      if (minimap) minimap.updateTile(x, y);
    }
    map.dirty.length = 0;
  }

  updateFog() {
    const fog = this.game.fog;
    if (fog.version === this.fogVersion) return;
    this.fogVersion = fog.version;
    const data = this.fogImage.data;
    for (let i = 0, n = fog.visible.length; i < n; i++) {
      data[i * 4 + 3] = fog.visible[i] ? 0 : fog.explored[i] ? 135 : 255;
    }
    this.fctx.putImageData(this.fogImage, 0, 0);
  }

  render(view) {
    const { ctx, game } = this;
    const { camX, camY } = this;
    const W = this.width;
    const H = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const cx = Math.round(camX);
    const cy = Math.round(camY);
    const sw = Math.min(W, this.terrain.width - cx);
    const sh = Math.min(H, this.terrain.height - cy);
    ctx.drawImage(this.terrain, cx, cy, sw, sh, 0, 0, sw, sh);

    ctx.save();
    ctx.translate(-cx, -cy);
    const tx0 = Math.max(0, Math.floor(cx / TILE) - 1);
    const ty0 = Math.max(0, Math.floor(cy / TILE) - 1);
    const tx1 = Math.min(game.map.w - 1, Math.ceil((cx + W) / TILE) + 1);
    const ty1 = Math.min(game.map.h - 1, Math.ceil((cy + H) / TILE) + 1);
    drawWaterShimmer(ctx, game.map, tx0, ty0, tx1, ty1, view.time);

    const inView = (x, y, m = 64) => x > cx - m && x < cx + W + m && y > cy - m && y < cy + H + m;

    // Ground effects.
    for (const e of game.effects) {
      if (!inView(e.x, e.y, 80)) continue;
      const tx = Math.floor(e.x / TILE);
      const ty = Math.floor(e.y / TILE);
      if (!game.fog.isExplored(tx, ty)) continue;
      if (e.type === 'rubble') drawRubble(ctx, e);
      else if (e.type === 'corpse' && game.fog.isVisible(tx, ty)) drawCorpse(ctx, e);
    }

    // Collect visible entities and draw them back to front.
    const list = [];
    for (const b of game.buildings) {
      if (!inView(b.px, b.py, b.size * TILE) || !isEntityVisible(game, b)) continue;
      list.push(b);
    }
    for (const u of game.units) {
      if (!inView(u.x, u.y) || !isEntityVisible(game, u)) continue;
      list.push(u);
    }
    list.sort((a, b) => sortY(a) - sortY(b));

    const sel = view.selection;
    for (const e of list) if (sel.has(e.id)) this.drawSelection(e, true);
    if (view.hover && !sel.has(view.hover.id) && list.includes(view.hover)) this.drawSelection(view.hover, false);

    for (const e of list) {
      if (e.kind === 'building') this.drawBuilding(e, view.time);
      else drawUnit(ctx, e, e.x, e.y);
    }

    // Projectiles.
    for (const p of game.projectiles) {
      if (!inView(p.x, p.y)) continue;
      if (!game.fog.isVisible(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      if (p.kind === 'arrow') {
        ctx.fillStyle = '#6b4a2a';
        ctx.fillRect(-9, -0.75, 10, 1.5);
        ctx.fillStyle = '#d8d8d8';
        ctx.fillRect(1, -1.5, 3, 3);
        ctx.fillStyle = '#eee';
        ctx.fillRect(-10, -2, 2, 4);
      } else {
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(-10, -1.5, 13, 3);
        ctx.fillStyle = '#bbb';
        ctx.fillRect(3, -2.5, 4, 5);
      }
      ctx.restore();
    }

    // Air effects.
    for (const e of game.effects) {
      if (!inView(e.x, e.y, 80)) continue;
      if (!game.fog.isVisible(Math.floor(e.x / TILE), Math.floor(e.y / TILE))) continue;
      const k = e.t / e.life;
      if (e.type === 'hit') {
        ctx.fillStyle = `rgba(255,240,180,${1 - k})`;
        for (let i = 0; i < 4; i++) {
          const a = i * 1.57 + e.x;
          ctx.fillRect(e.x + Math.cos(a) * k * 8 - 1, e.y + Math.sin(a) * k * 8 - 1, 2, 2);
        }
      } else if (e.type === 'explosion') {
        const r = e.size * TILE * 0.5 * (0.4 + k);
        ctx.fillStyle = `rgba(255,140,40,${0.7 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(70,60,50,${0.6 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y - k * 20, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === 'dust') {
        ctx.fillStyle = `rgba(180,150,110,${0.5 * (1 - k)})`;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const d = e.size * 14 * (0.5 + k);
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.6 + 8, 6 + k * 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Health bars.
    for (const e of list) {
      const show = sel.has(e.id) || e === view.hover || (e.hp < e.maxHp && e.owner >= 0);
      if (show) this.drawHealthBar(e, sel.has(e.id) || e === view.hover);
    }

    // Rally point of a selected building.
    if (sel.size === 1) {
      const b = game.get([...sel][0]);
      if (b && b.kind === 'building' && b.owner === PLAYER && b.rally) {
        const rx = (b.rally.x + 0.5) * TILE;
        const ry = (b.rally.y + 0.5) * TILE;
        ctx.strokeStyle = 'rgba(120,255,140,0.6)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(b.px, b.py);
        ctx.lineTo(rx, ry);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#5a4630';
        ctx.fillRect(rx - 1, ry - 14, 2, 16);
        ctx.fillStyle = TEAM_COLORS[PLAYER].main;
        ctx.fillRect(rx + 1, ry - 14, 9, 6);
      }
    }

    // Fog of war (a tiny per-tile canvas scaled up with smoothing).
    this.updateFog();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, cx / TILE, cy / TILE, W / TILE, H / TILE, cx, cy, W, H);
    ctx.imageSmoothingEnabled = false;

    // Building placement preview.
    if (view.placement) this.drawPlacement(view.placement);

    // Click markers.
    for (const m of view.markers) {
      const k = m.t / m.life;
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, 10 * (1 - k * 0.6), 6 * (1 - k * 0.6), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Drag-select box (screen space).
    if (view.dragRect) {
      const r = view.dragRect;
      ctx.strokeStyle = '#7dff8a';
      ctx.fillStyle = 'rgba(125,255,138,0.08)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
  }

  drawSelection(e, selected) {
    const ctx = this.ctx;
    const color = e.owner === PLAYER ? '#46ff63' : e.owner === NEUTRAL ? '#ffe14a' : '#ff4a3d';
    ctx.strokeStyle = color;
    ctx.globalAlpha = selected ? 1 : 0.5;
    ctx.lineWidth = 1.5;
    if (e.kind === 'unit') {
      const big = e.type === 'knight';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + (big ? 11 : 10), big ? 16 : 11, big ? 7 : 5.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const x = e.x * TILE + 1;
      const y = e.y * TILE + 1;
      const s = e.size * TILE - 2;
      const c = 10;
      ctx.beginPath();
      for (const [px, py, dx, dy] of [
        [x, y, 1, 1],
        [x + s, y, -1, 1],
        [x, y + s, 1, -1],
        [x + s, y + s, -1, -1],
      ]) {
        ctx.moveTo(px + dx * c, py);
        ctx.lineTo(px, py);
        ctx.lineTo(px, py + dy * c);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  drawHealthBar(e, full) {
    const ctx = this.ctx;
    const pct = Math.max(0, e.hp / e.maxHp);
    let x;
    let y;
    let w;
    if (e.kind === 'unit') {
      w = e.type === 'knight' ? 26 : 20;
      x = e.x - w / 2;
      y = e.y - (e.type === 'knight' ? 30 : 26);
    } else {
      w = e.size * TILE - 12;
      x = e.x * TILE + 6;
      y = e.y * TILE - 30;
      if (e.type === 'goldmine') return;
    }
    if (!full && pct >= 1) return;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = pct > 0.6 ? '#3bd14a' : pct > 0.3 ? '#e8c33a' : '#e5412f';
    ctx.fillRect(x, y, w * pct, 3);
  }

  drawBuilding(b, time) {
    const ctx = this.ctx;
    const x = b.x * TILE;
    const y = b.y * TILE;
    if (b.constructing) {
      drawConstruction(ctx, b, x, y);
      return;
    }
    const sprite = getBuildingSprite(b.type, b.owner);
    ctx.drawImage(sprite, x, y - 24);
    if (b.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.35, b.flash * 3);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 4, y + 4, b.size * TILE - 8, b.size * TILE - 8);
      ctx.restore();
    }
    if (b.type === 'blacksmith') {
      for (let k = 0; k < 3; k++) {
        const ph = (time * 0.5 + k / 3) % 1;
        ctx.fillStyle = `rgba(90,90,90,${0.5 * (1 - ph)})`;
        ctx.beginPath();
        ctx.arc(x + b.size * TILE - 24 + ph * 8, y - 36 - ph * 26, 4 + ph * 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (b.owner >= 0 && b.hp < b.maxHp * 0.5) {
      const S = b.size * TILE;
      drawFire(ctx, x + S * 0.3, y + S * 0.45, time, b.size / 3 + 0.4);
      if (b.hp < b.maxHp * 0.25) drawFire(ctx, x + S * 0.7, y + S * 0.6, time + 1.3, b.size / 3 + 0.3);
    }
  }

  drawPlacement(pl) {
    const ctx = this.ctx;
    const def = BUILDINGS[pl.type];
    const s = def.size;
    const sprite = getBuildingSprite(pl.type, PLAYER);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(sprite, pl.x * TILE, pl.y * TILE - 24);
    ctx.globalAlpha = 1;
    for (let ty = pl.y; ty < pl.y + s; ty++) {
      for (let tx = pl.x; tx < pl.x + s; tx++) {
        const ok = pl.tileOk(tx, ty);
        ctx.fillStyle = ok ? 'rgba(60,255,90,0.28)' : 'rgba(255,50,40,0.45)';
        ctx.fillRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
      }
    }
  }
}

function sortY(e) {
  return e.kind === 'building' ? (e.y + e.size) * TILE - 6 : e.y + 10;
}

const MINI_COLORS = {
  [T.GRASS]: [78, 125, 47],
  [T.TREE]: [32, 74, 30],
  [T.WATER]: [44, 95, 142],
  [T.ROCK]: [120, 116, 108],
  [T.STUMP]: [96, 120, 60],
  [T.DIRT]: [135, 104, 63],
};

export class Minimap {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    const { w, h } = game.map;
    this.base = makeCanvas(w, h);
    this.bctx = this.base.getContext('2d');
    this.image = this.bctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.setPixel(x, y);
    this.bctx.putImageData(this.image, 0, 0);
    this.dirty = false;
    this.fogCanvas = makeCanvas(w, h);
    this.fctx = this.fogCanvas.getContext('2d');
    this.fogImage = this.fctx.createImageData(w, h);
    this.fogVersion = -1;
  }

  updateFog() {
    const fog = this.game.fog;
    if (fog.version === this.fogVersion) return;
    this.fogVersion = fog.version;
    const data = this.fogImage.data;
    for (let i = 0, n = fog.visible.length; i < n; i++) {
      data[i * 4 + 3] = fog.visible[i] ? 0 : fog.explored[i] ? 135 : 255;
    }
    this.fctx.putImageData(this.fogImage, 0, 0);
  }

  setPixel(x, y) {
    const { map } = this.game;
    const i = y * map.w + x;
    const c = MINI_COLORS[map.tiles[i]];
    const d = this.image.data;
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = 255;
  }

  updateTile(x, y) {
    this.setPixel(x, y);
    this.dirty = true;
  }

  render(view, footprint) {
    const { ctx, game } = this;
    this.updateFog();
    if (this.dirty) {
      this.bctx.putImageData(this.image, 0, 0);
      this.dirty = false;
    }
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sx = W / game.map.w;
    const sy = H / game.map.h;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, W, H);
    for (const b of game.buildings) {
      if (!isEntityVisible(game, b)) continue;
      ctx.fillStyle = b.owner === NEUTRAL ? '#f5d142' : TEAM_COLORS[b.owner].light;
      ctx.fillRect(b.x * sx, b.y * sy, b.size * sx, b.size * sy);
      if (b.owner >= 0) {
        ctx.fillStyle = TEAM_COLORS[b.owner].main;
        ctx.fillRect(b.x * sx + 1, b.y * sy + 1, b.size * sx - 2, b.size * sy - 2);
      }
    }
    for (const u of game.units) {
      if (!isEntityVisible(game, u)) continue;
      ctx.fillStyle = view.selection.has(u.id) ? '#ffffff' : TEAM_COLORS[u.owner].light;
      ctx.fillRect(u.x / TILE * sx - 1, u.y / TILE * sy - 1, Math.max(2, sx), Math.max(2, sy));
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0, W, H);
    for (const a of view.alerts) {
      const k = (a.t % 1);
      ctx.strokeStyle = `rgba(255,60,40,${1 - k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((a.x / TILE) * sx, (a.y / TILE) * sy, 4 + k * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    // What the camera can see, as a polygon (a trapezoid in 3D).
    if (footprint && footprint.length) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      footprint.forEach((p, i) => {
        const x = clamp((p.x / TILE) * sx, 0, W - 0.5) + 0.5;
        const y = clamp((p.y / TILE) * sy, 0, H - 0.5) + 0.5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }
}
