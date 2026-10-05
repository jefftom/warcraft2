// Building models and the building layer.
//
//   new BuildingLayer(ctx)
//   sync(frame, clock)     create/update/remove a model per visible building
//   metrics(building)      { height } in world units, for picking and bars
//   dispose()
// Also exports createBuildingModel(type, owner, palette) -> THREE.Object3D
// (used for the placement preview).
//
// Every model is built once per (type, owner) from the geo.js kit and merged
// into a handful of geometries: `body` (matte), `metal`, `glow` (windows,
// torches, forge mouths) and `cloth` (flags, banners, swaying crops, animated
// in the vertex shader through an `aWave` attribute). The lumber mill also has
// a `spin` part (its saw blade). Models are local to the footprint centre with
// y = 0 on the ground and the front door facing +z (toward the camera).
//
// Construction: the body is drawn with a per-building clip material that
// discards everything above the current build height, a plank floor caps the
// hollow walls, and a timber scaffold (three stages) stands around it.

import * as THREE from 'three';
import { BUILDINGS } from '../config.js';
import { box, cyl, cone, ico, dodeca, prism, gable, merge, mix, hash, finish } from './geo.js';
import { SWATCH as C, teamColors } from './palette.js';

const PT = 0.14; // plinth top: walls start here
const TAU = Math.PI * 2;
const FACE_RY = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

const GLOW = {
  win: '#ffc65a',
  flame: '#ffe08a',
  flameCore: '#ffb347',
  forge: '#ff7a1e',
  forgeHot: '#ffd36b',
  gold: '#ffd75a',
  lantern: '#ffcc66',
};

const WALL = mix(C.stone, C.stoneLight, 0.35);
const QUOIN = mix(C.stoneLight, C.plaster, 0.35);

// Top of the roof, spire or flag, for picking and health bars.
const HEIGHT = { townhall: 3.25, farm: 1.45, barracks: 2.15, lumbermill: 2.0, blacksmith: 2.35, tower: 3.15, goldmine: 1.45 };
const heightOf = (type) => HEIGHT[type] || (BUILDINGS[type]?.size || 2) * 0.75;

// ---- geometry helpers ------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Point on a wall face: `a` along the wall, `o` outward from it. */
function fpos(face, x, z, a, o) {
  if (face === 'S') return [x + a, z + o];
  if (face === 'N') return [x - a, z - o];
  if (face === 'E') return [x + o, z - a];
  return [x - o, z + a];
}

/** A box on a wall face: `wa` wide along the wall, `wo` deep out of it. */
function fbox(face, x, z, a, o, wa, h, wo, color, y, t = {}) {
  const [px, pz] = fpos(face, x, z, a, o);
  const side = face === 'E' || face === 'W';
  return box(side ? wo : wa, h, side ? wa : wo, color, { ...t, x: px, y, z: pz });
}

/** Outline of an arched opening, base at y = 0. */
function archShape(w, h, n = 6) {
  const r = w / 2;
  const yc = Math.max(0.01, h - r);
  const pts = [
    [-r, 0],
    [r, 0],
  ];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    pts.push([Math.cos(a) * r, yc + Math.sin(a) * r]);
  }
  return pts;
}

/** Arched slab on a wall face; base at y0. */
function archAt(face, x, z, o, w, h, depth, color, y0) {
  const [px, pz] = fpos(face, x, z, 0, o);
  return prism(archShape(w, h), depth, color, { x: px, y: y0, z: pz, ry: FACE_RY[face] });
}

/** Square frustum: bottom wb x db, top wt x dt, height h; base at t.y. */
function frustum(wb, db, wt, dt, h, color, t) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const top = pos.getY(i) > 0;
    pos.setXYZ(i, pos.getX(i) * (top ? wt : wb), top ? h : 0, pos.getZ(i) * (top ? dt : db));
  }
  return finish(g, color, t);
}

/** Adds a sway weight to a finished geometry: 0 at y0, 1 at y1 (for crops). */
function addSway(g, y0, y1, amp, dx = 1, dz = 0.35) {
  const pos = g.attributes.position;
  const a = new Float32Array(pos.count * 4);
  const l = Math.hypot(dx, dz);
  for (let i = 0; i < pos.count; i++) {
    a[i * 4] = (dx / l) * amp;
    a[i * 4 + 2] = (dz / l) * amp;
    a[i * 4 + 3] = clamp01((pos.getY(i) - y0) / (y1 - y0));
  }
  g.setAttribute('aWave', new THREE.BufferAttribute(a, 4));
  return g;
}

const _q = new THREE.Quaternion();
const _eu = new THREE.Euler();
const _dv = new THREE.Vector3();

/**
 * Turns a canonical (untransformed) cloth geometry into a waving piece:
 * weight(x, y) is 0 where it is attached and 1 at the free edge; it flutters
 * along its local z (its normal).
 */
function clothGeo(g, color, t, amp, weight) {
  const pos = g.attributes.position;
  const a = new Float32Array(pos.count * 4);
  _eu.set(t.rx || 0, t.ry || 0, t.rz || 0);
  _q.setFromEuler(_eu);
  _dv.set(0, 0, amp).applyQuaternion(_q);
  for (let i = 0; i < pos.count; i++) {
    a[i * 4] = _dv.x;
    a[i * 4 + 1] = _dv.y;
    a[i * 4 + 2] = _dv.z;
    a[i * 4 + 3] = clamp01(weight(pos.getX(i), pos.getY(i)));
  }
  g.setAttribute('aWave', new THREE.BufferAttribute(a, 4));
  return finish(g, color, t);
}

// ---- model parts -------------------------------------------------------------

class Parts {
  constructor(type, owner) {
    this.type = type;
    this.tc = teamColors(owner);
    this.body = [];
    this.metal = [];
    this.glow = [];
    this.cloth = [];
    this.spin = [];
    this.spinAt = null;
    this.fx = { torches: [], chimneys: [], fires: [], glints: [], anvil: null, forge: null, saw: null, lanterns: [], entrance: null };
    this.core = null;
    this.seed = 1;
  }

  rnd() {
    this.seed++;
    return hash(this.seed * 7919 + 101);
  }
}

function plinth(p, w, d, o = {}) {
  const top = o.top ?? PT;
  const depth = 0.5;
  p.body.push(box(w, top + depth, d, o.color || C.stoneDark, { y: (top - depth) / 2 }));
  p.body.push(box(w + 0.02, 0.045, d + 0.02, o.cap || mix(C.stone, C.stoneDark, 0.35), { y: top - 0.022 }));
  // Flagstones on exposed parts of the plinth top: [x0, x1, z0, z1] areas.
  for (const [ax0, ax1, az0, az1] of o.paving || []) {
    for (let zz = az0; zz < az1 - 0.05; zz += 0.2) {
      let xx = ax0 + p.rnd() * 0.12;
      while (xx < ax1 - 0.08) {
        const len = Math.min(ax1 - xx, 0.2 + p.rnd() * 0.2);
        const dz = Math.min(az1 - zz, 0.2);
        p.body.push(box(len - 0.03, 0.02, dz - 0.03, mix(C.stone, C.stoneLight, p.rnd() * 0.6), { x: xx + len / 2, y: top + 0.008, z: zz + dz / 2 }));
        xx += len;
      }
    }
  }
  if (o.rocks === false) return;
  // Footing stones where the plinth meets the ground (front and sides).
  const edges = [
    ['S', w, d / 2 - 0.03],
    ['W', d, w / 2 - 0.03],
    ['E', d, w / 2 - 0.03],
  ];
  for (const [face, len, off] of edges) {
    const n = Math.max(2, Math.round(len / 0.45));
    for (let i = 0; i < n; i++) {
      const a = -len / 2 + ((i + 0.3 + p.rnd() * 0.4) / n) * len;
      const [x, z] = fpos(face, 0, 0, a, off);
      const r = 0.05 + p.rnd() * 0.04;
      p.body.push(dodeca(r, p.rnd() > 0.5 ? C.rock : C.rockDark, { x: x * 0.985, y: 0.01, z: z * 0.985, sy: 0.7, ry: p.rnd() * 3 }));
    }
  }
}

function ashlar(p, face, u0, u1, plane, y0, y1, col, density = 0.42) {
  const rowH = 0.15;
  let row = 0;
  for (let y = y0; y + rowH * 0.85 < y1; y += rowH, row++) {
    let u = u0 + 0.05 + (row % 2) * 0.11;
    while (u < u1 - 0.12) {
      const len = 0.17 + p.rnd() * 0.17;
      const end = Math.min(u1 - 0.05, u + len);
      if (p.rnd() < density && end - u > 0.09) {
        const mid = (u + end) / 2;
        const L = end - u - 0.03;
        const shade = (p.rnd() - 0.5) * 0.24;
        if (face === 'S') p.body.push(box(L, rowH - 0.03, 0.03, col, { x: mid, y: y + rowH / 2, z: plane, shade }));
        else p.body.push(box(0.03, rowH - 0.03, L, col, { x: plane, y: y + rowH / 2, z: mid, shade }));
      }
      u = end + 0.02;
    }
  }
}

function quoins(p, corners, y0, y1) {
  for (const [cx, cz, sx, sz] of corners) {
    let k = 0;
    for (let y = y0; y + 0.1 < y1; y += 0.14, k++) {
      const shade = (p.rnd() - 0.5) * 0.14;
      if (k % 2) p.body.push(box(0.2, 0.115, 0.1, QUOIN, { x: cx - sx * 0.085, y: y + 0.06, z: cz - sz * 0.035, shade }));
      else p.body.push(box(0.1, 0.115, 0.2, QUOIN, { x: cx - sx * 0.035, y: y + 0.06, z: cz - sz * 0.085, shade }));
    }
  }
}

/** Stone walls of a rectangular block, with base course, cornice, quoins and masonry. */
function stoneWalls(p, x0, x1, z0, z1, y0, y1, o = {}) {
  const w = x1 - x0;
  const d = z1 - z0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const col = o.color || WALL;
  p.body.push(box(w, h, d, col, { x: cx, y: y0 + h / 2, z: cz }));
  if (!o.noBase) p.body.push(box(w + 0.04, 0.1, d + 0.04, C.stoneDark, { x: cx, y: y0 + 0.05, z: cz }));
  if (!o.noTop) p.body.push(box(w + 0.06, 0.065, d + 0.06, C.stoneLight, { x: cx, y: y1 - 0.032, z: cz, shade: -0.04 }));
  if (!o.noQuoins) {
    const cs = [
      [x0, z1, -1, 1],
      [x1, z1, 1, 1],
    ];
    if (!o.frontQuoins) cs.push([x0, z0, -1, -1], [x1, z0, 1, -1]);
    quoins(p, cs, y0 + (o.noBase ? 0 : 0.1), y1 - 0.065);
  }
  const ya = y0 + (o.noBase ? 0.02 : 0.11);
  const yb = y1 - 0.07;
  const dens = o.density ?? 0.42;
  if (o.faces !== false) {
    const faces = o.faces || 'SWE';
    if (faces.includes('S')) ashlar(p, 'S', x0 + 0.1, x1 - 0.1, z1, ya, yb, col, dens);
    if (faces.includes('W')) ashlar(p, 'W', z0 + 0.1, z1 - 0.1, x0, ya, yb, col, dens);
    if (faces.includes('E')) ashlar(p, 'E', z0 + 0.1, z1 - 0.1, x1, ya, yb, col, dens);
  }
}

function framing(p, face, u0, u1, plane, y0, y1, beam, braces) {
  const n = Math.max(1, Math.round((u1 - u0) / 0.42));
  const at = (u, o, wa, h, wo, y, t) => (face === 'S' ? box(wa, h, wo, beam, { ...t, x: u, y, z: plane + o }) : box(wo, h, wa, beam, { ...t, x: plane + (face === 'E' ? o : -o), y, z: u }));
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    p.body.push(at(u, 0.008, 0.055, y1 - y0, 0.03, (y0 + y1) / 2));
  }
  if (!braces) return;
  const step = (u1 - u0) / n;
  for (const i of n > 1 ? [0, n - 1] : [0]) {
    const ua = u0 + step * i;
    const len = Math.hypot(step, y1 - y0);
    const ang = Math.atan2(y1 - y0, step) * (i === 0 ? 1 : -1);
    const mid = ua + step / 2;
    if (face === 'S') p.body.push(box(len - 0.02, 0.045, 0.026, beam, { x: mid, y: (y0 + y1) / 2, z: plane + 0.008, rz: ang }));
    else p.body.push(box(0.026, 0.045, len - 0.02, beam, { x: plane + (face === 'E' ? 0.008 : -0.008), y: (y0 + y1) / 2, z: mid, rx: face === 'E' ? ang : -ang }));
  }
}

/** Timber-framed plaster walls. */
function timberWalls(p, x0, x1, z0, z1, y0, y1, o = {}) {
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const beam = o.beam || C.woodDark;
  p.body.push(box(w, y1 - y0, d, o.fill || C.plaster, { x: cx, y: (y0 + y1) / 2, z: cz }));
  p.body.push(box(w + 0.035, 0.065, d + 0.035, beam, { x: cx, y: y0 + 0.032, z: cz }));
  p.body.push(box(w + 0.035, 0.06, d + 0.035, beam, { x: cx, y: y1 - 0.03, z: cz }));
  if (o.mid) p.body.push(box(w + 0.03, 0.045, d + 0.03, beam, { x: cx, y: o.mid, z: cz }));
  framing(p, 'S', x0, x1, z1, y0, y1, beam, o.braces !== false);
  framing(p, 'W', z0, z1, x0, y0, y1, beam, o.braces !== false);
  framing(p, 'E', z0, z1, x1, y0, y1, beam, o.braces !== false);
}

/** Plank walls with alternating boards (lumber mill). */
function plankWalls(p, x0, x1, z0, z1, y0, y1) {
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const h = y1 - y0;
  p.body.push(box(w, h, d, C.woodLight, { x: cx, y: y0 + h / 2, z: cz, shade: -0.06 }));
  const boards = (face, u0, u1, plane) => {
    let k = 0;
    for (let u = u0 + 0.06; u < u1 - 0.05; u += 0.13, k++) {
      if (k % 2) continue;
      const shade = (p.rnd() - 0.5) * 0.16;
      if (face === 'S') p.body.push(box(0.11, h - 0.04, 0.02, C.woodLight, { x: u, y: y0 + h / 2, z: plane + 0.004, shade }));
      else p.body.push(box(0.02, h - 0.04, 0.11, C.woodLight, { x: plane + (face === 'E' ? 0.004 : -0.004), y: y0 + h / 2, z: u, shade }));
    }
  };
  boards('S', x0, x1, z1);
  boards('W', z0, z1, x0);
  boards('E', z0, z1, x1);
  for (const [x, z] of [
    [x0, z1],
    [x1, z1],
    [x0, z0],
    [x1, z0],
  ]) {
    p.body.push(box(0.09, h + 0.02, 0.09, C.woodDark, { x, y: y0 + h / 2, z }));
  }
  p.body.push(box(w + 0.05, 0.07, d + 0.05, C.woodDark, { x: cx, y: y0 + 0.035, z: cz }));
  p.body.push(box(w + 0.05, 0.06, d + 0.05, C.woodDark, { x: cx, y: y1 - 0.03, z: cz }));
  p.body.push(box(w + 0.03, 0.045, d + 0.03, C.woodDark, { x: cx, y: y0 + h * 0.55, z: cz }));
}

