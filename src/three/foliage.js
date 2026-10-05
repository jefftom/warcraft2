// Trees, stumps, rocks and ground clutter, all instanced.
//
// Each tree tile gets one tree (a pine or a broadleaf), jittered, scaled,
// turned and tinted per instance; neighbouring canopies overlap into a solid
// forest wall from above. Trees sway in the wind in the vertex shader. When a
// tree is felled it topples over, sinks into the ground and leaves a stump.

import * as THREE from 'three';
import { T } from '../config.js';
import { cone, cyl, ico, dodeca, box, merge, hash } from './geo.js';
import { SWATCH } from './palette.js';

const SWAY = `
#ifdef USE_INSTANCING
  float swayPh = uTime * 1.5 + instanceMatrix[3][0] * 0.71 + instanceMatrix[3][2] * 0.53;
  float swayK = max( 0.0, position.y - 0.25 ) * 0.035;
  transformed.x += sin( swayPh ) * swayK;
  transformed.z += cos( swayPh * 0.8 ) * swayK * 0.6;
#endif`;

function pineGeometry() {
  return merge([
    cyl(0.07, 0.11, 0.55, 6, SWATCH.bark, { y: 0.27 }),
    cone(0.58, 0.85, 7, SWATCH.pineDark, { y: 0.78 }),
    cone(0.47, 0.75, 7, SWATCH.pine, { y: 1.18, ry: 0.4 }),
    cone(0.33, 0.62, 7, '#2f6634', { y: 1.55, ry: 0.9 }),
    cone(0.17, 0.4, 6, '#3b7a3e', { y: 1.86 }),
  ]);
}

function broadleafGeometry() {
  return merge([
    cyl(0.08, 0.13, 0.7, 6, SWATCH.bark, { y: 0.35 }),
    cyl(0.04, 0.05, 0.35, 5, SWATCH.bark, { x: 0.12, y: 0.68, rz: -0.6 }),
    ico(0.5, 0, SWATCH.leafDark, { y: 0.98, sy: 0.85 }),
    ico(0.38, 0, SWATCH.leaf, { x: -0.22, y: 1.18, z: 0.1, ry: 0.5 }),
    ico(0.36, 0, '#4a8a32', { x: 0.2, y: 1.22, z: -0.12, ry: 1.1 }),
    ico(0.28, 0, '#5c9e3c', { x: 0.02, y: 1.42, z: 0.05, ry: 2.0 }),
  ]);
}

function stumpGeometry() {
  return merge([
    cyl(0.13, 0.16, 0.16, 7, SWATCH.bark, { y: 0.08 }),
    cyl(0.12, 0.12, 0.012, 7, '#c49a62', { y: 0.165 }),
    box(0.06, 0.05, 0.22, SWATCH.bark, { x: 0.12, y: 0.03, ry: 0.6 }),
  ]);
}

function tuftGeometry() {
  return merge([
    cone(0.03, 0.22, 3, '#5f9a3a', { y: 0.11, rz: 0.25 }),
    cone(0.03, 0.26, 3, '#4f8a30', { x: 0.04, y: 0.13, rz: -0.2 }),
    cone(0.025, 0.18, 3, '#6fae46', { x: -0.04, z: 0.03, y: 0.09, rx: 0.3 }),
  ]);
}

function flowerGeometry() {
  return merge([cyl(0.008, 0.008, 0.14, 3, '#4f8a30', { y: 0.07 }), ico(0.035, 0, '#ffffff', { y: 0.15 })]);
}

const FLOWER_COLORS = ['#f2e36b', '#f4f4f0', '#e88fb4', '#b98ae8', '#ef8a4a'];

