// Unit layer: animated low-poly models for every unit.
//
//   new UnitLayer(ctx)
//   sync(frame, clock)     draws every visible unit, animated from its game state
//   metrics(unit)          { height, radius } in world units, for picking and bars
//   dispose()
// Also exports createUnitModel(type, owner, palette) -> THREE.Object3D: the unit
// in a neutral standing pose (shared geometry and materials; used for corpses).
//
// How it works. Each unit type is a rig of rigid parts ("bones"): every vertex
// of a model carries the index of the bone it belongs to (attribute `aBone`).
// All units of one (type, team) are drawn as one InstancedMesh per material
// (matte + metal), and each instance's posed bone matrices live in a float
// texture (one row per instance, three texels per bone) that the vertex shader
// reads. A whole army of one kind therefore costs two draw calls plus two for
// its shadows, however many units there are. Poses are computed on the CPU
// each frame from the game state (walk cycle, attack, chopping, carrying, hits).

import * as THREE from 'three';
import { TILE } from '../config.js';
import { box, cyl, cone, sphere, ico, dodeca, prism, merge, mix, hash, finish } from './geo.js';
import { SWATCH, teamColors } from './palette.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const MAX_BONES = 16;

// Unit-only colours (everything else comes from SWATCH).
const COL = {
  linen: '#dcc79a',
  linenDark: '#b09862',
  trousers: '#6b5338',
  boot: '#4d3523',
  straw: '#e6c262',
  strawLight: '#f1d987',
  beard: '#8a5a2e',
  eye: '#21150d',
  mail: '#7c838b',
  leatherDark: '#523620',
  olive: '#5f6038',
  burlap: '#c4a46e',
  burlapDark: '#94784a',
  coat: '#efe9dd',
  coatDark: '#b9ae9d',
  mane: '#4a3628',
  hoof: '#2f2721',
  slit: '#141414',
  string: '#efe6cf',
  feather: '#f4f1e8',
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => {
  v = clamp01(v);
  return v * v * (3 - 2 * v);
};
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, target, k) => v + (target - v) * Math.min(1, k);
const wrapAngle = (a) => a - TAU * Math.round(a / TAU);

// ---- model-building helpers --------------------------------------------------

const _m4 = new THREE.Matrix4();
const _eu = new THREE.Euler();
const _qa = new THREE.Quaternion();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Rotates (rx, ry, rz) then translates (x, y, z) a geometry in place. */
function xform(g, t) {
  _eu.set(t.rx || 0, t.ry || 0, t.rz || 0);
  _qa.setFromEuler(_eu);
  const s = t.s || 1;
  _m4.compose(_va.set(t.x || 0, t.y || 0, t.z || 0), _qa, _vb.set(s, s, s));
  g.applyMatrix4(_m4);
  return g;
}

/** Orients a geometry built along +Y so it runs from point a to point b. */
function between(g, a, b) {
  _vb.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  _qa.setFromUnitVectors(_up, _vb);
  _m4.makeRotationFromQuaternion(_qa);
  _m4.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  g.applyMatrix4(_m4);
  return g;
}

const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
/** A box from a to b, w wide and d deep. */
const strut = (a, b, w, d, color) => between(box(w, dist3(a, b), d, color), a, b);
/** A tapered cylinder from a (radius r0) to b (radius r1). */
const rod = (a, b, r0, r1, segs, color) => between(cyl(r1, r0, dist3(a, b), segs, color), a, b);
const scalePts = (pts, k) => pts.map(([x, y]) => [x * k, y * k]);

/** An open elliptical frustum (a cloth skirt): top radii (x, z), bottom radii (x, z), height h. */
function skirt(topRx, topRz, botRx, botRz, h, segs, color, t) {
  const g = new THREE.CylinderGeometry(1, 1, h, segs, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * (top ? topRx : botRx));
    p.setZ(i, p.getZ(i) * (top ? topRz : botRz));
  }
  return finish(g, color, t);
}

/** Collects model parts, each tagged with a bone and a material (matte or metal). */
class Kit {
  constructor(rig) {
    this.rig = rig;
    this.parts = [];
    this.bone = 0;
  }

  on(name) {
    this.bone = this.rig.b[name];
    if (this.bone === undefined) throw new Error(`unknown bone ${name}`);
    return this;
  }

  m(...geos) {
    for (const g of geos) this.parts.push({ g, bone: this.bone, metal: false });
    return this;
  }

  x(...geos) {
    for (const g of geos) this.parts.push({ g, bone: this.bone, metal: true });
    return this;
  }

  /** Builds parts in a local frame, then places them all with transform t. */
  local(t, fn) {
    const n = this.parts.length;
    fn();
    for (let i = n; i < this.parts.length; i++) xform(this.parts[i].g, t);
    return this;
  }
}