/** Gabled roof with shingle courses. Ridge along local X; base at y; rotated by ry. */
function gableRoof(p, o) {
  const { x = 0, y = 0, z = 0, w, d, h, color, ry = 0, rows = 4, oh = 0.1, end = C.stone, trim = C.woodDark, t = 0.045, list = p.body } = o;
  const alt = o.alt || mix(color, '#000000', 0.2);
  const g = [];
  const a = Math.atan2(h, d / 2);
  const L = Math.hypot(h, d / 2);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  g.push(gable(Math.max(0.05, w - oh * 2), d - 0.08, h - 0.04, end));
  for (const side of [1, -1]) {
    for (let i = 0; i < rows; i++) {
      const s0 = (i / rows) * L;
      const s1 = ((i + 1) / rows) * L;
      const len = s1 - s0 + 0.07;
      const s = (s0 + s1) / 2;
      const off = t / 2 + 0.004 + (rows - i) * 0.004;
      g.push(box(w, t, len, i % 2 ? alt : color, { y: s * sa + ca * off, z: side * (d / 2 - s * ca + sa * off), rx: side * (a - 0.07) }));
    }
    // Fascia along the eave.
    g.push(box(w + 0.01, 0.05, 0.035, o.fascia || mix(color, '#000000', 0.45), { y: -0.005, z: side * (d / 2 + 0.005) }));
  }
  g.push(box(w + 0.04, o.ridgeSize || 0.085, o.ridgeSize || 0.085, o.ridge || mix(color, '#000000', 0.35), { y: h + 0.015, rx: Math.PI / 4 }));
  if (trim) {
    for (const sx of [-1, 1]) {
      for (const side of [1, -1]) {
        const s = L / 2;
        const off = t + 0.02;
        g.push(box(0.05, 0.065, L + 0.03, trim, { x: sx * (w / 2 - 0.012), y: s * sa + ca * off * 0.5, z: side * (d / 2 - s * ca + sa * off * 0.5), rx: side * a }));
      }
    }
  }
  const geo = merge(g);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  list.push(geo);
}

/** Hipped roof built from overlapping courses; base w x d at y. */
function hipRoof(p, o) {
  const { x = 0, y = 0, z = 0, w, d, h, color, rows = 4, flare = 0.055, list = p.body } = o;
  const alt = o.alt || mix(color, '#000000', 0.2);
  const m = Math.min(w, d) / 2;
  const g = [];
  g.push(frustum(w + 0.02, d + 0.02, w - 0.02, d - 0.02, 0.05, o.fascia || mix(color, '#000000', 0.45), { y: -0.03 }));
  for (let i = 0; i < rows; i++) {
    const f0 = i / rows;
    const f1 = (i + 1) / rows;
    const fl = i === 0 ? 0 : flare;
    const drop = i === 0 ? 0 : 0.02;
    g.push(frustum(w - 2 * m * f0 + 2 * fl, d - 2 * m * f0 + 2 * fl, w - 2 * m * f1, d - 2 * m * f1, h * (f1 - f0) + drop, i % 2 ? alt : color, { y: h * f0 - drop }));
  }
  if (Math.abs(w - d) > 0.02) {
    const along = w > d;
    const len = Math.abs(w - d) + 0.08;
    g.push(box(along ? len : 0.085, 0.085, along ? 0.085 : len, o.ridge || mix(color, '#000000', 0.35), { y: h + 0.005, rx: along ? Math.PI / 4 : 0, rz: along ? 0 : Math.PI / 4 }));
  }
  const geo = merge(g);
  geo.translate(x, y, z);
  list.push(geo);
}

/** Conical roof in courses; base radius r at y. */
function coneRoof(p, o) {
  const { x = 0, y = 0, z = 0, r, h, color, rows = 3, segs = 10, flare = 0.045, list = p.body } = o;
  const alt = o.alt || mix(color, '#000000', 0.2);
  list.push(cyl(r + 0.01, r + 0.01, 0.05, segs, mix(color, '#000000', 0.45), { x, y: y - 0.005, z, ry: Math.PI / segs }));
  for (let i = 0; i < rows; i++) {
    const f0 = i / rows;
    const f1 = (i + 1) / rows;
    const fl = i === 0 ? 0 : flare;
    const drop = i === 0 ? 0 : 0.02;
    const th = h * (f1 - f0) + drop;
    list.push(cyl(r * (1 - f1), r * (1 - f0) + fl, th, segs, i % 2 ? alt : color, { x, y: y + h * f0 - drop + th / 2, z, ry: Math.PI / segs }));
  }
}

function windowAt(p, face, x, y, z, w = 0.17, h = 0.24, o = {}) {
  const glow = o.color || GLOW.win;
  if (o.arch) {
    p.body.push(archAt(face, x, z, 0.012, w + 0.09, h + 0.075, 0.036, o.frame || C.stoneLight, y - h / 2 - 0.045));
    p.glow.push(archAt(face, x, z, 0.03, w, h, 0.03, glow, y - h / 2));
  } else {
    p.body.push(fbox(face, x, z, 0, 0.012, w + 0.075, h + 0.075, 0.036, o.frame || C.woodDark, y));
    p.glow.push(fbox(face, x, z, 0, 0.03, w, h, 0.03, glow, y));
  }
  const bar = o.bars ? C.ironDark : C.woodDark;
  if (o.bars) {
    for (const k of [-1, 0, 1]) p.body.push(fbox(face, x, z, (k * w) / 3.2, 0.05, 0.018, h, 0.016, bar, y));
  } else if (w > 0.1) {
    p.body.push(fbox(face, x, z, 0, 0.05, 0.022, h * (o.arch ? 0.95 : 1), 0.016, bar, y));
    p.body.push(fbox(face, x, z, 0, 0.05, w, 0.022, 0.016, bar, y - (o.arch ? h * 0.08 : 0)));
  }
  if (o.sill !== false) p.body.push(fbox(face, x, z, 0, 0.035, w + 0.11, 0.035, 0.07, o.sillColor || C.stoneLight, y - h / 2 - 0.045));
  if (o.shutters) {
    for (const s of [-1, 1]) p.body.push(fbox(face, x, z, s * (w / 2 + 0.075), 0.026, 0.1, h + 0.05, 0.026, o.shutters, y));
  }
}

function doorAt(p, face, x, z, w, h, o = {}) {
  const y0 = o.y0 ?? PT;
  const col = o.color || C.woodDark;
  p.body.push(archAt(face, x, z, 0.012, w + 0.13, h + 0.075, 0.05, o.frame || C.stoneLight, y0));
  p.body.push(archAt(face, x, z, 0.032, w, h, 0.03, col, y0));
  const n = Math.max(2, Math.round(w / 0.1));
  const groove = mix(col, '#000000', 0.35);
  for (let i = 1; i < n; i++) p.body.push(fbox(face, x, z, -w / 2 + (i * w) / n, 0.05, 0.014, h - w * 0.45, 0.01, groove, y0 + (h - w * 0.45) / 2));
  for (const k of [0.25, 0.62]) p.body.push(fbox(face, x, z, 0, 0.052, w * 0.94, 0.03, 0.012, C.ironDark, y0 + h * k));
  if (o.double) p.body.push(fbox(face, x, z, 0, 0.054, 0.02, h - w * 0.3, 0.012, C.ironDark, y0 + (h - w * 0.3) / 2));
  p.body.push(fbox(face, x, z, 0.0, 0.11, w + 0.2, 0.05, 0.16, o.step || C.stoneDark, y0 + 0.002));
}

function torchAt(p, face, x, y, z) {
  p.body.push(fbox(face, x, z, 0, 0.03, 0.06, 0.07, 0.05, C.ironDark, y - 0.06));
  const [hx, hz] = fpos(face, x, z, 0, 0.085);
  const [bx, bz] = fpos(face, x, z, 0, 0.055);
  p.body.push(cyl(0.022, 0.016, 0.2, 5, C.wood, { x: (hx + bx) / 2, y: y - 0.01, z: (hz + bz) / 2 }));
  p.body.push(cyl(0.05, 0.032, 0.05, 6, C.ironDark, { x: hx, y: y + 0.1, z: hz }));
  p.glow.push(cone(0.042, 0.13, 5, GLOW.flame, { x: hx, y: y + 0.19, z: hz }));
  p.glow.push(ico(0.045, 0, GLOW.flameCore, { x: hx, y: y + 0.14, z: hz }));
  p.fx.torches.push([hx, y + 0.2, hz]);
}

function chimneyAt(p, x, z, y0, y1, w, d, o = {}) {
  p.body.push(box(w, y1 - y0, d, o.color || C.stone, { x, y: (y0 + y1) / 2, z }));
  p.body.push(box(w + 0.02, 0.05, d + 0.02, C.stoneDark, { x, y: y0 + (y1 - y0) * 0.45, z }));
  p.body.push(box(w + 0.07, 0.07, d + 0.07, C.stoneDark, { x, y: y1 - 0.035, z }));
  p.body.push(box(w * 0.55, 0.02, d * 0.55, '#221d18', { x, y: y1 + 0.004, z }));
  p.fx.chimneys.push([x, y1 + 0.05, z, o.heavy ? 1 : 0]);
}

/** A flag flying east from a pole whose top is at (x, yTop, z). */
function flagAt(p, x, yTop, z, fw, fh, color, o = {}) {
  const shape = o.shape || 'swallow';
  const g = new THREE.BoxGeometry(fw, fh, 0.016, 6, 2, 1).toNonIndexed();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) + fw / 2) / fw;
    let yy = pos.getY(i);
    if (shape === 'pennant') yy *= 1 - 0.85 * u;
    if (shape === 'swallow' && u > 0.99 && Math.abs(yy) < 1e-4) pos.setX(i, pos.getX(i) - fw * 0.3);
    pos.setY(i, yy - u * fh * 0.12);
  }
  p.cloth.push(clothGeo(g, color, { x: x + fw / 2 + 0.012, y: yTop - fh / 2 - 0.01, z }, o.amp ?? 0.09, (gx) => (gx + fw / 2) / fw));
  if (o.stripe) {
    const s = new THREE.BoxGeometry(fw * 0.98, fh * 0.22, 0.02, 6, 1, 1).toNonIndexed();
    const sp = s.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const u = (sp.getX(i) + fw / 2) / fw;
      let yy = sp.getY(i);
      if (shape === 'pennant') yy *= 1 - 0.85 * u;
      sp.setY(i, yy - u * fh * 0.12);
    }
    p.cloth.push(clothGeo(s, o.stripe, { x: x + fw / 2 + 0.012, y: yTop - fh / 2 - 0.01, z }, o.amp ?? 0.09, (gx) => (gx + fw / 2) / fw));
  }
}

/** A vertical banner hanging from a bar on a wall face (top centre at x, yTop, z). */
function bannerAt(p, face, x, yTop, z, bw, bh, tc, o = {}) {
  const [px, pz] = fpos(face, x, z, 0, o.out ?? 0.045);
  const ry = FACE_RY[face];
  const shape = (geo, w, h, oy) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let yy = pos.getY(i) - h / 2 + oy;
      if (o.point !== false && Math.abs(yy + bh) < 1e-4 && Math.abs(pos.getX(i)) < 1e-4) yy -= bw * 0.4;
      pos.setY(i, yy);
    }
    return geo;
  };
  const weight = (gx, gy) => -gy / (bh + bw * 0.4);
  const amp = o.amp ?? 0.05;
  const main = shape(new THREE.BoxGeometry(bw, bh, 0.016, 2, 5, 1).toNonIndexed(), bw, bh, 0);
  p.cloth.push(clothGeo(main, tc.main, { x: px, y: yTop, z: pz, ry }, amp, weight));
  // Emblem and hem in the light team colour.
  const [ex, ez] = fpos(face, x, z, 0, (o.out ?? 0.045) + 0.011);
  const emH = bh * 0.34;
  const em = new THREE.BoxGeometry(bw * 0.5, emH, 0.012, 1, 3, 1).toNonIndexed();
  const emp = em.attributes.position;
  for (let i = 0; i < emp.count; i++) {
    const yy = emp.getY(i);
    // A diamond: narrow the top and bottom rows.
    if (Math.abs(Math.abs(yy) - emH / 2) < 1e-4) emp.setX(i, emp.getX(i) * 0.12);
    emp.setY(i, yy - bh * 0.42);
  }
  p.cloth.push(clothGeo(em, o.emblem || tc.light, { x: ex, y: yTop, z: ez, ry }, amp, weight));
  const hem = new THREE.BoxGeometry(bw, bh * 0.08, 0.012, 2, 1, 1).toNonIndexed();
  hem.translate(0, -bh * 0.08, 0);
  p.cloth.push(clothGeo(hem, o.hem || tc.dark, { x: ex, y: yTop, z: ez, ry }, amp, weight));
  // Bar and finials.
  p.body.push(fbox(face, x, z, 0, o.out ?? 0.045, bw + 0.08, 0.03, 0.03, C.woodDark, yTop + 0.01));
  for (const s of [-1, 1]) p.body.push(fbox(face, x, z, s * (bw / 2 + 0.05), o.out ?? 0.045, 0.045, 0.045, 0.045, C.gold, yTop + 0.01));
}

function shieldShape(w, h) {
  return [
    [-w / 2, h * 0.5],
    [w / 2, h * 0.5],
    [w / 2, -h * 0.05],
    [w * 0.3, -h * 0.32],
    [0, -h * 0.5],
    [-w * 0.3, -h * 0.32],
    [-w / 2, -h * 0.05],
  ];
}

// ---- the buildings -----------------------------------------------------------

