// Tile map storage and a seeded, point-symmetric map generator so both
// sides always get an equally fair start.

import { T, TREE_WOOD, MAP_SIZE, BUILDINGS } from './config.js';

export class GameMap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.wood = new Uint8Array(w * h);
    this.variant = new Uint8Array(w * h);
    // Indices of tiles whose terrain changed; the renderer drains this.
    this.dirty = [];
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x, y) {
    return this.inBounds(x, y) ? this.tiles[y * this.w + x] : T.ROCK;
  }

  set(x, y, t) {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    this.tiles[i] = t;
    this.wood[i] = t === T.TREE ? TREE_WOOD : 0;
    this.dirty.push(i);
  }

  isTree(x, y) {
    return this.get(x, y) === T.TREE;
  }

  isWalkable(x, y) {
    const t = this.get(x, y);
    return t === T.GRASS || t === T.STUMP || t === T.DIRT;
  }

  isBuildable(x, y) {
    return this.isWalkable(x, y);
  }
}

function stamp(map, rng, cx, cy, r, type) {
  const R = Math.ceil(r + 1);
  for (let y = Math.floor(cy) - R; y <= Math.ceil(cy) + R; y++) {
    for (let x = Math.floor(cx) - R; x <= Math.ceil(cx) + R; x++) {
      if (!map.inBounds(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r + (rng() - 0.5) * 1.4) map.tiles[y * map.w + x] = type;
    }
  }
}

function clearCircle(map, cx, cy, r, type = T.GRASS) {
  const R = Math.ceil(r);
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      if (map.inBounds(x, y) && Math.hypot(x - cx, y - cy) <= r) map.tiles[y * map.w + x] = type;
    }
  }
}

function mirrorRect(map, r) {
  return { x: map.w - r.w - r.x, y: map.h - r.h - r.y, w: r.w, h: r.h };
}

// Flood fill over walkable tiles, treating the given rectangles as solid.
function reachable(map, sx, sy, solids) {
  const blocked = new Uint8Array(map.w * map.h);
  for (const r of solids) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) blocked[y * map.w + x] = 1;
  }
  const seen = new Uint8Array(map.w * map.h);
  const queue = [sy * map.w + sx];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop();
    const x = i % map.w;
    const y = (i / map.w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (!map.inBounds(nx, ny)) continue;
        const ni = ny * map.w + nx;
        if (seen[ni] || blocked[ni] || !map.isWalkable(nx, ny)) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
  }
  return seen;
}

function touchesReachable(map, seen, r) {
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (map.inBounds(x, y) && seen[y * map.w + x]) return true;
    }
  }
  return false;
}

function carve(map, ax, ay, bx, by) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(ax + ((bx - ax) * s) / steps);
    const y = Math.round(ay + ((by - ay) * s) / steps);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (map.inBounds(x + ox, y + oy) && !map.isWalkable(x + ox, y + oy)) map.tiles[(y + oy) * map.w + x + ox] = T.GRASS;
      }
    }
  }
}

export function generateMap(rng, size = MAP_SIZE) {
  const w = size;
  const h = size;
  const map = new GameMap(w, h);
  for (let i = 0; i < w * h; i++) map.variant[i] = Math.floor(rng() * 256);

  // Thick forest along the map border.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge < 2 + rng() * 2.2) map.tiles[y * w + x] = T.TREE;
    }
  }
  // Scattered woods, lakes, rocky outcrops and dirt patches.
  const area = w * h;
  for (let i = 0; i < area / 170; i++) stamp(map, rng, rng() * w, rng() * h, 1.5 + rng() * 4, T.TREE);
  for (let i = 0; i < area / 1600; i++) stamp(map, rng, 10 + rng() * (w - 20), 10 + rng() * (h - 20), 2.2 + rng() * 2.5, T.WATER);
  for (let i = 0; i < area / 1300; i++) stamp(map, rng, rng() * w, rng() * h, 0.8 + rng() * 1.3, T.ROCK);
  for (let i = 0; i < area / 260; i++) stamp(map, rng, rng() * w, rng() * h, 0.6 + rng() * 1.8, T.DIRT);

  // Player base in the top-left; everything gets mirrored for the enemy.
  const th = BUILDINGS.townhall.size;
  const ms = BUILDINGS.goldmine.size;
  const base = { x: 7 + rng.int(0, 2), y: 7 + rng.int(0, 2), w: th, h: th };
  const mineRight = rng() < 0.5;
  const homeMine = mineRight
    ? { x: base.x + th + 4, y: base.y + rng.int(0, 1), w: ms, h: ms }
    : { x: base.x + rng.int(0, 1), y: base.y + th + 4, w: ms, h: ms };
  const expansions = [
    { x: w - 15 + rng.int(-1, 1), y: 7 + rng.int(-1, 2), w: ms, h: ms },
    { x: Math.floor(w / 2) - 13 + rng.int(-2, 2), y: Math.floor(h / 2) - 8 + rng.int(-1, 1), w: ms, h: ms },
  ];

  const center = (r) => ({ x: r.x + r.w / 2 - 0.5, y: r.y + r.h / 2 - 0.5 });
  const bc = center(base);
  clearCircle(map, bc.x, bc.y, 7.5);
  const mc = center(homeMine);
  clearCircle(map, mc.x, mc.y, 3.2);
  clearCircle(map, mc.x, mc.y, 2.2, T.DIRT);
  for (const e of expansions) {
    const ec = center(e);
    clearCircle(map, ec.x, ec.y, 4.5);
    clearCircle(map, ec.x, ec.y, 2.2, T.DIRT);
  }
  // A reliable patch of lumber near the base, on the side away from the mine.
  const woodX = mineRight ? bc.x - 1 : bc.x + 9;
  const woodY = mineRight ? bc.y + 9.5 : bc.y - 1;
  stamp(map, rng, woodX, woodY, 2.6, T.TREE);

  // Point symmetry: copy the first half of the map onto the second half.
  const N = w * h;
  for (let i = 0; i < N / 2; i++) {
    map.tiles[N - 1 - i] = map.tiles[i];
  }

  const enemyBase = mirrorRect(map, base);
  const mines = [homeMine, ...expansions];
  for (const m of [homeMine, ...expansions]) mines.push(mirrorRect(map, m));

  // Make sure both bases and every mine can be reached on foot.
  for (let attempt = 0; attempt < 6; attempt++) {
    const solids = [base, enemyBase, ...mines];
    const startTile = { x: base.x + th, y: base.y + th };
    if (!map.isWalkable(startTile.x, startTile.y)) map.tiles[startTile.y * w + startTile.x] = T.GRASS;
    const seen = reachable(map, startTile.x, startTile.y, solids);
    const targets = [enemyBase, ...mines].filter((r) => !touchesReachable(map, seen, r));
    if (targets.length === 0) break;
    for (const t of targets) {
      const tc = center(t);
      carve(map, bc.x, bc.y, tc.x, tc.y);
    }
  }

  // Tree tiles need their lumber value.
  for (let i = 0; i < N; i++) map.wood[i] = map.tiles[i] === T.TREE ? TREE_WOOD : 0;

  return {
    map,
    starts: [base, enemyBase],
    mines,
  };
}
