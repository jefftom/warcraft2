// Minifigure units for the brick style. Proportions follow the real toy
// (about four bricks tall); arms and legs swing stiffly on their hinges.
// Models face +Z and stand on y = 0; one Group per unit with hinged parts.

import * as THREE from 'three';
import { TILE } from '../../config.js';
import { teamColors } from '../palette.js';
import { BRICK_COLORS, BRICK, PLATE, PITCH, brick, cyl, merge, part, plastic, rbox, roundBrick, sphere, torus } from './kit.js';

const MM = 0.025; // world units per millimetre at this scale
const SKIN = BRICK_COLORS.yellow;
const HIP_Y = 12.8 * MM;
const SHOULDER_Y = 27 * MM;

// The tapered torso block.
function torsoGeo(color) {
  const g = new THREE.BoxGeometry(15.6 * MM, 12.8 * MM, 8 * MM);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setX(i, pos.getX(i) * (12 / 15.6));
  g.computeVertexNormals();
  return part(g, color, { y: HIP_Y + 3.2 * MM + 6.4 * MM });
}

function faceGeo() {
  const z = 4.6 * MM + 0.004;
  const y = SHOULDER_Y + 1.5 * MM + 5.5 * MM;
  return merge([
    sphere(0.011, BRICK_COLORS.black, { x: -0.04, y: y + 0.02, z, sz: 0.5 }, 8, 6),
    sphere(0.011, BRICK_COLORS.black, { x: 0.04, y: y + 0.02, z, sz: 0.5 }, 8, 6),
    torus(0.036, 0.007, BRICK_COLORS.black, { y: y + 0.006, z: z - 0.004, rz: Math.PI * 1.1 }, Math.PI * 0.8),
  ]);
}

function headGeo(withStud = true) {
  const y0 = SHOULDER_Y + 1.5 * MM;
  const parts = [
    cyl(2.5 * MM, 2.5 * MM, 1.5 * MM, 10, SKIN, { y: SHOULDER_Y + 0.75 * MM }),
    cyl(4.8 * MM, 4.8 * MM, 8.6 * MM, 20, SKIN, { y: y0 + 4.3 * MM }),
    faceGeo(),
  ];
  if (withStud) parts.push(cyl(3 * MM, 3 * MM, 1.7 * MM, 14, SKIN, { y: y0 + 8.6 * MM + 0.85 * MM }));
  return merge(parts);
}

function legGeo(color, side) {
  const x = side * 3.9 * MM;
  return merge([
    rbox(7.6 * MM, 11.2 * MM, 7.4 * MM, color, { x, y: -HIP_Y + 1.6 * MM + 5.6 * MM, z: 0 }, 0.008),
    rbox(7.6 * MM, 1.6 * MM, 9.2 * MM, color, { x, y: -HIP_Y + 0.8 * MM, z: 0.9 * MM }, 0.005),
  ]);
}

// Arm hangs from a shoulder hinge at the origin, bent slightly forward,
// with the C-shaped hand at the end.
function armGeo(color, side) {
  return merge([
    cyl(2.4 * MM, 2.6 * MM, 10 * MM, 10, color, { x: side * 0.6 * MM, y: -5 * MM, z: 0.8 * MM, rx: 0.25 }),
    cyl(1.9 * MM, 1.9 * MM, 3 * MM, 10, SKIN, { x: side * 0.6 * MM, y: -11 * MM, z: 3.4 * MM, rx: 1.2 }),
    torus(2.2 * MM, 1 * MM, SKIN, { x: side * 0.6 * MM, y: -12.4 * MM, z: 5.2 * MM, rx: Math.PI / 2, rz: side * 0.6 }, Math.PI * 1.6),
  ]);
}

// Where a hand's grip sits, relative to the shoulder hinge.
const HAND = new THREE.Vector3(0, -12.4 * MM, 5.4 * MM);

function swordGeo() {
  return merge([
    rbox(0.034, 0.36, 0.012, BRICK_COLORS.steel, { y: 0.2 }, 0.004),
    rbox(0.11, 0.02, 0.03, BRICK_COLORS.yellow, { y: 0.02 }, 0.004),
    cyl(0.014, 0.014, 0.07, 8, BRICK_COLORS.reddishBrown, { y: -0.03 }),
  ]);
}