function buildTownhall(p) {
  const tc = p.tc;
  plinth(p, 3.8, 3.8, {
    paving: [
      [-1.86, -0.47, 1.4, 1.87],
      [0.47, 1.86, 1.4, 1.87],
      [-1.86, -1.38, -1.05, 0.6],
      [1.38, 1.86, -1.05, 0.6],
    ],
  });
  // Main hall.
  const hx0 = -1.35;
  const hx1 = 1.35;
  const hz0 = -1.45;
  const hz1 = 0.95;
  const top = 1.3;
  stoneWalls(p, hx0, hx1, hz0, hz1, PT, top, { density: 0.32 });
  hipRoof(p, { z: (hz0 + hz1) / 2, y: top - 0.03, w: 2.98, d: 2.68, h: 0.86, color: tc.main, rows: 5 });
  // Central keep with a tall spire.
  const kz = -0.32;
  stoneWalls(p, -0.58, 0.58, kz - 0.58, kz + 0.58, 1.3, 2.35, { noBase: true, density: 0.35, frontQuoins: true });
  p.body.push(box(1.3, 0.08, 1.3, C.stoneDark, { y: 2.31, z: kz }));
  hipRoof(p, { z: kz, y: 2.33, w: 1.42, d: 1.42, h: 0.74, color: tc.main, rows: 4 });
  p.body.push(cyl(0.016, 0.026, 0.3, 5, C.woodDark, { y: 3.18, z: kz }));
  p.body.push(ico(0.045, 0, C.gold, { y: 3.08, z: kz }));
  flagAt(p, 0.015, 3.31, kz, 0.38, 0.19, tc.main, { stripe: tc.light });
  windowAt(p, 'S', 0, 2.05, kz + 0.58, 0.17, 0.27, { arch: true });
  windowAt(p, 'W', -0.58, 2.05, kz, 0.15, 0.24, { arch: true });
  windowAt(p, 'E', 0.58, 2.05, kz, 0.15, 0.24, { arch: true });
  // Corner turrets.
  for (const [tx, tz] of [
    [-1.42, -1.42],
    [1.42, -1.42],
    [-1.42, 1.0],
    [1.42, 1.0],
  ]) {
    p.body.push(cyl(0.34, 0.37, 1.58, 10, WALL, { x: tx, y: PT + 0.79, z: tz }));
    p.body.push(cyl(0.385, 0.385, 0.09, 10, C.stoneDark, { x: tx, y: PT + 0.05, z: tz }));
    for (const yy of [0.62, 1.08]) p.body.push(cyl(0.358, 0.363, 0.045, 10, QUOIN, { x: tx, y: yy, z: tz }));
    p.body.push(cyl(0.42, 0.35, 0.12, 10, QUOIN, { x: tx, y: 1.69, z: tz }));
    coneRoof(p, { x: tx, z: tz, y: 1.74, r: 0.45, h: 0.72, color: tc.main, rows: 3 });
    p.body.push(ico(0.04, 0, C.gold, { x: tx, y: 2.49, z: tz }));
    if (tz > 0) {
      // Banners hang on the front turrets, where the camera sees them.
      bannerAt(p, 'S', tx, 1.5, tz + 0.345, 0.26, 0.62, tc, { out: 0.03 });
      windowAt(p, tx < 0 ? 'W' : 'E', tx + (tx < 0 ? -0.345 : 0.345), 1.2, tz, 0.06, 0.2, { sill: false, frame: C.stoneDark });
      windowAt(p, tx < 0 ? 'W' : 'E', tx + (tx < 0 ? -0.35 : 0.35), 0.6, tz, 0.06, 0.18, { sill: false, frame: C.stoneDark });
    } else {
      windowAt(p, tx < 0 ? 'W' : 'E', tx + (tx < 0 ? -0.345 : 0.345), 1.2, tz, 0.06, 0.2, { sill: false, frame: C.stoneDark });
    }
  }
  // Entrance porch with the great door.
  stoneWalls(p, -0.55, 0.55, 0.9, 1.5, PT, 1.05, { noQuoins: true, density: 0.3 });
  gableRoof(p, { z: 1.27, y: 1.03, w: 0.78, d: 1.3, h: 0.5, ry: Math.PI / 2, color: tc.main, end: C.stone, rows: 3 });
  doorAt(p, 'S', 0, 1.5, 0.5, 0.64, { double: true });
  p.body.push(prism(shieldShape(0.2, 0.22), 0.03, tc.main, { y: 1.2, z: 1.53 }));
  p.body.push(prism(shieldShape(0.25, 0.27), 0.02, C.gold, { y: 1.2, z: 1.515 }));
  torchAt(p, 'S', -0.4, 0.78, 1.5);
  torchAt(p, 'S', 0.4, 0.78, 1.5);
  p.body.push(box(0.9, 0.06, 0.22, C.stoneLight, { y: PT + 0.03, z: 1.72, shade: -0.08 }));
  // Windows either side of the porch.
  windowAt(p, 'S', -0.8, 0.72, hz1, 0.16, 0.26, { arch: true });
  windowAt(p, 'S', 0.8, 0.72, hz1, 0.16, 0.26, { arch: true });
  // Side windows.
  for (const wz of [-0.8, -0.25, 0.3]) {
    windowAt(p, 'W', hx0, 0.78, wz, 0.17, 0.26, { arch: true });
    windowAt(p, 'E', hx1, 0.78, wz, 0.17, 0.26, { arch: true });
  }
  // Dormers on the front slope.
  for (const dx of [-0.92, 0.92]) {
    stoneWalls(p, dx - 0.17, dx + 0.17, 0.35, 0.78, 1.32, 1.78, { noBase: true, noQuoins: true, faces: false, noTop: true });
    gableRoof(p, { x: dx, z: 0.6, y: 1.76, w: 0.5, d: 0.46, h: 0.22, ry: Math.PI / 2, color: tc.main, end: C.stone, rows: 2, trim: null });
    windowAt(p, 'S', dx, 1.6, 0.78, 0.14, 0.17, { sill: false });
  }
  chimneyAt(p, 0.98, -0.95, 1.4, 2.25, 0.24, 0.24);
  p.fx.fires.push([-0.9, 1.72, 0.25], [0.95, 1.65, -0.6], [0, 2.6, kz], [-1.42, 2.0, 1.0], [0.95, 1.5, 0.55], [-0.6, 1.9, -0.9]);
  p.core = { x0: hx0, x1: hx1, z0: hz0, z1: hz1, top };
}

function buildFarm(p) {
  const tc = p.tc;
  // An earth plinth for the yard and a stone footing under the cottage.
  p.body.push(box(1.86, 0.52, 1.86, mix(C.dirt, '#000000', 0.12), { y: 0.07 - 0.26 }));
  p.body.push(box(1.3, 0.56, 0.84, C.stoneDark, { x: -0.22, y: PT - 0.28, z: -0.47 }));
  // Cottage.
  const x0 = -0.84;
  const x1 = 0.4;
  const z0 = -0.86;
  const z1 = -0.1;
  timberWalls(p, x0, x1, z0, z1, PT, 0.68, { fill: C.plaster });
  hipRoof(p, {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    y: 0.64,
    w: 1.44,
    d: 1.0,
    h: 0.62,
    color: C.thatch,
    alt: mix(C.thatch, C.thatchDark, 0.5),
    ridge: C.thatchDark,
    fascia: C.thatchDark,
    rows: 4,
    flare: 0.07,
  });
  doorAt(p, 'S', -0.06, z1, 0.24, 0.4, { color: tc.dark, frame: C.woodDark, step: C.stone });
  windowAt(p, 'S', -0.52, 0.42, z1, 0.15, 0.15, { shutters: tc.main, sillColor: C.woodLight });
  windowAt(p, 'S', 0.24, 0.42, z1, 0.12, 0.15, { shutters: tc.main, sillColor: C.woodLight });
  windowAt(p, 'W', x0, 0.42, (z0 + z1) / 2, 0.15, 0.15, { shutters: tc.main, sillColor: C.woodLight });
  chimneyAt(p, 0.3, -0.62, 0.5, 1.32, 0.17, 0.2);
  // Pennant on the west end of the ridge.
  const rx = (x0 + x1) / 2 - 0.22;
  p.body.push(cyl(0.012, 0.016, 0.26, 5, C.woodDark, { x: rx, y: 1.32, z: (z0 + z1) / 2 }));
  p.body.push(ico(0.025, 0, C.gold, { x: rx, y: 1.45, z: (z0 + z1) / 2 }));
  flagAt(p, rx, 1.43, (z0 + z1) / 2, 0.27, 0.12, tc.main, { shape: 'pennant' });
  // Field: tilled soil with rows of wheat and cabbages.
  const soil = '#6b4a2b';
  p.body.push(box(1.62, 0.06, 0.78, soil, { y: 0.08, z: 0.46 }));
  const rows = [0.16, 0.36, 0.56, 0.76];
  rows.forEach((rz, ri) => {
    p.body.push(box(1.52, 0.075, 0.075, mix(soil, C.dirt, 0.35), { y: 0.11, z: rz, rx: Math.PI / 4 }));
    const wheat = ri % 2 === 0;
    for (let i = 0; i < 8; i++) {
      const px = -0.68 + i * 0.195 + (p.rnd() - 0.5) * 0.04;
      if (px > 0.38 && px < 0.66 && ri >= 1 && ri <= 2) continue; // scarecrow
      if (wheat) {
        for (let k = 0; k < 2; k++) {
          const h = 0.2 + p.rnd() * 0.06;
          const col = mix('#d8b548', '#9db04a', p.rnd() * 0.45);
          const g = cone(0.045, h, 4, col, { x: px + (k - 0.5) * 0.06, y: 0.13 + h / 2, z: rz + (p.rnd() - 0.5) * 0.04, rz: (k - 0.5) * 0.2 });
          p.cloth.push(addSway(g, 0.13, 0.13 + h, 0.035));
        }
      } else {
        const col = mix('#6aa03a', '#8fbf4a', p.rnd());
        p.body.push(ico(0.06, 0, col, { x: px, y: 0.17, z: rz, sy: 0.75, ry: p.rnd() * 3 }));
        p.body.push(ico(0.035, 0, mix(col, '#d8f08a', 0.35), { x: px, y: 0.21, z: rz }));
      }
    }
  });
  // Scarecrow in the team's colours.
  p.body.push(box(0.03, 0.5, 0.03, C.wood, { x: 0.52, y: 0.32, z: 0.46 }));
  p.body.push(box(0.32, 0.025, 0.025, C.wood, { x: 0.52, y: 0.43, z: 0.46 }));
  p.body.push(box(0.13, 0.16, 0.07, tc.main, { x: 0.52, y: 0.4, z: 0.46 }));
  p.body.push(ico(0.06, 0, C.thatch, { x: 0.52, y: 0.56, z: 0.46 }));
  p.body.push(cone(0.09, 0.08, 6, C.thatchDark, { x: 0.52, y: 0.62, z: 0.46 }));
  // Fence around the field.
  const fence = (ax, az, bx, bz, gap) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 0.28));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (gap && Math.abs(x) < 0.12) continue;
      p.body.push(box(0.045, 0.24, 0.045, C.woodDark, { x, y: 0.17, z }));
    }
    const along = Math.abs(bx - ax) > Math.abs(bz - az);
    for (const yy of [0.14, 0.23]) {
      if (gap) {
        for (const [a, b] of [
          [ax, -0.12],
          [0.12, bx],
        ]) {
          p.body.push(box(Math.abs(b - a), 0.025, 0.022, C.wood, { x: (a + b) / 2, y: yy, z: az }));
        }
      } else if (along) p.body.push(box(len, 0.025, 0.022, C.wood, { x: (ax + bx) / 2, y: yy, z: az }));
      else p.body.push(box(0.022, 0.025, len, C.wood, { x: ax, y: yy, z: (az + bz) / 2 }));
    }
  };
  fence(-0.86, 0.02, -0.86, 0.86);
  fence(0.86, 0.02, 0.86, 0.86);
  fence(-0.86, 0.86, 0.86, 0.86, true);
  // Haystack and a barrel beside the cottage.
  p.body.push(cyl(0.2, 0.22, 0.2, 8, C.thatch, { x: 0.66, y: 0.17, z: -0.55 }));
  p.body.push(cone(0.21, 0.3, 8, mix(C.thatch, C.thatchDark, 0.3), { x: 0.66, y: 0.42, z: -0.55 }));
  p.body.push(cyl(0.08, 0.08, 0.18, 7, C.wood, { x: 0.68, y: 0.16, z: -0.16 }));
  p.body.push(cyl(0.083, 0.083, 0.025, 7, C.ironDark, { x: 0.68, y: 0.12, z: -0.16 }));
  p.body.push(cyl(0.083, 0.083, 0.025, 7, C.ironDark, { x: 0.68, y: 0.21, z: -0.16 }));
  p.fx.fires.push([-0.5, 1.0, -0.48], [0.1, 0.95, -0.42], [0.66, 0.5, -0.55]);
  p.core = { x0, x1, z0, z1, top: 0.68 };
}

