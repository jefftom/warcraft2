// Procedural art. Every unit, building and terrain tile is drawn with canvas
// primitives, so the game needs no image assets. Buildings are cached per
// type/team; units are cheap enough to draw live (they animate).

import { TILE, T, TEAM_COLORS, NEUTRAL } from './config.js';

const SKIN = '#e8b98f';

function team(owner) {
  return TEAM_COLORS[owner] || TEAM_COLORS[NEUTRAL];
}

function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

// ---------------------------------------------------------------------------
// Terrain

const GRASS = ['#4f7d2f', '#4b792c', '#537f31', '#4d7a2e'];

export function drawTileBase(ctx, map, x, y) {
  const i = y * map.w + x;
  const t = map.tiles[i];
  const v = map.variant[i];
  const px = x * TILE;
  const py = y * TILE;

  if (t === T.WATER) {
    drawWater(ctx, map, x, y, px, py, v);
    return;
  }
  const dirt = t === T.DIRT;
  rect(ctx, px, py, TILE, TILE, dirt ? (v & 1 ? '#8b6c43' : '#87683f') : GRASS[v & 3]);
  // Speckles and grass blades.
  for (let k = 0; k < 5; k++) {
    const r = hash(i * 7 + k);
    const sx = px + Math.floor(hash(i * 13 + k * 3) * 30);
    const sy = py + Math.floor(r * 30);
    if (dirt) rect(ctx, sx, sy, 2, 2, r > 0.5 ? '#7a5c36' : '#9c7c50');
    else {
      ctx.fillStyle = r > 0.5 ? '#5f8f39' : '#43702a';
      ctx.fillRect(sx, sy, 1, 3);
    }
  }
  if (!dirt) {
    // Soften the border with neighbouring dirt.
    blendEdges(ctx, map, x, y, px, py, i);
    if ((v & 31) === 3) {
      // Occasional flowers.
      rect(ctx, px + 8 + (v & 7), py + 10, 2, 2, '#e9e37a');
      rect(ctx, px + 20, py + 18 - (v & 3), 2, 2, '#f2f2f2');
    }
  }
  if (t === T.STUMP) {
    ellipse(ctx, px + 16, py + 20, 7, 4, 'rgba(0,0,0,0.25)');
    ellipse(ctx, px + 16, py + 17, 6, 4, '#6b4a2a');
    ellipse(ctx, px + 16, py + 16, 5, 3, '#c49a62');
    ctx.strokeStyle = '#8f6a3e';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 16, 2.5, 1.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (t === T.ROCK) {
    drawRock(ctx, px, py, i);
  }
}

function blendEdges(ctx, map, x, y, px, py, i) {
  const nb = [
    [0, -1, px, py, TILE, 4],
    [0, 1, px, py + TILE - 4, TILE, 4],
    [-1, 0, px, py, 4, TILE],
    [1, 0, px + TILE - 4, py, 4, TILE],
  ];
  for (const [dx, dy, rx, ry, rw, rh] of nb) {
    if (map.get(x + dx, y + dy) !== T.DIRT) continue;
    for (let k = 0; k < 6; k++) {
      const a = hash(i * 31 + k * 5 + dx * 3 + dy * 11);
      const b = hash(i * 17 + k * 7 + dx * 5 + dy * 13);
      rect(ctx, rx + a * (rw - 3), ry + b * (rh - 2), 3, 3, '#87683f');
    }
  }
}

function drawRock(ctx, px, py, i) {
  const r = hash(i);
  ellipse(ctx, px + 16, py + 24, 14, 6, 'rgba(0,0,0,0.3)');
  poly(ctx, [px + 3, py + 25, px + 6, py + 10, px + 14, py + 4, px + 25, py + 7, px + 30, py + 18, px + 27, py + 26], '#7d7a73');
  poly(ctx, [px + 6, py + 10, px + 14, py + 4, px + 25, py + 7, px + 18, py + 13], '#9e9a91');
  poly(ctx, [px + 18, py + 13, px + 25, py + 7, px + 30, py + 18, px + 22, py + 20], '#6a675f');
  if (r > 0.5) poly(ctx, [px + 1, py + 30, px + 4, py + 22, px + 11, py + 22, px + 12, py + 30], '#86827a');
}

function drawWater(ctx, map, x, y, px, py, v) {
  rect(ctx, px, py, TILE, TILE, v & 1 ? '#2c5f8e' : '#2a5b8a');
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(px + (v % 20), py + ((v >> 3) % 26), 8, 1);
  const land = (dx, dy) => {
    const t = map.get(x + dx, y + dy);
    return t !== T.WATER;
  };
  const sand = '#c8b47c';
  const foam = 'rgba(220,235,245,0.55)';
  const S = 6;
  if (land(0, -1)) {
    rect(ctx, px, py, TILE, S, sand);
    rect(ctx, px, py + S, TILE, 2, foam);
  }
  if (land(0, 1)) {
    rect(ctx, px, py + TILE - S, TILE, S, sand);
    rect(ctx, px, py + TILE - S - 2, TILE, 2, foam);
  }
  if (land(-1, 0)) {
    rect(ctx, px, py, S, TILE, sand);
    rect(ctx, px + S, py, 2, TILE, foam);
  }
  if (land(1, 0)) {
    rect(ctx, px + TILE - S, py, S, TILE, sand);
    rect(ctx, px + TILE - S - 2, py, 2, TILE, foam);
  }
  for (const [dx, dy, cx, cy] of [
    [-1, -1, px, py],
    [1, -1, px + TILE - S, py],
    [-1, 1, px, py + TILE - S],
    [1, 1, px + TILE - S, py + TILE - S],
  ]) {
    if (land(dx, dy) && !land(dx, 0) && !land(0, dy)) rect(ctx, cx, cy, S, S, sand);
  }
}

// Trees are drawn in a second pass so their canopies may overlap neighbours.
export function drawTree(ctx, map, x, y) {
  const i = y * map.w + x;
  const px = x * TILE + 16 + (hash(i * 3) - 0.5) * 6;
  const py = y * TILE + 16 + (hash(i * 5) - 0.5) * 4;
  const pine = hash(i * 11) > 0.55;
  ellipse(ctx, px + 3, py + 12, 12, 5, 'rgba(0,0,0,0.28)');
  rect(ctx, px - 2, py + 4, 4, 9, '#5a3d22');
  if (pine) {
    poly(ctx, [px, py - 16, px + 12, py + 6, px - 12, py + 6], '#24502a');
    poly(ctx, [px, py - 16, px + 12, py + 6, px, py + 6], '#1c4122');
    poly(ctx, [px, py - 10, px + 9, py - 1, px - 9, py - 1], '#2f6634');
    poly(ctx, [px, py - 10, px - 9, py - 1, px - 2, py - 1], '#3b7a3e');
  } else {
    ellipse(ctx, px, py + 1, 13, 11, '#2b5a1f');
    ellipse(ctx, px - 4, py - 3, 9, 8, '#3a7228');
    ellipse(ctx, px + 5, py - 4, 8, 7, '#356a25');
    ellipse(ctx, px - 2, py - 8, 7, 6, '#4a8a32');
    ellipse(ctx, px - 4, py - 9, 3, 2, '#62a544');
  }
}

export function drawWaterShimmer(ctx, map, x0, y0, x1, y1, time) {
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * map.w + x;
      if (map.tiles[i] !== T.WATER) continue;
      const ph = time * 1.3 + hash(i) * 6.28;
      const s = Math.sin(ph);
      if (s < 0.4) continue;
      ctx.fillRect(x * TILE + 8 + Math.cos(ph) * 5, y * TILE + 12 + (i % 3) * 5, 10 * s, 1.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Buildings

const buildingCache = new Map();

export function getBuildingSprite(type, owner) {
  const key = `${type}:${owner}`;
  let c = buildingCache.get(key);
  if (c) return c;
  const size = { townhall: 4, farm: 2, barracks: 3, lumbermill: 3, blacksmith: 3, tower: 2, goldmine: 3 }[type] || 2;
  c = makeCanvas(size * TILE, size * TILE + 24);
  const ctx = c.getContext('2d');
  ctx.translate(0, 24);
  BUILDING_DRAW[type](ctx, size * TILE, team(owner));
  buildingCache.set(key, c);
  return c;
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function stoneWall(ctx, x, y, w, h, base = '#8d877c') {
  rect(ctx, x, y, w, h, base);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let row = 0; row * 7 < h; row++) {
    ctx.fillRect(x, y + row * 7, w, 1);
    for (let col = (row % 2) * 6; col < w; col += 12) ctx.fillRect(x + col, y + row * 7, 1, 7);
  }
  rect(ctx, x, y, w, 2, 'rgba(255,255,255,0.15)');
}

function plankWall(ctx, x, y, w, h, base = '#8a5f37') {
  rect(ctx, x, y, w, h, base);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let col = 0; col < w; col += 6) ctx.fillRect(x + col, y, 1, h);
}

function gableRoof(ctx, x, y, w, h, color, dark) {
  poly(ctx, [x - 4, y + h, x + w / 2, y, x + w + 4, y + h], color);
  poly(ctx, [x + w / 2, y, x + w + 4, y + h, x + w / 2, y + h], dark);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  for (let k = 1; k < 5; k++) {
    const yy = y + (h * k) / 5;
    const half = ((w / 2 + 4) * k) / 5;
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - half, yy);
    ctx.lineTo(x + w / 2 + half, yy);
    ctx.stroke();
  }
}

function hipRoof(ctx, x, y, w, h, ridge, color, dark) {
  const r0 = x + (w - ridge) / 2;
  poly(ctx, [x - 4, y + h, r0, y, r0 + ridge, y, x + w + 4, y + h], color);
  poly(ctx, [r0 + ridge, y, x + w + 4, y + h, x + w / 2 + ridge / 2, y + h], dark);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let k = 1; k < 4; k++) {
    const yy = y + (h * k) / 4;
    ctx.beginPath();
    ctx.moveTo(x - 4 + ((r0 - x + 4) * (4 - k)) / 4, yy);
    ctx.lineTo(x + w + 4 - ((x + w + 4 - r0 - ridge) * (4 - k)) / 4, yy);
    ctx.stroke();
  }
}

