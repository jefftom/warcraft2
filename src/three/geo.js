// Low-poly model kit. Every helper returns a non-indexed BufferGeometry with a
// per-vertex `color` attribute, already transformed into place, so a whole
// model can be merged into one geometry and drawn with one shared material.
//
// Conventions: 1 world unit = 1 map tile. +Y is up. A unit model stands on
// y = 0 and faces +Z (its "front"); the layer rotates it to face its heading.
// Positions given to helpers are the CENTER of the shape unless noted.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _color = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Applies colour and transform to a geometry.
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.ColorRepresentation} color
 * @param {{x?:number,y?:number,z?:number,rx?:number,ry?:number,rz?:number,sx?:number,sy?:number,sz?:number, shade?:number}} [t]
 *   `shade` (-1..1) darkens/lightens the colour; handy for two-tone faces.
 */
export function finish(geo, color, t = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
  _q.setFromEuler(_e);
  _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  _color.set(color);
  if (t.shade) {
    if (t.shade > 0) _color.lerp(new THREE.Color(1, 1, 1), t.shade);
    else _color.multiplyScalar(1 + t.shade);
  }
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export const box = (w, h, d, color, t) => finish(new THREE.BoxGeometry(w, h, d), color, t);
export const cyl = (rTop, rBottom, h, segs, color, t) => finish(new THREE.CylinderGeometry(rTop, rBottom, h, segs), color, t);
export const cone = (r, h, segs, color, t) => finish(new THREE.ConeGeometry(r, h, segs), color, t);
export const sphere = (r, wSeg, hSeg, color, t) => finish(new THREE.SphereGeometry(r, wSeg, hSeg), color, t);
export const ico = (r, detail, color, t) => finish(new THREE.IcosahedronGeometry(r, detail), color, t);
export const dodeca = (r, color, t) => finish(new THREE.DodecahedronGeometry(r, 0), color, t);
export const torus = (r, tube, rSeg, tSeg, color, t, arc = Math.PI * 2) => finish(new THREE.TorusGeometry(r, tube, rSeg, tSeg, arc), color, t);

/** A prism from a 2D outline (in the XY plane) extruded along Z by `depth`, centred. */
export function prism(points, depth, color, t) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return finish(g, color, t);
}

/** A gabled roof: ridge along X, width w (X), depth d (Z), height h, base at y. */
export function gable(w, d, h, color, t = {}) {
  return prism(
    [
      [-d / 2, 0],
      [d / 2, 0],
      [0, h],
    ],
    w,
    color,
    { ...t, ry: (t.ry || 0) + Math.PI / 2 },
  );
}

/** A four-sided pyramid roof (hip roof) of base w x d and height h; base at y. */
export function pyramid(w, d, h, color, t = {}) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  g.scale(w, h, d);
  return finish(g, color, t);
}

/** Merges geometries made by the helpers above into one. */
export function merge(geos) {
  const list = geos.filter(Boolean);
  if (list.length === 1) return list[0];
  const g = mergeGeometries(list, false);
  if (!g) throw new Error('merge failed: geometries have mismatched attributes');
  return g;
}

/** Shifts a geometry so the given point becomes its origin (useful for limb pivots). */
export function pivot(geo, x, y, z) {
  geo.translate(-x, -y, -z);
  return geo;
}

/** Mixes two colours; t=0 gives a, t=1 gives b. Returns a hex string. */
export function mix(a, b, t) {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/** Deterministic pseudo-random in [0,1) from an integer. */
export function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