function buildBarracks(p) {
  const tc = p.tc;
  plinth(p, 2.82, 2.82, { paving: [[0.66, 1.4, 0.52, 1.4]] });
  p.body.push(box(2.0, 0.02, 1.18, mix(C.dirt, C.stone, 0.2), { x: -0.33, y: PT + 0.01, z: 0.78 }));
  // Long hall.
  const x0 = -1.32;
  const x1 = 1.32;
  const z0 = -1.32;
  const z1 = 0.1;
  const top = 1.05;
  stoneWalls(p, x0, x1, z0, z1, PT, top, { density: 0.36 });
  hipRoof(p, { z: (z0 + z1) / 2, y: top - 0.03, w: 2.84, d: 1.7, h: 0.8, color: tc.main, rows: 4 });
  // Cross gable over the door with the crossed-swords emblem.
  const gx = -0.3;
  const gz1 = z1 + 0.3;
  stoneWalls(p, gx - 0.42, gx + 0.42, z1 - 0.2, gz1, PT, top, { noQuoins: true, density: 0.3 });
  gableRoof(p, { x: gx, z: z1 + 0.02, y: top - 0.03, w: 0.78, d: 1.1, h: 0.72, ry: Math.PI / 2, color: tc.main, end: C.stone, rows: 3 });
  doorAt(p, 'S', gx, gz1, 0.46, 0.6, { double: true });
  const ey = top + 0.25;
  for (const s of [-1, 1]) {
    p.body.push(box(0.035, 0.5, 0.012, C.steel, { x: gx, y: ey + 0.02, z: gz1 + 0.04, rz: s * 0.78 }));
    p.body.push(box(0.15, 0.03, 0.03, C.gold, { x: gx + s * 0.13, y: ey - 0.13, z: gz1 + 0.045, rz: -s * 0.78 }));
    p.body.push(box(0.03, 0.08, 0.03, C.leather, { x: gx + s * 0.165, y: ey - 0.175, z: gz1 + 0.045, rz: s * 0.78 }));
  }
  p.body.push(prism(shieldShape(0.3, 0.34), 0.03, C.gold, { x: gx, y: ey, z: gz1 + 0.065 }));
  p.body.push(prism(shieldShape(0.25, 0.29), 0.03, tc.main, { x: gx, y: ey + 0.006, z: gz1 + 0.08 }));
  p.body.push(box(0.05, 0.22, 0.02, tc.light, { x: gx, y: ey + 0.01, z: gz1 + 0.097 }));
  p.body.push(box(0.2, 0.045, 0.02, tc.light, { x: gx, y: ey + 0.06, z: gz1 + 0.097 }));
  windowAt(p, 'S', -1.0, 0.68, z1, 0.15, 0.2, { bars: true });
  windowAt(p, 'S', 0.32, 0.68, z1, 0.15, 0.2, { bars: true });
  windowAt(p, 'W', x0, 0.68, -0.6, 0.15, 0.2, { bars: true });
  // Watchtower on the front-east corner.
  const tx0 = 0.66;
  const tx1 = 1.34;
  const tz0 = -0.22;
  const tz1 = 0.5;
  stoneWalls(p, tx0, tx1, tz0, tz1, PT, 1.55, { density: 0.4 });
  p.body.push(box(tx1 - tx0 + 0.12, 0.09, tz1 - tz0 + 0.12, C.stoneLight, { x: (tx0 + tx1) / 2, y: 1.58, z: (tz0 + tz1) / 2 }));
  for (const [ax, az, bx, bz] of [
    [tx0, tz1, tx1, tz1],
    [tx0, tz0, tx1, tz0],
    [tx0, tz0, tx0, tz1],
    [tx1, tz0, tx1, tz1],
  ]) {
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = ax + (bx - ax) * t + (ax === bx ? (ax < 1 ? -0.03 : 0.03) : 0);
      const z = az + (bz - az) * t + (az === bz ? (az > 0 ? 0.03 : -0.03) : 0);
      p.body.push(box(ax === bx ? 0.1 : 0.14, 0.16, ax === bx ? 0.14 : 0.1, C.stone, { x, y: 1.7, z, shade: (p.rnd() - 0.5) * 0.1 }));
    }
  }
  windowAt(p, 'S', 1.0, 1.15, tz1, 0.06, 0.2, { sill: false, frame: C.stoneDark });
  windowAt(p, 'E', tx1, 1.15, 0.14, 0.06, 0.2, { sill: false, frame: C.stoneDark });
  p.body.push(cyl(0.016, 0.022, 0.62, 5, C.woodDark, { x: 1.0, y: 1.92, z: 0.14 }));
  p.body.push(ico(0.03, 0, C.gold, { x: 1.0, y: 2.24, z: 0.14 }));
  flagAt(p, 1.0, 2.2, 0.14, 0.34, 0.17, tc.main, { stripe: tc.light });
  // Weapon rack.
  const rz = 0.86;
  for (const s of [-1, 1]) p.body.push(box(0.05, 0.42, 0.05, C.woodDark, { x: -0.85 + s * 0.32, y: PT + 0.21, z: rz }));
  p.body.push(box(0.72, 0.045, 0.05, C.woodDark, { x: -0.85, y: PT + 0.38, z: rz }));
  p.body.push(box(0.72, 0.04, 0.12, C.wood, { x: -0.85, y: PT + 0.06, z: rz + 0.02 }));
  for (let i = 0; i < 4; i++) {
    const wx = -1.08 + i * 0.155;
    if (i % 2 === 0) {
      p.body.push(cyl(0.012, 0.012, 0.62, 4, C.woodLight, { x: wx, y: PT + 0.33, z: rz + 0.04, rx: -0.12 }));
      p.body.push(cone(0.03, 0.1, 4, C.steel, { x: wx, y: PT + 0.68, z: rz + 0.0, rx: -0.12 }));
    } else {
      p.body.push(box(0.04, 0.34, 0.012, C.steel, { x: wx, y: PT + 0.3, z: rz + 0.045, rx: -0.12 }));
      p.body.push(box(0.12, 0.025, 0.03, C.gold, { x: wx, y: PT + 0.48, z: rz + 0.03 }));
      p.body.push(box(0.025, 0.08, 0.025, C.leather, { x: wx, y: PT + 0.53, z: rz + 0.025 }));
    }
  }
  // Archery butt and barrels in front of the watchtower.
  {
    const ax = 1.02;
    const az = 0.98;
    for (const s of [-1, 1]) p.body.push(box(0.04, 0.42, 0.04, C.woodDark, { x: ax + s * 0.14, y: PT + 0.2, z: az - 0.08, rx: -0.25 }));
    p.body.push(cyl(0.2, 0.2, 0.12, 10, C.thatch, { x: ax, y: PT + 0.34, z: az, rx: Math.PI / 2 - 0.25 }));
    p.body.push(cyl(0.14, 0.14, 0.13, 10, tc.main, { x: ax, y: PT + 0.34, z: az + 0.005, rx: Math.PI / 2 - 0.25 }));
    p.body.push(cyl(0.085, 0.085, 0.14, 10, C.plaster, { x: ax, y: PT + 0.34, z: az + 0.01, rx: Math.PI / 2 - 0.25 }));
    p.body.push(cyl(0.035, 0.035, 0.15, 8, tc.dark, { x: ax, y: PT + 0.34, z: az + 0.015, rx: Math.PI / 2 - 0.25 }));
    for (const [bx, bz] of [
      [0.82, 0.62],
      [1.22, 0.64],
    ]) {
      p.body.push(cyl(0.1, 0.09, 0.22, 8, C.wood, { x: bx, y: PT + 0.11, z: bz }));
      p.body.push(cyl(0.103, 0.103, 0.02, 8, C.ironDark, { x: bx, y: PT + 0.16, z: bz }));
      p.body.push(cyl(0.095, 0.095, 0.01, 8, C.woodDark, { x: bx, y: PT + 0.22, z: bz }));
    }
  }
  // Training dummy.
  const dx = 0.2;
  const dz = 0.86;
  p.body.push(cyl(0.025, 0.03, 0.62, 5, C.wood, { x: dx, y: PT + 0.31, z: dz }));
  p.body.push(cyl(0.09, 0.1, 0.24, 7, C.thatch, { x: dx, y: PT + 0.42, z: dz }));
  p.body.push(box(0.4, 0.035, 0.035, C.wood, { x: dx, y: PT + 0.5, z: dz }));
  p.body.push(ico(0.07, 0, C.thatchDark, { x: dx, y: PT + 0.63, z: dz }));
  p.body.push(prism(shieldShape(0.13, 0.16), 0.025, tc.main, { x: dx - 0.2, y: PT + 0.44, z: dz + 0.03 }));
  // Banners at the yard gate.
  for (const bx of [-1.22, 0.5]) {
    const bz = 1.25;
    p.body.push(cyl(0.022, 0.028, 1.5, 6, C.woodDark, { x: bx, y: PT + 0.75, z: bz }));
    p.body.push(cyl(0.05, 0.06, 0.1, 6, C.stoneDark, { x: bx, y: PT + 0.05, z: bz }));
    p.body.push(ico(0.035, 0, C.gold, { x: bx, y: PT + 1.53, z: bz }));
    bannerAt(p, 'S', bx, PT + 1.4, bz, 0.26, 0.56, tc, { out: 0.03 });
  }
  p.fx.fires.push([-0.8, 1.45, -0.6], [0.45, 1.45, -0.6], [1.0, 1.75, 0.15], [-0.3, 1.35, 0.25], [-1.1, 1.2, -0.2]);
  p.core = { x0, x1, z0, z1, top };
}

function buildLumbermill(p) {
  const tc = p.tc;
  plinth(p, 2.82, 2.82, { color: mix(C.stoneDark, C.dirt, 0.3) });
  p.body.push(box(2.7, 0.02, 1.25, mix(C.dirt, '#d9b77a', 0.25), { y: PT + 0.01, z: 0.72 }));
  // Timber hall, gable end to the front.
  const x0 = -1.28;
  const x1 = 0.42;
  const z0 = -1.32;
  const z1 = 0.0;
  const top = 1.0;
  const cx = (x0 + x1) / 2;
  plankWalls(p, x0, x1, z0, z1, PT, top);
  gableRoof(p, { x: cx, z: -0.66, y: top - 0.03, w: 1.56, d: 1.96, h: 0.86, ry: Math.PI / 2, oh: 0.12, color: tc.main, end: C.woodLight, rows: 4 });
  // Gable end: boards, loft door and hoist beam with a rope.
  for (let i = -3; i <= 3; i += 2) {
    const hgt = 0.86 * (1 - Math.abs(i * 0.13) / 1.0) - 0.08;
    p.body.push(box(0.11, hgt, 0.02, C.woodLight, { x: cx + i * 0.13, y: top + hgt / 2, z: z1 + 0.012, shade: (p.rnd() - 0.5) * 0.15 }));
  }
  p.body.push(box(0.36, 0.34, 0.04, C.woodDark, { x: cx, y: top + 0.24, z: z1 + 0.02 }));
  p.body.push(box(0.28, 0.27, 0.03, C.wood, { x: cx, y: top + 0.23, z: z1 + 0.035 }));
  p.body.push(box(0.016, 0.27, 0.02, C.woodDark, { x: cx, y: top + 0.23, z: z1 + 0.05 }));
  p.body.push(box(0.07, 0.07, 0.42, C.woodDark, { x: cx, y: top + 0.52, z: z1 + 0.15 }));
  p.body.push(box(0.012, 0.36, 0.012, C.thatchDark, { x: cx, y: top + 0.32, z: z1 + 0.32 }));
  p.body.push(box(0.05, 0.06, 0.02, C.ironDark, { x: cx, y: top + 0.12, z: z1 + 0.32 }));
  // Barn door with a Z brace, and windows.
  const dx = cx;
  p.body.push(box(0.6, 0.66, 0.035, C.woodDark, { x: dx, y: PT + 0.33, z: z1 + 0.018 }));
  p.body.push(box(0.52, 0.6, 0.03, C.wood, { x: dx, y: PT + 0.31, z: z1 + 0.04 }));
  for (const yy of [0.12, 0.5]) p.body.push(box(0.52, 0.05, 0.02, C.woodDark, { x: dx, y: PT + yy, z: z1 + 0.06 }));
  p.body.push(box(0.6, 0.045, 0.02, C.woodDark, { x: dx, y: PT + 0.31, z: z1 + 0.06, rz: 0.62 }));
  p.body.push(box(0.016, 0.6, 0.02, C.woodDark, { x: dx, y: PT + 0.31, z: z1 + 0.062 }));
  windowAt(p, 'S', -1.06, 0.6, z1, 0.17, 0.2, {});
  windowAt(p, 'S', 0.17, 0.6, z1, 0.17, 0.2, {});
  windowAt(p, 'W', x0, 0.6, -0.66, 0.18, 0.2, {});
  // Open saw shed (lean-to) on the east side.
  const sx1 = 1.36;
  const sz0 = -1.3;
  const sz1 = -0.08;
  for (const pz of [sz0 + 0.05, (sz0 + sz1) / 2, sz1 - 0.02]) p.body.push(box(0.08, 0.62, 0.08, C.woodDark, { x: sx1 - 0.06, y: PT + 0.31, z: pz }));
  const run = sx1 - x1 + 0.06;
  const la = Math.atan2(0.24, run);
  const slope = Math.hypot(run, 0.24) + 0.08;
  const depth = sz1 - sz0 + 0.2;
  const shed = [box(slope, 0.05, depth, C.wood, { rz: -la })];
  for (let i = 0; i < 4; i++) {
    const u = -slope / 2 + ((i + 0.5) * slope) / 4;
    shed.push(box(slope / 4 + 0.03, 0.035, depth + 0.02, i % 2 ? C.woodLight : mix(C.woodLight, C.wood, 0.45), { x: u * Math.cos(la), y: -u * Math.sin(la) + 0.035, rz: -la - 0.06 }));
  }
  shed.push(box(0.05, 0.08, depth + 0.02, C.woodDark, { x: (slope / 2) * Math.cos(la), y: -(slope / 2) * Math.sin(la), rz: -la }));
  {
    const g = merge(shed);
    g.translate((x1 + sx1) / 2 + 0.03, 0.83, (sz0 + sz1) / 2);
    p.body.push(g);
  }
  p.body.push(box(sx1 - x1, 0.05, 0.05, C.woodDark, { x: (x1 + sx1) / 2, y: 0.76, z: sz1 - 0.02 }));
  // Lumber stacks under the shed.
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 3; i++) {
      const shade = (p.rnd() - 0.5) * 0.2;
      if (k % 2 === 0) p.body.push(box(0.6, 0.06, 0.11, C.woodLight, { x: 0.9, y: PT + 0.03 + k * 0.065, z: -0.92 + i * 0.13, shade }));
      else p.body.push(box(0.11, 0.06, 0.4, C.woodLight, { x: 0.7 + i * 0.2, y: PT + 0.03 + k * 0.065, z: -0.79, shade }));
    }
  }
  // Saw bench with a log, and the big saw blade (spins).
  const bz = 0.64;
  p.body.push(box(1.36, 0.07, 0.36, C.wood, { x: 0.6, y: 0.47, z: bz }));
  for (const lx of [-0.02, 1.22]) for (const lz of [-0.13, 0.13]) p.body.push(box(0.06, 0.34, 0.06, C.woodDark, { x: lx, y: PT + 0.17, z: bz + lz }));
  p.body.push(box(1.2, 0.04, 0.05, C.woodDark, { x: 0.6, y: 0.27, z: bz }));
  p.body.push(cyl(0.12, 0.12, 0.6, 8, C.bark, { x: 0.12, y: 0.62, z: bz, rz: Math.PI / 2 }));
  p.body.push(cyl(0.11, 0.11, 0.012, 8, C.woodLight, { x: -0.185, y: 0.62, z: bz, rz: Math.PI / 2 }));
  p.body.push(cyl(0.11, 0.11, 0.012, 8, C.woodLight, { x: 0.425, y: 0.62, z: bz, rz: Math.PI / 2 }));
  p.body.push(box(0.34, 0.06, 0.22, C.woodLight, { x: 1.06, y: 0.535, z: bz, shade: 0.05 }));
  for (const s of [-1, 1]) p.body.push(box(0.05, 0.62, 0.05, C.woodDark, { x: 0.78 + s * 0.56, y: 0.78, z: bz - 0.22 }));
  p.body.push(box(1.18, 0.06, 0.06, C.woodDark, { x: 0.78, y: 1.08, z: bz - 0.22 }));
  p.body.push(box(0.05, 0.05, 0.24, C.woodDark, { x: 0.78, y: 1.08, z: bz - 0.11 }));
  const blade = [];
  const R = 0.46;
  blade.push(cyl(R, R, 0.024, 24, C.steel, { rx: Math.PI / 2 }));
  blade.push(cyl(R * 0.72, R * 0.72, 0.03, 24, mix(C.steel, C.iron, 0.5), { rx: Math.PI / 2 }));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    blade.push(prism([[0, 0], [0.085, 0], [0, 0.07]], 0.024, C.steel, { x: Math.cos(a) * (R - 0.012), y: Math.sin(a) * (R - 0.012), rz: a + Math.PI / 2 }));
  }
  blade.push(cyl(0.1, 0.1, 0.06, 8, C.ironDark, { rx: Math.PI / 2 }));
  blade.push(cyl(0.04, 0.04, 0.07, 6, C.gold, { rx: Math.PI / 2 }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    blade.push(box(0.22, 0.03, 0.036, C.ironDark, { x: Math.cos(a) * 0.21, y: Math.sin(a) * 0.21, rz: a }));
  }
  p.spin.push(merge(blade));
  p.spinAt = [0.78, 0.52, bz];
  p.fx.saw = [0.78 + 0.36, 0.56, bz];
  // Log piles.
  const pile = (cx2, cz2, n, len) => {
    let k = 0;
    for (let layer = 0; layer < n; layer++) {
      for (let i = 0; i < n - layer; i++, k++) {
        const r = 0.11 + p.rnd() * 0.015;
        const z = cz2 + (i - (n - layer - 1) / 2) * 0.23;
        const y = PT + r + layer * 0.19;
        const l = len - p.rnd() * 0.12;
        p.body.push(cyl(r, r, l, 7, k % 2 ? C.bark : mix(C.bark, C.wood, 0.3), { x: cx2, y, z, rz: Math.PI / 2 }));
        p.body.push(cyl(r * 0.88, r * 0.88, 0.012, 7, C.woodLight, { x: cx2 + l / 2, y, z, rz: Math.PI / 2 }));
        p.body.push(cyl(r * 0.88, r * 0.88, 0.012, 7, C.woodLight, { x: cx2 - l / 2, y, z, rz: Math.PI / 2 }));
      }
    }
    for (const s of [-1, 1]) p.body.push(box(0.04, 0.34, 0.04, C.woodDark, { x: cx2, y: PT + 0.17, z: cz2 + s * (n * 0.12 + 0.02) }));
  };
  pile(-0.88, 0.8, 3, 0.85);
  // Sawdust heap and a chopping stump with an axe.
  p.body.push(cone(0.2, 0.12, 7, '#d9b77a', { x: 1.14, y: PT + 0.06, z: 1.12 }));
  p.body.push(cyl(0.12, 0.13, 0.16, 7, C.bark, { x: 0.22, y: PT + 0.08, z: 1.14 }));
  p.body.push(cyl(0.115, 0.115, 0.012, 7, C.woodLight, { x: 0.22, y: PT + 0.165, z: 1.14 }));
  p.body.push(box(0.025, 0.3, 0.025, C.woodLight, { x: 0.22, y: PT + 0.3, z: 1.14, rz: 0.35 }));
  p.body.push(box(0.12, 0.06, 0.02, C.iron, { x: 0.2, y: PT + 0.2, z: 1.14, rz: 0.35 }));
  // Pennant on the front of the ridge.
  p.body.push(cyl(0.012, 0.016, 0.3, 5, C.woodDark, { x: cx, y: top + 0.95, z: 0.02 }));
  p.body.push(ico(0.025, 0, C.gold, { x: cx, y: top + 1.1, z: 0.02 }));
  flagAt(p, cx, top + 1.08, 0.02, 0.28, 0.12, tc.main, { shape: 'pennant' });
  p.fx.fires.push([-0.85, 1.45, -0.5], [-0.1, 1.4, -0.9], [0.9, 0.95, -0.7], [-0.88, 0.6, 0.8]);
  p.core = { x0, x1, z0, z1, top };
}

