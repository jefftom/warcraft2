// The 3D view. Implements the same view interface as the classic renderer
// (see renderer.js), so the controller and main loop work with either.
//
// The scene is assembled from layers, each owning one family of objects:
//   terrain   ground mesh, water, map skirt          (terrain.js)
//   foliage   trees, stumps, rocks, ground clutter    (foliage.js)
//   buildings building models, construction, fires   (buildings.js)
//   units     unit models and their animation         (units.js)
//   effects   projectiles, corpses, rubble, bursts,
//             selection rings, markers, rally flag,
//             building placement preview            (effects.js)
//
// Coordinates: 1 world unit = 1 tile. World x = game px / TILE, world z =
// game py / TILE, +y is up. A unit at game (u.x, u.y) stands at
// (u.x / TILE, heightAt(...), u.y / TILE).

import * as THREE from 'three';
import { TILE } from '../config.js';
import { isEntityVisible } from '../visibility.js';
import { CameraRig } from './rig.js';
import { FogOfWar } from './fog.js';
import { Palette } from './palette.js';
import { Particles } from './particles.js';
import { Terrain } from './terrain.js';
import { FoliageLayer } from './foliage.js';
import { BuildingLayer } from './buildings.js';
import { UnitLayer } from './units.js';
import { EffectsLayer } from './effects.js';
import { Overlay } from './overlay.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BrickTerrain } from './brick/terrain.js';
import { BrickFoliage } from './brick/foliage.js';
import { BrickBuildingLayer } from './brick/buildings.js';
import { BrickUnitLayer } from './brick/units.js';
import { DioramaPost } from './post.js';

/**
 * Shared context handed to every layer.
 * @typedef {object} LayerContext
 * @property {import('../game.js').Game} game
 * @property {THREE.Scene} scene
 * @property {THREE.WebGLRenderer} renderer
 * @property {CameraRig} rig
 * @property {FogOfWar} fog            patch(material, opts) adds fog of war to a material
 * @property {Palette} palette         shared materials: matte, metal, glow, overlay(color, opacity)
 * @property {{glow: Particles, smoke: Particles, spark: Particles}} particles
 *           glow/spark are additive (fire, sparks, flashes); smoke is alpha-blended (smoke, dust)
 * @property {(x:number, z:number) => number} heightAt   ground height at world x/z (tiles)
 * @property {(e:object) => boolean} visible   whether the player may see this entity now
 * @property {{terrain: Terrain, foliage: FoliageLayer, buildings: BuildingLayer, units: UnitLayer, effects: EffectsLayer}} layers
 */

export class Renderer3D {
  /**
   * @param {{style?: 'standard'|'brick'}} [opts] `brick` swaps every model for
   *   toy bricks and minifigures and renders like a photographed diorama
   *   (prototype: minifigures, farms, trees and the baseplate).
   */
  constructor(canvas, game, stage, opts = {}) {
    this.canvas = canvas;
    this.game = game;
    this.style = opts.style === 'brick' ? 'brick' : 'standard';
    this.clock = 0;
    this.width = 1;
    this.height = 1;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d07);
    this.scene = scene;

    this.rig = new CameraRig(game.map.w, game.map.h);
    this.fog = new FogOfWar(game);
    this.palette = new Palette(this.fog);

    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x4a3b22, 1.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(-20, 34, -13);

    this.particles = {
      glow: new Particles(scene, this.fog, { additive: true, texture: 'soft', max: 2048 }),
      spark: new Particles(scene, this.fog, { additive: true, texture: 'spark', max: 1024 }),
      smoke: new Particles(scene, this.fog, { additive: false, texture: 'smoke', max: 2048 }),
    };

    /** @type {LayerContext} */
    const ctx = {
      game,
      scene,
      renderer,
      rig: this.rig,
      fog: this.fog,
      palette: this.palette,
      particles: this.particles,
      heightAt: () => 0,
      visible: (e) => isEntityVisible(game, e),
      layers: {},
    };
    this.ctx = ctx;
    const brick = this.style === 'brick';
    ctx.style = this.style;
    if (brick) {
      // Glossy plastic needs something to reflect.
      const pmrem = new THREE.PMREMGenerator(renderer);
      this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      scene.environment = this.envMap;
      scene.environmentIntensity = 0.32;
      hemi.intensity = 0.6;
      sun.intensity = 2.2;
      renderer.toneMappingExposure = 0.92;
      scene.background = new THREE.Color(0x1a120c);
    }
    const terrain = brick ? new BrickTerrain(ctx) : new Terrain(ctx);
    ctx.heightAt = (x, z) => terrain.heightAt(x, z);
    ctx.layers.terrain = terrain;
    ctx.layers.foliage = brick ? new BrickFoliage(ctx) : new FoliageLayer(ctx);
    ctx.layers.buildings = brick ? new BrickBuildingLayer(ctx) : new BuildingLayer(ctx);
    ctx.layers.units = brick ? new BrickUnitLayer(ctx) : new UnitLayer(ctx);
    ctx.layers.effects = new EffectsLayer(ctx);
    this.layers = ctx.layers;

