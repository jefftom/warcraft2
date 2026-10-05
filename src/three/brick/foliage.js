// Brick-built trees and rocks. Pines are stacked cone pieces on a round-brick
// trunk; broadleaf trees are stacked round plates. Turns are quarter turns
// only, like bricks on a baseplate. Felled trees pop off, leaving a stump.

import * as THREE from 'three';
import { T } from '../../config.js';
import { hash } from '../geo.js';
import { BRICK, BRICK_COLORS, PLATE, PITCH, brick, conePiece, merge, plastic, roundBrick, cyl, stud } from './kit.js';

function pine() {
  return merge([
    roundBrick(3, BRICK_COLORS.reddishBrown, 0, 0, 0, { studs: false }),
    conePiece(0.46, 0.3, BRICK * 1.05, BRICK_COLORS.darkGreen, 0, BRICK, 0, false, 10),
    conePiece(0.36, 0.2, BRICK * 1.05, BRICK_COLORS.darkGreen, 0, BRICK * 2.05, 0, false, 10),
    conePiece(0.24, 0.07, BRICK * 1.1, BRICK_COLORS.green, 0, BRICK * 3.1, 0, true, 10),
  ]);
}

function broadleaf() {
  const tier = (r, y, color, studRing) => {
    const out = [cyl(r, r, PLATE * 2, 10, color, { y: y + PLATE })];
    // A ring of studs on top, as on round plates.
    for (let i = 0; i < studRing; i++) {
      const a = (i / studRing) * Math.PI * 2;
      out.push(stud(color, Math.cos(a) * (r - PITCH * 0.6), y + PLATE * 2, Math.sin(a) * (r - PITCH * 0.6), 6));
    }
    return merge(out);
  };
  return merge([
    roundBrick(3, BRICK_COLORS.reddishBrown, 0, 0, 0, { studs: false }),
    roundBrick(3, BRICK_COLORS.reddishBrown, 0, BRICK, 0, { studs: false }),
    tier(0.42, BRICK * 2, BRICK_COLORS.green, 0),
    tier(0.48, BRICK * 2 + PLATE * 2, BRICK_COLORS.brightGreen, 0),
    tier(0.34, BRICK * 2 + PLATE * 4, BRICK_COLORS.brightGreen, 0),
    tier(0.18, BRICK * 2 + PLATE * 6, BRICK_COLORS.limeGreen, 1),
  ]);
}

function stump() {
  return merge([roundBrick(2, BRICK_COLORS.reddishBrown, 0, 0, 0, { studs: true })]);
}

function rock() {
  return merge([
    brick(3, 2, 3, BRICK_COLORS.lightGrey, 0, 0, 0),
    brick(2, 2, 3, BRICK_COLORS.darkGrey, -0.1, BRICK, 0),
    brick(1, 2, 3, BRICK_COLORS.lightGrey, 0.2, BRICK, 0.1, { ry: 0 }),
  ]);
}

export class BrickFoliage {
  constructor(ctx) {
    this.ctx = ctx;
    const { map } = ctx.game;
    this.map = map;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.mat = plastic(ctx.fog, { key: 'brick-foliage', roughness: 0.5, clearcoat: 0.3 });
    this.geos = [pine(), broadleaf(), stump(), rock()];
    const [pineGeo, leafGeo, stumpGeo, rockGeo] = this.geos;

    const pines = [];
    const leaves = [];
    const rocks = [];
    let trees = 0;
    for (let i = 0; i < map.tiles.length; i++) {
      const t = map.tiles[i];
      if (t === T.TREE) {
        trees++;
        const x = i % map.w;
        const y = (i / map.w) | 0;
        const clump = hash(Math.floor(x / 3) * 131 + Math.floor(y / 3) * 977);
        (hash(i * 3 + 1) < 0.3 + clump * 0.5 ? pines : leaves).push(i);
      } else if (t === T.STUMP) trees++;
      else if (t === T.ROCK) rocks.push(i);
    }
    this.trees = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const make = (list, geo, kind) => {
      const mesh = new THREE.InstancedMesh(geo, this.mat, Math.max(1, list.length));
      mesh.count = list.length;
      list.forEach((k, i) => {
        const x = k % map.w;
        const y = (k / map.w) | 0;
        // Snap to the stud grid: quarter turns and whole-stud offsets.
        p.set(x + 0.5 + Math.round((hash(k * 5) - 0.5) * 2) * PITCH * 0.5, 0, y + 0.5 + Math.round((hash(k * 7) - 0.5) * 2) * PITCH * 0.5);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(hash(k * 11) * 4) * (Math.PI / 2));
        const sc = kind === 'rock' ? 1 : 1 + Math.floor(hash(k * 13) * 3) * 0.12;
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        const tint = kind === 'rock' ? 1 : 0.88 + hash(k * 23) * 0.22;
        mesh.setColorAt(i, col.setScalar(tint));
        if (kind !== 'rock') this.trees.set(k, { mesh, index: i, x: p.x, z: p.z, scale: sc });
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    make(pines, pineGeo, 'tree');
    make(leaves, leafGeo, 'tree');
    make(rocks, rockGeo, 'rock');
    this.stumps = new THREE.InstancedMesh(stumpGeo, this.mat, Math.max(1, trees));
    this.stumps.count = 0;
    this.stumps.castShadow = true;
    this.group.add(this.stumps);
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === T.STUMP) this.addStump(i);
    this.popping = [];
  }

  addStump(k) {
    if (this.stumps.count >= this.stumps.instanceMatrix.count) return;
    const t = this.trees.get(k);
    const x = t ? t.x : (k % this.map.w) + 0.5;
    const z = t ? t.z : ((k / this.map.w) | 0) + 0.5;
    this.stumps.setMatrixAt(this.stumps.count++, new THREE.Matrix4().makeTranslation(x, 0, z));
    this.stumps.instanceMatrix.needsUpdate = true;
    this.stumps.computeBoundingSphere();
  }

  onTileChanged(x, y, tile) {
    const k = y * this.map.w + x;
    const t = this.trees.get(k);
    if (!t || tile === T.TREE) return;
    this.trees.delete(k);
    this.popping.push({ t, age: 0 });
    this.addStump(k);
  }

  // A felled tree hops up off its stud, tips and drops out of sight.
  update(frame) {
    if (!this.popping.length) return;
    const dt = Math.min(0.1, frame.dt || 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const p of this.popping) {
      p.age += dt;
      const k = Math.min(1, p.age / 0.7);
      const y = Math.sin(k * Math.PI) * 0.5 - k * k * 0.8;
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), k * 1.6);
      const s = p.t.scale * (1 - k * 0.6);
      m.compose(new THREE.Vector3(p.t.x, y, p.t.z), q, new THREE.Vector3(s, s, s));
      if (k >= 1) m.makeScale(0, 0, 0);
      p.t.mesh.setMatrixAt(p.t.index, m);
      p.t.mesh.instanceMatrix.needsUpdate = true;
      p.done = k >= 1;
    }
    this.popping = this.popping.filter((p) => !p.done);
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
  }
}
