// PLACEHOLDER: replaced by the real building layer. Interface:
//   new BuildingLayer(ctx)
//   sync(frame, clock)     create/update/remove a model per visible building
//   metrics(building)      { height } in world units, for picking and bars
//   dispose()
// Also exports createBuildingModel(type, owner, palette) -> THREE.Object3D
// (used for the placement preview).
import * as THREE from 'three';
import { box, pyramid, merge } from './geo.js';
import { SWATCH, teamColors } from './palette.js';

const HEIGHT = { townhall: 2.6, farm: 1.2, barracks: 1.8, lumbermill: 1.6, blacksmith: 1.6, tower: 2.6, goldmine: 1.4 };
const SIZE = { townhall: 4, farm: 2, barracks: 3, lumbermill: 3, blacksmith: 3, tower: 2, goldmine: 3 };

export function createBuildingModel(type, owner, palette) {
  const s = SIZE[type];
  const h = HEIGHT[type];
  const tc = teamColors(owner);
  const geo = merge([box(s * 0.85, h * 0.6, s * 0.85, type === 'goldmine' ? SWATCH.rock : SWATCH.stone, { y: h * 0.3 }), pyramid(s * 0.95, s * 0.95, h * 0.4, type === 'goldmine' ? SWATCH.rockDark : tc.main, { y: h * 0.6 })]);
  const mesh = new THREE.Mesh(geo, palette.matte);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class BuildingLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.models = new Map();
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
  }

  metrics(b) {
    return { height: HEIGHT[b.type] || 1.5 };
  }

  sync() {
    const { game } = this.ctx;
    const seen = new Set();
    for (const b of game.buildings) {
      if (!this.ctx.visible(b)) continue;
      seen.add(b.id);
      let m = this.models.get(b.id);
      if (!m) {
        m = createBuildingModel(b.type, b.owner, this.ctx.palette);
        this.models.set(b.id, m);
        this.group.add(m);
      }
      const cx = b.x + b.size / 2;
      const cz = b.y + b.size / 2;
      m.position.set(cx, this.ctx.heightAt(cx, cz), cz);
      m.scale.y = b.constructing ? Math.max(0.1, b.progress) : 1;
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
