// Ground mesh, lakes and the dark skirt around the map.
//
// The ground is one grid mesh with a vertex at every tile corner, painted with
// the same procedural tile art the classic view uses (minus trees and rocks,
// which are real 3D props here). Lake beds are pushed down and covered by an
// animated water surface.

import * as THREE from 'three';
import { T, TILE } from '../config.js';
import { makeCanvas } from '../sprites.js';
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
    this.buildSkirt();
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

  // Paints the ground one pixel at a time from smooth fields rather than tile
  // by tile, so there is no checkerboard: grass shade drifts with noise, and
  // dirt, forest floor, shore sand and gravel blend in with ragged soft edges.
  paintGround(map) {
    const S = TILE;
    const W = map.w * S;
    const H = map.h * S;
    const canvas = makeCanvas(W, H);
    const g = canvas.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;

    // Per-tile indicator fields, sampled bilinearly between tile centres.
    const field = (pred) => {
      const f = new Float32Array(map.w * map.h);
      for (let i = 0; i < f.length; i++) f[i] = pred(map.tiles[i]) ? 1 : 0;
      return f;
    };
    const dirt = field((t) => t === T.DIRT);
    const tree = field((t) => t === T.TREE);
    const water = field((t) => t === T.WATER);
    const rock = field((t) => t === T.ROCK);
    const sample = (f, fx, fy) => {
      const x = Math.min(map.w - 1.001, Math.max(0, fx - 0.5));
      const y = Math.min(map.h - 1.001, Math.max(0, fy - 0.5));
      const x0 = x | 0;
      const y0 = y | 0;
      const tx = x - x0;
      const ty = y - y0;
      const i = y0 * map.w + x0;
      const a = f[i] + (f[i + 1] - f[i]) * tx;
      const b = f[i + map.w] + (f[i + map.w + 1] - f[i + map.w]) * tx;
      return a + (b - a) * ty;
    };

    // Value noise on a lattice, smoothly interpolated.
    const lattice = (scale, seed) => {
      const lw = Math.ceil(map.w / scale) + 2;
      const lh = Math.ceil(map.h / scale) + 2;
      const v = new Float32Array(lw * lh);
      for (let i = 0; i < v.length; i++) v[i] = hash(i * 7919 + seed);
      return (fx, fy) => {
        const x = fx / scale;
        const y = fy / scale;
        const x0 = x | 0;
        const y0 = y | 0;
        let tx = x - x0;
        let ty = y - y0;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const i = y0 * lw + x0;
        const a = v[i] + (v[i + 1] - v[i]) * tx;
        const b = v[i + lw] + (v[i + lw + 1] - v[i + lw]) * tx;
        return a + (b - a) * ty;
      };
    };
    const broad = lattice(9, 11);
    const mid = lattice(2.5, 23);
    const fine = lattice(0.6, 37);

    const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const smooth = (e0, e1, x) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const GRASS_A = [70, 118, 40];
    const GRASS_B = [104, 148, 56];
    const GRASS_DRY = [128, 140, 62];
    const FOREST = [40, 64, 26];
    const NEEDLES = [86, 66, 38];
    const DIRT_A = [128, 96, 58];
    const DIRT_B = [156, 122, 78];
    const SAND = [204, 184, 130];
    const BED = [66, 92, 80];
    const GRAVEL = [132, 126, 114];

    for (let py = 0; py < H; py++) {
      const fy = (py + 0.5) / S;
      for (let px = 0; px < W; px++) {
        const fx = (px + 0.5) / S;
        const nb = broad(fx, fy);
        const nm = mid(fx, fy);
        const nf = fine(fx, fy);
        // Grass: broad drifts of lush and drier green.
        let c = mixc(GRASS_A, GRASS_B, smooth(0.25, 0.85, nb * 0.7 + nm * 0.3));
        c = mixc(c, GRASS_DRY, smooth(0.62, 0.95, nm) * 0.45);
        // Forest floor under trees, with fallen needles.
        const tr = smooth(0.25, 0.75, sample(tree, fx, fy) + (nm - 0.5) * 0.4);
        if (tr > 0) c = mixc(c, nf > 0.55 ? NEEDLES : FOREST, tr * 0.8);
        // Dirt patches with ragged edges.
        const dr = smooth(0.4, 0.6, sample(dirt, fx, fy) + (nm - 0.5) * 0.5 + (nf - 0.5) * 0.18);
        if (dr > 0) c = mixc(c, mixc(DIRT_A, DIRT_B, nf), dr);
        // Gravel around rocks.
        const rk = smooth(0.2, 0.7, sample(rock, fx, fy) + (nf - 0.5) * 0.4);
        if (rk > 0) c = mixc(c, GRAVEL, rk * 0.85);
        // Shores: sand at the waterline, a dark bed under the water.
        const wt = sample(water, fx, fy) + (nm - 0.5) * 0.18;
        if (wt > 0.08) {
          c = mixc(c, SAND, smooth(0.08, 0.3, wt));
          c = mixc(c, BED, smooth(0.42, 0.75, wt));
        }
        // Per-pixel grain so close-ups are not smeared.
        const grain = 0.92 + hash(px * 73856093 ^ py * 19349663) * 0.16;
        const i = (py * W + px) * 4;
        d[i] = c[0] * grain;
        d[i + 1] = c[1] * grain;
        d[i + 2] = c[2] * grain;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // Hand-drawn detail on top: grass blades, pebbles and the odd flower.
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.get(x, y);
        if (t === T.WATER) continue;
        const k = y * map.w + x;
        for (let n = 0; n < 7; n++) {
          const r = hash(k * 31 + n * 7);
          const bx = x * S + hash(k * 13 + n * 3) * (S - 2);
          const by = y * S + r * (S - 4);
          if (t === T.DIRT || t === T.ROCK) {
            g.fillStyle = r > 0.5 ? 'rgba(80,60,36,0.45)' : 'rgba(190,165,120,0.4)';
            g.fillRect(bx, by, 2, 2);
          } else {
            g.fillStyle = r > 0.5 ? 'rgba(150,190,80,0.35)' : 'rgba(30,60,20,0.35)';
            g.fillRect(bx, by, 1, 3);
          }
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

  buildSkirt() {
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