function shieldGeo(tc) {
  return merge([
    rbox(0.26, 0.3, 0.025, tc.main, {}, 0.01),
    rbox(0.21, 0.04, 0.03, tc.light, { y: 0.03 }, 0.004),
    rbox(0.04, 0.2, 0.03, tc.light, { y: 0.01 }, 0.004),
    cyl(0.024, 0.024, 0.03, 10, BRICK_COLORS.yellow, { rx: Math.PI / 2, z: 0.016, y: 0.03 }),
  ]);
}

function helmetGeo(tc) {
  const y = SHOULDER_Y + 1.5 * MM;
  return merge([
    cyl(5.4 * MM, 5.4 * MM, 5 * MM, 20, BRICK_COLORS.lightGrey, { y: y + 7.6 * MM }),
    sphere(5.4 * MM, BRICK_COLORS.lightGrey, { y: y + 9.8 * MM, sy: 0.5 }, 18, 8),
    rbox(10 * MM, 7 * MM, 2 * MM, BRICK_COLORS.lightGrey, { y: y + 4.8 * MM, z: -4.4 * MM }, 0.004),
    rbox(1.4 * MM, 6 * MM, 3 * MM, BRICK_COLORS.lightGrey, { y: y + 6 * MM, z: 4.9 * MM }, 0.003),
    rbox(2.2 * MM, 4 * MM, 9 * MM, tc.main, { y: y + 13.4 * MM, z: -1 * MM }, 0.008),
    rbox(2.2 * MM, 2.6 * MM, 6 * MM, tc.light, { y: y + 15.4 * MM, z: -3.5 * MM, rx: -0.5 }, 0.006),
  ]);
}

function capGeo() {
  const y = SHOULDER_Y + 1.5 * MM;
  return merge([
    cyl(8 * MM, 8 * MM, 1.2 * MM, 20, BRICK_COLORS.tan, { y: y + 7 * MM }),
    cyl(4.6 * MM, 5.2 * MM, 4.5 * MM, 18, BRICK_COLORS.tan, { y: y + 9.6 * MM }),
  ]);
}

function hoodGeo(tc) {
  const y = SHOULDER_Y + 1.5 * MM;
  return merge([
    sphere(5.6 * MM, tc.dark, { y: y + 6.6 * MM, z: -0.8 * MM, sy: 1.1 }, 16, 10),
    rbox(13 * MM, 3 * MM, 9 * MM, tc.dark, { y: SHOULDER_Y + 0.5 * MM, z: -0.5 * MM }, 0.006),
  ]);
}

function pickGeo() {
  return merge([
    cyl(0.012, 0.012, 0.34, 8, BRICK_COLORS.reddishBrown, { y: 0.12 }),
    rbox(0.2, 0.03, 0.03, BRICK_COLORS.darkGrey, { y: 0.27, rz: 0.15 }, 0.006),
  ]);
}

function bowGeo() {
  return merge([
    torus(0.2, 0.012, BRICK_COLORS.reddishBrown, { rz: Math.PI / 2 - 1.1 }, 2.2),
    cyl(0.003, 0.003, 0.36, 4, BRICK_COLORS.white, { x: 0.075 }),
  ]);
}

function lanceGeo() {
  return merge([
    cyl(0.016, 0.022, 0.9, 8, BRICK_COLORS.white, { y: 0.32 }),
    cyl(0.003, 0.05, 0.12, 10, BRICK_COLORS.lightGrey, { y: -0.16 }),
  ]);
}