function door(ctx, x, y, w, h) {
  rect(ctx, x, y + w / 2, w, h - w / 2, '#3b2615');
  ellipse(ctx, x + w / 2, y + w / 2, w / 2, w / 2, '#3b2615');
  rect(ctx, x + w / 2 - 0.5, y + 2, 1, h - 2, '#24170c');
}

function windowAt(ctx, x, y, lit = true) {
  rect(ctx, x, y, 6, 7, '#2a2016');
  rect(ctx, x + 1, y + 1, 4, 5, lit ? '#f0c060' : '#3d4b5c');
  rect(ctx, x + 2.5, y + 1, 1, 5, '#2a2016');
}

function flag(ctx, x, y, tc) {
  rect(ctx, x, y, 2, 18, '#5a4630');
  poly(ctx, [x + 2, y + 1, x + 13, y + 4, x + 2, y + 8], tc.main);
  poly(ctx, [x + 2, y + 5, x + 13, y + 4, x + 2, y + 8], tc.dark);
}

function shadowBox(ctx, S) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(S / 2 + 4, S - 8, S / 2, S / 6, 0, 0, Math.PI * 2);
  ctx.fill();
}

const BUILDING_DRAW = {
  townhall(ctx, S, tc) {
    shadowBox(ctx, S);
    stoneWall(ctx, 8, 56, S - 16, S - 62);
    rect(ctx, 8, S - 10, S - 16, 4, 'rgba(0,0,0,0.25)');
    hipRoof(ctx, 8, 14, S - 16, 44, 40, tc.main, tc.dark);
    // Central keep with spire.
    stoneWall(ctx, S / 2 - 16, 4, 32, 54, '#9a9488');
    poly(ctx, [S / 2 - 20, 6, S / 2, -22, S / 2 + 20, 6], tc.main);
    poly(ctx, [S / 2, -22, S / 2 + 20, 6, S / 2, 6], tc.dark);
    flag(ctx, S / 2 - 1, -40, tc);
    windowAt(ctx, S / 2 - 3, 18);
    door(ctx, S / 2 - 9, S - 34, 18, 26);
    windowAt(ctx, 22, 70);
    windowAt(ctx, S - 28, 70);
    windowAt(ctx, 36, 72);
    windowAt(ctx, S - 42, 72);
    // Steps and torches.
    rect(ctx, S / 2 - 14, S - 9, 28, 4, '#a8a397');
    rect(ctx, S / 2 - 16, S - 34, 3, 8, '#5a4630');
    ellipse(ctx, S / 2 - 14.5, S - 36, 2.5, 3, '#ffb347');
    rect(ctx, S / 2 + 13, S - 34, 3, 8, '#5a4630');
    ellipse(ctx, S / 2 + 14.5, S - 36, 2.5, 3, '#ffb347');
  },

  farm(ctx, S, tc) {
    shadowBox(ctx, S);
    // Crop field.
    rect(ctx, 2, 30, 30, 30, '#7b5a34');
    for (let r = 0; r < 5; r++) {
      rect(ctx, 4, 33 + r * 6, 26, 3, r % 2 ? '#8fb04a' : '#a7c25a');
      for (let k = 0; k < 6; k++) rect(ctx, 5 + k * 4.4, 32 + r * 6, 2, 2, '#c8d870');
    }
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(2, 30, 30, 30);
    ctx.lineWidth = 1;
    // Cottage.
    plankWall(ctx, 32, 30, 28, 28, '#c9ad7a');
    gableRoof(ctx, 30, 6, 32, 26, '#c9a24a', '#a8842f');
    rect(ctx, 30, 30, 32, 3, tc.main);
    door(ctx, 41, 42, 9, 16);
    windowAt(ctx, 52, 38);
    rect(ctx, 52, 8, 5, 12, '#7d7468');
  },

  barracks(ctx, S, tc) {
    shadowBox(ctx, S);
    stoneWall(ctx, 6, 40, S - 12, S - 46);
    hipRoof(ctx, 6, 8, S - 12, 34, 50, tc.main, tc.dark);
    door(ctx, S / 2 - 9, S - 32, 18, 26);
    windowAt(ctx, 16, 54);
    windowAt(ctx, S - 22, 54);
    // Shield with crossed swords.
    ellipse(ctx, S / 2, 52, 9, 10, '#d9d3c4');
    ellipse(ctx, S / 2, 52, 7, 8, tc.main);
    ctx.strokeStyle = '#e6e6e6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 - 6, 45);
    ctx.lineTo(S / 2 + 6, 59);
    ctx.moveTo(S / 2 + 6, 45);
    ctx.lineTo(S / 2 - 6, 59);
    ctx.stroke();
    ctx.lineWidth = 1;
    flag(ctx, 12, -8, tc);
    flag(ctx, S - 18, -8, tc);
    // Weapon rack.
    rect(ctx, S - 20, S - 22, 12, 2, '#5a3d22');
    for (let k = 0; k < 3; k++) rect(ctx, S - 19 + k * 4, S - 30, 1, 10, '#cfcfcf');
  },

  lumbermill(ctx, S, tc) {
    shadowBox(ctx, S);
    plankWall(ctx, 8, 38, S - 30, S - 44, '#8a5f37');
    gableRoof(ctx, 6, 8, S - 26, 32, '#6b4a2a', '#563a20');
    rect(ctx, 4, 38, S - 22, 3, tc.main);
    door(ctx, 24, S - 30, 16, 24);
    windowAt(ctx, 50, 50);
    // Saw wheel.
    ellipse(ctx, S - 16, 48, 14, 14, '#9aa0a6');
    ellipse(ctx, S - 16, 48, 11, 11, '#c5cbd1');
    ctx.strokeStyle = '#6a7076';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(S - 16 + Math.cos(a) * 11, 48 + Math.sin(a) * 11);
      ctx.lineTo(S - 16 + Math.cos(a + 0.2) * 14, 48 + Math.sin(a + 0.2) * 14);
      ctx.stroke();
    }
    ellipse(ctx, S - 16, 48, 3, 3, tc.main);
    // Log pile.
    for (let k = 0; k < 3; k++) {
      ellipse(ctx, S - 30 + k * 9, S - 10, 4.5, 4.5, '#7a5230');
      ellipse(ctx, S - 30 + k * 9, S - 10, 2.5, 2.5, '#c49a62');
    }
    ellipse(ctx, S - 25, S - 17, 4.5, 4.5, '#7a5230');
    ellipse(ctx, S - 25, S - 17, 2.5, 2.5, '#c49a62');
  },

  blacksmith(ctx, S, tc) {
    shadowBox(ctx, S);
    stoneWall(ctx, 8, 36, S - 16, S - 42, '#7c766c');
    hipRoof(ctx, 8, 6, S - 16, 32, 30, '#5b6068', '#474b52');
    rect(ctx, 4, 36, S - 8, 3, tc.main);
    // Chimney.
    stoneWall(ctx, S - 30, -12, 12, 30, '#6d675e');
    // Forge glow.
    rect(ctx, 16, S - 34, 22, 26, '#2a1a10');
    rect(ctx, 19, S - 26, 16, 14, '#ff7a1a');
    rect(ctx, 22, S - 22, 10, 8, '#ffd04a');
    door(ctx, S - 36, S - 32, 16, 26);
    // Anvil.
    rect(ctx, S / 2 - 6, S - 14, 14, 4, '#3d3f44');
    rect(ctx, S / 2 - 2, S - 10, 6, 5, '#2d2f33');
    poly(ctx, [S / 2 - 10, S - 14, S / 2 - 6, S - 14, S / 2 - 6, S - 11], '#3d3f44');
  },

  tower(ctx, S, tc) {
    shadowBox(ctx, S);
    stoneWall(ctx, 14, 6, S - 28, S - 12, '#968f83');
    ellipse(ctx, S / 2, S - 6, (S - 28) / 2, 4, '#7d776c');
    // Battlements.
    rect(ctx, 10, 0, S - 20, 10, '#a39c90');
    for (let k = 0; k < 5; k++) rect(ctx, 10 + k * ((S - 24) / 4), -6, 4, 6, '#a39c90');
    poly(ctx, [12, -6, S / 2, -30, S - 12, -6], tc.main);
    poly(ctx, [S / 2, -30, S - 12, -6, S / 2, -6], tc.dark);
    rect(ctx, S / 2 - 2, 20, 4, 9, '#20160d');
    rect(ctx, S / 2 - 2, 38, 4, 9, '#20160d');
    door(ctx, S / 2 - 5, S - 20, 10, 14);
  },

  goldmine(ctx, S) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(S / 2 + 4, S - 8, S / 2, S / 5, 0, 0, Math.PI * 2);
    ctx.fill();
    poly(ctx, [2, S - 6, 10, 30, 30, 6, 56, 0, 80, 14, S - 2, 40, S - 4, S - 6], '#7a6a55');
    poly(ctx, [30, 6, 56, 0, 80, 14, 60, 26, 36, 22], '#968470');
    poly(ctx, [80, 14, S - 2, 40, S - 4, S - 6, 74, S - 10, 66, 34], '#5f523f');
    poly(ctx, [2, S - 6, 10, 30, 22, 40, 26, S - 8], '#6d5e4a');
    // Entrance.
    poly(ctx, [S / 2 - 16, S - 6, S / 2 - 14, S - 34, S / 2 + 14, S - 34, S / 2 + 16, S - 6], '#16110b');
    rect(ctx, S / 2 - 18, S - 38, 36, 5, '#6b4a2a');
    rect(ctx, S / 2 - 18, S - 38, 5, 34, '#6b4a2a');
    rect(ctx, S / 2 + 13, S - 38, 5, 34, '#6b4a2a');
    // Gold veins.
    for (const [gx, gy, r] of [
      [22, 50, 4],
      [70, 42, 5],
      [44, 18, 3],
      [78, 62, 3],
      [16, 72, 3],
    ]) {
      ellipse(ctx, gx, gy, r, r * 0.8, '#d4a017');
      ellipse(ctx, gx - 1, gy - 1, r * 0.5, r * 0.4, '#fff0a0');
    }
    // Cart.
    rect(ctx, S - 30, S - 18, 16, 8, '#6b4a2a');
    ellipse(ctx, S - 22, S - 20, 7, 3, '#e8c33a');
    ellipse(ctx, S - 27, S - 9, 3, 3, '#333');
    ellipse(ctx, S - 17, S - 9, 3, 3, '#333');
  },
};

