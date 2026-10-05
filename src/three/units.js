// PLACEHOLDER: replaced by the real unit layer. Interface:
//   new UnitLayer(ctx)
//   sync(frame, clock)     create/update/remove a model per visible unit
//   metrics(unit)          { height, radius } in world units, for picking and bars
//   dispose()
// Also exports createUnitModel(type, owner) -> THREE.Object3D (used for corpses).
import * as THREE from 'three';
import { TILE } from '../config.js';
import { cyl, sphere, merge } from './geo.js';
import { SWATCH, teamColors } from './palette.js';

const cache = new Map();
function unitGeometry(type, owner) {
  const key = `${type}:${owner}`;
  if (!cache.has(key)) {
    const tc = teamColors(owner);
    cache.set(key, merge([cyl(0.18, 0.22, 0.5, 8, tc.main, { y: 0.3 }), sphere(0.14, 8, 6, SWATCH.skin, { y: 0.68 })]));
  }
  return cache.get(key);
}

export function createUnitModel(type, owner, palette) {
  return new THREE.Mesh(unitGeometry(type, owner), palette.matte);
}

export class UnitLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.models = new Map();
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
  }

  metrics(u) {
    return u.type === 'knight' ? { height: 1.2, radius: 0.5 } : { height: 0.85, radius: 0.3 };
  }

  sync() {
    const { game } = this.ctx;
    const seen = new Set();
    for (const u of game.units) {
      if (!this.ctx.visible(u)) continue;
      seen.add(u.id);
      let m = this.models.get(u.id);
      if (!m) {
        m = createUnitModel(u.type, u.owner, this.ctx.palette);
        m.castShadow = true;
        this.models.set(u.id, m);
        this.group.add(m);
      }
      const x = u.x / TILE;
      const z = u.y / TILE;
      m.position.set(x, this.ctx.heightAt(x, z), z);
    }
    for (const [id, m] of this.models) {
      if (!seen.has(id)) {
        m.removeFromParent();
        this.models.delete(id);
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}
