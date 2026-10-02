import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generateMap } from '../src/map.js';
import { mulberry32 } from '../src/util.js';
import { PLAYER, ENEMY, BUILDINGS, UNITS, T } from '../src/config.js';
import { run, runUntil, checkOccupancy } from './helpers.js';

function quietGame(seed = 7) {
  return new Game({ seed, ai: false });
}

test('generated maps are fair and connected', () => {
  for (const seed of [1, 2, 3, 42, 1234]) {
    const { map, starts, mines } = generateMap(mulberry32(seed));
    assert.equal(starts.length, 2);
    assert.equal(mines.length, 6);
    // Point symmetry, apart from the odd corridor carved for connectivity.
    let mismatched = 0;
    const N = map.w * map.h;
    for (let i = 0; i < N; i++) if (map.tiles[i] !== map.tiles[N - 1 - i]) mismatched++;
    assert.ok(mismatched < N * 0.02, `seed ${seed}: map is roughly symmetric (${mismatched} mismatches)`);
    for (const r of [...starts, ...mines]) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) assert.ok(map.isWalkable(x, y), `seed ${seed}: footprint at ${x},${y} is clear`);
      }
    }
  }
});

test('both players start with a town hall and three peasants', () => {
  const g = quietGame();
  for (const owner of [PLAYER, ENEMY]) {
    assert.equal(g.buildings.filter((b) => b.owner === owner && b.type === 'townhall').length, 1);
    assert.equal(g.units.filter((u) => u.owner === owner && u.type === 'peasant').length, 3);
  }
  assert.deepEqual(checkOccupancy(g), []);
});

test('peasants mine gold and deliver it to the town hall', () => {
  const g = quietGame();
  const p = g.players[PLAYER];
  const start = p.gold;
  const peasants = g.units.filter((u) => u.owner === PLAYER);
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  const c = g.centerTile(hall);
  const mine = g.nearestMine(c.x, c.y, 20);
  g.commandHarvestGold(peasants, mine);
  run(g, 40);
  assert.ok(p.gold >= start + 60, `gold rose from ${start} to ${p.gold}`);
  assert.equal(p.stats.goldMined, p.gold - start);
  assert.ok(mine.gold < 10000);
  assert.deepEqual(checkOccupancy(g), []);
});

test('peasants chop lumber and trees eventually fall', () => {
  const g = quietGame();
  const p = g.players[PLAYER];
  const peasants = g.units.filter((u) => u.owner === PLAYER);
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  const c = g.centerTile(hall);
  const tree = g.findTreeNear(c.x, c.y, peasants[0], null, null, 20);
  assert.ok(tree, 'there is a tree near the base');
  g.commandHarvestWood(peasants, tree.x, tree.y);
  run(g, 90);
  assert.ok(p.stats.woodHarvested >= 60, `harvested ${p.stats.woodHarvested} lumber`);
  let stumps = 0;
  for (let i = 0; i < g.map.tiles.length; i++) if (g.map.tiles[i] === T.STUMP) stumps++;
  assert.ok(stumps >= 1, 'at least one tree was felled');
});

test('construction spends resources, completes and releases the builder', () => {
  const g = quietGame();
  const p = g.players[PLAYER];
  const builder = g.units.find((u) => u.owner === PLAYER);
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  // Find an open spot near the hall.
  let spot = null;
  for (let r = 3; r < 10 && !spot; r++) {
    for (let dy = -r; dy <= r && !spot; dy++) {
      for (let dx = -r; dx <= r && !spot; dx++) {
        if (g.canPlace('farm', PLAYER, hall.x + dx, hall.y + dy).ok) spot = { x: hall.x + dx, y: hall.y + dy };
      }
    }
  }
  assert.ok(spot, 'found a farm site');
  const gold = p.gold;
  assert.equal(g.commandBuild(builder, 'farm', spot.x, spot.y), true);
  assert.equal(p.gold, gold - BUILDINGS.farm.cost.gold, 'cost is paid when the order is given');
  const done = runUntil(g, () => g.buildings.some((b) => b.type === 'farm' && !b.constructing), 60);
  assert.ok(done, 'farm finished');
  assert.equal(builder.hidden, false, 'builder came back out');
  assert.equal(p.foodCap, BUILDINGS.townhall.food + BUILDINGS.farm.food);
  assert.deepEqual(checkOccupancy(g), []);
});

