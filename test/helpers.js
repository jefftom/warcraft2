import { STEP } from '../src/config.js';

export function run(game, seconds) {
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) {
    game.update(STEP);
    game.events.length = 0;
  }
}

export function runUntil(game, predicate, maxSeconds) {
  const ticks = Math.round(maxSeconds / STEP);
  for (let i = 0; i < ticks; i++) {
    if (predicate()) return true;
    game.update(STEP);
    game.events.length = 0;
  }
  return predicate();
}

// Every visible unit must own the tile(s) it stands on, and the occupancy
// grid must not point at units that are gone or tucked inside buildings.
export function checkOccupancy(game) {
  const problems = [];
  const w = game.map.w;
  const owned = new Set();
  for (const u of game.units) {
    if (u.dead || u.hidden) continue;
    const tiles = [[u.tx, u.ty]];
    if (u.moving) tiles.push([u.toX, u.toY], [u.fromX, u.fromY]);
    for (const [x, y] of tiles) {
      const i = y * w + x;
      if (u.moving && x === u.tx && y === u.ty && game.unitGrid[i] !== u.id) continue;
      if (game.unitGrid[i] !== u.id) problems.push(`unit ${u.id} not on grid at ${x},${y} (grid has ${game.unitGrid[i]})`);
      owned.add(i);
    }
    if (!game.map.isWalkable(u.tx, u.ty) || game.buildingGrid[u.ty * w + u.tx]) {
      problems.push(`unit ${u.id} (${u.type}) stands on blocked tile ${u.tx},${u.ty}`);
    }
  }
  for (let i = 0; i < game.unitGrid.length; i++) {
    const id = game.unitGrid[i];
    if (!id) continue;
    const u = game.get(id);
    if (!u || u.dead || u.hidden) problems.push(`grid tile ${i} points at missing/hidden unit ${id}`);
  }
  return problems;
}