export class FoliageLayer {
  /** @param {import('./index.js').LayerContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    const { map } = ctx.game;
    this.map = map;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);

    this.treeMat = ctx.fog.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), {
      key: 'tree-sway',
      beginVertex: SWAY,
    });
    this.geos = [];
    const geo = (g) => {
      this.geos.push(g);
      return g;
    };
    this.pineGeo = geo(pineGeometry());
    this.leafGeo = geo(broadleafGeometry());

    // Trees.
    const pines = [];
    const leaves = [];
    let maxTrees = 0;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.get(x, y);
        if (t === T.TREE || t === T.STUMP) maxTrees++;
        if (t !== T.TREE) continue;
        const k = y * map.w + x;
        // Pines dominate the dark woods; broadleaf trees gather in clumps.
        const clump = hash(Math.floor(x / 4) * 131 + Math.floor(y / 4) * 977);
        (hash(k * 3 + 1) < 0.35 + clump * 0.4 ? pines : leaves).push(k);
      }
    }
    this.trees = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    const makeTrees = (list, g) => {
      const mesh = new THREE.InstancedMesh(g, this.treeMat, Math.max(1, list.length));
      mesh.count = list.length;
      list.forEach((k, i) => {
        const x = k % map.w;
        const y = (k / map.w) | 0;
        pos.set(x + 0.5 + (hash(k * 5) - 0.5) * 0.3, 0, y + 0.5 + (hash(k * 7) - 0.5) * 0.3);
        pos.y = ctx.heightAt(pos.x, pos.z) - 0.02;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(k * 11) * Math.PI * 2);
        const s = 0.82 + hash(k * 13) * 0.4;
        sc.set(s * (0.92 + hash(k * 17) * 0.16), s * (0.9 + hash(k * 19) * 0.25), s);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
        const tint = 0.82 + hash(k * 23) * 0.32;
        col.setRGB(tint * (0.95 + hash(k * 29) * 0.1), tint, tint * (0.9 + hash(k * 31) * 0.1));
        mesh.setColorAt(i, col);
        this.trees.set(k, { mesh, index: i, matrix: m.clone(), x: pos.x, y: pos.y, z: pos.z, scale: sc.clone(), quat: q.clone() });
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    };
    this.pines = makeTrees(pines, this.pineGeo);
    this.leaves = makeTrees(leaves, this.leafGeo);

    // Stumps: room for every tree on the map to become one.
    this.stumps = new THREE.InstancedMesh(geo(stumpGeometry()), ctx.palette.matte, Math.max(1, maxTrees));
    this.stumps.count = 0;
    this.stumps.castShadow = true;
    this.stumps.receiveShadow = true;
    this.group.add(this.stumps);
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === T.STUMP) this.addStump(i % map.w, (i / map.w) | 0);

    this.buildRocks(geo);
    this.buildClutter(geo);
    this.falling = [];
  }

  addStump(x, y) {
    const k = y * this.map.w + x;
    const tree = this.trees.get(k);
    const px = tree ? tree.x : x + 0.5;
    const pz = tree ? tree.z : y + 0.5;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px, this.ctx.heightAt(px, pz) - 0.02, pz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(k * 41) * 6.28),
      new THREE.Vector3(1, 1, 1).multiplyScalar(tree ? tree.scale.x : 1),
    );
    if (this.stumps.count >= this.stumps.instanceMatrix.count) return;
    this.stumps.setMatrixAt(this.stumps.count++, m);
    this.stumps.instanceMatrix.needsUpdate = true;
    this.stumps.computeBoundingSphere();
  }

  buildRocks(geo) {
    const { map, ctx } = this;
    const list = [];
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === T.ROCK) list.push(i);
    const boulder = geo(dodeca(0.5, SWATCH.rock, { sy: 0.7 }));
    const mesh = new THREE.InstancedMesh(boulder, ctx.palette.matte, Math.max(1, list.length * 3));
    let n = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    for (const k of list) {
      const x = k % map.w;
      const y = (k / map.w) | 0;
      const count = 2 + (hash(k * 3) > 0.5 ? 1 : 0);
      for (let j = 0; j < count; j++) {
        const s = j === 0 ? 0.75 + hash(k * 5) * 0.35 : 0.3 + hash(k * 7 + j) * 0.3;
        const px = x + 0.5 + (j === 0 ? 0 : (hash(k * 11 + j) - 0.5) * 0.7);
        const pz = y + 0.5 + (j === 0 ? 0 : (hash(k * 13 + j) - 0.5) * 0.7);
        e.set(hash(k * 17 + j) * 0.6, hash(k * 19 + j) * 6.28, hash(k * 23 + j) * 0.4);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(px, ctx.heightAt(px, pz) + s * 0.12, pz), q, new THREE.Vector3(s, s * (0.8 + hash(k + j) * 0.4), s));
        mesh.setMatrixAt(n, m);
        const g = 0.8 + hash(k * 29 + j) * 0.35;
        mesh.setColorAt(n, col.setRGB(g, g * 0.98, g * 0.94));
        n++;
      }
    }
    mesh.count = n;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.rocks = mesh;
  }

  // Sparse grass tufts, flowers and pebbles, fixed per tile.
  buildClutter(geo) {
    const { map, ctx } = this;
    const tufts = [];
    const flowers = [];
    const pebbles = [];
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.get(x, y);
        const k = y * map.w + x;
        if (t === T.GRASS) {
          if (hash(k * 37) < 0.55) tufts.push([x + 0.15 + hash(k * 41) * 0.7, y + 0.15 + hash(k * 43) * 0.7, k]);
          if (hash(k * 47) < 0.12) flowers.push([x + 0.2 + hash(k * 53) * 0.6, y + 0.2 + hash(k * 59) * 0.6, k]);
        } else if (t === T.DIRT && hash(k * 61) < 0.4) {
          pebbles.push([x + 0.2 + hash(k * 67) * 0.6, y + 0.2 + hash(k * 71) * 0.6, k]);
        } else if (t === T.TREE && hash(k * 73) < 0.18) {
          flowers.push([x + 0.1 + hash(k * 79) * 0.8, y + 0.85, k]);
        }
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const place = (list, g, scaleFn, colorFn) => {
      const mesh = new THREE.InstancedMesh(g, this.treeMat, Math.max(1, list.length));
      list.forEach(([px, pz, k], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(k * 83) * 6.28);
        const sc = scaleFn(k);
        s.set(sc, sc, sc);
        m.compose(new THREE.Vector3(px, ctx.heightAt(px, pz) - 0.01, pz), q, s);
        mesh.setMatrixAt(i, m);
        if (colorFn) mesh.setColorAt(i, colorFn(k, col));
      });
      mesh.count = list.length;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    this.tufts = place(tufts, geo(tuftGeometry()), (k) => 0.8 + hash(k * 89) * 0.7);
    this.flowers = place(
      flowers,
      geo(flowerGeometry()),
      (k) => 0.8 + hash(k * 97) * 0.5,
      (k, c) => c.set(FLOWER_COLORS[Math.floor(hash(k * 101) * FLOWER_COLORS.length)]),
    );
    this.pebbles = place(
      pebbles,
      geo(dodeca(0.06, SWATCH.rock, { sy: 0.6 })),
      (k) => 0.6 + hash(k * 103) * 0.9,
      (k, c) => c.setRGB(0.85 + hash(k) * 0.2, 0.82 + hash(k) * 0.2, 0.75 + hash(k) * 0.2),
    );
  }

  onTileChanged(x, y, tile) {
    const k = y * this.map.w + x;
    const tree = this.trees.get(k);
    if (!tree || tile === T.TREE) return;
    this.trees.delete(k);
    // Topple away from the camera's left, with a little variety.
    const a = hash(k * 107) * Math.PI * 2;
    this.falling.push({ tree, t: 0, axis: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) });
    this.addStump(x, y);
  }

  update(frame, clock) {
    if (!this.falling.length) return;
    const dt = Math.min(0.1, frame.dt || 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    for (const f of this.falling) {
      f.t += dt;
      const { tree } = f;
      // Ease into the fall, then sink and shrink away.
      const fall = Math.min(1, (f.t / 0.9) ** 2);
      const sink = Math.max(0, (f.t - 1.0) / 0.8);
      q.setFromAxisAngle(f.axis, fall * 1.45).multiply(tree.quat);
      p.set(tree.x, tree.y - sink * 0.6, tree.z);
      const s = Math.max(0.001, 1 - sink);
      m.compose(p, q, tree.scale.clone().multiplyScalar(s));
      tree.mesh.setMatrixAt(tree.index, m);
      tree.mesh.instanceMatrix.needsUpdate = true;
      if (sink >= 1) {
        m.makeScale(0, 0, 0);
        tree.mesh.setMatrixAt(tree.index, m);
        f.done = true;
      }
    }
    this.falling = this.falling.filter((f) => !f.done);
    void clock;
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    this.treeMat.dispose();
    this.group.traverse((o) => o.isInstancedMesh && o.dispose());
  }
}