function sackGeo(kind) {
  if (kind === 'gold') {
    return merge([roundBrick(3, BRICK_COLORS.reddishBrown, 0, -0.05, 0, { studs: false }), sphere(0.07, BRICK_COLORS.yellow, { y: 0.24 }, 10, 8)]);
  }
  return merge([
    cyl(0.04, 0.04, 0.34, 10, BRICK_COLORS.reddishBrown, { rz: Math.PI / 2, y: 0.02 }),
    cyl(0.04, 0.04, 0.34, 10, BRICK_COLORS.brown, { rz: Math.PI / 2, y: 0.1, z: 0.02 }),
    cyl(0.04, 0.04, 0.34, 10, BRICK_COLORS.reddishBrown, { rz: Math.PI / 2, y: 0.06, z: -0.07 }),
  ]);
}

function horseGeo(tc) {
  const W = BRICK_COLORS.white;
  return merge([
    rbox(0.34, 0.26, 0.82, W, { y: 0.5 }, 0.03),
    rbox(0.2, 0.36, 0.2, W, { y: 0.74, z: 0.42, rx: -0.5 }, 0.03),
    rbox(0.17, 0.16, 0.32, W, { y: 0.9, z: 0.6 }, 0.03),
    rbox(0.05, 0.08, 0.05, W, { x: 0.06, y: 1.0, z: 0.52 }, 0.01),
    rbox(0.05, 0.08, 0.05, W, { x: -0.06, y: 1.0, z: 0.52 }, 0.01),
    rbox(0.06, 0.2, 0.22, BRICK_COLORS.darkGrey, { y: 0.88, z: 0.38, rx: -0.5 }, 0.01),
    // Caparison in team colour hanging off each flank, with a light border.
    rbox(0.37, 0.24, 0.7, tc.main, { y: 0.44 }, 0.02),
    rbox(0.38, 0.03, 0.71, tc.light, { y: 0.33 }, 0.01),
    rbox(0.24, 0.07, 0.3, BRICK_COLORS.reddishBrown, { y: 0.66, z: -0.04 }, 0.02),
    cyl(0.03, 0.01, 0.22, 8, BRICK_COLORS.darkGrey, { y: 0.52, z: -0.48, rx: -2.4 }),
  ]);
}

function horseLegGeo() {
  return merge([rbox(0.09, 0.4, 0.1, BRICK_COLORS.white, { y: -0.2 }, 0.015), rbox(0.1, 0.06, 0.12, BRICK_COLORS.darkGrey, { y: -0.39 }, 0.01)]);
}

const LOOKS = {
  peasant: { torso: BRICK_COLORS.tan, legs: BRICK_COLORS.reddishBrown, arms: BRICK_COLORS.tan, head: 'cap', right: 'pick', sash: true },
  footman: { torso: 'team', legs: BRICK_COLORS.darkGrey, arms: 'team', head: 'helmet', right: 'sword', left: 'shield' },
  archer: { torso: BRICK_COLORS.darkGreen, legs: BRICK_COLORS.reddishBrown, arms: BRICK_COLORS.darkGreen, head: 'hood', left: 'bow', sash: true },
  knight: { torso: 'team', legs: BRICK_COLORS.lightGrey, arms: BRICK_COLORS.lightGrey, head: 'helmet', right: 'lance', left: 'shield', horse: true },
};