function buildBlacksmith(p) {
  const tc = p.tc;
  plinth(p, 2.82, 2.82);
  p.body.push(box(2.7, 0.02, 1.2, mix(C.dirt, '#5a5249', 0.55), { y: PT + 0.01, z: 0.74 }));
  // Stone workshop.
  const x0 = -1.32;
  const x1 = 0.36;
  const z0 = -1.32;
  const z1 = 0.05;
  const top = 1.0;
  stoneWalls(p, x0, x1, z0, z1, PT, top, { color: mix(C.stone, C.stoneDark, 0.25), density: 0.4 });
  hipRoof(p, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: top - 0.03, w: 1.92, d: 1.62, h: 0.78, color: tc.main, rows: 4 });
  doorAt(p, 'S', -0.42, z1, 0.32, 0.55);
  windowAt(p, 'S', -1.0, 0.62, z1, 0.17, 0.22, {});
  windowAt(p, 'W', x0, 0.62, -0.62, 0.17, 0.22, {});
  // Forge: a stone hearth with a glowing mouth and the great chimney above it.
  const fx0 = 0.36;
  const fx1 = 1.22;
  const fz0 = -1.2;
  const fz1 = -0.2;
  const forgeStone = mix(C.stone, C.stoneDark, 0.35);
  stoneWalls(p, fx0, fx1, fz0, fz1, PT, 0.92, { color: forgeStone, density: 0.5, faces: 'SE' });
  p.body.push(frustum(fx1 - fx0 + 0.06, fz1 - fz0 + 0.06, 0.5, 0.5, 0.36, C.stone, { x: (fx0 + fx1) / 2, y: 0.9, z: (fz0 + fz1) / 2 }));
  chimneyAt(p, (fx0 + fx1) / 2, (fz0 + fz1) / 2, 1.2, 2.32, 0.42, 0.42, { color: forgeStone, heavy: true });
  for (let y = 1.4; y < 2.2; y += 0.17) {
    for (const [sx, sz] of [
      [-1, 1],
      [1, 1],
    ]) {
      p.body.push(box(0.12, 0.09, 0.07, QUOIN, { x: (fx0 + fx1) / 2 + sx * 0.18, y, z: (fz0 + fz1) / 2 + sz * 0.2, shade: (p.rnd() - 0.5) * 0.2 }));
    }
  }
  const mx = (fx0 + fx1) / 2;
  p.body.push(archAt('S', mx, fz1, 0.0, 0.56, 0.5, 0.06, C.stoneLight, PT + 0.1));
  p.glow.push(archAt('S', mx, fz1, 0.022, 0.44, 0.42, 0.04, GLOW.forge, PT + 0.12));
  p.glow.push(box(0.36, 0.08, 0.03, GLOW.forgeHot, { x: mx, y: PT + 0.17, z: fz1 + 0.05 }));
  p.body.push(box(0.6, 0.08, 0.16, C.stoneLight, { x: mx, y: PT + 0.06, z: fz1 + 0.07 }));
  p.fx.forge = [mx, PT + 0.35, fz1 + 0.08];
  // Bellows beside the hearth.
  p.body.push(prism([[0, 0.06], [0.3, 0.02], [0.3, -0.02], [0, -0.06]], 0.18, C.leather, { x: fx1 - 0.02, y: 0.55, z: -0.08, ry: -Math.PI / 2 }));
  // Anvil on a stump, glowing work piece, hammer.
  const ax = 0.7;
  const az = 0.58;
  p.body.push(cyl(0.14, 0.16, 0.26, 7, C.bark, { x: ax, y: PT + 0.13, z: az }));
  p.body.push(cyl(0.135, 0.135, 0.012, 7, C.woodLight, { x: ax, y: PT + 0.265, z: az }));
  p.metal.push(box(0.16, 0.06, 0.13, C.ironDark, { x: ax, y: PT + 0.3, z: az }));
  p.metal.push(box(0.08, 0.07, 0.08, C.ironDark, { x: ax, y: PT + 0.36, z: az }));
  p.metal.push(box(0.3, 0.07, 0.12, C.iron, { x: ax, y: PT + 0.43, z: az }));
  p.metal.push(cone(0.05, 0.16, 6, C.iron, { x: ax + 0.22, y: PT + 0.43, z: az, rz: -Math.PI / 2 }));
  p.glow.push(box(0.16, 0.025, 0.035, GLOW.forge, { x: ax - 0.02, y: PT + 0.48, z: az + 0.01 }));
  p.body.push(box(0.025, 0.025, 0.2, C.wood, { x: ax - 0.12, y: PT + 0.48, z: az + 0.12, ry: 0.4 }));
  p.metal.push(box(0.05, 0.05, 0.09, C.ironDark, { x: ax - 0.16, y: PT + 0.49, z: az + 0.21, ry: 0.4 }));
  p.fx.anvil = [ax - 0.02, PT + 0.5, az + 0.01];
  // Quench barrel and coal heap.
  p.body.push(cyl(0.13, 0.12, 0.28, 8, C.wood, { x: 1.14, y: PT + 0.14, z: 0.2 }));
  for (const yy of [0.06, 0.22]) p.body.push(cyl(0.133, 0.133, 0.025, 8, C.ironDark, { x: 1.14, y: PT + yy, z: 0.2 }));
  p.body.push(cyl(0.115, 0.115, 0.01, 8, '#3d5a6e', { x: 1.14, y: PT + 0.27, z: 0.2 }));
  p.body.push(cone(0.2, 0.14, 7, '#2b2826', { x: 1.1, y: PT + 0.07, z: 0.85 }));
  for (let i = 0; i < 5; i++) p.body.push(dodeca(0.04, '#3a3532', { x: 1.0 + p.rnd() * 0.25, y: PT + 0.02, z: 0.7 + p.rnd() * 0.3 }));
  // Grindstone.
  p.body.push(box(0.05, 0.22, 0.24, C.woodDark, { x: -0.98, y: PT + 0.11, z: 0.68 }));
  p.body.push(box(0.05, 0.22, 0.24, C.woodDark, { x: -0.72, y: PT + 0.11, z: 0.68 }));
  p.body.push(cyl(0.16, 0.16, 0.08, 10, C.stoneLight, { x: -0.85, y: PT + 0.25, z: 0.68, rz: Math.PI / 2 }));
  p.body.push(cyl(0.02, 0.02, 0.36, 5, C.ironDark, { x: -0.85, y: PT + 0.25, z: 0.68, rz: Math.PI / 2 }));
  // Tools on the wall.
  p.body.push(box(0.36, 0.22, 0.025, C.wood, { x: 0.05, y: 0.6, z: z1 + 0.02 }));
  for (let i = 0; i < 3; i++) p.metal.push(box(0.03, 0.18, 0.02, C.iron, { x: -0.07 + i * 0.12, y: 0.6, z: z1 + 0.045, rz: (i - 1) * 0.25 }));
  // Hanging sign on a bracket.
  p.body.push(box(0.03, 0.03, 0.32, C.ironDark, { x: x0 + 0.05, y: 0.95, z: z1 + 0.16 }));
  p.body.push(box(0.03, 0.12, 0.03, C.ironDark, { x: x0 + 0.05, y: 0.89, z: z1 + 0.02, rx: 0.6 }));
  {
    const g = new THREE.BoxGeometry(0.22, 0.17, 0.02, 1, 3, 1).toNonIndexed();
    g.translate(0, -0.085, 0);
    p.cloth.push(clothGeo(g, tc.main, { x: x0 + 0.05, y: 0.93, z: z1 + 0.22, ry: Math.PI / 2 }, 0.035, (gx, gy) => -gy / 0.17));
    const e = new THREE.BoxGeometry(0.12, 0.05, 0.03, 1, 1, 1).toNonIndexed();
    e.translate(0, -0.08, 0);
    p.cloth.push(clothGeo(e, C.iron, { x: x0 + 0.05, y: 0.93, z: z1 + 0.22, ry: Math.PI / 2 }, 0.035, (gx, gy) => -gy / 0.17));
  }
  p.fx.fires.push([-0.9, 1.35, -0.6], [-0.1, 1.35, -0.5], [0.8, 1.15, -0.7]);
  p.core = { x0, x1, z0, z1, top };
}

function buildTower(p) {
  const tc = p.tc;
  plinth(p, 1.8, 1.8);
  p.body.push(cyl(0.8, 0.84, 0.12, 12, C.stoneDark, { y: PT + 0.05 }));
  const r0 = 0.68;
  const r1 = 0.6;
  const top = 2.05;
  const rAt = (y) => r0 + ((r1 - r0) * (y - PT)) / (top - PT);
  p.body.push(cyl(r1, r0, top - PT, 12, C.stone, { y: (PT + top) / 2, ry: Math.PI / 12 }));
  // Masonry courses and blocks on the visible side.
  for (let y = PT + 0.42; y < top - 0.2; y += 0.44) p.body.push(cyl(rAt(y) + 0.015, rAt(y) + 0.015, 0.04, 12, C.stoneLight, { y, shade: -0.05, ry: Math.PI / 12 }));
  for (let y = PT + 0.08; y < top - 0.15; y += 0.145) {
    for (let k = 0; k < 7; k++) {
      if (p.rnd() > 0.5) continue;
      const a = -Math.PI * 0.6 + (k / 6) * Math.PI * 1.2 + (p.rnd() - 0.5) * 0.15;
      const r = rAt(y);
      p.body.push(box(0.16 + p.rnd() * 0.08, 0.11, 0.03, C.stone, { x: Math.sin(a) * r, y: y + 0.06, z: Math.cos(a) * r, ry: a, shade: (p.rnd() - 0.5) * 0.24 }));
    }
  }
  // Corbels and battlement.
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    p.body.push(box(0.09, 0.12, 0.1, C.stoneDark, { x: Math.sin(a) * 0.62, y: top - 0.08, z: Math.cos(a) * 0.62, ry: a }));
  }
  p.body.push(cyl(0.78, 0.7, 0.12, 12, C.stoneLight, { y: top + 0.04, ry: Math.PI / 12 }));
  p.body.push(cyl(0.77, 0.77, 0.1, 12, C.stone, { y: top + 0.15 }));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + Math.PI / 8;
    p.body.push(box(0.2, 0.18, 0.12, C.stone, { x: Math.sin(a) * 0.71, y: top + 0.29, z: Math.cos(a) * 0.71, ry: a, shade: (p.rnd() - 0.5) * 0.1 }));
  }
  coneRoof(p, { y: top + 0.2, r: 0.66, h: 0.76, color: tc.main, rows: 3, segs: 10 });
  p.body.push(cyl(0.014, 0.02, 0.32, 5, C.woodDark, { y: top + 1.06 }));
  p.body.push(ico(0.04, 0, C.gold, { y: top + 0.97 }));
  flagAt(p, 0.012, top + 1.2, 0, 0.36, 0.18, tc.main, { stripe: tc.light });
  // Arrow slits.
  for (const [a, y] of [
    [0, 1.0],
    [-0.9, 1.5],
    [0.9, 1.5],
    [-1.4, 0.95],
    [0, 1.6],
  ]) {
    const r = rAt(y) + 0.005;
    p.body.push(box(0.12, 0.28, 0.04, C.stoneDark, { x: Math.sin(a) * r, y, z: Math.cos(a) * r, ry: a }));
    p.glow.push(box(0.045, 0.2, 0.04, GLOW.win, { x: Math.sin(a) * (r + 0.012), y, z: Math.cos(a) * (r + 0.012), ry: a }));
  }
  doorAt(p, 'S', 0, rAt(0.3) - 0.02, 0.3, 0.48);
  torchAt(p, 'S', 0.32, 0.62, rAt(0.62) - 0.05);
  p.body.push(prism(shieldShape(0.2, 0.24), 0.03, tc.main, { x: 0, y: 0.9, z: rAt(0.9) + 0.01 }));
  p.body.push(prism(shieldShape(0.24, 0.28), 0.02, C.gold, { x: 0, y: 0.9, z: rAt(0.9) - 0.005 }));
  p.fx.fires.push([0, 2.65, 0.3], [-0.35, 2.45, 0.0], [0.3, 1.6, 0.6]);
  p.core = { x0: -r0, x1: r0, z0: -r0, z1: r0, top, round: r0 };
}

