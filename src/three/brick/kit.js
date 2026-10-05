// Toy-brick construction kit for the brick style.
//
// Real brick proportions at game scale: 5 studs across a map tile, so one
// stud pitch is 0.2 world units, a brick is 1.2 pitches tall and a plate is a
// third of a brick. Pieces keep three.js's own normals (smooth round studs,
// crisp faces, rounded edges that catch the light) and carry vertex colours,
// so a whole model merges into one geometry drawn with one plastic material.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PITCH = 0.2;
export const BRICK = PITCH * 1.2;
export const PLATE = BRICK / 3;
const GAP = 0.006;
const STUD_R = 0.06;
const STUD_H = 0.042;

// Classic brick colours.
export const BRICK_COLORS = {
  white: '#e9e5da',
  lightGrey: '#a3a2a4',
  darkGrey: '#646765',
  black: '#1b1b1d',
  yellow: '#f5c518',
  tan: '#d9bb7b',
  darkTan: '#958a73',
  brown: '#6b3f22',
  reddishBrown: '#7c3f24',
  green: '#3d8b3f',
  brightGreen: '#4bb24a',
  darkGreen: '#21542c',
  limeGreen: '#a5c33a',
  sand: '#d8c99a',
  transBlue: '#2a7bd6',
  transClear: '#cfe8f4',
  orange: '#f07c1b',
  steel: '#c9cdd2',
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Colours and places a geometry, keeping its normals.
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.ColorRepresentation} color
 * @param {{x?:number,y?:number,z?:number,rx?:number,ry?:number,rz?:number,sx?:number,sy?:number,sz?:number}} [t]
 */
export function part(geo, color, t = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  if (!g.attributes.normal) g.computeVertexNormals();
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
  _q.setFromEuler(_e);
  _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  _c.set(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function merge(list) {
  const geos = list.flat().filter(Boolean);
  if (geos.length === 1) return geos[0];
  const g = mergeGeometries(geos, false);
  if (!g) throw new Error('brick merge failed');
  return g;
}

export const rbox = (w, h, d, color, t, r = 0.012) =>
  part(new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), color, t);
export const cyl = (rTop, rBottom, h, segs, color, t) => part(new THREE.CylinderGeometry(rTop, rBottom, h, segs), color, t);
export const sphere = (r, color, t, w = 16, h = 10) => part(new THREE.SphereGeometry(r, w, h), color, t);
export const torus = (r, tube, color, t, arc = Math.PI * 2) => part(new THREE.TorusGeometry(r, tube, 8, 20, arc), color, t);

/** One stud with its base on y. */
export function stud(color, x, y, z, segs = 10) {
  return cyl(STUD_R, STUD_R, STUD_H, segs, color, { x, y: y + STUD_H / 2, z });
}

/**
 * A brick or plate `w` x `d` studs, `plates` plates tall (3 = a brick),
 * standing on (x, y, z) at the centre of its base. ry rotates it about Y.
 */
export function brick(w, d, plates, color, x = 0, y = 0, z = 0, opts = {}) {
  const h = plates * PLATE;
  const out = [rbox(w * PITCH - GAP, h - GAP / 2, d * PITCH - GAP, color, { y: h / 2 })];
  if (opts.studs !== false) {
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) out.push(stud(color, (i - (w - 1) / 2) * PITCH, h, (j - (d - 1) / 2) * PITCH));
    }
  }
  const g = merge(out);
  g.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, opts.ry || 0, 0)), _s.set(1, 1, 1)));
  return g;
}

/** A round 1x1 brick (or plate) centred at (x, z), base at y. */
export function roundBrick(plates, color, x = 0, y = 0, z = 0, opts = {}) {
  const h = plates * PLATE;
  const out = [cyl(PITCH / 2 - GAP, PITCH / 2 - GAP, h - GAP / 2, 10, color, { x, y: y + h / 2, z })];
  if (opts.studs !== false) out.push(stud(color, x, y + h, z));
  return merge(out);
}

/**
 * A 45-degree slope brick `w` studs wide and `d` studs deep, one brick tall,
 * sloping down toward +Z (rotate with ry). Base centred on (x, y, z).
 */
export function slope(w, d, color, x = 0, y = 0, z = 0, ry = 0) {
  const D = d * PITCH - GAP;
  const H = BRICK - GAP / 2;
  const lip = PLATE * 0.6;
  // Profile in the ZY plane: flat strip at the back (one stud), slope to the front lip.
  const back = Math.min(PITCH, D);
  const shape = new THREE.Shape();
  shape.moveTo(-D / 2, 0);
  shape.lineTo(D / 2, 0);
  shape.lineTo(D / 2, lip);
  shape.lineTo(-D / 2 + back, H);
  shape.lineTo(-D / 2, H);
  shape.lineTo(-D / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w * PITCH - GAP, bevelEnabled: false });
  g.translate(0, 0, -(w * PITCH - GAP) / 2);
  g.rotateY(-Math.PI / 2);
  const parts = [part(g, color)];
  if (d > 1) {
    for (let i = 0; i < w; i++) parts.push(stud(color, (i - (w - 1) / 2) * PITCH, H, -D / 2 + back / 2));
  }
  const out = merge(parts);
  out.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(1, 1, 1)));
  return out;
}

/** A cone piece (like the classic 2x2 or 4x4 cones). */
export function conePiece(rBottom, rTop, h, color, x = 0, y = 0, z = 0, withStud = true, segs = 12) {
  const out = [cyl(rTop, rBottom, h, segs, color, { x, y: y + h / 2, z })];
  if (withStud) out.push(stud(color, x, y + h, z));
  return merge(out);
}

/**
 * Glossy ABS plastic. Clearcoat gives the sharp highlight real bricks have;
 * the environment map (set on the scene) supplies the reflections.
 */
export function plastic(fog, opts = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.4,
    metalness: 0,
    clearcoat: opts.clearcoat ?? 0.5,
    clearcoatRoughness: 0.22,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
  });
  return fog.patch(mat, { key: opts.key || 'plastic' });
}
