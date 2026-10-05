// Transient and interface effects: projectiles, corpses, rubble, bursts of
// fire/smoke/sparks, selection rings, command markers, the rally flag and the
// building placement preview. Everything is pooled; nothing is allocated per
// frame once the pools are warm.

import * as THREE from 'three';
import { TILE, PLAYER, NEUTRAL, BUILDINGS } from '../config.js';
import { createUnitModel } from './units.js';
import { createBuildingModel } from './buildings.js';
import { cyl, cone, box, dodeca, merge } from './geo.js';
import { SWATCH, teamColors } from './palette.js';

const SEL_COLORS = { own: 0x46ff63, foe: 0xff4a3d, neutral: 0xffe14a };
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();

function arrowGeometry() {
  return merge([
    cyl(0.012, 0.012, 0.52, 4, SWATCH.woodLight, { rx: Math.PI / 2 }),
    cone(0.032, 0.09, 4, SWATCH.iron, { z: 0.3, rx: Math.PI / 2 }),
    box(0.075, 0.004, 0.1, '#f2efe6', { z: -0.21 }),
    box(0.004, 0.075, 0.1, '#f2efe6', { z: -0.21 }),
  ]);
}

function boltGeometry() {
  return merge([
    cyl(0.03, 0.03, 0.6, 5, SWATCH.woodDark, { rx: Math.PI / 2 }),
    cone(0.06, 0.16, 5, SWATCH.ironDark, { z: 0.37, rx: Math.PI / 2 }),
    box(0.12, 0.008, 0.12, SWATCH.leather, { z: -0.24 }),
  ]);
}

// A soft dark blot used for blood stains and scorch marks.
function blotTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = i === 0 ? 0 : 10 + (i % 3) * 3;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const gr = g.createRadialGradient(x, y, 0, x, y, 16);
    gr.addColorStop(0, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A flat rounded-square frame of the given outer size and line width.
function frameGeometry(size, width) {
  const h = size / 2;
  const r = Math.min(0.35, size * 0.12);
  const shape = new THREE.Shape();
  const rounded = (path, hs, rr) => {
    path.moveTo(-hs + rr, -hs);
    path.lineTo(hs - rr, -hs);
    path.quadraticCurveTo(hs, -hs, hs, -hs + rr);
    path.lineTo(hs, hs - rr);
    path.quadraticCurveTo(hs, hs, hs - rr, hs);
    path.lineTo(-hs + rr, hs);
    path.quadraticCurveTo(-hs, hs, -hs, hs - rr);
    path.lineTo(-hs, -hs + rr);
    path.quadraticCurveTo(-hs, -hs, -hs + rr, -hs);
  };
  rounded(shape, h, r);
  const hole = new THREE.Path();
  rounded(hole, h - width, Math.max(0.01, r - width));
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 6);
  g.rotateX(-Math.PI / 2);
  return g;
}

function overlayMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export class EffectsLayer {
  /** @param {import('./index.js').LayerContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.owned = []; // geometries/materials/textures to dispose
    const own = (x) => {
      this.owned.push(x);
      return x;
    };
    this.own = own;

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();

    // Projectiles.
    this.arrows = new THREE.InstancedMesh(own(arrowGeometry()), ctx.palette.matte, 192);
    this.bolts = new THREE.InstancedMesh(own(boltGeometry()), ctx.palette.matte, 48);
    for (const m of [this.arrows, this.bolts]) {
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.flights = new WeakMap();

    // Game effects (corpses, rubble...) keyed by the effect object.
    this.live = new Map();
    this.blot = own(blotTexture());
    this.decalGeo = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    this.chunkGeo = own(merge([dodeca(0.16, SWATCH.stone, { sy: 0.7 })]));
    this.timberGeo = own(box(0.5, 0.07, 0.09, SWATCH.woodDark));

    // Selection rings and building frames.
    this.ringGeo = own(new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2));
    this.frameGeos = {};
    this.selMats = {};
    for (const [k, color] of Object.entries(SEL_COLORS)) {
      this.selMats[k] = own(overlayMaterial(color, 0.95));
      this.selMats[`${k}Hover`] = own(overlayMaterial(color, 0.45));
    }
    this.ringPool = [];
    this.framePool = [];

    // Command markers.
    this.markerPool = [];

    // Rally flag and its dotted trail.
    const tc = teamColors(PLAYER);
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(own(cyl(0.025, 0.03, 0.9, 5, SWATCH.woodDark, { y: 0.45 })), ctx.palette.matte);
    const cloth = new THREE.Mesh(own(box(0.32, 0.2, 0.02, tc.main, { x: 0.17, y: 0.78 })), ctx.palette.matte);
    pole.castShadow = true;
    cloth.castShadow = true;
    flag.add(pole, cloth);
    flag.visible = false;
    this.flag = flag;
    this.flagCloth = cloth;
    this.group.add(flag);
    this.dots = new THREE.InstancedMesh(own(new THREE.CircleGeometry(0.07, 10).rotateX(-Math.PI / 2)), own(overlayMaterial(SEL_COLORS.own, 0.8)), 120);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.group.add(this.dots);

    // Placement preview.
    this.ghosts = {};
    this.ghostMat = own(
      new THREE.MeshStandardMaterial({ color: 0x9dffb4, emissive: 0x2a8a3e, transparent: true, opacity: 0.55, depthWrite: true, roughness: 0.8 }),
    );
    this.tileQuads = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2)), own(overlayMaterial(0xffffff, 0.45)), 16);
    this.tileQuads.count = 0;
    this.tileQuads.frustumCulled = false;
    this.group.add(this.tileQuads);
    this.ghostShown = null;
  }

  visibleAt(wx, wz) {
    return this.ctx.fog.levelAt(Math.floor(wx), Math.floor(wz)) > 0.5;
  }

  sync(frame, clock) {
    const dt = Math.min(0.1, frame.dt || 0);
    this.syncProjectiles();
    this.syncGameEffects(dt);
    this.syncSelection(frame, clock);
    this.syncMarkers(frame);
    this.syncRally(frame, clock);
    this.syncPlacement(frame, clock);
  }

  // ---- projectiles ---------------------------------------------------------

  launchHeight(p) {
    const src = this.ctx.game.get(p.src);
    if (src && src.kind === 'building') return this.ctx.layers.buildings.metrics(src).height * 0.85;
    return 0.62;
  }

  syncProjectiles() {
    const { game, heightAt } = this.ctx;
    let na = 0;
    let nb = 0;
    const m = this._m;
    const d = this._d;
    for (const p of game.projectiles) {
      const x = p.x / TILE;
      const z = p.y / TILE;
      let f = this.flights.get(p);
      if (!f) {
        const tx = p.tx / TILE;
        const tz = p.ty / TILE;
        const target = game.get(p.target);
        f = {
          y0: heightAt(x, z) + this.launchHeight(p),
          y1: (target && target.kind === 'building' ? 0.9 : 0.5) + heightAt(tx, tz),
          total: Math.max(0.5, Math.hypot(tx - x, tz - z)),
        };
        f.arc = p.kind === 'arrow' ? Math.min(2.4, f.total * 0.2) : f.total * 0.05;
        this.flights.set(p, f);
      }
      if (!this.visibleAt(x, z)) continue;
      const remaining = Math.hypot(p.tx / TILE - x, p.ty / TILE - z);
      const k = Math.min(1, Math.max(0, 1 - remaining / f.total));
      const y = f.y0 + (f.y1 - f.y0) * k + Math.sin(k * Math.PI) * f.arc;
      const slope = (f.y1 - f.y0) / f.total + (Math.cos(k * Math.PI) * Math.PI * f.arc) / f.total;
      d.set(Math.cos(p.angle), slope, Math.sin(p.angle)).normalize();
      m.lookAt(d, ZERO, UP);
      m.setPosition(x, y, z);
      if (p.kind === 'arrow') {
        if (na < this.arrows.instanceMatrix.count) this.arrows.setMatrixAt(na++, m);
      } else if (nb < this.bolts.instanceMatrix.count) {
        this.bolts.setMatrixAt(nb++, m);
      }
    }
    this.arrows.count = na;
    this.bolts.count = nb;
    this.arrows.instanceMatrix.needsUpdate = true;
    this.bolts.instanceMatrix.needsUpdate = true;
  }

  // ---- corpses, rubble and bursts -------------------------------------------

  syncGameEffects(dt) {
    const { game } = this.ctx;
    const seen = new Set();
    for (const e of game.effects) {
      seen.add(e);
      let rec = this.live.get(e);
      if (!rec) {
        rec = this.spawn(e);
        this.live.set(e, rec);
      }
      if (rec.update) rec.update(e, dt);
    }
    for (const [e, rec] of this.live) {
      if (seen.has(e)) continue;
      if (rec.remove) rec.remove();
      this.live.delete(e);
    }
  }

  spawn(e) {
    const wx = e.x / TILE;
    const wz = e.y / TILE;
    const visible = this.visibleAt(wx, wz);
    switch (e.type) {
      case 'corpse':
        return this.spawnCorpse(e, wx, wz);
      case 'rubble':
        return this.spawnRubble(e, wx, wz);
      case 'explosion':
        if (visible) this.burst(wx, wz, e.size || 2);
        return {};
      case 'dust':
        if (visible) this.dust(wx, wz, e.size || 2);
        return {};
      case 'hit':
        if (visible) this.sparks(wx, wz);
        return {};
      default:
        return {};
    }
  }

  decal(color, opacity) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      map: this.blot,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(this.decalGeo, mat);
    mesh.renderOrder = 3;
    return mesh;
  }

  spawnCorpse(e, wx, wz) {
    const { heightAt, palette } = this.ctx;
    const holder = new THREE.Group();
    const body = createUnitModel(e.unitType || 'footman', e.owner ?? PLAYER, palette);
    const big = e.unitType === 'knight';
    // Lie the model on its side, turned a little at random.
    body.rotation.set(0, 0, (e.facing || 1) > 0 ? -Math.PI / 2 : Math.PI / 2);
    body.position.y = big ? 0.32 : 0.14;
    holder.add(body);
    const stain = this.decal(0x5a0c0c, 0.6);
    stain.scale.set(big ? 1.1 : 0.75, 1, big ? 1.1 : 0.75);
    stain.position.y = 0.02;
    holder.add(stain);
    holder.rotation.y = (((e.x * 13 + e.y * 7) % 100) / 100) * Math.PI * 2;
    const ground = heightAt(wx, wz);
    holder.position.set(wx, ground, wz);
    this.group.add(holder);
    return {
      update: (fx) => {
        holder.visible = this.visibleAt(wx, wz);
        // Sink into the ground over the last four seconds.
        const left = fx.life - fx.t;
        const sink = left < 4 ? (4 - left) / 4 : 0;
        body.position.y = (big ? 0.32 : 0.14) - sink * 0.7;
        stain.material.opacity = 0.6 * (1 - sink);
      },
      remove: () => {
        holder.removeFromParent();
        stain.material.dispose();
      },
    };
  }

  spawnRubble(e, wx, wz) {
    const { heightAt, palette } = this.ctx;
    const size = e.size || 2;
    const holder = new THREE.Group();
    const n = Math.round(size * size * 3);
    const stones = new THREE.InstancedMesh(this.chunkGeo, palette.matte, n);
    const beams = new THREE.InstancedMesh(this.timberGeo, palette.matte, Math.ceil(n / 3));
    const seed = Math.floor(e.x * 31 + e.y * 17);
    const rnd = (i) => {
      const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const m = this._m;
    const q = this._q;
    const s = this._s;
    const p = this._v;
    for (let i = 0; i < n; i++) {
      const px = (rnd(i) - 0.5) * size * 0.9;
      const pz = (rnd(i + 99) - 0.5) * size * 0.9;
      const sc = 0.5 + rnd(i + 7) * 1.1;
      q.setFromEuler(new THREE.Euler(rnd(i + 3) * 3, rnd(i + 5) * 6, rnd(i + 9) * 3));
      m.compose(p.set(px, heightAt(wx + px, wz + pz) - heightAt(wx, wz) + 0.04, pz), q, s.set(sc, sc, sc));
      stones.setMatrixAt(i, m);
      stones.setColorAt(i, this._c.setScalar(0.55 + rnd(i + 11) * 0.45));
    }
    for (let i = 0; i < beams.count; i++) {
      const px = (rnd(i + 300) - 0.5) * size * 0.8;
      const pz = (rnd(i + 400) - 0.5) * size * 0.8;
      q.setFromEuler(new THREE.Euler(rnd(i + 500) * 0.5, rnd(i + 600) * 6, rnd(i + 700) * 0.6));
      const sc = 0.8 + rnd(i + 800) * 1.4;
      m.compose(p.set(px, heightAt(wx + px, wz + pz) - heightAt(wx, wz) + 0.06, pz), q, s.set(sc, 1, 1));
      beams.setMatrixAt(i, m);
      beams.setColorAt(i, this._c.setScalar(0.35 + rnd(i + 900) * 0.4));
    }
    stones.castShadow = true;
    stones.receiveShadow = true;
    beams.castShadow = true;
    const scorch = this.decal(0x14100c, 0.75);
    scorch.scale.set(size * 1.25, 1, size * 1.25);
    scorch.position.y = 0.02;
    holder.add(stones, beams, scorch);
    holder.position.set(wx, heightAt(wx, wz), wz);
    this.group.add(holder);
    s.set(1, 1, 1);
    return {
      update: (fx) => {
        const left = fx.life - fx.t;
        const fade = left < 8 ? (8 - left) / 8 : 0;
        stones.position.y = -fade * 0.35;
        beams.position.y = -fade * 0.35;
        scorch.material.opacity = 0.75 * (1 - fade);
        // Smoulder for a while after the collapse.
        if (fx.t < 12 && Math.random() < 0.12 && this.visibleAt(wx, wz)) {
          this.ctx.particles.smoke.emit({
            x: wx + (Math.random() - 0.5) * size * 0.7,
            y: holder.position.y + 0.2,
            z: wz + (Math.random() - 0.5) * size * 0.7,
            vy: 0.5,
            vx: 0.15,
            life: 2.5,
            size: 0.5,
            size1: 1.4,
            color: [0.25, 0.23, 0.21, 0.5],
            color1: [0.35, 0.33, 0.3, 0],
            drag: 0.3,
          });
        }
      },
      remove: () => {
        holder.removeFromParent();
        stones.dispose();
        beams.dispose();
        scorch.material.dispose();
      },
    };
  }

  burst(wx, wz, size) {
    const { glow, smoke, spark } = this.ctx.particles;
    const y = this.ctx.heightAt(wx, wz);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * size * 0.45;
      glow.emit({
        x: wx + Math.cos(a) * r,
        y: y + 0.2 + Math.random() * size * 0.5,
        z: wz + Math.sin(a) * r,
        vx: Math.cos(a) * 1.4,
        vy: 1.5 + Math.random() * 2.5,
        vz: Math.sin(a) * 1.4,
        life: 0.5 + Math.random() * 0.6,
        size: 0.8 + Math.random() * 0.9,
        size1: 0.2,
        color: [1, 0.62, 0.22, 1],
        color1: [0.9, 0.2, 0.05, 0],
        drag: 2,
      });
    }
    for (let i = 0; i < 30; i++) {
      smoke.emit({
        x: wx + (Math.random() - 0.5) * size,
        y: y + 0.4 + Math.random() * 0.8,
        z: wz + (Math.random() - 0.5) * size,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 0.9 + Math.random() * 1.4,
        vz: (Math.random() - 0.5) * 0.6,
        life: 2.2 + Math.random() * 1.6,
        size: 0.9,
        size1: 2.6,
        color: [0.18, 0.16, 0.14, 0.75],
        color1: [0.4, 0.38, 0.35, 0],
        drag: 0.4,
      });
    }
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 3.5;
      spark.emit({
        x: wx,
        y: y + 0.6,
        z: wz,
        vx: Math.cos(a) * sp,
        vy: 2.5 + Math.random() * 4,
        vz: Math.sin(a) * sp,
        life: 0.8 + Math.random() * 0.7,
        size: 0.14,
        size1: 0.06,
        color: [1, 0.85, 0.5, 1],
        color1: [1, 0.4, 0.1, 0],
        gravity: 9,
      });
    }
  }

  dust(wx, wz, size) {
    const y = this.ctx.heightAt(wx, wz);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const r = size * 0.55;
      this.ctx.particles.smoke.emit({
        x: wx + Math.cos(a) * r,
        y: y + 0.15,
        z: wz + Math.sin(a) * r,
        vx: Math.cos(a) * 1.2,
        vy: 0.35,
        vz: Math.sin(a) * 1.2,
        life: 1.2 + Math.random() * 0.5,
        size: 0.5,
        size1: 1.3,
        color: [0.62, 0.52, 0.38, 0.6],
        color1: [0.7, 0.62, 0.5, 0],
        drag: 2.2,
      });
    }
  }

  sparks(wx, wz) {
    const y = this.ctx.heightAt(wx, wz) + 0.5;
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      this.ctx.particles.spark.emit({
        x: wx,
        y,
        z: wz,
        vx: Math.cos(a) * 1.8,
        vy: 1 + Math.random() * 1.5,
        vz: Math.sin(a) * 1.8,
        life: 0.25 + Math.random() * 0.15,
        size: 0.12,
        size1: 0.04,
        color: [1, 0.95, 0.7, 1],
        color1: [1, 0.6, 0.2, 0],
        gravity: 6,
      });
    }
  }

  // ---- selection ---------------------------------------------------------------

  frameGeo(size) {
    if (!this.frameGeos[size]) this.frameGeos[size] = this.own(frameGeometry(size + 0.3, 0.09));
    return this.frameGeos[size];
  }

  syncSelection(frame, clock) {
    const { game, heightAt } = this.ctx;
    let nr = 0;
    let nf = 0;
    const pulse = 1 + Math.sin(clock * 5) * 0.035;
    const show = (e, hover) => {
      if (!e || e.dead || !this.ctx.visible(e)) return;
      const kind = e.owner === PLAYER ? 'own' : e.owner === NEUTRAL ? 'neutral' : 'foe';
      const mat = this.selMats[hover ? `${kind}Hover` : kind];
      if (e.kind === 'building') {
        let mesh = this.framePool[nf];
        if (!mesh) {
          mesh = new THREE.Mesh(this.frameGeo(e.size), mat);
          mesh.renderOrder = 5;
          this.framePool.push(mesh);
          this.group.add(mesh);
        }
        nf++;
        mesh.geometry = this.frameGeo(e.size);
        mesh.material = mat;
        const cx = e.x + e.size / 2;
        const cz = e.y + e.size / 2;
        mesh.position.set(cx, heightAt(cx, cz) + 0.06, cz);
        mesh.visible = true;
      } else {
        let mesh = this.ringPool[nr];
        if (!mesh) {
          mesh = new THREE.Mesh(this.ringGeo, mat);
          mesh.renderOrder = 5;
          this.ringPool.push(mesh);
          this.group.add(mesh);
        }
        nr++;
        mesh.material = mat;
        const r = this.ctx.layers.units.metrics(e).radius * 1.25 * (hover ? 1 : pulse);
        const x = e.x / TILE;
        const z = e.y / TILE;
        mesh.scale.set(r, 1, r);
        mesh.position.set(x, heightAt(x, z) + 0.05, z);
        mesh.visible = true;
      }
    };
    for (const id of frame.selection) show(game.get(id), false);
    if (frame.hover && !frame.selection.has(frame.hover.id)) show(frame.hover, true);
    for (let i = nr; i < this.ringPool.length; i++) this.ringPool[i].visible = false;
    for (let i = nf; i < this.framePool.length; i++) this.framePool[i].visible = false;
  }

  // ---- command markers -----------------------------------------------------------

  syncMarkers(frame) {
    const { heightAt } = this.ctx;
    const list = frame.markers || [];
    for (let i = 0; i < list.length; i++) {
      const mk = list[i];
      let mesh = this.markerPool[i];
      if (!mesh) {
        mesh = new THREE.Mesh(this.ringGeo, this.own(overlayMaterial(0xffffff, 1)));
        mesh.renderOrder = 6;
        this.markerPool.push(mesh);
        this.group.add(mesh);
      }
      const k = Math.min(1, mk.t / mk.life);
      const x = mk.x / TILE;
      const z = mk.y / TILE;
      const r = 0.55 * (1 - k * 0.65);
      mesh.scale.set(r, 1, r);
      mesh.position.set(x, heightAt(x, z) + 0.06, z);
      mesh.material.color.set(mk.color);
      mesh.material.opacity = 1 - k * k;
      mesh.visible = true;
    }
    for (let i = list.length; i < this.markerPool.length; i++) this.markerPool[i].visible = false;
  }

  // ---- rally point ------------------------------------------------------------------

  syncRally(frame, clock) {
    const { game, heightAt } = this.ctx;
    let b = null;
    if (frame.selection.size === 1) {
      const e = game.get(frame.selection.values().next().value);
      if (e && e.kind === 'building' && e.owner === PLAYER && e.rally) b = e;
    }
    if (!b) {
      this.flag.visible = false;
      this.dots.count = 0;
      return;
    }
    const fx = b.rally.x + 0.5;
    const fz = b.rally.y + 0.5;
    this.flag.position.set(fx, heightAt(fx, fz), fz);
    this.flag.visible = true;
    this.flagCloth.rotation.y = Math.sin(clock * 4) * 0.25;
    // A marching trail of dots from the building to the flag.
    const sx = b.x + b.size / 2;
    const sz = b.y + b.size / 2;
    const len = Math.hypot(fx - sx, fz - sz);
    const step = 0.45;
    const n = Math.min(this.dots.instanceMatrix.count, Math.floor(len / step));
    const offset = (clock * 1.2) % step;
    const m = this._m;
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, (i * step + offset) / len);
      const x = sx + (fx - sx) * t;
      const z = sz + (fz - sz) * t;
      m.makeTranslation(x, heightAt(x, z) + 0.06, z);
      this.dots.setMatrixAt(i, m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  // ---- building placement preview ------------------------------------------------------

  ghost(type) {
    if (!this.ghosts[type]) {
      const obj = createBuildingModel(type, PLAYER, this.ctx.palette);
      obj.traverse((o) => {
        if (o.isMesh) {
          o.material = this.ghostMat;
          o.castShadow = false;
          o.receiveShadow = false;
          o.renderOrder = 7;
        }
      });
      obj.visible = false;
      this.group.add(obj);
      this.ghosts[type] = obj;
    }
    return this.ghosts[type];
  }

  syncPlacement(frame, clock) {
    const pl = frame.placement;
    if (this.ghostShown && (!pl || this.ghostShown !== this.ghosts[pl.type])) {
      this.ghostShown.visible = false;
      this.ghostShown = null;
    }
    if (!pl || !BUILDINGS[pl.type]) {
      this.tileQuads.count = 0;
      return;
    }
    const { heightAt } = this.ctx;
    const size = BUILDINGS[pl.type].size;
    const g = this.ghost(pl.type);
    const cx = pl.x + size / 2;
    const cz = pl.y + size / 2;
    g.position.set(cx, heightAt(cx, cz), cz);
    g.visible = true;
    this.ghostShown = g;
    let bad = false;
    let n = 0;
    const m = this._m;
    for (let ty = pl.y; ty < pl.y + size; ty++) {
      for (let tx = pl.x; tx < pl.x + size; tx++) {
        const ok = pl.tileOk(tx, ty);
        if (!ok) bad = true;
        m.makeTranslation(tx + 0.5, heightAt(tx + 0.5, ty + 0.5) + 0.05, ty + 0.5);
        this.tileQuads.setMatrixAt(n, m);
        this.tileQuads.setColorAt(n, this._c.set(ok ? 0x3cff6a : 0xff3a2a));
        n++;
      }
    }
    this.tileQuads.count = n;
    this.tileQuads.instanceMatrix.needsUpdate = true;
    if (this.tileQuads.instanceColor) this.tileQuads.instanceColor.needsUpdate = true;
    this.ghostMat.color.set(bad ? 0xff9d8a : 0x9dffb4);
    this.ghostMat.emissive.set(bad ? 0x8a2a1e : 0x2a8a3e);
    this.ghostMat.opacity = 0.5 + Math.sin(clock * 4) * 0.06;
  }

  dispose() {
    for (const rec of this.live.values()) if (rec.remove) rec.remove();
    this.live.clear();
    this.group.removeFromParent();
    this.arrows.dispose();
    this.bolts.dispose();
    this.dots.dispose();
    this.tileQuads.dispose();
    for (const x of this.owned) x.dispose();
  }
}
