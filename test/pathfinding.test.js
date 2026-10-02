import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathFinder } from '../src/pathfinding.js';

function grid(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const passable = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rows[y][x] !== '#';
  return { w, h, passable };
}

test('finds a straight path on open ground', () => {
  const g = grid(['.....', '.....', '.....']);
  const pf = new PathFinder(g.w, g.h);
  const res = pf.find(0, 1, { x: 4, y: 1, w: 1, h: 1 }, 0, g.passable);
  assert.equal(res.reached, true);
  assert.deepEqual(res.path.at(-1), { x: 4, y: 1 });
  assert.equal(res.path.length, 4);
});

test('routes around walls and never cuts corners', () => {
  const g = grid([
    '......',
    '.####.',
    '.#..#.',
    '.####.',
    '......',
  ]);
  const pf = new PathFinder(g.w, g.h);
  const res = pf.find(2, 2, { x: 0, y: 0, w: 1, h: 1 }, 0, g.passable);
  // A sealed room: diagonal squeezes between wall corners are not allowed.
  assert.equal(res.reached, false);

  const open = grid([
    '......',
    '.####.',
    '.#....',
    '.#..#.',
    '......',
  ]);
  const pf2 = new PathFinder(open.w, open.h);
  const res2 = pf2.find(2, 2, { x: 0, y: 0, w: 1, h: 1 }, 0, open.passable);
  assert.equal(res2.reached, true);
  let px = 2;
  let py = 2;
  for (const step of res2.path) {
    assert.ok(open.passable(step.x, step.y), `step ${step.x},${step.y} is passable`);
    assert.ok(Math.abs(step.x - px) <= 1 && Math.abs(step.y - py) <= 1, 'steps are adjacent');
    if (step.x !== px && step.y !== py) {
      assert.ok(open.passable(step.x, py) && open.passable(px, step.y), 'diagonal does not cut a corner');
    }
    px = step.x;
    py = step.y;
  }
});

test('stops within range of a rectangle goal', () => {
  const g = grid(['........', '........', '........', '........']);
  const pf = new PathFinder(g.w, g.h);
  const res = pf.find(0, 0, { x: 5, y: 1, w: 3, h: 3 }, 1, g.passable);
  assert.equal(res.reached, true);
  const end = res.path.at(-1);
  assert.equal(end.x, 4);
});

test('returns a partial path toward an unreachable goal', () => {
  const g = grid(['...#...', '...#...', '...#...']);
  const pf = new PathFinder(g.w, g.h);
  const res = pf.find(0, 1, { x: 6, y: 1, w: 1, h: 1 }, 0, g.passable);
  assert.equal(res.reached, false);
  assert.equal(res.path.at(-1).x, 2, 'gets as close as the wall allows');
});
