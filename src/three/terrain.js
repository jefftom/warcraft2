// Ground mesh, lakes and the dark skirt around the map.
//
// The ground is one grid mesh with a vertex at every tile corner, painted with
// the same procedural tile art the classic view uses (minus trees and rocks,
// which are real 3D props here). Lake beds are pushed down and covered by an
// animated water surface.

import * as THREE from 'three';
import { T, TILE } from '../config.js';
import { drawTileBase, makeCanvas } from '../sprites.js';
import { hash } from './geo.js';

const WATER_LEVEL = -0.2;

export class Terrain {
  /** @param {import('./index.js').LayerContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    const { map } = ctx.game;
    this.w = map.w;
    this.h = map.h;
    this.heights = this.computeHeights(map);
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.buildGround(ctx, map);
    this.buildWater(ctx, map);
    this.buildSkirt(ctx);
  }

  computeHeights(map) {
    const W = map.w + 1;
    const H = map.h + 1;
    const hts = new Float32Array(W * H);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        // Gentle rolling ground.
        let v = 0.07 * Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4) + 0.05 * Math.sin((x + z) * 0.11 + 2.1);
        // Lake beds: the more water tiles share this corner, the deeper.
        let water = 0;
        let rock = 0;
        for (const [dx, dz] of [
          [-1, -1],
          [0, -1],
          [-1, 0],
          [0, 0],
        ]) {
          const t = map.get(x + dx, z + dz);
          if (t === T.WATER) water++;
          if (t === T.ROCK) rock++;
        }
        if (water) v = Math.min(v, WATER_LEVEL + 0.12) - 0.55 * (water / 4) ** 0.8;
        else v += rock * 0.05 + (hash(x * 977 + z * 131) - 0.5) * 0.03;
        hts[z * W + x] = v;
      }
    }
    return hts;
  }

  /** Ground height at world position (x, z); x/z are in tiles. */
  heightAt(x, z) {
    const W = this.w + 1;
    const cx = Math.max(0, Math.min(this.w - 0.001, x));
    const cz = Math.max(0, Math.min(this.h - 0.001, z));
    const x0 = Math.floor(cx);
    const z0 = Math.floor(cz);
    const fx = cx - x0;
    const fz = cz - z0;
    const h = this.heights;
    const a = h[z0 * W + x0];
    const b = h[z0 * W + x0 + 1];
    const c = h[(z0 + 1) * W + x0];
    const d = h[(z0 + 1) * W + x0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  paintGround(map) {
    const canvas = makeCanvas(map.w * TILE, map.h * TILE);
    const g = canvas.getContext('2d');
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.get(x, y);
        if (t === T.ROCK || t === T.TREE) {
          // Paint plain ground beneath props; they are modelled in 3D.
          const saved = map.tiles[y * map.w + x];
          map.tiles[y * map.w + x] = T.GRASS;
          drawTileBase(g, map, x, y);
          map.tiles[y * map.w + x] = saved;
          if (t === T.TREE) {
            // Forest floor: shaded, with fallen needles.
            g.fillStyle = 'rgba(18,34,10,0.42)';
            g.fillRect(x * TILE, y * TILE, TILE, TILE);
            for (let k = 0; k < 6; k++) {
              const r = hash(y * map.w + x + k * 7919);
              g.fillStyle = r > 0.5 ? 'rgba(110,80,40,0.35)' : 'rgba(40,70,25,0.4)';
              g.fillRect(x * TILE + hash(k * 13 + x) * 28, y * TILE + r * 28, 3, 2);
            }
          } else {
            g.fillStyle = 'rgba(120,110,95,0.35)';
            g.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        } else {
          drawTileBase(g, map, x, y);
        }
      }
    }
    return canvas;
  }

  buildGround(ctx, map) {
    const W = map.w + 1;
    const H = map.h + 1;
    const pos = new Float32Array(W * H * 3);
    const uv = new Float32Array(W * H * 2);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        pos[i * 3] = x;
        pos[i * 3 + 1] = this.heights[i];
        pos[i * 3 + 2] = z;
        uv[i * 2] = x / map.w;
        uv[i * 2 + 1] = z / map.h;
      }
    }
    const index = [];
    for (let z = 0; z < map.h; z++) {
      for (let x = 0; x < map.w; x++) {
        const a = z * W + x;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();

    const tex = new THREE.CanvasTexture(this.paintGround(map));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.groundTexture = tex;
    const mat = ctx.fog.patch(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }), { key: 'ground' });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.group.add(this.ground);
  }

  buildWater(ctx, map) {
    // A tiling normal map from summed waves gives the surface its glints.
    const S = 128;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const height = (x, y) =>
      Math.sin((x / S) * Math.PI * 2 * 3 + Math.sin((y / S) * Math.PI * 2 * 2)) * 0.5 +
      Math.sin((y / S) * Math.PI * 2 * 4 + (x / S) * Math.PI * 2) * 0.35 +
      Math.sin(((x + y) / S) * Math.PI * 2 * 5) * 0.15;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = height(x + 1, y) - height(x - 1, y);
        const dy = height(x, y + 1) - height(x, y - 1);
        const n = new THREE.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize();
        const i = (y * S + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255;
        img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
        img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const normal = new THREE.CanvasTexture(c);
    normal.wrapS = THREE.RepeatWrapping;
    normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(map.w / 3, map.h / 3);
    this.waterNormal = normal;

    let any = false;
    for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === T.WATER) any = true;
    if (!any) return;
    const mat = ctx.fog.patch(
      new THREE.MeshStandardMaterial({
        color: 0x2f6c98,
        roughness: 0.18,
        metalness: 0.05,
        transparent: true,
        opacity: 0.86,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.45, 0.45),
      }),
      { key: 'water' },
    );
    const geo = new THREE.PlaneGeometry(map.w, map.h);
    geo.rotateX(-Math.PI / 2);
    geo.translate(map.w / 2, WATER_LEVEL, map.h / 2);
    this.water = new THREE.Mesh(geo, mat);
    this.water.receiveShadow = true;
    this.water.renderOrder = 2;
    this.group.add(this.water);
  }

  buildSkirt(ctx) {
    // Dark woodland floor beyond the map edge, so the camera never sees a void.
    const geo = new THREE.PlaneGeometry(this.w + 120, this.h + 120);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.w / 2, -0.35, this.h / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0b0d07 });
    this.skirt = new THREE.Mesh(geo, mat);
    this.group.add(this.skirt);
  }

  update(clock) {
    if (this.waterNormal) {
      this.waterNormal.offset.set(clock * 0.012, clock * 0.007);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.groundTexture.dispose();
    if (this.waterNormal) this.waterNormal.dispose();
  }
}

export { WATER_LEVEL };
