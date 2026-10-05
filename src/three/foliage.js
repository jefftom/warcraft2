// PLACEHOLDER: replaced by the real foliage layer. Interface:
//   new FoliageLayer(ctx)            build props for the initial map
//   onTileChanged(x, y, tile)        a tile changed (tree felled -> stump)
//   update(frame, clock)             per-frame animation
//   dispose()
import * as THREE from 'three';
import { T } from '../config.js';
import { cone, cyl, merge } from './geo.js';
import { SWATCH } from './palette.js';

export class FoliageLayer {
  constructor(ctx) {
    this.ctx = ctx;
    const { map } = ctx.game;
    const trees = [];
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.isTree(x, y)) trees.push([x, y]);
    const geo = merge([cyl(0.08, 0.1, 0.4, 5, SWATCH.bark, { y: 0.2 }), cone(0.45, 1.3, 6, SWATCH.pine, { y: 1.0 })]);
    this.trees = new THREE.InstancedMesh(geo, ctx.palette.matte, trees.length);
    this.index = new Map();
    const m = new THREE.Matrix4();
    trees.forEach(([x, y], i) => {
      m.makeTranslation(x + 0.5, ctx.heightAt(x + 0.5, y + 0.5), y + 0.5);
      this.trees.setMatrixAt(i, m);
      this.index.set(y * map.w + x, i);
    });
    this.trees.castShadow = true;
    this.trees.receiveShadow = true;
    ctx.scene.add(this.trees);
  }

  onTileChanged(x, y, tile) {
    const i = this.index.get(y * this.ctx.game.map.w + x);
    if (i === undefined || tile === T.TREE) return;
    this.trees.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    this.trees.instanceMatrix.needsUpdate = true;
  }

  update() {}

  dispose() {
    this.trees.removeFromParent();
    this.trees.geometry.dispose();
  }
}