const cache = new Map();
function kit(type, owner) {
  const key = `${type}:${owner}`;
  if (cache.has(key)) return cache.get(key);
  const tc = teamColors(owner);
  const look = LOOKS[type] || LOOKS.footman;
  const c = (v) => (v === 'team' ? tc.main : v);
  const torsoParts = [
    torsoGeo(c(look.torso)),
    rbox(15.6 * MM, 3.2 * MM, 8 * MM, c(look.legs), { y: HIP_Y + 1.6 * MM }, 0.004),
    headGeo(look.head !== 'cap'),
  ];
  if (look.sash) torsoParts.push(rbox(14 * MM, 2.2 * MM, 8.4 * MM, tc.main, { y: HIP_Y + 8 * MM, rz: 0.5 }, 0.003));
  if (look.torso === 'team') {
    // A printed crest on the chest.
    torsoParts.push(rbox(5 * MM, 6 * MM, 0.6 * MM, tc.light, { y: HIP_Y + 9.5 * MM, z: 4.1 * MM }, 0.002));
    torsoParts.push(rbox(10 * MM, 1.4 * MM, 0.8 * MM, BRICK_COLORS.yellow, { y: HIP_Y + 4.4 * MM, z: 4.1 * MM }, 0.002));
  }
  if (look.head === 'helmet') torsoParts.push(helmetGeo(tc));
  if (look.head === 'cap') torsoParts.push(capGeo());
  if (look.head === 'hood') torsoParts.push(hoodGeo(tc));
  if (type === 'archer') torsoParts.push(cyl(0.035, 0.035, 0.26, 10, BRICK_COLORS.reddishBrown, { y: 0.62, z: -0.13, rx: 0.3 }));
  const k = {
    torso: merge(torsoParts),
    legL: legGeo(c(look.legs), -1),
    legR: legGeo(c(look.legs), 1),
    armL: armGeo(c(look.arms), -1),
    armR: armGeo(c(look.arms), 1),
    right: look.right === 'sword' ? swordGeo() : look.right === 'pick' ? pickGeo() : look.right === 'lance' ? lanceGeo() : null,
    left: look.left === 'shield' ? shieldGeo(tc) : look.left === 'bow' ? bowGeo() : null,
    horse: look.horse ? horseGeo(tc) : null,
    horseLeg: look.horse ? horseLegGeo() : null,
    look,
  };
  cache.set(key, k);
  return k;
}

const SACKS = {};
function sack(kind) {
  if (!SACKS[kind]) SACKS[kind] = sackGeo(kind);
  return SACKS[kind];
}