/** Darkens vertices near the ground: a cheap baked ambient occlusion. */
function shadeAO(g) {
  const p = g.attributes.position;
  const c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const k = 0.66 + 0.34 * smooth(p.getY(i) / 0.34);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

function tagBone(g, bone) {
  const n = g.attributes.position.count;
  g.setAttribute('aBone', new THREE.BufferAttribute(new Float32Array(n).fill(bone), 1));
}

// ---- rigs ---------------------------------------------------------------------

/**
 * @param {Array<{name:string, parent?:string, pivot:number[], dir?:number[]}>} defs
 *   bones in order (parents before children); pivot in model space (bind pose);
 *   dir is the bone's rest direction, used when aiming it at a point.
 */
function makeRig(type, defs, opts) {
  const b = {};
  defs.forEach((d, i) => (b[d.name] = i));
  const scale = opts.scale || 1;
  const rig = {
    type,
    nb: defs.length,
    b,
    scale,
    parents: defs.map((d) => (d.parent ? b[d.parent] : -1)),
    pivots: defs.map((d) => new THREE.Vector3(...d.pivot).multiplyScalar(scale)),
    dirs: defs.map((d) => new THREE.Vector3(...(d.dir || [0, -1, 0])).normalize()),
    optional: new Set((opts.optional || []).map((n) => b[n])),
    build: opts.build,
    pose: opts.pose,
    metrics: opts.metrics,
  };
  rig.parents.forEach((p, i) => {
    if (p >= i || p === undefined) throw new Error(`${type}: bone ${defs[i].name} must come after its parent`);
  });
  if (rig.nb > MAX_BONES) throw new Error(`${type}: too many bones`);
  return rig;
}

// Bind-pose landmarks shared by the humanoid rigs.
const HAND_L = [0.2, 0.3, 0];
const HAND_R = [-0.2, 0.3, 0];

function humanBones(left = [], right = [], extra = []) {
  return [
    { name: 'root', pivot: [0, 0.3, 0] },
    { name: 'torso', parent: 'root', pivot: [0, 0.36, 0] },
    { name: 'head', parent: 'torso', pivot: [0, 0.58, 0] },
    { name: 'legL', parent: 'root', pivot: [0.072, 0.3, 0] },
    { name: 'legR', parent: 'root', pivot: [-0.072, 0.3, 0] },
    { name: 'armL', parent: 'torso', pivot: [0.185, 0.53, 0] },
    ...left,
    { name: 'armR', parent: 'torso', pivot: [-0.185, 0.53, 0] },
    ...right,
    ...extra,
  ];
}

function humanLegs(k, trousers, boot, opts = {}) {
  for (const s of [1, -1]) {
    k.on(s > 0 ? 'legL' : 'legR');
    const x = 0.072 * s;
    k.m(cyl(0.052, 0.044, 0.21, 6, trousers, { x, y: 0.2 }));
    if (opts.tallBoots) {
      k.m(box(0.1, 0.14, 0.15, boot, { x, y: 0.07, z: 0.02 }));
      k.m(box(0.112, 0.035, 0.112, mix(boot, '#000', 0.25), { x, y: 0.145 }));
    } else if (opts.sabaton) {
      k.x(box(0.1, 0.08, 0.155, boot, { x, y: 0.04, z: 0.025 }));
      k.x(box(0.07, 0.12, 0.03, SWATCH.steel, { x, y: 0.17, z: 0.045 }));
    } else {
      k.m(box(0.098, 0.085, 0.15, boot, { x, y: 0.042, z: 0.024 }));
      k.m(box(0.104, 0.03, 0.104, mix(boot, '#000', 0.25), { x, y: 0.1 }));
    }
  }
}

function humanFace(k, y, z, opts = {}) {
  k.m(sphere(opts.r || 0.12, 8, 6, SWATCH.skin, { y, z }));
  k.m(box(0.034, 0.05, 0.05, SWATCH.skinDark, { y: y - 0.012, z: z + 0.118 }));
  for (const s of [1, -1]) k.m(box(0.024, 0.034, 0.014, COL.eye, { x: 0.043 * s, y: y + 0.016, z: z + 0.101 }));
}

// -- peasant ----------------------------------------------------------------------

function buildPeasant(k, tc) {
  humanLegs(k, COL.trousers, COL.boot);
  k.on('root');
  k.m(cyl(0.135, 0.165, 0.13, 8, COL.linen, { y: 0.305 }));
  k.m(cyl(0.169, 0.169, 0.026, 8, COL.linenDark, { y: 0.25 }));
  k.on('torso');
  k.m(cyl(0.125, 0.14, 0.2, 8, COL.linen, { y: 0.47 }));
  k.m(cyl(0.085, 0.125, 0.04, 8, mix(COL.linen, '#ffffff', 0.15), { y: 0.59 }));
  k.m(cyl(0.147, 0.147, 0.036, 8, SWATCH.leather, { y: 0.385 }));
  k.m(box(0.045, 0.036, 0.02, SWATCH.gold, { y: 0.385, z: 0.146 }));
  k.m(skirt(0.186, 0.143, 0.186, 0.143, 0.075, 12, tc.main, { y: 0.47, rz: 0.75 }));
  k.m(cyl(0.048, 0.055, 0.05, 6, SWATCH.skinDark, { y: 0.61 }));
  k.on('head');
  humanFace(k, 0.69, 0);
  k.m(box(0.15, 0.06, 0.07, COL.beard, { y: 0.615, z: 0.075 }));
  k.m(box(0.2, 0.08, 0.1, COL.beard, { y: 0.71, z: -0.065 }));
  k.local({ y: 0.775, rx: -0.14 }, () => {
    k.m(cyl(0.185, 0.195, 0.024, 12, COL.straw, {}));
    k.m(cyl(0.085, 0.118, 0.09, 8, COL.strawLight, { y: 0.052 }));
    k.m(cyl(0.121, 0.121, 0.028, 8, tc.main, { y: 0.024 }));
  });
  for (const s of [1, -1]) {
    k.on(s > 0 ? 'armL' : 'armR');
    k.m(cyl(0.057, 0.05, 0.13, 6, COL.linen, { x: 0.19 * s, y: 0.48 }));
    k.m(cyl(0.042, 0.038, 0.1, 6, SWATCH.skin, { x: 0.195 * s, y: 0.37 }));
    k.m(ico(0.05, 0, SWATCH.skin, { x: 0.2 * s, y: 0.3 }));
  }
  // Tools, held in the right fist with the handle pointing forward.
  k.on('axe').local({ x: HAND_R[0], y: HAND_R[1] }, () => {
    k.m(cyl(0.019, 0.019, 0.46, 5, SWATCH.woodLight, { z: 0.15, rx: HALF_PI }));
    k.x(prism([[-0.035, 0.02], [0.04, 0.02], [0.08, -0.12], [-0.065, -0.12]], 0.028, SWATCH.steel, { z: 0.33, ry: HALF_PI }));
    k.x(box(0.036, 0.055, 0.065, SWATCH.ironDark, { z: 0.33, y: 0.012 }));
  });
  k.on('pick').local({ x: HAND_R[0], y: HAND_R[1] }, () => {
    k.m(cyl(0.019, 0.019, 0.46, 5, SWATCH.woodLight, { z: 0.15, rx: HALF_PI }));
    k.x(box(0.036, 0.06, 0.055, SWATCH.ironDark, { z: 0.35 }));
    k.x(cone(0.027, 0.17, 4, SWATCH.iron, { z: 0.335, y: 0.1, rx: -0.3 }));
    k.x(cone(0.027, 0.17, 4, SWATCH.iron, { z: 0.335, y: -0.1, rx: Math.PI + 0.3 }));
  });
  // A sack of gold slung over the right shoulder.
  k.on('sack');
  k.m(ico(0.165, 1, COL.burlap, { x: -0.1, y: 0.5, z: -0.2, s: 1 }));
  k.m(ico(0.12, 0, COL.burlapDark, { x: -0.12, y: 0.4, z: -0.19 }));
  k.m(rod([-0.11, 0.62, -0.17], [-0.15, 0.72, -0.1], 0.065, 0.04, 6, COL.burlapDark));
  k.x(dodeca(0.045, SWATCH.gold, { x: -0.06, y: 0.635, z: -0.24 }));
  k.x(dodeca(0.04, SWATCH.gold, { x: -0.17, y: 0.62, z: -0.25 }));
  k.x(dodeca(0.035, SWATCH.gold, { x: -0.21, y: 0.56, z: -0.17 }));
  // A bundle of logs on the right shoulder.
  k.on('logs');
  for (const [x, y, z, l] of [
    [-0.25, 0.62, 0.02, 0.5],
    [-0.17, 0.625, -0.02, 0.52],
    [-0.21, 0.69, 0.0, 0.47],
  ]) {
    k.m(cyl(0.043, 0.043, l, 6, SWATCH.bark, { x, y, z, rx: HALF_PI }));
    k.m(cyl(0.034, 0.034, l + 0.014, 6, SWATCH.woodLight, { x, y, z, rx: HALF_PI }));
  }
  k.m(box(0.19, 0.17, 0.035, COL.leatherDark, { x: -0.21, y: 0.65, z: 0.0 }));
}

// -- footman ----------------------------------------------------------------------

const HEATER = [
  [-0.15, 0.17],
  [0.15, 0.17],
  [0.15, 0.03],
  [0.11, -0.09],
  [0, -0.2],
  [-0.11, -0.09],
  [-0.15, 0.03],
];

function buildFootman(k, tc) {
  humanLegs(k, COL.mail, SWATCH.iron, { sabaton: true });
  k.on('root');
  k.x(cyl(0.14, 0.172, 0.13, 8, SWATCH.iron, { y: 0.3 }));
  for (const s of [1, -1]) {
    k.m(box(0.15, 0.17, 0.02, tc.main, { y: 0.285, z: 0.172 * s }));
    k.m(box(0.155, 0.03, 0.024, tc.light, { y: 0.205, z: 0.172 * s }));
  }
  k.on('torso');
  k.x(cyl(0.14, 0.152, 0.22, 8, SWATCH.steel, { y: 0.47 }));
  k.m(box(0.17, 0.205, 0.315, tc.main, { y: 0.465 }));
  k.m(box(0.05, 0.207, 0.318, tc.light, { y: 0.465 }));
  k.m(cyl(0.157, 0.157, 0.036, 8, SWATCH.leather, { y: 0.365 }));
  k.x(box(0.04, 0.036, 0.02, SWATCH.gold, { y: 0.365, z: 0.155 }));
  k.x(cyl(0.075, 0.108, 0.05, 8, SWATCH.iron, { y: 0.6 }));
  k.on('head');
  humanFace(k, 0.68, 0.0, { r: 0.112 });
  k.x(cyl(0.12, 0.13, 0.075, 8, SWATCH.steel, { y: 0.737 }));
  k.x(cone(0.12, 0.08, 8, SWATCH.steel, { y: 0.814 }));
  k.x(cyl(0.138, 0.138, 0.022, 8, SWATCH.iron, { y: 0.703 }));
  k.x(box(0.026, 0.085, 0.026, SWATCH.iron, { y: 0.668, z: 0.118 }));
  for (const s of [1, -1]) k.x(box(0.03, 0.09, 0.085, SWATCH.iron, { x: 0.108 * s, y: 0.655, z: 0.02 }));
  // Crest: a team-colour brush from brow to nape, the clearest thing from above.
  k.on('crest');
  const crest = [
    [-0.11, 0],
    [-0.125, 0.06],
    [-0.08, 0.125],
    [0, 0.15],
    [0.075, 0.12],
    [0.11, 0.05],
    [0.09, 0],
  ];
  k.m(prism(crest, 0.05, tc.main, { y: 0.78, ry: HALF_PI }));
  k.m(prism(scalePts(crest, 0.72), 0.056, tc.light, { y: 0.79, z: -0.005, ry: HALF_PI }));
  for (const s of [1, -1]) {
    k.on(s > 0 ? 'armL' : 'armR');
    k.x(sphere(0.08, 6, 4, SWATCH.steel, { x: 0.2 * s, y: 0.54, sy: 0.85 }));
    k.m(cyl(0.05, 0.045, 0.12, 6, COL.mail, { x: 0.195 * s, y: 0.46 }));
    k.x(cyl(0.05, 0.045, 0.1, 6, SWATCH.steel, { x: 0.2 * s, y: 0.36 }));
    k.m(ico(0.052, 0, SWATCH.leather, { x: 0.2 * s, y: 0.295 }));
  }
  // Big heater shield strapped to the left forearm.
  k.on('armL').local({ x: 0.275, y: 0.37, z: 0.075, ry: 0.35, rx: -0.15 }, () => {
    k.x(prism(scalePts(HEATER, 1.1), 0.03, SWATCH.iron, { z: -0.014 }));
    k.m(prism(HEATER, 0.042, tc.main, {}));
    k.m(box(0.055, 0.29, 0.048, tc.light, { y: -0.01 }));
    k.m(box(0.25, 0.055, 0.048, tc.light, { y: 0.07 }));
    k.x(ico(0.042, 0, SWATCH.gold, { y: 0.07, z: 0.03 }));
  });
  // Broadsword, blade forward and up.
  k.on('armR').local({ x: -0.205, y: 0.3, z: 0.01, rx: 1.0 }, () => {
    k.m(cyl(0.021, 0.021, 0.11, 5, COL.leatherDark, {}));
    k.x(ico(0.03, 0, SWATCH.gold, { y: -0.07 }));
    k.x(box(0.16, 0.03, 0.042, SWATCH.gold, { y: 0.065 }));
    k.x(prism([[-0.032, 0], [0.032, 0], [0.032, 0.3], [0, 0.37], [-0.032, 0.3]], 0.018, SWATCH.steel, { y: 0.075 }));
  });
}

// -- archer -----------------------------------------------------------------------

// Bow, in the bow bone's bind frame (grip at the left fist, limbs bending back).
const BOW_HALF = 0.28;
const BOW_SET = -0.085;
const bowPoint = (t) => [HAND_L[0], HAND_L[1] + BOW_HALF * t, HAND_L[2] + BOW_SET * t * t];
const NOCK = [HAND_L[0], HAND_L[1], HAND_L[2] + BOW_SET];

function buildArcher(k, tc) {
  humanLegs(k, COL.olive, COL.leatherDark, { tallBoots: true });
  k.on('root');
  k.m(cyl(0.13, 0.158, 0.13, 8, SWATCH.leather, { y: 0.31 }));
  k.m(cyl(0.161, 0.161, 0.024, 8, COL.leatherDark, { y: 0.255 }));
  k.on('torso');
  k.m(cyl(0.12, 0.135, 0.2, 8, COL.olive, { y: 0.47 }));
  k.m(cyl(0.142, 0.142, 0.034, 8, COL.leatherDark, { y: 0.385 }));
  k.m(skirt(0.176, 0.136, 0.176, 0.136, 0.04, 12, COL.leatherDark, { y: 0.47, rz: -0.72 }));
  k.m(cyl(0.1, 0.172, 0.085, 8, tc.main, { y: 0.565 }));
  k.m(cyl(0.175, 0.175, 0.022, 8, tc.dark, { y: 0.52 }));
  k.m(cyl(0.045, 0.052, 0.05, 6, SWATCH.skinDark, { y: 0.61 }));
  // Quiver on the back, fletchings showing over the shoulder.
  k.local({ x: 0.075, y: 0.5, z: -0.205, rz: -0.42, rx: -0.12 }, () => {
    k.m(cyl(0.052, 0.045, 0.28, 6, COL.leatherDark, {}));
    k.m(cyl(0.056, 0.056, 0.03, 6, SWATCH.leather, { y: 0.12 }));
    for (const [dx, dz] of [
      [0.02, 0.0],
      [-0.02, 0.015],
      [0.0, -0.02],
    ]) {
      k.m(cyl(0.007, 0.007, 0.08, 3, SWATCH.woodLight, { x: dx, y: 0.17, z: dz }));
      k.m(box(0.034, 0.06, 0.008, COL.feather, { x: dx, y: 0.22, z: dz }));
      k.m(box(0.008, 0.06, 0.034, tc.light, { x: dx, y: 0.22, z: dz }));
    }
  });
  k.on('cloak');
  const cloak = [
    [-0.13, 0],
    [0.13, 0],
    [0.17, -0.37],
    [0.0, -0.4],
    [-0.17, -0.37],
  ];
  k.m(prism(cloak, 0.028, tc.main, { y: 0.575, z: -0.158 }));
  k.m(prism(scalePts(cloak, 0.95), 0.02, tc.dark, { y: 0.57, z: -0.14 }));
  k.on('head');
  humanFace(k, 0.68, 0.025, { r: 0.108 });
  k.m(sphere(0.132, 8, 6, tc.main, { y: 0.7, z: -0.035 }));
  k.m(cyl(0.104, 0.104, 0.03, 8, tc.dark, { y: 0.68, z: 0.07, rx: HALF_PI }));
  k.m(cone(0.07, 0.17, 6, tc.main, { y: 0.765, z: -0.16, rx: -2.0 }));
  for (const s of [1, -1]) {
    k.on(s > 0 ? 'armL' : 'armR');
    k.m(cyl(0.054, 0.048, 0.13, 6, COL.olive, { x: 0.19 * s, y: 0.48 }));
    k.m(cyl(0.045, 0.04, 0.1, 6, SWATCH.leather, { x: 0.195 * s, y: 0.37 }));
    k.m(ico(0.048, 0, SWATCH.skin, { x: 0.2 * s, y: 0.3 }));
  }
  k.on('bow');
  const ts = [-1, -0.62, -0.24, 0.24, 0.62, 1];
  for (let i = 0; i < ts.length - 1; i++) k.m(strut(bowPoint(ts[i]), bowPoint(ts[i + 1]), 0.028, 0.026, SWATCH.woodDark));
  k.m(strut(bowPoint(-0.26), bowPoint(0.26), 0.036, 0.036, SWATCH.leather));
  for (const t of [-1, 1]) k.x(ico(0.018, 0, SWATCH.gold, { x: bowPoint(t)[0], y: bowPoint(t)[1], z: bowPoint(t)[2] }));
  k.on('strT').m(strut(bowPoint(1), NOCK, 0.008, 0.008, COL.string));
  k.on('strB').m(strut(bowPoint(-1), NOCK, 0.008, 0.008, COL.string));
  k.on('arrow').local({ x: NOCK[0] - 0.022, y: NOCK[1], z: NOCK[2] }, () => {
    k.m(cyl(0.009, 0.009, 0.5, 4, SWATCH.woodLight, { z: 0.25, rx: HALF_PI }));
    k.x(cone(0.024, 0.07, 4, SWATCH.steel, { z: 0.52, rx: HALF_PI }));
    k.m(box(0.006, 0.04, 0.07, tc.light, { z: 0.04 }));
    k.m(box(0.04, 0.006, 0.07, COL.feather, { z: 0.04 }));
  });
}

// -- knight -----------------------------------------------------------------------

const KITE = [
  [-0.12, 0.16],
  [0.12, 0.16],
  [0.125, 0.05],
  [0.06, -0.1],
  [0, -0.22],
  [-0.06, -0.1],
  [-0.125, 0.05],
];

function buildKnight(k, tc) {
  k.on('horse');
  k.m(ico(1, 1, COL.coat, { y: 0.585, z: -0.01, sx: 0.158, sy: 0.15, sz: 0.4 }));
  // Caparison: team cloth hanging from the back to below the belly, light hem,
  // a lozenge on each flank.
  k.m(skirt(0.156, 0.4, 0.222, 0.465, 0.24, 12, tc.main, { y: 0.48 }));
  k.m(skirt(0.225, 0.469, 0.228, 0.473, 0.045, 12, tc.light, { y: 0.375 }));
  for (const s of [1, -1]) k.m(box(0.02, 0.1, 0.1, tc.light, { x: 0.196 * s, y: 0.49, z: -0.02, rz: 0.17 * s, rx: Math.PI / 4 }));
  k.m(box(0.31, 0.024, 0.3, tc.main, { y: 0.712, z: -0.02 }));
  for (const z of [0.13, -0.17]) k.m(box(0.315, 0.028, 0.035, tc.light, { y: 0.713, z }));
  k.m(box(0.19, 0.05, 0.24, SWATCH.leather, { y: 0.745, z: -0.02 }));
  k.m(box(0.17, 0.08, 0.04, COL.leatherDark, { y: 0.78, z: -0.135 }));
  k.m(box(0.1, 0.07, 0.04, COL.leatherDark, { y: 0.77, z: 0.095 }));
  k.on('neck');
  k.m(cyl(0.075, 0.105, 0.36, 6, COL.coat, { y: 0.79, z: 0.38, rx: 0.5 }));
  k.m(cyl(0.09, 0.118, 0.18, 6, tc.main, { y: 0.71, z: 0.335, rx: 0.5 }));
  k.m(cyl(0.12, 0.12, 0.03, 6, tc.light, { y: 0.63, z: 0.29, rx: 0.5 }));
  k.m(strut([0, 0.99, 0.4], [0, 0.69, 0.22], 0.036, 0.06, COL.mane));
  k.m(cyl(0.05, 0.074, 0.28, 6, COL.coat, { y: 0.88, z: 0.55, rx: 2.15 }));
  k.m(ico(0.058, 0, COL.coatDark, { y: 0.8, z: 0.668 }));
  for (const s of [1, -1]) {
    k.m(cone(0.026, 0.08, 4, COL.coat, { x: 0.036 * s, y: 1.0, z: 0.44, rx: -0.25 }));
    k.m(box(0.012, 0.022, 0.03, COL.eye, { x: 0.058 * s, y: 0.905, z: 0.52 }));
    k.m(strut([0.05 * s, 0.81, 0.64], [0.1 * s, 0.79, 0.12], 0.012, 0.012, COL.leatherDark));
  }
  k.x(strut([0, 0.96, 0.49], [0, 0.85, 0.64], 0.07, 0.022, SWATCH.steel));
  k.x(cone(0.02, 0.07, 4, SWATCH.gold, { y: 1.0, z: 0.49, rx: 0.4 }));
  const legs = [
    ['legFL', 0.085, 0.22],
    ['legFR', -0.085, 0.22],
    ['legBL', 0.085, -0.22],
    ['legBR', -0.085, -0.22],
  ];
  for (const [name, x, z] of legs) {
    k.on(name);
    k.m(cyl(0.06, 0.042, 0.26, 6, COL.coat, { x, y: 0.33, z }));
    k.m(cyl(0.036, 0.034, 0.17, 6, COL.coat, { x, y: 0.125, z }));
    k.m(cyl(0.042, 0.052, 0.065, 6, COL.hoof, { x, y: 0.032, z: z + 0.008 }));
  }
  k.on('tail');
  k.m(cyl(0.035, 0.05, 0.14, 5, COL.mane, { y: 0.58, z: -0.43, rx: 0.5 }));
  k.m(cyl(0.05, 0.075, 0.3, 6, COL.mane, { y: 0.42, z: -0.47, rx: 0.22 }));
  k.on('rider');
  k.m(box(0.19, 0.08, 0.17, COL.mail, { y: 0.785, z: -0.02 }));
  for (const s of [1, -1]) {
    k.x(strut([0.09 * s, 0.79, -0.02], [0.2 * s, 0.7, 0.1], 0.08, 0.08, SWATCH.steel));
    k.x(strut([0.205 * s, 0.71, 0.1], [0.225 * s, 0.5, 0.06], 0.07, 0.075, SWATCH.steel));
    k.x(box(0.075, 0.05, 0.14, SWATCH.iron, { x: 0.228 * s, y: 0.475, z: 0.085 }));
  }
  k.x(cyl(0.12, 0.138, 0.22, 8, SWATCH.steel, { y: 0.91, z: -0.02 }));
  k.m(box(0.15, 0.22, 0.3, tc.main, { y: 0.89, z: -0.02 }));
  k.m(box(0.045, 0.222, 0.303, tc.light, { y: 0.89, z: -0.02 }));
  k.m(cyl(0.143, 0.143, 0.034, 8, SWATCH.leather, { y: 0.81, z: -0.02 }));
  k.x(cyl(0.07, 0.1, 0.05, 8, SWATCH.iron, { y: 1.035, z: -0.02 }));
  k.on('head');
  k.x(cyl(0.102, 0.11, 0.17, 8, SWATCH.steel, { y: 1.13, z: -0.02 }));
  k.x(cyl(0.075, 0.102, 0.035, 8, SWATCH.steel, { y: 1.232, z: -0.02 }));
  k.x(cyl(0.113, 0.113, 0.024, 8, SWATCH.gold, { y: 1.205, z: -0.02 }));
  k.m(box(0.16, 0.022, 0.04, COL.slit, { y: 1.15, z: 0.072 }));
  k.x(box(0.026, 0.1, 0.02, SWATCH.gold, { y: 1.095, z: 0.09 }));
  k.on('crest');
  k.m(cone(0.065, 0.24, 6, tc.main, { y: 1.33, z: -0.07, rx: -0.55 }));
  k.m(cone(0.05, 0.2, 6, tc.light, { y: 1.29, z: -0.15, rx: -1.25 }));
  k.m(ico(0.06, 0, tc.main, { y: 1.255, z: -0.03 }));
  for (const s of [1, -1]) {
    k.on(s > 0 ? 'armL' : 'armR');
    k.x(sphere(0.075, 6, 4, SWATCH.steel, { x: 0.165 * s, y: 0.985, z: -0.02, sy: 0.85 }));
    k.x(cyl(0.046, 0.04, 0.2, 6, SWATCH.steel, { x: 0.17 * s, y: 0.87, z: -0.02 }));
    k.m(ico(0.048, 0, SWATCH.leather, { x: 0.17 * s, y: 0.76, z: -0.02 }));
  }
  k.on('armL').local({ x: 0.25, y: 0.84, z: 0.03, ry: 0.8, rx: -0.1 }, () => {
    k.x(prism(scalePts(KITE, 1.1), 0.028, SWATCH.iron, { z: -0.013 }));
    k.m(prism(KITE, 0.04, tc.main, {}));
    k.m(prism([[-0.03, 0.16], [0.03, 0.16], [0.03, -0.12], [0, -0.17], [-0.03, -0.12]], 0.046, tc.light, {}));
    k.x(ico(0.035, 0, SWATCH.gold, { y: 0.06, z: 0.03 }));
  });
  k.on('lance').local({ x: -0.17, y: 0.76, z: -0.02 }, () => {
    k.m(cyl(0.016, 0.027, 1.04, 6, SWATCH.woodLight, { y: 0.3 }));
    k.x(cone(0.07, 0.13, 8, SWATCH.steel, { y: 0.1 }));
    k.x(cone(0.03, 0.15, 5, SWATCH.steel, { y: 0.89 }));
    k.m(prism([[0, 0], [0.26, 0.045], [0, 0.11]], 0.012, tc.main, { y: 0.66, ry: HALF_PI }));
    k.m(prism([[0, 0.035], [0.17, 0.05], [0, 0.075]], 0.016, tc.light, { y: 0.66, ry: HALF_PI }));
  });
}

// ---- posing -----------------------------------------------------------------------

/** Per-bone pose for one unit: euler rotation, translation, scale, and optional aim/orient. */
class Pose {
  constructor() {
    this.r = new Float32Array(MAX_BONES * 3);
    this.t = new Float32Array(MAX_BONES * 3);
    this.s = new Float32Array(MAX_BONES * 3);
    this.mode = new Uint8Array(MAX_BONES);
    this.w = new Float32Array(MAX_BONES);
    this.tgt = new Float32Array(MAX_BONES * 3);
    this.ref = new Int8Array(MAX_BONES);
    this.W = Array.from({ length: MAX_BONES }, () => new THREE.Matrix4());
  }

  reset(nb) {
    this.r.fill(0, 0, nb * 3);
    this.t.fill(0, 0, nb * 3);
    this.s.fill(1, 0, nb * 3);
    this.mode.fill(0, 0, nb);
  }

  rot(j, x, y, z) {
    const i = j * 3;
    this.r[i] += x;
    this.r[i + 1] += y;
    this.r[i + 2] += z;
  }

  /** Blends the rotation toward (x, y, z) by k. */
  mixRot(j, x, y, z, k) {
    const i = j * 3;
    const r = this.r;
    r[i] += (x - r[i]) * k;
    r[i + 1] += (y - r[i + 1]) * k;
    r[i + 2] += (z - r[i + 2]) * k;
  }

  move(j, x, y, z) {
    const i = j * 3;
    this.t[i] += x;
    this.t[i + 1] += y;
    this.t[i + 2] += z;
  }

  scale(j, x, y = x, z = x) {
    const i = j * 3;
    this.s[i] *= x;
    this.s[i + 1] *= y;
    this.s[i + 2] *= z;
  }

  hide(j) {
    this.s.fill(0, j * 3, j * 3 + 3);
  }

  /** Points bone j's rest direction at (x, y, z), given in bone `ref`'s bind frame (-1: model space). */
  aim(j, x, y, z, ref, k = 1) {
    if (k <= 0) return;
    this.mode[j] = 1;
    this.w[j] = Math.min(1, k);
    this.ref[j] = ref;
    this.tgt[j * 3] = x;
    this.tgt[j * 3 + 1] = y;
    this.tgt[j * 3 + 2] = z;
  }

  /** Blends bone j toward a fixed model-space orientation (euler), whatever its parents do. */
  orient(j, x, y, z, k = 1) {
    if (k <= 0) return;
    this.mode[j] = 2;
    this.w[j] = Math.min(1, k);
    this.tgt[j * 3] = x;
    this.tgt[j * 3 + 1] = y;
    this.tgt[j * 3 + 2] = z;
  }
}

const _L = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _e = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Turns a pose into model-space bone matrices (P.W), parents first. */
function compose(rig, P) {
  const { r, t, s, W } = P;
  for (let j = 0; j < rig.nb; j++) {
    const i = j * 3;
    const piv = rig.pivots[j];
    const par = rig.parents[j];
    _e.set(r[i], r[i + 1], r[i + 2]);
    _q.setFromEuler(_e);
    if (P.mode[j] === 1) {
      _v.set(P.tgt[i], P.tgt[i + 1], P.tgt[i + 2]);
      const ref = P.ref[j];
      if (ref >= 0) _v.applyMatrix4(W[ref]);
      if (par >= 0) _v.applyMatrix4(_inv.copy(W[par]).invert());
      _v.x -= piv.x + t[i];
      _v.y -= piv.y + t[i + 1];
      _v.z -= piv.z + t[i + 2];
      if (_v.lengthSq() > 1e-8) {
        _q2.setFromUnitVectors(rig.dirs[j], _v.normalize());
        _q.slerp(_q2, P.w[j]);
      }
    } else if (P.mode[j] === 2) {
      _e.set(P.tgt[i], P.tgt[i + 1], P.tgt[i + 2]);
      _q2.setFromEuler(_e);
      if (par >= 0) _q2.premultiply(_qp.setFromRotationMatrix(W[par]).invert());
      _q.slerp(_q2, P.w[j]);
    }
    _pos.set(piv.x + t[i], piv.y + t[i + 1], piv.z + t[i + 2]);
    _scl.set(s[i], s[i + 1], s[i + 2]);
    _L.compose(_pos, _q, _scl);
    const e = _L.elements;
    e[12] -= e[0] * piv.x + e[4] * piv.y + e[8] * piv.z;
    e[13] -= e[1] * piv.x + e[5] * piv.y + e[9] * piv.z;
    e[14] -= e[2] * piv.x + e[6] * piv.y + e[10] * piv.z;
    if (par >= 0) W[j].multiplyMatrices(W[par], _L);
    else W[j].copy(_L);
  }
}

function inCombat(u) {
  const o = u.order;
  return !u.moving && !!o && (o.type === 'attack' || (o.type === 'hold' && !!o.target));
}

/** 0..1 as the next blow comes due (the last `lead` seconds of the cooldown). */
function readiness(u, lead) {
  if (!inCombat(u) || u.attackAnim > 0) return 0;
  return smooth(1 - u.cooldown / lead);
}

/** Walk cycle, idle breathing and glances shared by the humanoids. Returns the walk phase. */
function humanMotion(P, b, u, st, clock, stride, armSwing = 0.55) {
  const w = st.walk;
  const idle = 1 - w;
  const ph = u.walkAnim * (TAU / stride);
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  P.rot(b.legL, -s * 0.72 * w, 0, 0);
  P.rot(b.legR, s * 0.72 * w, 0, 0);
  P.move(b.root, 0, (Math.abs(c) - 0.7) * 0.05 * w, 0);
  P.rot(b.root, 0, s * 0.12 * w, 0);
  P.rot(b.torso, 0.1 * w, -s * 0.2 * w, -c * 0.03 * w);
  P.rot(b.head, -0.06 * w, s * 0.08 * w, 0);
  P.rot(b.armL, s * armSwing * w, 0, 0.07);
  P.rot(b.armR, -s * armSwing * w, 0, -0.07);
  // Breathing and the odd look around while standing.
  const br = Math.sin(clock * 2.1 + st.seed * TAU);
  P.rot(b.torso, -0.025 * br * idle, 0, 0);
  P.move(b.torso, 0, 0.004 * br * idle, 0);
  P.rot(b.armL, 0, 0, 0.035 * br * idle);
  P.rot(b.armR, 0, 0, -0.035 * br * idle);
  const look = Math.sin(clock * 0.43 + st.seed * 37);
  P.rot(b.head, 0.03 * br * idle, 0.5 * Math.sign(look) * smooth((Math.abs(look) - 0.62) / 0.3) * idle, 0);
  return ph;
}

/** Recoil when struck. */
function humanHit(P, b, u) {
  const k = clamp01(u.flash / 0.12);
  if (k <= 0) return;
  P.rot(b.torso, -0.32 * k, 0, 0);
  P.rot(b.head, -0.25 * k, 0, 0);
  P.move(b.root, 0, 0, -0.05 * k);
  P.rot(b.armL, -0.3 * k, 0, 0.25 * k);
  P.rot(b.armR, -0.3 * k, 0, -0.25 * k);
}

/** An accelerating downswing: 0 = raised, 1 = struck (held once landed; callers blend back to rest). */
function strikeCurve(s, hit = 0.32) {
  const k = clamp01(s / hit);
  return k * k;
}

function posePeasant(P, u, st, clock, dt, layer) {
  const b = this.b;
  humanMotion(P, b, u, st, clock, 0.78);
  const carry = u.carry ? u.carry.type : null;
  const o = u.order;
  const woodJob = o && o.type === 'harvest' ? o.res === 'wood' : !!u.lastHarvest && u.lastHarvest.res === 'wood';
  if (carry !== 'gold') P.hide(b.sack);
  if (carry !== 'wood') P.hide(b.logs);
  if (carry || !woodJob) P.hide(b.axe);
  if (carry || woodJob) P.hide(b.pick);
  P.rot(b.axe, -0.6, 0, 0);
  P.rot(b.pick, -0.6, 0, 0);
  if (carry === 'gold') {
    P.aim(b.armR, -0.17, 0.74, -0.08, b.torso);
    P.rot(b.torso, 0.06, 0, 0);
  } else if (carry === 'wood') {
    P.aim(b.armR, -0.23, 0.78, 0.13, b.torso);
    P.rot(b.torso, 0.03, 0, -0.04);
  }

  // Chopping: a two-handed overhead swing every 0.55 s, landing on the beat.
  const chopping = !!o && o.type === 'harvest' && o.phase === 'chopping';
  st.chop = approach(st.chop, chopping ? 1 : 0, dt * 8);
  if (st.chop > 0.002) {
    const c = (u.workAnim % 0.55) / 0.55;
    const raise = c < 0.62 ? smooth(c / 0.62) : 1 - ((c - 0.62) / 0.38) ** 2;
    const a = lerp(-1.0, -3.25, raise);
    const k = st.chop;
    P.mixRot(b.armR, a, 0, 0.32, k);
    P.mixRot(b.armL, a + 0.15, 0, -0.32, k);
    P.rot(b.torso, lerp(0.24, -0.14, raise) * k, 0, 0);
    P.rot(b.head, lerp(0.15, -0.1, raise) * k, 0, 0);
    P.move(b.root, 0, -0.022 * (1 - raise) * k, 0);
    P.rot(b.axe, 0.55 * k, 0, 0);
    P.rot(b.legL, -0.2 * k, 0, 0.05 * k);
    P.rot(b.legR, 0.18 * k, 0, -0.05 * k);
    const beat = Math.floor(u.workAnim / 0.55);
    if (chopping && beat !== st.beat) {
      if (st.beat >= 0 && beat > st.beat) layer.chips(st);
      st.beat = beat;
    }
  } else st.beat = -1;

  // Fighting with whatever tool is in hand.
  const ready = readiness(u, 0.3);
  if (u.attackAnim > 0) {
    const s = 1 - u.attackAnim / 0.3;
    const k = strikeCurve(s);
    P.mixRot(b.armR, lerp(-3.1, -0.85, k), 0, lerp(-0.1, 0.2, k), 1 - smooth((s - 0.6) / 0.4));
    P.rot(b.torso, lerp(-0.1, 0.2, k), lerp(-0.2, 0.25, k), 0);
  } else if (ready > 0) {
    P.mixRot(b.armR, -3.1, 0, -0.1, ready);
    P.rot(b.torso, -0.1 * ready, -0.2 * ready, 0);
  }
  humanHit(P, b, u);
}

function poseFootman(P, u, st, clock, dt) {
  const b = this.b;
  const ph = humanMotion(P, b, u, st, clock, 0.84, 0.45);
  const w = st.walk;
  P.rot(b.armL, -0.38, 0, 0.12);
  P.rot(b.armR, -0.25, 0, -0.05);
  P.rot(b.crest, -0.1 * w * Math.abs(Math.sin(ph)), 0, 0.05 * Math.sin(clock * 1.7 + st.seed * 9));

  // Guard: shield up, feet apart.
  const fight = inCombat(u);
  st.guard = approach(st.guard, fight ? 1 : 0, dt * 6);
  const g = smooth(st.guard);
  if (g > 0) {
    P.mixRot(b.armL, -0.95, 0, -0.25, g);
    P.rot(b.legL, -0.25 * g, 0, 0.06 * g);
    P.rot(b.legR, 0.22 * g, 0, -0.06 * g);
    P.move(b.root, 0, -0.015 * g, 0);
    P.rot(b.torso, 0.06 * g, 0, 0);
  }
  // Wind up as the next blow comes due, then a diagonal slash.
  const ready = readiness(u, 0.32);
  if (u.attackAnim > 0) {
    const s = 1 - u.attackAnim / 0.3;
    const k = strikeCurve(s, 0.36);
    const back = 1 - smooth((s - 0.55) / 0.45);
    P.mixRot(b.armR, lerp(-3.0, -0.6, k), 0, lerp(-0.5, 0.5, k), back);
    P.rot(b.torso, 0, lerp(-0.3, 0.38, k) * back, 0);
    P.move(b.root, 0, 0, 0.04 * k * back);
  } else if (ready > 0) {
    P.mixRot(b.armR, -3.0, 0, -0.5, ready);
    P.rot(b.torso, -0.05 * ready, -0.3 * ready, 0);
  }
  humanHit(P, b, u);
}

function poseArcher(P, u, st, clock, dt) {
  const b = this.b;
  const ph = humanMotion(P, b, u, st, clock, 0.8);
  const w = st.walk;
  P.rot(b.cloak, 0.28 * w + 0.07 * Math.sin(ph * 2) * w + 0.04 * Math.sin(clock * 1.6 + st.seed * 7) * (1 - w), 0, 0);
  // Carrying the bow at rest.
  P.rot(b.armL, -0.22, 0, 0.06);
  P.rot(b.bow, -0.2, 0, -0.38);

  // Shooting stance: side-on, bow arm out toward the target, string drawn to the jaw.
  const fight = inCombat(u);
  st.aim = approach(st.aim, fight ? 1 : 0, dt * 6);
  const A = smooth(st.aim);
  if (A > 0) {
    P.rot(b.root, 0, -0.5 * A, 0);
    P.rot(b.torso, 0, -0.55 * A, 0);
    P.rot(b.head, 0, 0.95 * A, 0);
    P.rot(b.legL, -0.2 * A, 0, 0.08 * A);
    P.rot(b.legR, 0.15 * A, 0, -0.08 * A);
    P.aim(b.armL, 0.05, 0.62, 3, -1, A);
    P.orient(b.bow, 0, 0, 0.12, A);
  }
  let draw = 0;
  if (fight && u.attackAnim <= 0) {
    const cd = u.def.cooldown;
    draw = clamp01((cd * 0.85 - u.cooldown) / (cd * 0.5));
  }
  st.draw = approach(st.draw, draw, dt * 10);
  let d = smooth(st.draw) * 0.27;
  if (u.attackAnim > 0) {
    // Release: the string snaps back and quivers, the draw hand flies back.
    st.draw = 0;
    const s = 1 - u.attackAnim / 0.3;
    d = -0.03 * Math.sin(s * 30) * (1 - s);
    P.aim(b.armR, NOCK[0] - 0.02, NOCK[1] + 0.06, NOCK[2] - 0.2, b.bow, A);
  } else {
    P.aim(b.armR, NOCK[0], NOCK[1], NOCK[2], b.arrow, A);
  }
  const ang = Math.atan2(d, BOW_HALF);
  const len = Math.hypot(d, BOW_HALF) / BOW_HALF;
  P.rot(b.strT, ang, 0, 0);
  P.scale(b.strT, 1, len, 1);
  P.rot(b.strB, -ang, 0, 0);
  P.scale(b.strB, 1, len, 1);
  if (A > 0.5 && u.attackAnim <= 0 && st.draw > 0.02) P.move(b.arrow, 0, 0, -d);
  else P.hide(b.arrow);
  humanHit(P, b, u);
}

function poseKnight(P, u, st, clock, dt, layer) {
  const b = this.b;
  const w = st.walk;
  const idle = 1 - w;
  const ph = u.walkAnim * (TAU / 1.1);
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  // Trot: diagonal pairs swing together.
  const A = 0.7 * w;
  P.rot(b.legFL, -s * A, 0, 0);
  P.rot(b.legBR, -s * A, 0, 0);
  P.rot(b.legFR, s * A, 0, 0);
  P.rot(b.legBL, s * A, 0, 0);
  P.move(b.horse, 0, (Math.abs(c) - 0.5) * 0.05 * w, 0);
  P.rot(b.horse, Math.sin(2 * ph) * 0.035 * w, 0, 0);
  P.rot(b.neck, Math.sin(2 * ph + 0.7) * 0.09 * w - 0.05 * w, 0, 0);
  P.rot(b.tail, 0.18 * w + 0.06 * Math.sin(2 * ph), Math.sin(clock * 1.9 + st.seed * 9) * 0.28 * (1 - 0.6 * w), 0);
  P.move(b.rider, 0, -(Math.abs(c) - 0.5) * 0.02 * w, 0);
  P.rot(b.rider, 0.06 * w, 0, 0);
  // Idle: breathing, a slow head toss now and then, a weight shift.
  const br = Math.sin(clock * 1.7 + st.seed * TAU);
  P.move(b.horse, 0, 0.004 * br * idle, 0);
  const toss = Math.sin(clock * 0.37 + st.seed * 23);
  P.rot(b.neck, 0.35 * smooth((toss - 0.55) / 0.35) * idle, 0.15 * Math.sin(clock * 0.6 + st.seed) * idle, 0);
  P.rot(b.legBL, 0.12 * idle * smooth((Math.sin(clock * 0.21 + st.seed * 5) - 0.3) / 0.4), 0, 0);
  P.rot(b.head, 0, 0.35 * Math.sin(clock * 0.31 + st.seed * 13) * idle, 0);
  P.rot(b.crest, -0.12 * w - 0.05 * Math.abs(s) * w, 0, 0.06 * Math.sin(clock * 1.5 + st.seed));
  // Arms: shield forward, lance raised (tilting forward while riding).
  P.rot(b.armL, -0.45, 0, 0.12);
  P.rot(b.armR, -0.32, 0, -0.04);
  P.rot(b.lance, 0.25 + 0.35 * w, 0, 0.05);

  // Combat: couch the lance, draw back as the blow comes due, then thrust.
  const fight = inCombat(u);
  st.guard = approach(st.guard, fight ? 1 : 0, dt * 6);
  const g = smooth(st.guard);
  const ready = readiness(u, 0.35);
  let thrust = 0;
  if (u.attackAnim > 0) {
    const t = 1 - u.attackAnim / 0.3;
    thrust = t < 0.3 ? 1 - (1 - t / 0.3) ** 2 : 1 - smooth((t - 0.3) / 0.7);
  }
  if (g > 0) {
    P.mixRot(b.armR, -0.75 + 0.45 * ready - 0.75 * thrust, 0, 0.12, g);
    P.orient(b.lance, 1.42 - 0.08 * ready, 0, 0, g);
    P.mixRot(b.armL, -0.7, 0, -0.1, g);
    P.rot(b.rider, (-0.08 * ready + 0.14 * thrust) * g, (0.12 * ready - 0.15 * thrust) * g, 0);
    P.move(b.rider, 0, 0, (0.06 * thrust - 0.03 * ready) * g);
    P.rot(b.horse, (0.05 * thrust - 0.03 * ready) * g, 0, 0);
    P.move(b.horse, 0, 0.01 * ready * g, 0.05 * thrust * g);
    P.rot(b.neck, (-0.18 * ready + 0.1 * thrust) * g, 0, 0);
    P.rot(b.legFL, -0.25 * ready * g, 0, 0);
  }
  // Hit: the rider rocks back and the horse throws its head.
  const hk = clamp01(u.flash / 0.12);
  if (hk > 0) {
    P.rot(b.rider, -0.25 * hk, 0, 0);
    P.rot(b.head, -0.2 * hk, 0, 0);
    P.rot(b.neck, -0.3 * hk, 0, 0);
    P.move(b.horse, 0, 0, -0.04 * hk);
  }
  // Dust kicked up by the hooves.
  const beat = Math.floor(ph / Math.PI);
  if (beat !== st.beat) {
    if (w > 0.5 && st.beat >= 0) layer.dust(st, beat & 1 ? 0.085 : -0.085);
    st.beat = beat;
  }
}

// ---- rig table -------------------------------------------------------------------

const RIGS = {
  peasant: makeRig(
    'peasant',
    humanBones(
      [],
      [
        { name: 'axe', parent: 'armR', pivot: HAND_R },
        { name: 'pick', parent: 'armR', pivot: HAND_R },
      ],
      [
        { name: 'sack', parent: 'torso', pivot: [0, 0.5, -0.15] },
        { name: 'logs', parent: 'torso', pivot: [-0.2, 0.62, 0] },
      ],
    ),
    { build: buildPeasant, pose: posePeasant, optional: ['axe', 'sack', 'logs'], metrics: { height: 0.86, radius: 0.28 } },
  ),
  footman: makeRig('footman', humanBones([], [], [{ name: 'crest', parent: 'head', pivot: [0, 0.8, 0] }]), {
    build: buildFootman,
    pose: poseFootman,
    metrics: { height: 0.92, radius: 0.32 },
  }),
  archer: makeRig(
    'archer',
    humanBones(
      [
        { name: 'bow', parent: 'armL', pivot: HAND_L },
        { name: 'strT', parent: 'bow', pivot: bowPoint(1) },
        { name: 'strB', parent: 'bow', pivot: bowPoint(-1) },
        { name: 'arrow', parent: 'bow', pivot: NOCK },
      ],
      [],
      [{ name: 'cloak', parent: 'torso', pivot: [0, 0.575, -0.15] }],
    ),
    { build: buildArcher, pose: poseArcher, optional: ['arrow'], metrics: { height: 0.86, radius: 0.28 } },
  ),
  knight: makeRig(
    'knight',
    [
      { name: 'horse', pivot: [0, 0.54, 0] },
      { name: 'neck', parent: 'horse', pivot: [0, 0.64, 0.27] },
      { name: 'legFL', parent: 'horse', pivot: [0.085, 0.46, 0.22] },
      { name: 'legFR', parent: 'horse', pivot: [-0.085, 0.46, 0.22] },
      { name: 'legBL', parent: 'horse', pivot: [0.085, 0.46, -0.22] },
      { name: 'legBR', parent: 'horse', pivot: [-0.085, 0.46, -0.22] },
      { name: 'tail', parent: 'horse', pivot: [0, 0.63, -0.38] },
      { name: 'rider', parent: 'horse', pivot: [0, 0.78, -0.02] },
      { name: 'head', parent: 'rider', pivot: [0, 1.04, -0.02] },
      { name: 'crest', parent: 'head', pivot: [0, 1.24, -0.03] },
      { name: 'armL', parent: 'rider', pivot: [0.16, 0.97, -0.02] },
      { name: 'armR', parent: 'rider', pivot: [-0.16, 0.97, -0.02] },
      { name: 'lance', parent: 'armR', pivot: [-0.17, 0.76, -0.02], dir: [0, 1, 0] },
    ],
    { build: buildKnight, pose: poseKnight, scale: 0.9, metrics: { height: 1.24, radius: 0.46 } },
  ),
};

// ---- geometry cache ------------------------------------------------------------

const geoCache = new Map();

/**
 * Merged geometries for one (type, team): { matte, metal } with an `aBone`
 * attribute. `still` leaves out parts that only appear in some poses (the
 * carried sack and logs, the nocked arrow, the second tool) for static models.
 */
function unitGeometry(type, owner, still = false) {
  const key = `${type}:${owner}:${still ? 's' : 'a'}`;
  let entry = geoCache.get(key);
  if (entry) return entry;
  const rig = RIGS[type] || RIGS.peasant;
  const kit = new Kit(rig);
  rig.build(kit, teamColors(owner));
  const lists = { matte: [], metal: [] };
  for (const p of kit.parts) {
    if (still && rig.optional.has(p.bone)) continue;
    tagBone(p.g, p.bone);
    lists[p.metal ? 'metal' : 'matte'].push(p.g);
  }
  entry = {};
  for (const name of ['matte', 'metal']) {
    if (!lists[name].length) continue;
    const g = merge(lists[name]);
    if (rig.scale !== 1) g.scale(rig.scale, rig.scale, rig.scale);
    shadeAO(g);
    g.computeBoundingSphere();
    entry[name] = g;
  }
  geoCache.set(key, entry);
  return entry;
}

/**
 * A unit in a neutral standing pose, facing +Z, feet on y = 0 (for corpses).
 * Geometry and materials are shared between copies: do not dispose them.
 */
export function createUnitModel(type, owner, palette) {
  const geos = unitGeometry(RIGS[type] ? type : 'peasant', owner, true);
  const group = new THREE.Group();
  for (const [name, mat] of [
    ['matte', palette.matte],
    ['metal', palette.metal],
  ]) {
    if (!geos[name]) continue;
    const mesh = new THREE.Mesh(geos[name], mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// ---- GPU side: instanced batches with a bone texture -------------------------------

const RIG_DECL = /* glsl */ `
attribute float aBone;
uniform highp sampler2D uBones;`;

const RIG_VERTEX = /* glsl */ `
{
  int rigCol = int( aBone + 0.5 ) * 3;
  vec4 rigP = vec4( transformed, 1.0 );
  transformed = vec3(
    dot( texelFetch( uBones, ivec2( rigCol, gl_InstanceID ), 0 ), rigP ),
    dot( texelFetch( uBones, ivec2( rigCol + 1, gl_InstanceID ), 0 ), rigP ),
    dot( texelFetch( uBones, ivec2( rigCol + 2, gl_InstanceID ), 0 ), rigP ) );
}`;

function injectRig(shader, uniforms) {
  shader.uniforms.uBones = uniforms.uBones;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${RIG_DECL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${RIG_VERTEX}`);
}

function rigMaterial(ctx, base, key, uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: Math.min(1, base.roughness * 1.1),
    metalness: base.metalness * 0.75,
    flatShading: true,
  });
  ctx.fog.patch(mat, { key });
  const fogCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    fogCompile.call(mat, shader, renderer);
    injectRig(shader, uniforms);
  };
  return mat;
}

function rigDepthMaterial(uniforms) {
  const mat = new THREE.MeshDepthMaterial();
  mat.onBeforeCompile = (shader) => injectRig(shader, uniforms);
  mat.customProgramCacheKey = () => 'units-rig-depth';
  return mat;
}

/** All units of one (type, team): two instanced meshes sharing a bone texture. */
class Batch {
  constructor(layer, type, owner) {
    this.layer = layer;
    this.rig = RIGS[type];
    this.geos = unitGeometry(type, owner);
    this.uniforms = { uBones: { value: null } };
    const { palette } = layer.ctx;
    this.materials = {
      matte: rigMaterial(layer.ctx, palette.matte, 'units-rig-matte', this.uniforms),
      metal: rigMaterial(layer.ctx, palette.metal, 'units-rig-metal', this.uniforms),
    };
    this.depth = rigDepthMaterial(this.uniforms);
    this.capacity = 0;
    this.meshes = [];
    this.list = [];
    this.texture = null;
    this.ensure(16);
  }

  ensure(n) {
    if (n <= this.capacity) return;
    let cap = Math.max(16, this.capacity);
    while (cap < n) cap *= 2;
    this.disposeGpu();
    const width = this.rig.nb * 3;
    this.boneData = new Float32Array(width * cap * 4);
    const tex = new THREE.DataTexture(this.boneData, width, cap, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.texture = tex;
    this.uniforms.uBones.value = tex;
    this.matrices = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16).setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    for (const name of ['matte', 'metal']) {
      if (!this.geos[name]) continue;
      const mesh = new THREE.InstancedMesh(this.geos[name], this.materials[name], cap);
      mesh.instanceMatrix = this.matrices;
      mesh.instanceColor = this.colors;
      mesh.customDepthMaterial = this.depth;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.layer.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.capacity = cap;
  }

  commit(n) {
    for (const mesh of this.meshes) {
      mesh.count = n;
      mesh.visible = n > 0;
    }
    if (n > 0) {
      this.matrices.needsUpdate = true;
      this.colors.needsUpdate = true;
      this.texture.needsUpdate = true;
    }
  }

  disposeGpu() {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.meshes = [];
    if (this.texture) this.texture.dispose();
    this.texture = null;
  }

  dispose() {
    this.disposeGpu();
    this.materials.matte.dispose();
    this.materials.metal.dispose();
    this.depth.dispose();
  }
}

// ---- the layer -------------------------------------------------------------------

export class UnitLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'units';
    ctx.scene.add(this.group);
    this.batches = new Map();
    this.states = new Map();
    this.pose = new Pose();
    this.lastClock = null;
    this.frameNo = 0;
    this._emit = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, size1: 0.1, color: [1, 1, 1, 1], color1: [1, 1, 1, 0], gravity: 0, drag: 0 };
  }

  metrics(u) {
    const rig = RIGS[u.type];
    return rig ? rig.metrics : RIGS.peasant.metrics;
  }

  batch(type, owner) {
    const key = `${type}:${owner}`;
    let b = this.batches.get(key);
    if (!b) {
      b = new Batch(this, type, owner);
      this.batches.set(key, b);
    }
    return b;
  }

  sync(frame, clock) {
    const { game } = this.ctx;
    const dt = this.lastClock === null ? 0 : Math.min(0.1, Math.max(0, clock - this.lastClock));
    this.lastClock = clock;
    this.frameNo++;
    for (const b of this.batches.values()) b.list.length = 0;
    for (const u of game.units) {
      if (u.dead || u.hidden || !RIGS[u.type] || !this.ctx.visible(u)) continue;
      this.batch(u.type, u.owner).list.push(u);
    }
    for (const b of this.batches.values()) {
      const n = b.list.length;
      b.ensure(n);
      for (let i = 0; i < n; i++) this.drawUnit(b, i, b.list[i], dt, clock);
      b.commit(n);
    }
    for (const [id, st] of this.states) if (st.frame !== this.frameNo) this.states.delete(id);
  }

  drawUnit(batch, i, u, dt, clock) {
    const rig = batch.rig;
    const x = u.x / TILE;
    const z = u.y / TILE;
    const heading = u.dirX || u.dirY ? Math.atan2(u.dirX, u.dirY) : null;
    let st = this.states.get(u.id);
    if (!st) {
      st = { yaw: heading ?? 0, walk: u.moving ? 1 : 0, chop: 0, guard: 0, aim: 0, draw: 0, beat: -1, seed: hash(u.id * 7919 + 13), frame: 0, x, y: 0, z };
      this.states.set(u.id, st);
    }
    st.frame = this.frameNo;
    if (heading !== null) st.yaw = wrapAngle(st.yaw + wrapAngle(heading - st.yaw) * Math.min(1, dt * (u.type === 'knight' ? 9 : 13)));
    st.walk = approach(st.walk, u.moving ? 1 : 0, dt * 10);
    st.x = x;
    st.z = z;
    st.y = this.ctx.heightAt(x, z);

    const P = this.pose;
    P.reset(rig.nb);
    rig.pose(P, u, st, clock, dt, this);
    compose(rig, P);

    // Bone rows: three texels (the rows of a 3x4 affine matrix) per bone.
    const data = batch.boneData;
    let o = i * rig.nb * 12;
    for (let j = 0; j < rig.nb; j++, o += 12) {
      const e = P.W[j].elements;
      data[o] = e[0];
      data[o + 1] = e[4];
      data[o + 2] = e[8];
      data[o + 3] = e[12];
      data[o + 4] = e[1];
      data[o + 5] = e[5];
      data[o + 6] = e[9];
      data[o + 7] = e[13];
      data[o + 8] = e[2];
      data[o + 9] = e[6];
      data[o + 10] = e[10];
      data[o + 11] = e[14];
    }
    // Instance transform: position and heading.
    const m = batch.matrices.array;
    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    const k = i * 16;
    m[k] = c;
    m[k + 1] = 0;
    m[k + 2] = -s;
    m[k + 3] = 0;
    m[k + 4] = 0;
    m[k + 5] = 1;
    m[k + 6] = 0;
    m[k + 7] = 0;
    m[k + 8] = s;
    m[k + 9] = 0;
    m[k + 10] = c;
    m[k + 11] = 0;
    m[k + 12] = x;
    m[k + 13] = st.y;
    m[k + 14] = z;
    m[k + 15] = 1;
    // Hit flash: a warm brightening for a moment.
    const f = clamp01(u.flash / 0.12);
    const col = batch.colors.array;
    col[i * 3] = 1 + 1.5 * f;
    col[i * 3 + 1] = 1 + 0.75 * f;
    col[i * 3 + 2] = 1 + 0.6 * f;
  }

  /** Wood chips flying off the tree in front of a chopping peasant. */
  chips(st) {
    const p = this.ctx.particles && this.ctx.particles.smoke;
    if (!p) return;
    const fx = Math.sin(st.yaw);
    const fz = Math.cos(st.yaw);
    const e = this._emit;
    for (let n = 0; n < 5; n++) {
      const side = (Math.random() - 0.5) * 1.6;
      e.x = st.x + fx * 0.42;
      e.y = st.y + 0.3 + Math.random() * 0.06;
      e.z = st.z + fz * 0.42;
      e.vx = -fx * (0.6 + Math.random() * 0.6) + fz * side;
      e.vy = 1.0 + Math.random() * 0.9;
      e.vz = -fz * (0.6 + Math.random() * 0.6) - fx * side;
      e.life = 0.45 + Math.random() * 0.25;
      e.size = 0.07;
      e.size1 = 0.05;
      const light = Math.random() < 0.5;
      e.color[0] = light ? 0.86 : 0.55;
      e.color[1] = light ? 0.7 : 0.38;
      e.color[2] = light ? 0.45 : 0.2;
      e.color[3] = 1;
      e.color1[0] = e.color[0];
      e.color1[1] = e.color[1];
      e.color1[2] = e.color[2];
      e.color1[3] = 0;
      e.gravity = 5;
      e.drag = 0.5;
      p.emit(e);
    }
  }

  /** A puff of dust behind a trotting horse. */
  dust(st, side) {
    const p = this.ctx.particles && this.ctx.particles.smoke;
    if (!p) return;
    const fx = Math.sin(st.yaw);
    const fz = Math.cos(st.yaw);
    const back = Math.random() < 0.5 ? -0.2 : 0.2;
    const e = this._emit;
    e.x = st.x + fx * back + fz * side;
    e.y = st.y + 0.05;
    e.z = st.z + fz * back - fx * side;
    e.vx = -fx * 0.3 + (Math.random() - 0.5) * 0.2;
    e.vy = 0.25 + Math.random() * 0.15;
    e.vz = -fz * 0.3 + (Math.random() - 0.5) * 0.2;
    e.life = 0.7;
    e.size = 0.14;
    e.size1 = 0.42;
    e.color[0] = 0.62;
    e.color[1] = 0.53;
    e.color[2] = 0.4;
    e.color[3] = 0.32;
    e.color1[0] = 0.62;
    e.color1[1] = 0.55;
    e.color1[2] = 0.45;
    e.color1[3] = 0;
    e.gravity = 0;
    e.drag = 1.5;
    p.emit(e);
  }

  dispose() {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
    this.states.clear();
    this.group.removeFromParent();
    for (const entry of geoCache.values()) for (const g of Object.values(entry)) g.dispose();
    geoCache.clear();
  }
}