// Construction: a foundation with scaffolding and the building rising.
export function drawConstruction(ctx, b, x, y) {
  const S = b.size * TILE;
  const p = b.progress;
  rect(ctx, x + 2, y + 2, S - 4, S - 4, '#7a5d3a');
  ctx.strokeStyle = '#5c4329';
  ctx.strokeRect(x + 2.5, y + 2.5, S - 5, S - 5);
  if (p > 0.25) {
    const sprite = getBuildingSprite(b.type, b.owner);
    const visible = Math.min(1, (p - 0.25) / 0.75);
    const h = (S + 24) * visible;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(sprite, 0, S + 24 - h, S, h, x, y + S - h, S, h);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = '#b08850';
  ctx.lineWidth = 2;
  const posts = Math.max(2, b.size + 1);
  for (let k = 0; k < posts; k++) {
    const px = x + 4 + (k * (S - 8)) / (posts - 1);
    ctx.beginPath();
    ctx.moveTo(px, y + S - 2);
    ctx.lineTo(px, y + 6);
    ctx.stroke();
  }
  for (let r = 0; r < 3; r++) {
    const py = y + S - 4 - r * (S / 3);
    ctx.beginPath();
    ctx.moveTo(x + 4, py);
    ctx.lineTo(x + S - 4, py);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

// ---------------------------------------------------------------------------
// Units

function legs(ctx, phase, moving, color = '#4a3a2a') {
  const s = moving ? Math.sin(phase * Math.PI * 2) * 3 : 0;
  rect(ctx, -4, 4, 3, 7 + s * 0.3, color);
  rect(ctx, 1, 4, 3, 7 - s * 0.3, color);
  rect(ctx, -4 + s * 0.5, 10 + s * 0.3, 4, 2, '#2a1f14');
  rect(ctx, 1 - s * 0.5, 10 - s * 0.3, 4, 2, '#2a1f14');
}

function body(ctx, color, trim) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-6, -6, 12, 12, 3);
  ctx.fill();
  if (trim) rect(ctx, -6, -1, 12, 3, trim);
}

function head(ctx, helmet, plume) {
  ellipse(ctx, 0, -10, 5, 5, SKIN);
  rect(ctx, 1, -11, 2, 2, '#2a1f14');
  if (helmet) {
    ctx.fillStyle = helmet;
    ctx.beginPath();
    ctx.arc(0, -11, 5.5, Math.PI, 0);
    ctx.fill();
    rect(ctx, -5.5, -11, 11, 2, helmet);
    if (plume) {
      ctx.fillStyle = plume;
      ctx.beginPath();
      ctx.ellipse(-1, -17, 2.5, 4, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPeasant(ctx, u, tc) {
  const moving = u.moving;
  legs(ctx, u.walkAnim * 0.9, moving, '#5a4630');
  body(ctx, '#9b7a4f', tc.main);
  head(ctx, null);
  // Straw hat.
  ellipse(ctx, 0, -14, 7, 2.5, '#d8bd6a');
  ellipse(ctx, 0, -15.5, 4, 3, '#cdb05a');
  const chopping = u.order && u.order.type === 'harvest' && u.order.phase === 'chopping';
  let swing = 0;
  if (chopping) swing = Math.sin(u.workAnim * Math.PI * 2 / 0.55) * 1.1;
  else if (u.attackAnim > 0) swing = Math.sin((u.attackAnim / 0.3) * Math.PI) * 1.2;
  ctx.save();
  ctx.translate(5, -3);
  ctx.rotate(-0.6 + swing);
  rect(ctx, -1, -12, 2, 14, '#7a5230');
  rect(ctx, -1, -13, 6, 4, '#9aa0a6');
  ctx.restore();
  if (u.carry) {
    if (u.carry.type === 'gold') {
      ellipse(ctx, -7, -3, 5, 5, '#c9a227');
      ellipse(ctx, -7, -6, 3, 1.5, '#8c6f14');
      ellipse(ctx, -8, -4, 1.5, 1.5, '#fff0a0');
    } else {
      for (let k = 0; k < 3; k++) {
        rect(ctx, -12, -9 + k * 3, 10, 3, k % 2 ? '#7a5230' : '#8f6238');
        ellipse(ctx, -12, -7.5 + k * 3, 1.5, 1.5, '#c49a62');
      }
    }
  }
}

function drawFootman(ctx, u, tc) {
  legs(ctx, u.walkAnim * 0.9, u.moving, '#5c5f66');
  body(ctx, '#8d939b', null);
  rect(ctx, -4, -6, 8, 12, tc.main);
  rect(ctx, -1, -6, 2, 12, tc.light);
  head(ctx, '#9ba1a8', tc.main);
  // Sword arm.
  const swing = u.attackAnim > 0 ? Math.sin((u.attackAnim / 0.3) * Math.PI) * 1.6 : 0;
  ctx.save();
  ctx.translate(5, -2);
  ctx.rotate(-0.4 + swing);
  rect(ctx, -1, -15, 2.5, 13, '#e6e8eb');
  rect(ctx, -3, -3, 6.5, 2, '#a07a2a');
  rect(ctx, -0.5, -1, 1.5, 4, '#5a3d22');
  ctx.restore();
  // Shield.
  ellipse(ctx, -6, 0, 5, 6.5, '#c8c8c8');
  ellipse(ctx, -6, 0, 3.8, 5.2, tc.main);
  ellipse(ctx, -6, 0, 1.2, 1.2, '#e8d070');
}

function drawArcher(ctx, u, tc) {
  legs(ctx, u.walkAnim * 0.9, u.moving, '#4f5a35');
  body(ctx, '#6b8a3f', null);
  rect(ctx, -6, -6, 3, 12, tc.main);
  // Quiver.
  rect(ctx, -8, -12, 4, 12, '#6b4a2a');
  rect(ctx, -8, -14, 1, 3, '#ddd');
  rect(ctx, -6, -15, 1, 3, '#ddd');
  head(ctx, null);
  // Hood.
  ctx.fillStyle = tc.dark;
  ctx.beginPath();
  ctx.arc(0, -11, 5.5, Math.PI * 0.95, Math.PI * 0.05);
  ctx.fill();
  // Bow.
  const draw = u.attackAnim > 0 ? Math.max(0, 1 - u.attackAnim / 0.3) : 0;
  ctx.strokeStyle = '#7a5230';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(4, -3, 9, -1.2, 1.2);
  ctx.stroke();
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(4 + Math.cos(-1.2) * 9, -3 + Math.sin(-1.2) * 9);
  ctx.lineTo(4 - draw * 4, -3);
  ctx.lineTo(4 + Math.cos(1.2) * 9, -3 + Math.sin(1.2) * 9);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawKnight(ctx, u, tc) {
  const ph = u.walkAnim * 0.7 * Math.PI * 2;
  const m = u.moving ? 1 : 0;
  // Horse legs.
  for (const [lx, o] of [
    [-9, 0],
    [-5, Math.PI],
    [6, Math.PI],
    [10, 0],
  ]) {
    const s = Math.sin(ph + o) * 3 * m;
    rect(ctx, lx + s * 0.4, 4, 3, 9, '#cfc9bd');
    rect(ctx, lx + s * 0.4, 12, 3, 2, '#3b3026');
  }
  // Horse body and head.
  ellipse(ctx, 0, 2, 13, 7, '#e2ddd2');
  ellipse(ctx, 0, 4, 12, 4, tc.main);
  rect(ctx, -12, 3, 24, 2, tc.light);
  ctx.save();
  ctx.translate(11, -4);
  ctx.rotate(-0.5);
  ellipse(ctx, 2, 0, 6, 3.5, '#e2ddd2');
  ctx.restore();
  ellipse(ctx, 16, -8, 3.5, 2.5, '#e2ddd2');
  rect(ctx, 9, -10, 3, 5, '#6b5a48');
  rect(ctx, -15, -1, 4, 8, '#6b5a48');
  // Rider.
  ctx.save();
  ctx.translate(-1, -8);
  body(ctx, '#9ba1a8', null);
  rect(ctx, -4, -6, 8, 12, tc.main);
  head(ctx, '#b4b9bf', tc.main);
  const thrust = u.attackAnim > 0 ? Math.sin((u.attackAnim / 0.3) * Math.PI) * 6 : 0;
  rect(ctx, 0 + thrust, -4, 20, 2, '#8a6a40');
  poly(ctx, [20 + thrust, -5, 25 + thrust, -3, 20 + thrust, -1], '#e6e8eb');
  ellipse(ctx, -5, 0, 4.5, 6, tc.main);
  ellipse(ctx, -5, 0, 2, 3, tc.light);
  ctx.restore();
}

const UNIT_DRAW = { peasant: drawPeasant, footman: drawFootman, archer: drawArcher, knight: drawKnight };

export function drawUnit(ctx, u, x, y) {
  const tc = team(u.owner);
  const big = u.type === 'knight';
  ellipse(ctx, x, y + (big ? 12 : 11), big ? 14 : 8, big ? 4.5 : 3.5, 'rgba(0,0,0,0.3)');
  ctx.save();
  const bob = u.moving ? Math.abs(Math.sin(u.walkAnim * Math.PI * 1.8)) * 1.2 : 0;
  ctx.translate(Math.round(x), Math.round(y - bob));
  ctx.scale(u.facing, 1);
  UNIT_DRAW[u.type](ctx, u, tc);
  ctx.restore();
  if (u.flash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.6, u.flash * 5);
    ellipse(ctx, x, y - 2, big ? 14 : 8, big ? 12 : 13, '#ffffff');
    ctx.restore();
  }
}

// Used for interface portraits.
export function drawUnitIcon(ctx, type, owner, size) {
  const fake = { type, owner, facing: 1, moving: false, walkAnim: 0, attackAnim: 0, workAnim: 0, carry: null, order: null };
  ctx.save();
  const s = size / (type === 'knight' ? 40 : 30);
  ctx.translate(size / 2, size / 2 + 2 * s);
  ctx.scale(s, s);
  UNIT_DRAW[type](ctx, fake, team(owner));
  ctx.restore();
}

export function drawBuildingIcon(ctx, type, owner, size) {
  const sprite = getBuildingSprite(type, owner);
  const w = sprite.width;
  const h = sprite.height;
  const s = Math.min(size / w, size / h) * 0.95;
  ctx.drawImage(sprite, (size - w * s) / 2, (size - h * s) / 2, w * s, h * s);
}

export function drawCorpse(ctx, e) {
  const fade = Math.min(1, (e.life - e.t) / 4);
  ctx.save();
  ctx.globalAlpha = fade;
  ellipse(ctx, e.x, e.y + 6, 9, 4, 'rgba(110,10,10,0.55)');
  if (e.t < e.life * 0.5) {
    ctx.translate(e.x, e.y + 4);
    ctx.rotate((Math.PI / 2) * (e.facing || 1));
    ctx.scale(0.8, 0.8);
    ctx.globalAlpha = fade * 0.75;
    const tc = team(e.owner);
    if (e.unitType === 'knight') {
      ellipse(ctx, 0, 0, 12, 6, '#a9a399');
    } else {
      body(ctx, '#6d6a64', tc.dark);
      ellipse(ctx, 0, -10, 5, 5, '#b89c80');
    }
  } else {
    // Bones.
    ctx.strokeStyle = '#e8e2d0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.x - 6, e.y + 4);
    ctx.lineTo(e.x + 6, e.y + 8);
    ctx.moveTo(e.x - 5, e.y + 9);
    ctx.lineTo(e.x + 5, e.y + 3);
    ctx.stroke();
    ellipse(ctx, e.x + 7, e.y + 2, 3, 3, '#e8e2d0');
    ctx.lineWidth = 1;
  }
  ctx.restore();
}

export function drawRubble(ctx, e) {
  const S = e.size * TILE;
  const fade = Math.min(1, (e.life - e.t) / 6);
  ctx.save();
  ctx.globalAlpha = fade;
  const x0 = e.x - S / 2;
  const y0 = e.y - S / 2;
  ellipse(ctx, e.x, e.y + 4, S / 2 - 2, S / 2.6, 'rgba(40,30,20,0.55)');
  const n = e.size * 6;
  for (let k = 0; k < n; k++) {
    const rx = x0 + 6 + hash(k * 7 + e.size) * (S - 12);
    const ry = y0 + 8 + hash(k * 13 + e.size * 3) * (S - 14);
    const r = 2 + hash(k * 3) * 4;
    ellipse(ctx, rx, ry, r, r * 0.7, k % 3 ? '#6e665b' : '#4a3b2b');
  }
  ctx.restore();
}

export function drawFire(ctx, x, y, time, scale = 1) {
  for (let k = 0; k < 3; k++) {
    const ph = time * 9 + k * 2.1;
    const h = (8 + Math.sin(ph) * 3) * scale;
    const xo = (k - 1) * 4 * scale;
    poly(ctx, [x + xo - 3 * scale, y, x + xo, y - h, x + xo + 3 * scale, y], k === 1 ? '#ffd04a' : '#ff7a1a');
  }
  const sm = (time * 0.7) % 1;
  ctx.fillStyle = `rgba(60,60,60,${0.45 * (1 - sm)})`;
  ctx.beginPath();
  ctx.arc(x + sm * 6, y - 12 * scale - sm * 18, (4 + sm * 6) * scale, 0, Math.PI * 2);
  ctx.fill();
}

export { team, shade };