function buildGoldmine(p) {
  // Earth mound reaching below ground.
  p.body.push(ico(1, 1, mix(C.dirt, C.rockDark, 0.45), { y: -0.04, sx: 1.42, sy: 0.42, sz: 1.36 }));
  const rocks = [
    [0, 0.66, -0.4, 0.95, 0.74],
    [-0.84, 0.42, -0.25, 0.62, 0.78],
    [0.86, 0.38, -0.32, 0.6, 0.8],
    [-0.42, 0.32, -0.98, 0.52, 0.8],
    [0.5, 0.3, -1.0, 0.5, 0.8],
    [-1.04, 0.18, 0.48, 0.36, 0.85],
    [1.04, 0.16, 0.46, 0.38, 0.8],
    [-0.66, 0.12, 0.92, 0.26, 0.8],
    [0.8, 0.1, 1.0, 0.24, 0.8],
    [0.32, 1.06, -0.62, 0.42, 0.85],
    [-0.5, 0.9, -0.5, 0.36, 0.8],
  ];
  rocks.forEach(([x, y, z, r, sy], i) => {
    const col = i % 3 === 0 ? C.rock : i % 3 === 1 ? mix(C.rock, C.rockDark, 0.55) : mix(C.rock, C.stoneLight, 0.3);
    p.body.push(dodeca(r, col, { x, y, z, sy, ry: i * 1.7, rx: (i % 2) * 0.3 }));
  });
  // Mossy tufts on top.
  const moss = mix(C.grass, C.leafDark, 0.45);
  for (const [x, y, z, r] of [
    [-0.15, 1.18, -0.42, 0.26],
    [0.25, 1.34, -0.66, 0.18],
    [-0.9, 0.86, -0.32, 0.2],
    [0.9, 0.82, -0.42, 0.18],
  ]) {
    p.body.push(ico(r, 0, moss, { x, y, z, sy: 0.22, ry: x * 3 }));
  }
  // Timber-framed tunnel entrance cut into the front.
  const ez = 0.62;
  p.body.push(box(0.6, 0.72, 0.6, '#0d0906', { y: 0.36, z: ez - 0.28 }));
  p.body.push(box(0.6, 0.02, 0.5, mix(C.dirt, '#000000', 0.4), { y: 0.02, z: ez - 0.2 }));
  for (const s of [-1, 1]) {
    p.body.push(box(0.12, 0.84, 0.12, C.wood, { x: s * 0.37, y: 0.4, z: ez, rz: s * 0.04 }));
    p.body.push(box(0.05, 0.3, 0.06, C.woodDark, { x: s * 0.24, y: 0.7, z: ez + 0.02, rz: s * 0.8 }));
    p.body.push(dodeca(0.16, C.rockDark, { x: s * 0.52, y: 0.08, z: ez + 0.06, sy: 0.7 }));
  }
  p.body.push(box(1.0, 0.14, 0.15, C.woodDark, { y: 0.86, z: ez }));
  p.body.push(box(1.04, 0.05, 0.3, C.wood, { y: 0.96, z: ez - 0.06, rx: 0.25 }));
  p.body.push(box(0.34, 0.12, 0.025, C.woodLight, { y: 0.86, z: ez + 0.085 }));
  p.body.push(box(0.2, 0.03, 0.01, C.woodDark, { y: 0.87, z: ez + 0.1, rz: 0.5 }));
  p.body.push(box(0.2, 0.03, 0.01, C.woodDark, { y: 0.87, z: ez + 0.1, rz: -0.5 }));
  // Rails, sleepers and a gravel bed.
  p.body.push(box(0.56, 0.14, 0.85, '#7d7466', { y: -0.04, z: 1.03 }));
  for (let i = 0; i < 6; i++) p.body.push(box(0.44, 0.03, 0.07, C.woodDark, { y: 0.04, z: 0.7 + i * 0.13 }));
  for (const s of [-1, 1]) p.metal.push(box(0.03, 0.035, 0.9, C.iron, { x: s * 0.13, y: 0.07, z: 0.98 }));
  // Mine cart full of gold.
  const cz = 1.1;
  p.body.push(frustum(0.34, 0.26, 0.42, 0.32, 0.22, C.wood, { y: 0.13, z: cz }));
  for (const s of [-1, 1]) p.body.push(box(0.44, 0.03, 0.03, C.ironDark, { y: 0.31, z: cz + s * 0.155 }));
  for (const s of [-1, 1]) p.body.push(box(0.03, 0.2, 0.33, C.ironDark, { x: s * 0.19, y: 0.23, z: cz }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.metal.push(cyl(0.065, 0.065, 0.04, 8, C.ironDark, { x: sx * 0.15, y: 0.11, z: cz + sz * 0.1, rz: Math.PI / 2 }));
  p.body.push(ico(0.17, 0, C.gold, { y: 0.35, z: cz, sx: 1.15, sy: 0.55 }));
  for (let i = 0; i < 5; i++) p.glow.push(ico(0.045, 0, GLOW.gold, { x: -0.12 + i * 0.06, y: 0.41 + (i % 2) * 0.02, z: cz + (i % 2 ? 0.05 : -0.04) }));
  // Lanterns on the posts.
  for (const s of [-1, 1]) {
    p.body.push(box(0.025, 0.025, 0.12, C.ironDark, { x: s * 0.37, y: 0.7, z: ez + 0.1 }));
    p.body.push(box(0.075, 0.1, 0.075, C.ironDark, { x: s * 0.37, y: 0.6, z: ez + 0.15 }));
    p.glow.push(box(0.055, 0.075, 0.08, GLOW.lantern, { x: s * 0.37, y: 0.6, z: ez + 0.15 }));
    p.fx.lanterns.push([s * 0.37, 0.6, ez + 0.16]);
  }
  p.fx.entrance = [0, 0.3, ez + 0.1];
  // Gold veins: streaks of nuggets running across the rock faces.
  const veins = [
    [0, 0.8, 0.55, 0.55, 0.6],
    [0, -0.55, 0.45, 0.7, -0.5],
    [0, 0.1, 0.9, 0.3, 0.9],
    [1, 0.3, 0.5, 0.8, 0.7],
    [2, -0.25, 0.55, 0.8, -0.7],
    [3, -0.3, 0.75, 0.55, 0.4],
    [4, 0.45, 0.8, 0.35, -0.4],
    [5, 0.25, 0.55, 0.8, 0.8],
    [6, -0.3, 0.6, 0.8, -0.6],
    [9, 0.3, 0.6, 0.75, 0.5],
    [10, -0.4, 0.6, 0.7, -0.3],
  ];
  for (const [ri, dx, dy, dz, tilt] of veins) {
    const [rx, ry, rz, r, sy] = rocks[ri];
    const l = Math.hypot(dx, dy, dz);
    const vx = rx + (dx / l) * r * 0.84;
    const vy = ry + (dy / l) * r * sy * 0.84;
    const vz = rz + (dz / l) * r * 0.84;
    for (let k = -2; k <= 2; k++) {
      const s = 0.035 + (2 - Math.abs(k)) * 0.016 + p.rnd() * 0.015;
      const t = { x: vx + k * 0.07, y: vy + k * 0.07 * tilt, z: vz + 0.02 - Math.abs(k) * 0.025, rx: p.rnd() * 3, ry: p.rnd() * 3, sy: 1.3 };
      if (k === 0) p.glow.push(ico(s * 0.85, 0, GLOW.gold, t));
      else p.body.push(ico(s, 0, k % 2 ? C.gold : mix(C.gold, '#fff2b0', 0.3), t));
    }
    p.fx.glints.push([vx, vy + 0.03, vz + 0.05]);
  }
  // Props: a pickaxe, spare timbers and a few loose nuggets.
  p.body.push(box(0.03, 0.42, 0.03, C.woodLight, { x: -0.64, y: 0.22, z: 0.84, rz: 0.3 }));
  p.metal.push(box(0.26, 0.04, 0.03, C.iron, { x: -0.7, y: 0.42, z: 0.84, rz: 0.5 }));
  for (let i = 0; i < 3; i++) p.body.push(box(0.6, 0.07, 0.07, i % 2 ? C.wood : C.woodDark, { x: 0.84, y: 0.04 + i * 0.07, z: 0.86 + (i % 2) * 0.04, ry: 0.6 }));
  for (let i = 0; i < 4; i++) p.body.push(ico(0.035, 0, C.gold, { x: -0.3 + p.rnd() * 0.15, y: 0.04, z: 1.05 + p.rnd() * 0.2 }));
  p.core = { x0: -1, x1: 1, z0: -1, z1: 0.6, top: 1.2 };
}

const BUILDERS = {
  townhall: buildTownhall,
  farm: buildFarm,
  barracks: buildBarracks,
  lumbermill: buildLumbermill,
  blacksmith: buildBlacksmith,
  tower: buildTower,
  goldmine: buildGoldmine,
};

function buildFallback(p, size) {
  plinth(p, size - 0.2, size - 0.2);
  const h = size * 0.4;
  stoneWalls(p, -size * 0.4, size * 0.4, -size * 0.4, size * 0.4, PT, h);
  hipRoof(p, { y: h - 0.03, w: size * 0.9, d: size * 0.9, h: size * 0.3, color: p.tc.main });
  p.core = { x0: -size * 0.4, x1: size * 0.4, z0: -size * 0.4, z1: size * 0.4, top: h };
}

// ---- model cache -------------------------------------------------------------

const defs = new Map();
const kits = new Map();

// The renderer's sun direction (index.js sunOffset); faces turned away from it
// only get the weak sky fill, which leaves every camera-facing wall nearly
// black, so a little bounce light is baked into their vertex colours.
const SUN = new THREE.Vector3(-20, 34, -13).normalize();

/**
 * Bakes soft lighting into vertex colours: darker near the ground (contact
 * occlusion) and a lift on vertical faces turned away from the sun.
 */
function bakeLight(g, o = {}) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const col = g.attributes.color;
  const lift = o.lift ?? 0.75;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    let k = o.ao === false ? 1 : 0.74 + 0.26 * clamp01((y - 0.02) / 0.4);
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    const ndl = nx * SUN.x + ny * SUN.y + nz * SUN.z;
    const away = clamp01((0.2 - ndl) / 0.5) * clamp01(1 - Math.abs(ny) * 1.2);
    k *= 1 + lift * away;
    const r = col.getX(i) * k;
    const gg = col.getY(i) * k;
    const b = col.getZ(i) * k;
    const mx = Math.max(r, gg, b, 1);
    col.setXYZ(i, r / mx, gg / mx, b / mx);
  }
  return g;
}

function modelDef(type, owner) {
  const key = `${type}:${owner}`;
  let def = defs.get(key);
  if (def) return def;
  const p = new Parts(type, owner);
  p.seed = type.length * 131 + 7;
  const size = BUILDINGS[type]?.size || 2;
  (BUILDERS[type] || ((q) => buildFallback(q, size)))(p);
  const geos = {
    body: p.body.length ? bakeLight(merge(p.body)) : null,
    metal: p.metal.length ? bakeLight(merge(p.metal), { ao: false }) : null,
    glow: p.glow.length ? merge(p.glow) : null,
    cloth: p.cloth.length ? bakeLight(merge(p.cloth), { ao: false, lift: 0.5 }) : null,
    spin: p.spin.length ? bakeLight(merge(p.spin), { ao: false }) : null,
  };
  for (const g of Object.values(geos)) g?.computeBoundingSphere();
  def = { type, owner, size, height: heightOf(type), geos, spinAt: p.spinAt, fx: p.fx, core: p.core };
  defs.set(key, def);
  return def;
}