    this.overlay = new Overlay(stage, canvas);
    this.post = brick ? new DioramaPost(renderer, scene, this.rig.camera) : null;
    this._p = { x: 0, y: 0, z: 0 };
    game.map.dirty.length = 0;
  }

  // ---- lifecycle -----------------------------------------------------------

  resize(width, height) {
    this.width = width;
    this.height = height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, true);
    this.rig.setSize(width, height);
    this.overlay.resize(width, height, dpr);
    if (this.post) this.post.setSize(width, height, dpr);
  }

  dispose() {
    for (const layer of Object.values(this.layers)) layer.dispose?.();
    for (const p of Object.values(this.particles)) p.dispose();
    this.palette.dispose();
    this.fog.dispose();
    this.overlay.dispose();
    if (this.post) this.post.dispose();
    if (this.envMap) this.envMap.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // Felled trees and other terrain changes.
  syncTerrain(minimap) {
    const { map } = this.game;
    if (!map.dirty.length) return;
    for (const i of map.dirty) {
      const x = i % map.w;
      const y = (i / map.w) | 0;
      this.layers.foliage.onTileChanged(x, y, map.tiles[i]);
      if (minimap) minimap.updateTile(x, y);
    }
    map.dirty.length = 0;
  }

  render(frame) {
    const dt = Math.min(0.1, frame.dt || 0);
    this.clock += dt;
    const clock = this.clock;
    this.rig.update(dt);
    this.fog.update(dt, clock);
    this.layers.terrain.update(clock);
    this.layers.foliage.update(frame, clock);
    this.layers.buildings.sync(frame, clock);
    this.layers.units.sync(frame, clock);
    this.layers.effects.sync(frame, clock);

    const bufferHeight = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    for (const p of Object.values(this.particles)) p.update(dt, bufferHeight, this.rig.camera);

    // The sun's shadow camera follows the view.
    const t = this.rig.target;
    const r = this.rig.distance * 1.05 + 8;
    this.sun.position.copy(t).add(this.sunOffset);
    this.sun.target.position.copy(t);
    const sc = this.sun.shadow.camera;
    if (sc.right !== r) {
      sc.left = -r;
      sc.right = r;
      sc.top = r;
      sc.bottom = -r;
      sc.updateProjectionMatrix();
    }

    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.rig.camera);
    this.overlay.draw(this.healthBars(frame), frame.dragRect);
  }

  healthBars(frame) {
    const bars = [];
    const { game, rig } = this;
    const p = this._p;
    const consider = (e) => {
      const selected = frame.selection.has(e.id);
      const hover = e === frame.hover;
      const damaged = e.owner >= 0 && e.hp < e.maxHp;
      const building = e.kind === 'building';
      if (!selected && !hover && !damaged && !(building && e.constructing && e.owner >= 0)) return;
      if (e.type === 'goldmine') return;
      if (!this.ctx.visible(e)) return;
      if (building) {
        const m = this.layers.buildings.metrics(e);
        const cx = e.x + e.size / 2;
        const cz = e.y + e.size / 2;
        rig.project(cx, this.ctx.heightAt(cx, cz) + m.height + 0.25, cz, p);
        if (p.z > 1 || p.x < -60 || p.x > this.width + 60 || p.y < -30 || p.y > this.height + 30) return;
        const w = Math.max(30, Math.min(120, rig.pixelsAt(cx, 0, cz, e.size) * 0.75));
        bars.push({ x: p.x, y: p.y, w, pct: Math.max(0, e.hp / e.maxHp), full: selected || hover, progress: e.constructing ? e.progress : undefined });
      } else {
        const m = this.layers.units.metrics(e);
        const wx = e.x / TILE;
        const wz = e.y / TILE;
        rig.project(wx, this.ctx.heightAt(wx, wz) + m.height + 0.2, wz, p);
        if (p.z > 1 || p.x < -30 || p.x > this.width + 30 || p.y < -30 || p.y > this.height + 30) return;
        const w = Math.max(18, Math.min(40, rig.pixelsAt(wx, 0, wz, m.radius * 2) * 0.9));
        bars.push({ x: p.x, y: p.y, w, pct: Math.max(0, e.hp / e.maxHp), full: selected || hover });
      }
    };
    for (const b of game.buildings) consider(b);
    for (const u of game.units) consider(u);
    return bars;
  }

  // ---- view interface ------------------------------------------------------
  // World coordinates here are game pixels (tile * TILE), like the 2D view.

  centerOn(px, py) {
    this.rig.centerOn(px / TILE, py / TILE);
  }

  panBy(dx, dy) {
    this.rig.panBy(dx, dy);
  }

  wheel(dx, dy) {
    if (dx) this.rig.panBy(dx, 0);
    if (dy) this.rig.zoomBy(dy);
  }

  zoomBy(delta) {
    this.rig.zoomBy(delta);
  }

  screenToWorld(sx, sy) {
    const g = this.rig.screenToGround(sx, sy);
    return g ? { x: g.x * TILE, y: g.z * TILE } : null;
  }

  worldToScreen(px, py) {
    const p = this.rig.project(px / TILE, 0, py / TILE);
    return { x: p.x, y: p.y };
  }

  isOnScreen(px, py, margin = 0) {
    const p = this.rig.project(px / TILE, 0, py / TILE, this._p);
    return p.z < 1 && p.x > -margin && p.x < this.width + margin && p.y > -margin && p.y < this.height + margin;
  }

  footprint() {
    const pts = [];
    const corners = [
      [0, 0],
      [this.width, 0],
      [this.width, this.height],
      [0, this.height],
    ];
    for (const [sx, sy] of corners) {
      const g = this.rig.screenToGround(sx, sy);
      if (g) pts.push({ x: g.x * TILE, y: g.z * TILE });
    }
    return pts;
  }

  unitScreen(u, out) {
    const m = this.layers.units.metrics(u);
    const wx = u.x / TILE;
    const wz = u.y / TILE;
    const wy = this.ctx.heightAt(wx, wz);
    this.rig.project(wx, wy + m.height * 0.5, wz, out);
    out.rx = Math.max(11, this.rig.pixelsAt(wx, wy, wz, m.radius * 2) * 0.7);
    out.ry = Math.max(14, this.rig.pixelsAt(wx, wy, wz, m.height) * 0.62);
    return out;
  }

  pick(sx, sy) {
    const { game } = this;
    const p = { x: 0, y: 0, z: 0, rx: 0, ry: 0 };
    let best = null;
    let bestD = Infinity;
    for (const u of game.units) {
      if (!this.ctx.visible(u)) continue;
      this.unitScreen(u, p);
      if (p.z > 1) continue;
      const dx = sx - p.x;
      const dy = sy - p.y;
      if ((dx * dx) / (p.rx * p.rx) + (dy * dy) / (p.ry * p.ry) > 1) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best) return best;

    const ground = this.rig.screenToGround(sx, sy);
    let bestNear = -Infinity;
    for (const b of game.buildings) {
      if (!this.ctx.visible(b)) continue;
      const s = b.size;
      let hit = ground && ground.x >= b.x && ground.x < b.x + s && ground.z >= b.y && ground.z < b.y + s;
      if (!hit) {
        // The silhouette: the screen box around the building's bounding box.
        const h = this.layers.buildings.metrics(b).height;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const cx of [b.x + 0.15, b.x + s - 0.15]) {
          for (const cz of [b.y + 0.15, b.y + s - 0.15]) {
            for (const cy of [0, h]) {
              this.rig.project(cx, cy, cz, this._p);
              minX = Math.min(minX, this._p.x);
              maxX = Math.max(maxX, this._p.x);
              minY = Math.min(minY, this._p.y);
              maxY = Math.max(maxY, this._p.y);
            }
          }
        }
        hit = sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
      }
      // When silhouettes overlap, the one nearer the camera wins.
      if (hit && b.y + s > bestNear) {
        bestNear = b.y + s;
        best = b;
      }
    }
    return best;
  }

  unitsInRect(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1) - 6;
    const maxX = Math.max(x0, x1) + 6;
    const minY = Math.min(y0, y1) - 6;
    const maxY = Math.max(y0, y1) + 6;
    const p = { x: 0, y: 0, z: 0, rx: 0, ry: 0 };
    return this.game.units.filter((u) => {
      if (!this.ctx.visible(u)) return false;
      this.unitScreen(u, p);
      return p.z < 1 && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    });
  }
}
