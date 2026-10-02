// Grid A* with 8-way movement (no corner cutting). Goals are rectangles plus
// a range, so the same search handles "walk to tile", "stand next to a
// building" and "get within bow range". When the goal can't be reached the
// path leads to the closest reachable tile instead.

import { octileToRect, rectDist } from './util.js';

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

class MinHeap {
  constructor() {
    this.items = [];
    this.prios = [];
  }
  get size() {
    return this.items.length;
  }
  clear() {
    this.items.length = 0;
    this.prios.length = 0;
  }
  push(item, prio) {
    const items = this.items;
    const prios = this.prios;
    let i = items.length;
    items.push(item);
    prios.push(prio);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prios[p] <= prio) break;
      items[i] = items[p];
      prios[i] = prios[p];
      i = p;
    }
    items[i] = item;
    prios[i] = prio;
  }
  pop() {
    const items = this.items;
    const prios = this.prios;
    const top = items[0];
    const lastItem = items.pop();
    const lastPrio = prios.pop();
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && prios[r] < prios[l] ? r : l;
        if (prios[c] >= lastPrio) break;
        items[i] = items[c];
        prios[i] = prios[c];
        i = c;
      }
      items[i] = lastItem;
      prios[i] = lastPrio;
    }
    return top;
  }
}

export class PathFinder {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    this.heap = new MinHeap();
    this.searches = 0;
  }

  /**
   * @param {number} sx start x
   * @param {number} sy start y
   * @param {{x:number,y:number,w:number,h:number}} goal goal rectangle
   * @param {number} range Chebyshev distance from the goal that counts as arrived
   * @param {(x:number, y:number) => boolean} passable
   * @param {number} maxNodes search budget
   * @returns {{path: {x:number,y:number}[], reached: boolean}}
   */
  find(sx, sy, goal, range, passable, maxNodes = 7000) {
    this.searches++;
    const w = this.w;
    const h = this.h;
    if (rectDist(sx, sy, goal) <= range) return { path: [], reached: true };

    this.gen++;
    const gen = this.gen;
    const { g, parent, seen, closed, heap } = this;
    heap.clear();

    const start = sy * w + sx;
    g[start] = 0;
    parent[start] = -1;
    seen[start] = gen;
    heap.push(start, octileToRect(sx, sy, goal));

    let best = start;
    let bestH = Math.max(0, octileToRect(sx, sy, goal) - range);
    let found = -1;
    let expanded = 0;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const cx = cur % w;
      const cy = (cur / w) | 0;

      if (rectDist(cx, cy, goal) <= range) {
        found = cur;
        break;
      }
      const hCur = Math.max(0, octileToRect(cx, cy, goal) - range);
      if (hCur < bestH || (hCur === bestH && g[cur] < g[best])) {
        best = cur;
        bestH = hCur;
      }
      if (++expanded > maxNodes) break;

      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0];
        const dy = DIRS[d][1];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] === gen) continue;
        if (!passable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
        const ng = g[cur] + DIRS[d][2];
        if (seen[ni] === gen && ng >= g[ni]) continue;
        seen[ni] = gen;
        g[ni] = ng;
        parent[ni] = cur;
        // Slightly inflated heuristic keeps searches snappy on open ground.
        heap.push(ni, ng + 1.001 * Math.max(0, octileToRect(nx, ny, goal) - range));
      }
    }

    const end = found >= 0 ? found : best;
    const path = [];
    for (let i = end; i !== start && i >= 0; i = parent[i]) {
      path.push({ x: i % w, y: (i / w) | 0 });
    }
    path.reverse();
    return { path, reached: found >= 0 };
  }
}