/** Scaffolding stages and the plank floor shown while a building goes up (per type). */
function constructionKit(type) {
  let kit = kits.get(type);
  if (kit) return kit;
  const def = modelDef(type, -1);
  const core = def.core;
  const full = def.height;
  const pole = C.woodLight;
  const beam = C.wood;
  const m = 0.1;
  const X0 = core.x0 - m;
  const X1 = core.x1 + m;
  const Z0 = core.z0 - m;
  const Z1 = core.z1 + m;
  const nx = Math.max(1, Math.ceil((X1 - X0) / 0.9));
  const nz = Math.max(1, Math.ceil((Z1 - Z0) / 0.9));
  const xs = [];
  const zs = [];
  for (let i = 0; i <= nx; i++) xs.push(X0 + ((X1 - X0) * i) / nx);
  for (let j = 0; j <= nz; j++) zs.push(Z0 + ((Z1 - Z0) * j) / nz);
  const stage = (top) => {
    const g = [];
    // Corner stakes and string lines mark the foundation.
    for (const [x, z] of [
      [core.x0 - 0.04, core.z0 - 0.04],
      [core.x1 + 0.04, core.z0 - 0.04],
      [core.x0 - 0.04, core.z1 + 0.04],
      [core.x1 + 0.04, core.z1 + 0.04],
    ]) {
      g.push(box(0.04, 0.3, 0.04, C.woodLight, { x, y: 0.15, z }));
    }
    g.push(box(core.x1 - core.x0 + 0.08, 0.012, 0.012, C.plaster, { x: (core.x0 + core.x1) / 2, y: 0.24, z: core.z1 + 0.04 }));
    g.push(box(0.012, 0.012, core.z1 - core.z0 + 0.08, C.plaster, { x: core.x0 - 0.04, y: 0.24, z: (core.z0 + core.z1) / 2 }));
    g.push(box(0.012, 0.012, core.z1 - core.z0 + 0.08, C.plaster, { x: core.x1 + 0.04, y: 0.24, z: (core.z0 + core.z1) / 2 }));
    if (top < 0.3) return merge(g);
    const poles = [];
    for (const x of xs) poles.push([x, Z0], [x, Z1]);
    for (const z of zs.slice(1, -1)) poles.push([X0, z], [X1, z]);
    for (const [x, z] of poles) g.push(cyl(0.024, 0.03, top + 0.12, 5, pole, { x, y: (top + 0.12) / 2, z }));
    const levels = [];
    for (let y = 0.42; y <= top + 0.01; y += 0.42) levels.push(y);
    for (const y of levels) {
      g.push(box(X1 - X0 + 0.08, 0.035, 0.035, beam, { x: (X0 + X1) / 2, y, z: Z1 }));
      g.push(box(X1 - X0 + 0.08, 0.035, 0.035, beam, { x: (X0 + X1) / 2, y, z: Z0 }));
      g.push(box(0.035, 0.035, Z1 - Z0 + 0.08, beam, { x: X0, y, z: (Z0 + Z1) / 2 }));
      g.push(box(0.035, 0.035, Z1 - Z0 + 0.08, beam, { x: X1, y, z: (Z0 + Z1) / 2 }));
      // Walkway boards along the front and west side.
      g.push(box(X1 - X0, 0.025, 0.15, C.woodLight, { x: (X0 + X1) / 2, y: y + 0.03, z: Z1 - 0.02, shade: -0.05 }));
      g.push(box(0.15, 0.025, Z1 - Z0, C.woodLight, { x: X0 + 0.02, y: y + 0.03, z: (Z0 + Z1) / 2, shade: -0.1 }));
    }
    // Cross braces on the front and west faces.
    const lv = [0, ...levels];
    for (let k = 0; k + 1 < lv.length; k++) {
      const ya = lv[k];
      const yb = lv[k + 1];
      for (let i = 0; i + 1 < xs.length; i++) {
        if ((i + k) % 2) continue;
        const dx = xs[i + 1] - xs[i];
        const len = Math.hypot(dx, yb - ya);
        const ang = Math.atan2(yb - ya, dx) * ((i + k) % 4 ? -1 : 1);
        g.push(box(len, 0.025, 0.025, beam, { x: (xs[i] + xs[i + 1]) / 2, y: (ya + yb) / 2, z: Z1 + 0.025, rz: ang }));
      }
      for (let j = 0; j + 1 < zs.length; j++) {
        if ((j + k) % 2 === 0) continue;
        const dz = zs[j + 1] - zs[j];
        const len = Math.hypot(dz, yb - ya);
        g.push(box(0.025, 0.025, len, beam, { x: X0 - 0.025, y: (ya + yb) / 2, z: (zs[j] + zs[j + 1]) / 2, rx: -Math.atan2(yb - ya, dz) }));
      }
    }
    // A ladder up the front.
    const lx = xs[Math.min(1, xs.length - 1)] - 0.2;
    const lt = Math.min(top, levels[levels.length - 1] ?? top) + 0.1;
    for (const s of [-1, 1]) g.push(box(0.03, lt, 0.03, C.woodLight, { x: lx + s * 0.09, y: lt / 2, z: Z1 + 0.12, rx: -0.12 }));
    for (let y = 0.12; y < lt - 0.05; y += 0.13) g.push(box(0.18, 0.02, 0.02, C.woodLight, { x: lx, y, z: Z1 + 0.12 - (y - lt / 2) * 0.12 }));
    return merge(g);
  };
  const stages = [0, 0.84, Math.max(1.0, Math.min(full - 0.15, core.top + 0.9))].map((t) => stage(t));
  // Building materials piled at the front-left corner while the foundation is laid.
  stages[0] = merge([stages[0], ...pileGeo(core)]);
  // Plank floor capping the hollow walls at the build height.
  let cap;
  if (core.round) {
    cap = merge([cyl(core.round - 0.01, core.round - 0.01, 0.04, 12, C.woodLight, {}), box(core.round * 1.6, 0.012, 0.03, C.woodDark, { y: 0.026 }), box(0.03, 0.012, core.round * 1.6, C.woodDark, { y: 0.026 })]);
  } else {
    const w = core.x1 - core.x0 - 0.01;
    const d = core.z1 - core.z0 - 0.01;
    const g = [box(w, 0.04, d, C.woodLight, { x: (core.x0 + core.x1) / 2, z: (core.z0 + core.z1) / 2 })];
    for (let z = core.z0 + 0.15; z < core.z1 - 0.05; z += 0.15) g.push(box(w, 0.006, 0.012, C.woodDark, { x: (core.x0 + core.x1) / 2, y: 0.022, z }));
    for (const x of [core.x0 + 0.25, core.x1 - 0.25]) g.push(box(0.05, 0.03, d, C.wood, { x, y: 0.03, z: (core.z0 + core.z1) / 2 }));
    cap = merge(g);
  }
  for (const g of [...stages, cap]) g.computeBoundingSphere();
  kit = { stages, cap };
  kits.set(type, kit);
  return kit;
}

function pileGeo(core) {
  const g = [];
  const x = core.x0 + 0.2;
  const z = core.z1 + 0.32;
  for (let i = 0; i < 3; i++) g.push(box(0.5, 0.05, 0.08, C.woodLight, { x: x + 0.1, y: 0.03 + i * 0.05, z: z + (i % 2) * 0.04, shade: -0.05 * i }));
  for (let i = 0; i < 3; i++) g.push(box(0.14, 0.1, 0.1, C.stoneLight, { x: x + 0.48 + (i % 2) * 0.12, y: 0.05 + (i === 2 ? 0.1 : 0), z: z + 0.02, shade: -0.06 * i }));
  return g;
}

/**
 * Builds a building model: a Group of meshes sharing cached geometry.
 * Swap materials freely (the geometries are shared: never dispose them).
 */
export function createBuildingModel(type, owner, palette) {
  return buildModel(modelDef(type, owner), palette, null);
}

function buildModel(def, palette, mats) {
  const group = new THREE.Group();
  const parts = {};
  const add = (name, geo, mat, cast) => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    m.name = name;
    group.add(m);
    parts[name] = m;
  };
  add('body', def.geos.body, palette.matte, true);
  add('metal', def.geos.metal, palette.metal, true);
  add('glow', def.geos.glow, mats ? mats.glow : palette.glow, false);
  add('cloth', def.geos.cloth, mats ? mats.cloth : palette.matte, true);
  add('spin', def.geos.spin, palette.matte, true);
  if (parts.spin) parts.spin.position.set(...def.spinAt);
  group.userData.parts = parts;
  group.userData.buildingType = def.type;
  return group;
}

// ---- materials ---------------------------------------------------------------

const CLOTH_VERT = `
float wPh = uTime * 3.4 + modelMatrix[3].x * 0.9 + modelMatrix[3].z * 0.6;
float wS = sin( wPh - aWave.w * 3.4 ) + 0.35 * sin( wPh * 2.3 - aWave.w * 6.5 + 1.3 );
transformed += aWave.xyz * aWave.w * wS;`;

const GLOW_VERT = `
float gPh = uTime + modelMatrix[3].x * 2.1 + modelMatrix[3].z * 1.3;
vColor.rgb *= 0.9 + 0.07 * sin( gPh * 9.0 + position.x * 7.0 + position.z * 5.0 ) + 0.05 * sin( gPh * 23.0 + position.y * 11.0 );`;

function makeMaterials(fog) {
  const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  fog.patch(cloth, { key: 'bld-cloth', beginVertex: CLOTH_VERT });
  const base = cloth.onBeforeCompile;
  cloth.onBeforeCompile = (shader, r) => {
    base(shader, r);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aWave;');
  };
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  fog.patch(glow, { key: 'bld-glow', beginVertex: GLOW_VERT });
  return { cloth, glow };
}

function makeCutMaterial(fog) {
  const uCut = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  fog.patch(mat, { key: 'bld-cut', uniforms: { uCut }, beginVertex: 'vCutY = transformed.y;' });
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    base(shader, r);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCutY;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCutY;\nuniform float uCut;')
      .replace('void main() {', 'void main() {\n\tif ( vCutY > uCut ) discard;');
  };
  return { mat, uCut };
}

// ---- particles -----------------------------------------------------------------

// Start and end colours (r, g, b, a) for every kind of particle the layer emits.
const COL = {
  dust: [
    [0.78, 0.7, 0.58, 0.45],
    [0.8, 0.74, 0.64, 0],
  ],
  burst: [
    [0.8, 0.73, 0.6, 0.55],
    [0.82, 0.77, 0.68, 0],
  ],
  chip: [
    [0.4, 0.37, 0.33, 1],
    [0.4, 0.37, 0.33, 0.8],
  ],
  puff: [
    [0.7, 0.66, 0.6, 0.5],
    [0.75, 0.72, 0.68, 0],
  ],
  flame: [
    [1, 0.72, 0.32, 0.85],
    [1, 0.3, 0.05, 0],
  ],
  halo: [
    [1, 0.6, 0.25, 0.22],
    [1, 0.45, 0.15, 0],
  ],
  heavy: [
    [0.35, 0.33, 0.32, 0.55],
    [0.55, 0.54, 0.53, 0],
  ],
  hearth: [
    [0.86, 0.85, 0.83, 0.42],
    [0.92, 0.92, 0.92, 0],
  ],
  ember: [
    [1, 0.45, 0.12, 0.35],
    [1, 0.25, 0.05, 0],
  ],
  spark: [
    [1, 0.75, 0.35, 1],
    [1, 0.3, 0.05, 0],
  ],
  hammer: [
    [1, 0.85, 0.45, 1],
    [1, 0.35, 0.05, 0],
  ],
  flash: [
    [1, 0.7, 0.3, 0.7],
    [1, 0.4, 0.1, 0],
  ],
  saw: [
    [0.92, 0.8, 0.55, 0.85],
    [0.95, 0.86, 0.66, 0],
  ],
  glint: [
    [1, 0.95, 0.7, 1],
    [1, 0.8, 0.35, 0],
  ],
  lamp: [
    [1, 0.75, 0.35, 0.16],
    [1, 0.6, 0.2, 0],
  ],
  lampBusy: [
    [1, 0.75, 0.35, 0.3],
    [1, 0.6, 0.2, 0],
  ],
  mineDust: [
    [0.62, 0.55, 0.45, 0.45],
    [0.7, 0.65, 0.58, 0],
  ],
  fire: [
    [1, 0.62, 0.18, 0.9],
    [0.9, 0.18, 0.03, 0],
  ],
  fireSmoke: [
    [0.16, 0.14, 0.13, 0.62],
    [0.3, 0.29, 0.28, 0],
  ],
};

// One reusable emit descriptor (Particles.emit copies it), so emitting allocates nothing.
const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, size1: 0.1, color: null, color1: null, gravity: 0, drag: 0 };
const rand = Math.random;

function emit(ps, c, x, y, z, vx, vy, vz, life, size, size1, gravity = 0, drag = 0) {
  P.x = x;
  P.y = y;
  P.z = z;
  P.vx = vx;
  P.vy = vy;
  P.vz = vz;
  P.life = life;
  P.size = size;
  P.size1 = size1;
  P.gravity = gravity;
  P.drag = drag;
  P.color = c[0];
  P.color1 = c[1];
  ps.emit(P);
}

const WIND_X = 0.16;
const WIND_Z = -0.05;

// ---- the layer ---------------------------------------------------------------

