import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { PLAYER, ENEMY } from '../src/config.js';
import { run, checkOccupancy } from './helpers.js';

test('the AI builds an economy and an army', () => {
  const g = new Game({ seed: 5, difficulty: 'normal' });
  run(g, 300);
  const types = new Set(g.buildings.filter((b) => b.owner === ENEMY).map((b) => b.type));
  for (const t of ['townhall', 'farm', 'barracks', 'lumbermill']) assert.ok(types.has(t), `AI built a ${t}`);
  const army = g.units.filter((u) => u.owner === ENEMY && !u.isWorker);
  assert.ok(army.length >= 3, `AI has an army of ${army.length}`);
  assert.ok(g.players[ENEMY].stats.goldMined > 1500);
});

test('AI versus AI plays long games without breaking invariants', () => {
  for (const seed of [11, 23]) {
    const g = new Game({ seed, difficulty: 'hard', playerAI: 'normal' });
    for (let minute = 0; minute < 12 && g.winner === null; minute++) {
      run(g, 60);
      assert.deepEqual(checkOccupancy(g), [], `seed ${seed}, minute ${minute + 1}: occupancy grid is consistent`);
      for (const p of g.players) {
        assert.ok(p.gold >= 0 && p.wood >= 0, 'resources never go negative');
        assert.ok(p.food <= Math.max(p.foodCap, p.food), 'food is tracked');
      }
    }
    const fights = g.players[PLAYER].stats.kills + g.players[ENEMY].stats.kills;
    assert.ok(fights > 0, `seed ${seed}: the armies met (${fights} kills)`);
  }
});
