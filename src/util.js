// Small shared helpers: seeded RNG and grid geometry.

export function mulberry32(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Chebyshev (king-move) distance from tile (x, y) to a rectangle of tiles.
export function rectDist(x, y, r) {
  const dx = x < r.x ? r.x - x : x >= r.x + r.w ? x - (r.x + r.w - 1) : 0;
  const dy = y < r.y ? r.y - y : y >= r.y + r.h ? y - (r.y + r.h - 1) : 0;
  return Math.max(dx, dy);
}

// Chebyshev distance between two tile rectangles.
export function rectRectDist(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1));
  const dy = Math.max(0, a.y - (b.y + b.h - 1), b.y - (a.y + a.h - 1));
  return Math.max(dx, dy);
}

// Octile distance (8-way movement cost) from a tile to a rectangle.
export function octileToRect(x, y, r) {
  const dx = x < r.x ? r.x - x : x >= r.x + r.w ? x - (r.x + r.w - 1) : 0;
  const dy = y < r.y ? r.y - y : y >= r.y + r.h ? y - (r.y + r.h - 1) : 0;
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

export function formatTime(seconds) {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