test('cancelling a build order before it starts refunds in full', () => {
  const g = quietGame();
  const p = g.players[PLAYER];
  const builder = g.units.find((u) => u.owner === PLAYER);
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  const gold = p.gold;
  const wood = p.wood;
  let placed = false;
  for (let dy = 6; dy < 12 && !placed; dy++) {
    if (g.canPlace('farm', PLAYER, hall.x, hall.y + dy).ok) placed = g.commandBuild(builder, 'farm', hall.x, hall.y + dy);
  }
  assert.ok(placed);
  g.commandStop([builder]);
  assert.equal(p.gold, gold);
  assert.equal(p.wood, wood);
});

test('training respects food, queue and refunds cancellations', () => {
  const g = quietGame();
  const p = g.players[PLAYER];
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  p.gold = 10000;
  // 3 peasants, 5 food: two more fit.
  assert.equal(g.train(hall, 'peasant'), true);
  assert.equal(g.train(hall, 'peasant'), true);
  assert.equal(g.train(hall, 'peasant'), false, 'food cap stops the third');
  const before = p.gold;
  g.cancelQueueItem(hall);
  assert.equal(p.gold, before + UNITS.peasant.cost.gold);
  assert.equal(hall.queue.length, 1);
  run(g, UNITS.peasant.time + 1);
  assert.equal(g.units.filter((u) => u.owner === PLAYER).length, 4);
});

test('units cannot be trained without their required buildings', () => {
  const g = quietGame();
  const p = g.players[PLAYER];
  p.gold = 10000;
  p.wood = 10000;
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  const barracks = g.addBuilding('barracks', PLAYER, hall.x, hall.y + 7);
  g.addBuilding('farm', PLAYER, hall.x + 5, hall.y + 7);
  g.updatePlayers();
  assert.equal(g.train(barracks, 'footman'), true);
  assert.equal(g.train(barracks, 'archer'), false, 'archers need a lumber mill');
  assert.equal(g.train(barracks, 'knight'), false, 'knights need a blacksmith');
});

test('footmen fight: damage is armor-reduced but always at least 1', () => {
  const g = quietGame();
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  const x = hall.x + 6;
  const y = hall.y + 6;
  const a = g.addUnit('footman', PLAYER, x, y);
  const b = g.addUnit('peasant', ENEMY, x + 3, y);
  g.commandAttack([a], b);
  const killed = runUntil(g, () => b.dead, 30);
  assert.ok(killed, 'the footman kills the peasant');
  assert.equal(g.players[PLAYER].stats.kills, 1);
  assert.deepEqual(checkOccupancy(g), []);

  // A peasant against a knight still chips away.
  const k = g.addUnit('knight', ENEMY, x + 6, y + 4);
  const hp = k.hp;
  g.applyHit(k, { damage: 0, pierce: 0 }, 0, PLAYER);
  assert.equal(k.hp, hp - 1);
});

test('archers shoot projectiles that land', () => {
  const g = quietGame();
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  const x = hall.x + 6;
  const y = hall.y + 6;
  const archer = g.addUnit('archer', PLAYER, x, y);
  const target = g.addUnit('footman', ENEMY, x + 3, y);
  target.setOrder(g, { type: 'hold', target: 0 });
  g.commandAttack([archer], target);
  run(g, 0.5);
  assert.ok(g.projectiles.length > 0 || target.hp < target.maxHp, 'an arrow is in flight or has hit');
  run(g, 3);
  assert.ok(target.hp < target.maxHp, 'the target took damage');
});

test('idle soldiers defend themselves', () => {
  const g = quietGame();
  const hall = g.buildings.find((b) => b.owner === PLAYER && b.type === 'townhall');
  const x = hall.x + 6;
  const y = hall.y + 6;
  const guard = g.addUnit('footman', PLAYER, x, y);
  const raider = g.addUnit('footman', ENEMY, x + 2, y);
  run(g, 2);
  assert.ok(guard.order && guard.order.type === 'attack', 'the guard engages on its own');
  assert.ok(raider.hp < raider.maxHp || guard.hp < guard.maxHp);
});

test('destroying every enemy building and unit wins the game', () => {
  const g = quietGame();
  for (const e of [...g.units, ...g.buildings]) if (e.owner === ENEMY) g.kill(e, PLAYER);
  run(g, 1);
  assert.equal(g.winner, PLAYER);
});

test('the simulation is deterministic for a given seed', () => {
  const a = new Game({ seed: 99, playerAI: 'normal' });
  const b = new Game({ seed: 99, playerAI: 'normal' });
  run(a, 90);
  run(b, 90);
  const snap = (g) => JSON.stringify(g.players.map((p) => [p.gold, p.wood, p.food, p.stats]));
  assert.equal(snap(a), snap(b));
});
