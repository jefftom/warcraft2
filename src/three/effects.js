// PLACEHOLDER: replaced by the real effects layer. Interface:
//   new EffectsLayer(ctx)
//   sync(frame, clock)     projectiles, game.effects, selection rings, markers,
//                          rally flag and the building placement preview
//   dispose()
import * as THREE from 'three';
import { TILE, PLAYER, NEUTRAL } from '../config.js';

export class EffectsLayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.ringGeo = new THREE.RingGeometry(0.34, 0.42, 24);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.mats = {
      own: ctx.palette.overlay(0x46ff63, 0.9),
      foe: ctx.palette.overlay(0xff4a3d, 0.9),
      neutral: ctx.palette.overlay(0xffe14a, 0.9),
    };
    this.rings = [];
    this.boltGeo = new THREE.BoxGeometry(0.05, 0.05, 0.4);
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0x5a3d22 });
    this.bolts = [];
  }

  sync(frame) {
    const { game, heightAt } = this.ctx;
    for (const r of this.rings) r.removeFromParent();
    this.rings.length = 0;
    for (const id of frame.selection) {
      const e = game.get(id);
      if (!e || !this.ctx.visible(e)) continue;
      const mat = e.owner === PLAYER ? this.mats.own : e.owner === NEUTRAL ? this.mats.neutral : this.mats.foe;
      const ring = new THREE.Mesh(this.ringGeo, mat);
      const x = e.kind === 'building' ? e.x + e.size / 2 : e.x / TILE;
      const z = e.kind === 'building' ? e.y + e.size / 2 : e.y / TILE;
      const s = e.kind === 'building' ? e.size * 1.3 : e.type === 'knight' ? 1.5 : 1;
      ring.scale.set(s, 1, s);
      ring.position.set(x, heightAt(x, z) + 0.04, z);
      this.group.add(ring);
      this.rings.push(ring);
    }
    for (const b of this.bolts) b.removeFromParent();
    this.bolts.length = 0;
    for (const p of game.projectiles) {
      const m = new THREE.Mesh(this.boltGeo, this.boltMat);
      const x = p.x / TILE;
      const z = p.y / TILE;
      m.position.set(x, heightAt(x, z) + 0.6, z);
      m.rotation.y = -p.angle + Math.PI / 2;
      this.group.add(m);
      this.bolts.push(m);
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}
