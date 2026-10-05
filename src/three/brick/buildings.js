// Brick-built buildings. Each model is an ordered list of pieces, foundation
// first and roof last, so a building under construction assembles itself
// brick by brick as progress rises. Prototype: the farm.

import * as THREE from 'three';
import { teamColors } from '../palette.js';
import { hash } from '../geo.js';
import { BRICK, BRICK_COLORS, PITCH, PLATE, brick, cyl, merge, plastic, rbox, roundBrick, slope, sphere } from './kit.js';

// Stud index (0..n-1 across a footprint of n studs) to a local coordinate.
const at = (i, n) => (i - (n - 1) / 2) * PITCH;

function farmPieces(owner) {
  const tc = teamColors(owner);
  const N = 10; // a 2x2-tile footprint is 10 x 10 studs
  const pieces = [];
  const add = (geo) => pieces.push(geo);

  // Foundation plates: a field on the left, a yard on the right.
  add(brick(4, 10, 1, BRICK_COLORS.reddishBrown, at(1.5, N), 0, at(4.5, N)));
  add(brick(6, 10, 1, BRICK_COLORS.tan, at(6.5, N), 0, at(4.5, N)));
  const base = PLATE;

  // Cottage walls: x 4..9, z 0..4, four courses laid in a staggered bond.
  const X0 = 4;
  const X1 = 9;
  const Z0 = 0;
  const Z1 = 4;
  const doorX = [6, 7];
  for (let c = 0; c < 4; c++) {
    const y = base + c * BRICK;
    const color = (i) => (c === 0 ? BRICK_COLORS.darkTan : hash(c * 97 + i * 13) < 0.2 ? BRICK_COLORS.tan : BRICK_COLORS.white);
    // Front and back rows run the full width; their joints shift each course.
    for (const z of [Z0, Z1]) {
      let x = X0;
      if (c % 2) {
        add(brick(1, 1, 3, color(x + z), at(x, N), y, at(z, N)));
        x++;
      }
      while (x <= X1) {
        const isDoor = z === Z1 && c < 3 && doorX.includes(x);
        const isWindow = z === Z1 && (c === 1 || c === 2) && (x === X0 + 0 || x === X0 + 1);
        if (isDoor || isWindow) {
          x++;
          continue;
        }
        const len = x + 1 <= X1 && !(z === Z1 && c < 3 && doorX.includes(x + 1)) && !(z === Z1 && (c === 1 || c === 2) && x + 1 <= X0 + 1) ? 2 : 1;
        add(brick(len, 1, 3, color(x + z * 7), at(x + (len - 1) / 2, N), y, at(z, N)));
        x += len;
      }
    }
    // Side walls fill between them.
    for (const x of [X0, X1]) {
      let z = Z0 + 1;
      if (c % 2 === 0) {
        add(brick(1, 1, 3, color(x + z * 3), at(x, N), y, at(z, N)));
        z++;
      }
      while (z < Z1) {
        if (x === X1 && (c === 1 || c === 2) && z === 2) {
          z++;
          continue;
        }
        const len = z + 1 < Z1 && !(x === X1 && (c === 1 || c === 2) && z + 1 === 2) ? 2 : 1;
        add(brick(1, len, 3, color(x * 5 + z), at(x, N), y, at(z + (len - 1) / 2, N)));
        z += len;
      }
    }
  }
  // Door with a knob, windows with clear panes.
  add(
    merge([
      rbox(2 * PITCH - 0.03, 3 * BRICK - 0.02, PITCH * 0.5, BRICK_COLORS.reddishBrown, { x: at(6.5, N), y: base + 1.5 * BRICK, z: at(Z1, N) }, 0.01),
      sphere(0.02, BRICK_COLORS.yellow, { x: at(7, N), y: base + 1.4 * BRICK, z: at(Z1, N) + PITCH * 0.28 }, 8, 6),
    ]),
  );
  const pane = (x, z, w, d) =>
    merge([
      rbox(w, 2 * BRICK - 0.01, d, BRICK_COLORS.white, { x, y: base + 2 * BRICK, z }, 0.008),
      rbox(w * 0.8, 2 * BRICK * 0.8, d * 1.15, BRICK_COLORS.transClear, { x, y: base + 2 * BRICK, z }, 0.004),
      rbox(0.012, 2 * BRICK * 0.8, d * 1.2, BRICK_COLORS.white, { x, y: base + 2 * BRICK, z }, 0.002),
    ]);
  add(pane(at(4.5, N), at(Z1, N), 2 * PITCH - 0.01, PITCH * 0.6));
  add(pane(at(X1, N), at(2, N), PITCH * 0.6, PITCH - 0.01));

  // Roof: slope bricks on both sides with a ridge, in team colour.
  const top = base + 4 * BRICK;
  const roofW = X1 - X0 + 3;
  const roofX = at((X0 + X1) / 2, N);
  add(slope(roofW, 2, tc.main, roofX, top, at(Z1 - 0.5, N) + PITCH, 0));
  add(slope(roofW, 2, tc.main, roofX, top, at(Z0 + 0.5, N) - PITCH, Math.PI));
  add(brick(roofW, 1, 3, tc.dark, roofX, top, at(2, N), { studs: false }));
  add(slope(roofW, 2, tc.main, roofX, top + BRICK, at(2.5, N), 0));
  add(slope(roofW, 2, tc.main, roofX, top + BRICK, at(1.5, N), Math.PI));
  add(brick(roofW, 1, 1, tc.dark, roofX, top + 2 * BRICK, at(2, N)));
  // Chimney.
  for (let k = 0; k < 3; k++) add(brick(1, 1, 3, BRICK_COLORS.darkGrey, at(8, N), top + k * BRICK, at(1, N), { studs: k === 2 }));

  // Crops: rows of green plants and golden wheat.
  for (let z = 1; z < 9; z++) {
    for (const x of [0.6, 2.4]) {
      if ((z + Math.round(x)) % 2) {
        add(merge([cyl(0.012, 0.012, 0.12, 6, BRICK_COLORS.darkGreen, { x: at(x, N), y: base + 0.06, z: at(z, N) }), sphere(0.07, BRICK_COLORS.brightGreen, { x: at(x, N), y: base + 0.13, z: at(z, N), sy: 0.8 }, 10, 6)]));
      } else {
        add(merge([0, 1, 2].map((k) => cyl(0.018, 0.018, 0.2, 6, BRICK_COLORS.yellow, { x: at(x, N) + (k - 1) * 0.035, y: base + 0.1, z: at(z, N) + (k % 2) * 0.03 }))));
      }
    }
  }
  // Yard: a hay bale and a white fence along the front.
  add(roundBrick(3, BRICK_COLORS.yellow, at(8.5, N), base, at(7, N)));
  add(roundBrick(3, BRICK_COLORS.yellow, at(7.3, N), base, at(7.6, N)));
  for (let x = 0; x < N; x += 2) {
    add(
      merge([
        rbox(2 * PITCH - 0.01, 0.03, 0.03, BRICK_COLORS.white, { x: at(x + 0.5, N), y: base + 0.17, z: at(9, N) }, 0.006),
        rbox(2 * PITCH - 0.01, 0.03, 0.03, BRICK_COLORS.white, { x: at(x + 0.5, N), y: base + 0.08, z: at(9, N) }, 0.006),
        rbox(0.05, 0.22, 0.05, BRICK_COLORS.white, { x: at(x, N), y: base + 0.11, z: at(9, N) }, 0.008),
      ]),
    );
  }
  return pieces;
}