class Minifig {
  constructor(layer, u) {
    const k = kit(u.type, u.owner);
    const mat = layer.mat;
    this.type = u.type;
    this.root = new THREE.Group();
    this.rider = new THREE.Group();
    this.root.add(this.rider);
    const mesh = (g) => {
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    this.rider.add(mesh(k.torso));
    const hinge = (g, x, y) => {
      const h = new THREE.Group();
      h.position.set(x, y, 0);
      h.add(mesh(g));
      this.rider.add(h);
      return h;
    };
    this.legL = hinge(k.legL, 0, HIP_Y);
    this.legR = hinge(k.legR, 0, HIP_Y);
    this.armL = hinge(k.armL, -7.2 * MM, SHOULDER_Y);
    this.armR = hinge(k.armR, 7.2 * MM, SHOULDER_Y);
    this.armL.rotation.z = -0.12;
    this.armR.rotation.z = 0.12;
    if (k.right) {
      const tool = mesh(k.right);
      tool.position.copy(HAND);
      tool.rotation.x = k.look.right === 'lance' ? 1.35 : 1.2;
      this.armR.add(tool);
    }
    if (k.left) {
      const held = mesh(k.left);
      held.position.copy(HAND);
      if (k.look.left === 'shield') {
        held.position.z += 0.05;
        held.position.x -= 0.02;
      } else held.rotation.y = Math.PI / 2;
      this.armL.add(held);
    }
    this.carry = new THREE.Group();
    this.carry.position.set(0, 0.48, -0.17);
    this.rider.add(this.carry);
    this.carryKind = null;
    if (k.horse) {
      this.horse = mesh(k.horse);
      this.root.add(this.horse);
      this.hooves = [
        [-0.12, 0.25],
        [0.12, 0.25],
        [-0.12, -0.28],
        [0.12, -0.28],
      ].map(([x, z]) => {
        const h = new THREE.Group();
        h.position.set(x, 0.4, z);
        h.add(mesh(k.horseLeg));
        this.root.add(h);
        return h;
      });
      // Sit the rider in the saddle with legs forward.
      this.rider.position.set(0, 0.38, -0.04);
      this.legL.rotation.x = -1.45;
      this.legR.rotation.x = -1.45;
      this.legL.position.x = -0.035;
      this.legR.position.x = 0.035;
    }
    this.yaw = 0;
  }

  setCarry(kind) {
    if (kind === this.carryKind) return;
    this.carryKind = kind;
    this.carry.clear();
    if (kind) {
      const m = new THREE.Mesh(sack(kind), this.carryMat);
      m.castShadow = true;
      this.carry.add(m);
    }
  }
}

export class BrickUnitLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.mat = plastic(ctx.fog, { key: 'brick-units' });
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.figs = new Map();
  }

  metrics(u) {
    return u.type === 'knight' ? { height: 1.5, radius: 0.48 } : { height: 1.0, radius: 0.26 };
  }

  sync(frame, clock) {
    const { game, heightAt } = this.ctx;
    const dt = Math.min(0.1, frame.dt || 0);
    const seen = new Set();
    for (const u of game.units) {
      if (!this.ctx.visible(u)) continue;
      seen.add(u.id);
      let f = this.figs.get(u.id);
      if (!f) {
        f = new Minifig(this, u);
        f.carryMat = this.mat;
        f.yaw = Math.atan2(u.dirX || 0, u.dirY || 1);
        this.figs.set(u.id, f);
        this.group.add(f.root);
      }
      this.pose(f, u, dt, clock);
      const x = u.x / TILE;
      const z = u.y / TILE;
      f.root.position.set(x, heightAt(x, z), z);
    }
    for (const [id, f] of this.figs) {
      if (seen.has(id)) continue;
      f.root.removeFromParent();
      this.figs.delete(id);
    }
  }

  pose(f, u, dt, clock) {
    // Turn toward the heading, the short way round.
    if (u.dirX || u.dirY) {
      const target = Math.atan2(u.dirX, u.dirY);
      let d = target - f.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.yaw += d * Math.min(1, dt * 12);
    }
    f.root.rotation.y = f.yaw;
    const mounted = !!f.horse;
    const walking = u.moving;
    const ph = u.walkAnim * Math.PI * 2 * (mounted ? 0.55 : 0.85);
    const swing = walking ? Math.sin(ph) : 0;
    const idle = Math.sin(clock * 2 + u.id) * 0.04;

    if (mounted) {
      f.hooves[0].rotation.x = swing * 0.6;
      f.hooves[3].rotation.x = swing * 0.6;
      f.hooves[1].rotation.x = -swing * 0.6;
      f.hooves[2].rotation.x = -swing * 0.6;
      f.horse.position.y = walking ? Math.abs(Math.sin(ph)) * 0.04 : 0;
      f.rider.position.y = 0.38 + f.horse.position.y;
    } else {
      f.legL.rotation.x = swing * 0.65;
      f.legR.rotation.x = -swing * 0.65;
      f.rider.position.y = walking ? Math.abs(Math.sin(ph)) * 0.03 : 0;
    }
    // Arms: swing while walking, hold weapons ready otherwise.
    let armR = walking ? swing * 0.5 : -0.25 + idle;
    let armL = walking ? -swing * 0.5 : -0.35 - idle;
    const chopping = u.order && u.order.type === 'harvest' && u.order.phase === 'chopping';
    if (chopping) {
      const k = (u.workAnim % 0.55) / 0.55;
      armR = k < 0.6 ? -2.6 * (k / 0.6) : -2.6 + 3.0 * ((k - 0.6) / 0.4);
    } else if (u.attackAnim > 0) {
      const k = 1 - u.attackAnim / 0.3;
      if (u.type === 'archer') {
        armL = -1.55;
        armR = -1.4 + k * 0.5;
      } else if (u.type === 'knight') {
        armR = -0.6 + Math.sin(k * Math.PI) * 0.7;
      } else {
        // Raise the weapon, then bring it down hard.
        armR = k < 0.35 ? -2.7 * (k / 0.35) : -2.7 + 3.1 * ((k - 0.35) / 0.65);
      }
    } else if (u.type === 'archer' && !walking) {
      armL = -1.2;
    }
    if (mounted) armR = Math.min(armR, -0.6);
    f.armR.rotation.x = armR;
    f.armL.rotation.x = armL;
    // A stiff little jolt when hit.
    f.rider.rotation.x = u.flash > 0 ? -0.18 : 0;
    f.setCarry(u.carry ? u.carry.type : null);
  }

  dispose() {
    this.group.removeFromParent();
    this.mat.dispose();
  }
}

export { BRICK, PLATE, PITCH, brick };
