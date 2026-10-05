// Brick-style ground: one big baseplate. Studs come from a tiling normal map
// (real stud geometry across the whole map would be millions of triangles);
// colours are laid out as plates, with tan paths and darker green patches;
// lakes are glossy transparent-blue tiles over a deep bed.

import * as THREE from 'three';
import { T } from '../../config.js';
import { makeCanvas } from '../../sprites.js';
import { hash } from '../geo.js';
import { BRICK_COLORS, PLATE, merge, rbox } from './kit.js';

const STUDS_PER_TILE = 5;

function studNormalMap() {
  const S = 64;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const R = S * 0.3;
  const height = (x, y) => {
    const d = Math.hypot(x - S / 2, y - S / 2);
    // A flat-topped cylinder with a slightly rounded rim.
    return d < R - 2 ? 1 : d < R + 1 ? Math.max(0, (R + 1 - d) / 3) : 0;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = height(x + 1, y) - height(x - 1, y);
      const dy = height(x, y + 1) - height(x, y - 1);
      const n = new THREE.Vector3(-dx * 3.2, -dy * 3.2, 1).normalize();
      const i = (y * S + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class BrickTerrain {
  constructor(ctx) {
    this.ctx = ctx;
    const { map } = ctx.game;
    this.w = map.w;
    this.h = map.h;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);

    // Plate colours, painted at a few pixels per stud with seams between plates.
    const P = 4;
    const S = STUDS_PER_TILE * P;
    const canvas = makeCanvas(map.w * S, map.h * S);
    const g = canvas.getContext('2d');
    const tileColor = (x, y) => {
      const t = map.get(x, y);
      if (t === T.WATER) return '#163a5c';
      if (t === T.DIRT) return BRICK_COLORS.tan;
      if (t === T.ROCK) return BRICK_COLORS.lightGrey;
      if (t === T.TREE) return BRICK_COLORS.darkGreen;
      // Patchwork of greens in 2x2-tile plates.
      const p = hash(Math.floor(x / 2) * 7919 + Math.floor(y / 2) * 104729);
      return p < 0.07 ? '#469c47' : p > 0.95 ? '#367a38' : BRICK_COLORS.green;
    };
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const c = tileColor(x, y);
        g.fillStyle = c;
        g.fillRect(x * S, y * S, S, S);
        // A dark seam where the colour changes, like neighbouring plates.
        g.fillStyle = 'rgba(0,0,0,0.28)';
        if (tileColor(x - 1, y) !== c) g.fillRect(x * S, y * S, 2, S);
        if (tileColor(x, y - 1) !== c) g.fillRect(x * S, y * S, S, 2);
      }
    }
    const colorTex = new THREE.CanvasTexture(canvas);
    colorTex.colorSpace = THREE.SRGBColorSpace;
    colorTex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
    this.colorTex = colorTex;
    this.normalTex = studNormalMap();
    this.normalTex.repeat.set(map.w * STUDS_PER_TILE, map.h * STUDS_PER_TILE);
    this.normalTex.anisotropy = colorTex.anisotropy;

    const geo = new THREE.PlaneGeometry(map.w, map.h);
    geo.rotateX(-Math.PI / 2);
    geo.translate(map.w / 2, 0, map.h / 2);
    // PlaneGeometry's v runs bottom-up after the rotation; flip to match rows.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    colorTex.flipY = false;
    const mat = ctx.fog.patch(
      new THREE.MeshPhysicalMaterial({
        map: colorTex,
        normalMap: this.normalTex,
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 0.62,
        clearcoat: 0.12,
        clearcoatRoughness: 0.4,
      }),
      { key: 'baseplate' },
    );
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    // Water: a layer of transparent blue tiles over the dark bed.
    const tiles = [];
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (map.get(x, y) === T.WATER) tiles.push(rbox(0.98, PLATE, 0.98, BRICK_COLORS.transBlue, { x: x + 0.5, y: PLATE / 2, z: y + 0.5 }, 0.01));
      }
    }
    if (tiles.length) {
      const water = new THREE.Mesh(
        merge(tiles),
        ctx.fog.patch(
          new THREE.MeshPhysicalMaterial({ vertexColors: true, transparent: true, opacity: 0.72, roughness: 0.28, clearcoat: 0.25, clearcoatRoughness: 0.25 }),
          { key: 'brick-water' },
        ),
      );
      water.renderOrder = 2;
      water.receiveShadow = true;
      this.group.add(water);
      this.water = water;
    }

    // The table beyond the baseplate.
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(map.w + 160, map.h + 160).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a120c }));
    skirt.position.set(map.w / 2, -0.03, map.h / 2);
    this.group.add(skirt);
  }

  heightAt() {
    return 0;
  }

  update() {}

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.colorTex.dispose();
    this.normalTex.dispose();
  }
}