export class BuildingLayer {
  /** @param {import('./index.js').LayerContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    ctx.scene.add(this.group);
    this.records = new Map();
    this.mats = makeMaterials(ctx.fog);
    this.cutPool = [];
    this.cutAll = [];
    this.lastClock = null;
    this.frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._s = new THREE.Sphere();
  }

  metrics(b) {
    const h = heightOf(b.type);
    if (b.constructing) return { height: Math.max(0.7, Math.min(h, this.cutHeight(h, b.progress) + 0.45)) };
    return { height: h };
  }

  cutHeight(h, progress) {
    return PT - 0.02 + (h + 0.05 - PT) * clamp01(progress);
  }

  sync(frame, clock) {
    const { game } = this.ctx;
    const dt = this.lastClock === null ? 0 : Math.min(0.1, Math.max(0, clock - this.lastClock));
    this.lastClock = clock;
    const cam = this.ctx.rig.camera;
    this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);

    for (const r of this.records.values()) {
      r.seen = false;
      r.inside = 0;
    }
    for (const u of game.units) {
      if (u.hidden && u.inside) {
        const r = this.records.get(u.inside);
        if (r) r.inside++;
      }
    }
    for (const b of game.buildings) {
      if (!this.ctx.visible(b)) continue;
      let r = this.records.get(b.id);
      if (r && (r.type !== b.type || r.owner !== b.owner)) {
        this.drop(r);
        r = null;
      }
      if (!r) r = this.add(b);
      r.seen = true;
      this.update(r, b, clock, dt);
    }
    for (const r of this.records.values()) if (!r.seen) this.drop(r);
  }

  add(b) {
    const { ctx } = this;
    const def = modelDef(b.type, b.owner);
    const model = buildModel(def, ctx.palette, this.mats);
    const s = b.size;
    const cx = b.x + s / 2;
    const cz = b.y + s / 2;
    // Sit on the highest ground under the footprint; the plinth reaches down.
    let gy = ctx.heightAt(cx, cz);
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      gy = Math.max(gy, ctx.heightAt(cx + dx * (s / 2 - 0.15), cz + dz * (s / 2 - 0.15)));
    }
    model.position.set(cx, gy, cz);
    this.group.add(model);
    const r = {
      id: b.id,
      type: b.type,
      owner: b.owner,
      def,
      model,
      parts: model.userData.parts,
      cx,
      cz,
      gy,
      seen: true,
      inside: 0,
      cut: null,
      scaffold: null,
      cap: null,
      stage: -1,
      flash: 0,
      shaking: false,
      seed: hash(b.id * 31 + 5),
      acc: { torch: 0, smoke: rand(), fire: 0, fsmoke: 0, ember: 0, forge: rand(), anvil: rand() * 2, glint: 0, saw: 0, dust: 0, lantern: 0 },
    };
    this.records.set(b.id, r);
    return r;
  }

  drop(r) {
    if (r.cut) this.endConstruction(r, false);
    r.model.removeFromParent();
    this.records.delete(r.id);
  }

  update(r, b, clock, dt) {
    const { def, model, parts } = r;
    if (b.constructing) {
      if (!r.cut) this.beginConstruction(r);
      this.updateConstruction(r, b, dt);
    } else if (r.cut) this.endConstruction(r, true);

    // Hit reaction: a short shudder.
    const k = b.flash > 0 ? Math.min(1, b.flash / 0.12) : 0;
    if (k > 0 || r.shaking) {
      r.shaking = k > 0;
      model.position.x = r.cx + Math.sin(clock * 85 + r.seed * 20) * 0.035 * k;
      model.position.z = r.cz + Math.cos(clock * 70 + r.seed * 11) * 0.02 * k;
      model.scale.set(1 + 0.012 * k, 1 - 0.025 * k, 1 + 0.012 * k);
    }
    if (b.flash > r.flash + 0.02) this.debris(r, b);
    r.flash = b.flash;

    if (parts.spin && !b.constructing) parts.spin.rotation.z = -clock * 6.5;

    // Ambient effects only for buildings in view.
    const s = this._s;
    s.center.set(r.cx, r.gy + def.height * 0.5, r.cz);
    s.radius = def.size * 0.75 + def.height * 0.5;
    if (dt <= 0 || !this.frustum.intersectsSphere(s)) return;
    if (!b.constructing) this.ambient(r, dt);
    if (b.type !== 'goldmine' && b.maxHp > 1) this.damage(r, b, dt);
  }

  // ---- construction --------------------------------------------------------

  beginConstruction(r) {
    const { parts } = r;
    r.cut = this.cutPool.pop() || this.newCut();
    parts.body.material = r.cut.mat;
    parts.body.castShadow = false;
    for (const n of ['metal', 'glow', 'cloth', 'spin']) if (parts[n]) parts[n].visible = false;
    const kit = constructionKit(r.type);
    r.scaffold = new THREE.Mesh(kit.stages[0], this.ctx.palette.matte);
    r.scaffold.castShadow = true;
    r.scaffold.receiveShadow = true;
    r.cap = new THREE.Mesh(kit.cap, this.ctx.palette.matte);
    r.cap.receiveShadow = true;
    r.model.add(r.scaffold, r.cap);
    r.stage = 0;
  }

  newCut() {
    const c = makeCutMaterial(this.ctx.fog);
    this.cutAll.push(c);
    return c;
  }

  updateConstruction(r, b, dt) {
    const p = clamp01(b.progress);
    const cut = this.cutHeight(r.def.height, p);
    r.cut.uCut.value = cut;
    const stage = p < 0.12 ? 0 : p < 0.45 ? 1 : 2;
    if (stage !== r.stage) {
      r.stage = stage;
      r.scaffold.geometry = constructionKit(r.type).stages[stage];
    }
    const core = r.def.core;
    r.cap.visible = cut > PT + 0.02 && cut < core.top - 0.01;
    r.cap.position.y = cut;
    // Puffs of dust where the builders work.
    if (dt <= 0) return;
    r.acc.dust += dt * 1.6;
    while (r.acc.dust >= 1) {
      r.acc.dust -= 1;
      const front = rand() < 0.5;
      const x = front ? core.x0 + rand() * (core.x1 - core.x0) : rand() < 0.5 ? core.x0 : core.x1;
      const z = front ? core.z1 + 0.05 : core.z0 + rand() * (core.z1 - core.z0);
      const y = Math.min(cut, core.top) + 0.02;
      emit(this.ctx.particles.smoke, COL.dust, r.cx + x, r.gy + y, r.cz + z, (rand() - 0.5) * 0.3, 0.25 + rand() * 0.2, (rand() - 0.5) * 0.3, 1.1, 0.18, 0.55);
    }
  }

  endConstruction(r, finished) {
    const { parts } = r;
    parts.body.material = this.ctx.palette.matte;
    parts.body.castShadow = true;
    for (const n of ['metal', 'glow', 'cloth', 'spin']) if (parts[n]) parts[n].visible = true;
    r.scaffold.removeFromParent();
    r.cap.removeFromParent();
    r.scaffold = null;
    r.cap = null;
    this.cutPool.push(r.cut);
    r.cut = null;
    r.stage = -1;
    if (finished) this.burst(r, 18);
  }

  // ---- effects -------------------------------------------------------------

  /** A ring of dust around the base (construction finished). */
  burst(r, n) {
    const half = r.def.size / 2;
    const smoke = this.ctx.particles.smoke;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      emit(smoke, COL.burst, r.cx + c * half * 0.95, r.gy + 0.1, r.cz + s * half * 0.95, c * 0.6, 0.3 + rand() * 0.2, s * 0.6, 1.3, 0.35, 0.9, 0, 1.5);
    }
  }

  /** Chips and dust knocked off by a hit. */
  debris(r, b) {
    const core = r.def.core;
    const smoke = this.ctx.particles.smoke;
    const x = r.cx + core.x0 + rand() * (core.x1 - core.x0);
    const z = r.cz + core.z1 + 0.05;
    const top = b.constructing ? Math.min(core.top, this.cutHeight(r.def.height, b.progress)) : core.top;
    const y = r.gy + 0.25 + rand() * Math.max(0.1, top - 0.3);
    for (let i = 0; i < 4; i++) emit(smoke, COL.chip, x, y, z, (rand() - 0.5) * 1.2, 0.8 + rand(), 0.4 + rand() * 0.6, 0.6, 0.07, 0.04, 6);
    emit(smoke, COL.puff, x, y, z, 0, 0.3, 0.3, 0.8, 0.25, 0.6, 0, 1);
  }

  ambient(r, dt) {
    const { fx } = r.def;
    const { glow, spark, smoke } = this.ctx.particles;
    const ox = r.model.position.x;
    const oy = r.model.position.y;
    const oz = r.model.position.z;
    const acc = r.acc;

    // Torches: small licking flames and a soft halo.
    if (fx.torches.length) {
      acc.torch += dt * 11;
      while (acc.torch >= 1) {
        acc.torch -= 1;
        for (const [x, y, z] of fx.torches) {
          emit(glow, COL.flame, ox + x + (rand() - 0.5) * 0.03, oy + y, oz + z + (rand() - 0.5) * 0.03, (rand() - 0.5) * 0.06, 0.35 + rand() * 0.3, (rand() - 0.5) * 0.06, 0.28 + rand() * 0.18, 0.2, 0.05);
          if (rand() < 0.25) emit(glow, COL.halo, ox + x, oy + y - 0.04, oz + z, 0, 0.05, 0, 0.35, 0.65, 0.55);
        }
      }
    }

    // Chimney smoke.
    if (fx.chimneys.length) {
      acc.smoke += dt * 2.6;
      while (acc.smoke >= 1) {
        acc.smoke -= 1;
        for (const [x, y, z, heavy] of fx.chimneys) {
          emit(
            smoke,
            heavy ? COL.heavy : COL.hearth,
            ox + x + (rand() - 0.5) * 0.06,
            oy + y,
            oz + z + (rand() - 0.5) * 0.06,
            WIND_X * 0.6 + (rand() - 0.5) * 0.08,
            0.38 + rand() * 0.15,
            WIND_Z + (rand() - 0.5) * 0.08,
            2.8 + rand(),
            heavy ? 0.26 : 0.2,
            heavy ? 1.05 : 0.8,
            -0.02,
            0.15,
          );
        }
      }
    }

    // Forge: embers drifting out of the mouth, hammer sparks at the anvil.
    if (fx.forge) {
      const [x, y, z] = fx.forge;
      acc.forge += dt * 5;
      while (acc.forge >= 1) {
        acc.forge -= 1;
        emit(glow, COL.ember, ox + x + (rand() - 0.5) * 0.3, oy + y - 0.12, oz + z + 0.02, (rand() - 0.5) * 0.1, 0.12, 0.08, 0.5, 0.4, 0.2);
        if (rand() < 0.5) emit(spark, COL.spark, ox + x + (rand() - 0.5) * 0.25, oy + y, oz + z + 0.05, (rand() - 0.5) * 0.2, 0.5 + rand() * 0.4, 0.15, 0.8, 0.07, 0.02, -0.1);
      }
    }
    if (fx.anvil) {
      acc.anvil -= dt;
      if (acc.anvil <= 0) {
        acc.anvil = 1.1 + rand() * 0.9;
        const [x, y, z] = fx.anvil;
        for (let i = 0; i < 9; i++) {
          const a = rand() * TAU;
          const sp = 0.6 + rand() * 0.9;
          emit(spark, COL.hammer, ox + x, oy + y, oz + z, Math.cos(a) * sp, 1.0 + rand() * 1.2, Math.sin(a) * sp, 0.45 + rand() * 0.25, 0.09, 0.03, 5);
        }
        emit(glow, COL.flash, ox + x, oy + y + 0.03, oz + z, 0, 0, 0, 0.18, 0.5, 0.2);
      }
    }

    // Saw dust.
    if (fx.saw) {
      const [x, y, z] = fx.saw;
      acc.saw += dt * 7;
      while (acc.saw >= 1) {
        acc.saw -= 1;
        emit(smoke, COL.saw, ox + x, oy + y, oz + z + 0.02, 0.5 + rand() * 0.5, 0.25 + rand() * 0.3, (rand() - 0.5) * 0.3, 0.7, 0.07, 0.22, 1.2, 1);
      }
    }

    // Gold glints; brighter lanterns and dust while miners are inside.
    if (fx.glints.length) {
      acc.glint += dt * 2.4;
      while (acc.glint >= 1) {
        acc.glint -= 1;
        const [x, y, z] = fx.glints[(rand() * fx.glints.length) | 0];
        emit(spark, COL.glint, ox + x + (rand() - 0.5) * 0.1, oy + y + (rand() - 0.5) * 0.06, oz + z, 0, 0, 0, 0.45, 0.32, 0.0);
      }
    }
    if (fx.lanterns.length) {
      acc.lantern += dt * (r.inside ? 6 : 2.5);
      while (acc.lantern >= 1) {
        acc.lantern -= 1;
        for (const [x, y, z] of fx.lanterns) emit(glow, r.inside ? COL.lampBusy : COL.lamp, ox + x, oy + y, oz + z + 0.02, 0, 0.03, 0, 0.5, r.inside ? 0.6 : 0.42, 0.5);
      }
      if (r.inside && fx.entrance) {
        const [x, y, z] = fx.entrance;
        acc.dust += dt * 1.8;
        while (acc.dust >= 1) {
          acc.dust -= 1;
          emit(smoke, COL.mineDust, ox + x + (rand() - 0.5) * 0.4, oy + y, oz + z, (rand() - 0.5) * 0.2, 0.15, 0.25 + rand() * 0.2, 1.2, 0.2, 0.55, 0, 0.8);
        }
      }
    }
  }

  damage(r, b, dt) {
    // A building under construction starts at 10% hp, so judge it against
    // what it would have by now.
    const expected = b.constructing ? b.maxHp * (0.1 + 0.9 * clamp01(b.progress)) : b.maxHp;
    const ratio = b.hp / Math.max(1, expected);
    if (ratio >= 0.5) return;
    const pts = r.def.fx.fires;
    if (!pts.length) return;
    const severe = ratio < 0.25;
    const n = severe ? pts.length : Math.min(2, pts.length);
    const { glow, spark, smoke } = this.ctx.particles;
    const ox = r.model.position.x;
    const oy = r.model.position.y;
    const oz = r.model.position.z;
    const capY = b.constructing ? this.cutHeight(r.def.height, b.progress) : Infinity;
    const acc = r.acc;
    const scale = severe ? 1.25 : 1;
    acc.fire += dt * (severe ? 16 : 12);
    acc.fsmoke += dt * (severe ? 4.5 : 3);
    acc.ember += dt * (severe ? 4 : 2);
    while (acc.fire >= 1) {
      acc.fire -= 1;
      for (let i = 0; i < n; i++) {
        const [x, y0, z] = pts[i];
        const y = Math.min(y0, capY);
        emit(glow, COL.fire, ox + x + (rand() - 0.5) * 0.22, oy + y + rand() * 0.05, oz + z + (rand() - 0.5) * 0.22, (rand() - 0.5) * 0.15 + WIND_X * 0.3, 0.7 + rand() * 0.5, (rand() - 0.5) * 0.15, 0.45 + rand() * 0.3, 0.42 * scale, 0.12);
      }
    }
    while (acc.fsmoke >= 1) {
      acc.fsmoke -= 1;
      for (let i = 0; i < n; i++) {
        const [x, y0, z] = pts[i];
        const y = Math.min(y0, capY) + 0.3;
        emit(smoke, COL.fireSmoke, ox + x + (rand() - 0.5) * 0.15, oy + y, oz + z + (rand() - 0.5) * 0.15, WIND_X + (rand() - 0.5) * 0.15, 0.55 + rand() * 0.25, WIND_Z + (rand() - 0.5) * 0.15, 2.4 + rand() * 0.8, 0.35 * scale, 1.4 * scale, -0.05, 0.1);
      }
    }
    while (acc.ember >= 1) {
      acc.ember -= 1;
      const [x, y0, z] = pts[(rand() * n) | 0];
      const y = Math.min(y0, capY);
      emit(spark, COL.spark, ox + x + (rand() - 0.5) * 0.2, oy + y + 0.1, oz + z, (rand() - 0.5) * 0.5 + WIND_X, 0.9 + rand() * 0.8, (rand() - 0.5) * 0.5, 1.0 + rand() * 0.6, 0.08, 0.03, 0.4, 0.4);
    }
  }

  dispose() {
    for (const r of [...this.records.values()]) this.drop(r);
    this.group.removeFromParent();
    this.mats.cloth.dispose();
    this.mats.glow.dispose();
    for (const c of this.cutAll) c.mat.dispose();
    for (const def of defs.values()) for (const g of Object.values(def.geos)) g?.dispose();
    for (const kit of kits.values()) for (const g of [...kit.stages, kit.cap]) g.dispose();
    defs.clear();
    kits.clear();
  }
}