const PIECES = {};
function pieces(type, owner) {
  const key = `${type}:${owner}`;
  if (!PIECES[key]) PIECES[key] = type === 'farm' ? farmPieces(owner) : null;
  return PIECES[key];
}

const FULL = {};
function fullGeometry(type, owner) {
  const key = `${type}:${owner}`;
  if (!FULL[key]) {
    const list = pieces(type, owner);
    FULL[key] = list ? merge(list.map((g) => g.clone())) : null;
  }
  return FULL[key];
}

export class BrickBuildingLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.mat = plastic(ctx.fog, { key: 'brick-buildings' });
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.models = new Map();
  }

  metrics(b) {
    return { height: b.type === 'farm' ? PLATE + 6 * BRICK : 1.5 };
  }

  sync(frame) {
    const { game } = this.ctx;
    const seen = new Set();
    for (const b of game.buildings) {
      if (!this.ctx.visible(b) || !pieces(b.type, b.owner)) continue;
      seen.add(b.id);
      let rec = this.models.get(b.id);
      if (!rec) {
        rec = { mesh: new THREE.Mesh(undefined, this.mat), shown: -1 };
        rec.mesh.castShadow = true;
        rec.mesh.receiveShadow = true;
        rec.mesh.position.set(b.x + b.size / 2, 0, b.y + b.size / 2);
        this.group.add(rec.mesh);
        this.models.set(b.id, rec);
      }
      // Assemble: show as many pieces as construction allows.
      const list = pieces(b.type, b.owner);
      const want = b.constructing ? Math.max(1, Math.floor(list.length * b.progress)) : list.length;
      if (want !== rec.shown) {
        if (rec.partial) rec.partial.dispose();
        rec.partial = null;
        if (want >= list.length) rec.mesh.geometry = fullGeometry(b.type, b.owner);
        else {
          rec.partial = merge(list.slice(0, want).map((g) => g.clone()));
          rec.mesh.geometry = rec.partial;
        }
        rec.shown = want;
      }
      // Burning when badly damaged.
      if (!b.constructing && b.hp < b.maxHp * 0.5 && Math.random() < 0.5 * (frame.dt || 0) * 60 * 0.25) {
        const cx = b.x + b.size / 2 + (Math.random() - 0.5) * b.size * 0.6;
        const cz = b.y + b.size / 2 + (Math.random() - 0.5) * b.size * 0.6;
        this.ctx.particles.glow.emit({ x: cx, y: 1.2, z: cz, vy: 1.2, life: 0.6, size: 0.5, size1: 0.1, color: [1, 0.6, 0.2, 1], color1: [1, 0.2, 0.05, 0] });
        this.ctx.particles.smoke.emit({ x: cx, y: 1.5, z: cz, vy: 0.8, life: 2, size: 0.4, size1: 1.2, color: [0.2, 0.2, 0.2, 0.6], color1: [0.35, 0.35, 0.35, 0] });
      }
    }
    for (const [id, rec] of this.models) {
      if (seen.has(id)) continue;
      rec.mesh.removeFromParent();
      if (rec.partial) rec.partial.dispose();
      this.models.delete(id);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const rec of this.models.values()) if (rec.partial) rec.partial.dispose();
    this.mat.dispose();
  }
}
