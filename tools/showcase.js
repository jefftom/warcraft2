// A fixed scene with every unit, building, prop and effect, for checking the
// 3D art. Open tools/showcase.html?focus=units (see PRESETS) via `npm start`,
// or screenshot it with `node tools/shot.mjs --focus units`.

import { Game } from '../src/game.js';
import { T, TILE, PLAYER, ENEMY, STEP } from '../src/config.js';
import { Renderer3D } from '../src/three/index.js';

const params = new URLSearchParams(location.search);
const focus = params.get('focus') || 'overview';

// Camera presets: centre (tiles) and distance.
export const PRESETS = {
  overview: { x: 40, z: 41, d: 40 },
  units: { x: 27, z: 31.5, d: 12 },
  unitsclose: { x: 24.5, z: 31.5, d: 6.5 },
  fight: { x: 45, z: 31.5, d: 13 },
  buildings: { x: 31, z: 44, d: 24 },
  townhall: { x: 22, z: 42, d: 12 },
  workshops: { x: 35, z: 42.5, d: 13 },
  construction: { x: 27, z: 53.5, d: 15 },
  foliage: { x: 55, z: 44, d: 19 },
  effects: { x: 44, z: 36, d: 15 },
  fog: { x: 66, z: 42, d: 28 },
  // Brick-style prototype scene (?style=brick).
  brick: { x: 26.5, z: 40.5, d: 13 },
  brickclose: { x: 24, z: 39.6, d: 6.2 },
  brickwide: { x: 28, z: 41, d: 22 },
  brickunits: { x: 22.5, z: 37.2, d: 5.5 },
};
const style = params.get('style') === 'brick' ? 'brick' : 'standard';

const game = new Game({ seed: 3, ai: false });
const { map } = game;

// Clear a stage in the middle of the map, removing anything already there.
for (const u of [...game.units]) if (u.tx >= 14 && u.tx < 68 && u.ty >= 22 && u.ty < 62) game.kill(u);
for (const b of [...game.buildings]) {
  if (b.x + b.size > 14 && b.x < 68 && b.y + b.size > 22 && b.y < 62) game.removeBuilding(b);
}
game.cleanup();
for (let y = 22; y < 62; y++) for (let x = 14; x < 68; x++) map.set(x, y, (x * 7 + y * 3) % 23 === 0 ? T.DIRT : T.GRASS);

// Foliage corner: a forest, a lake, rocks, stumps and a dirt path.
for (let y = 38; y < 50; y++) for (let x = 50; x < 62; x++) if ((x - 56) ** 2 + (y - 44) ** 2 < 30 + ((x * y) % 7)) map.set(x, y, T.TREE);
for (let y = 51; y < 59; y++) for (let x = 51; x < 60; x++) if ((x - 55.5) ** 2 / 16 + (y - 55) ** 2 / 9 < 1) map.set(x, y, T.WATER);
for (const [x, y] of [[50, 34], [51, 35], [53, 34], [62, 37], [63, 52]]) map.set(x, y, T.ROCK);
for (const [x, y] of [[49, 41], [49, 43], [50, 46], [48, 44]]) map.set(x, y, T.STUMP);
for (let x = 14; x < 50; x++) map.set(x, 37, T.DIRT);
// A lake edge and some forest under fog, east of the stage.
for (let y = 36; y < 48; y++) for (let x = 64; x < 68; x++) map.set(x, y, T.TREE);

// Units: a lineup of every type for both sides.
const types = ['peasant', 'peasant', 'peasant', 'footman', 'archer', 'knight'];
const lineup = [];
types.forEach((t, i) => {
  const a = game.addUnit(t, PLAYER, 22 + i * 1, 30);
  const b = game.addUnit(t, ENEMY, 22 + i * 1, 33);
  lineup.push(a, b);
  if (i === 1) {
    a.carry = { type: 'gold', amount: 10 };
    b.carry = { type: 'gold', amount: 10 };
  }
  if (i === 2) {
    a.carry = { type: 'wood', amount: 10 };
    b.carry = { type: 'wood', amount: 10 };
  }
});
for (const u of lineup) u.facing = 1;
// Walkers pacing back and forth so walk cycles show.
const walkers = [game.addUnit('footman', PLAYER, 22, 28), game.addUnit('knight', ENEMY, 31, 28), game.addUnit('peasant', PLAYER, 22, 35)];

// A fight.
const blue = [];
const red = [];
for (let i = 0; i < 3; i++) {
  blue.push(game.addUnit('footman', PLAYER, 42, 29 + i * 2));
  red.push(game.addUnit('footman', ENEMY, 47, 29 + i * 2));
}
blue.push(game.addUnit('archer', PLAYER, 40, 31), game.addUnit('knight', PLAYER, 41, 33));
red.push(game.addUnit('archer', ENEMY, 49, 31), game.addUnit('knight', ENEMY, 48, 33));

// A lumberjack at work.
const jack = game.addUnit('peasant', PLAYER, 49, 40);
game.commandHarvestWood([jack], 50, 40);

// Buildings: both sides, then construction and damage states.
const row = [['townhall', 20], ['farm', 25], ['barracks', 28], ['lumbermill', 32], ['blacksmith', 36], ['tower', 40]];
for (const [type, x] of row) {
  game.addBuilding(type, PLAYER, x, 40);
  game.addBuilding(type, ENEMY, x, 46);
}
const mine = game.addBuilding('goldmine', -1, 43, 40);
mine.gold = 9000;
const c1 = game.addBuilding('barracks', PLAYER, 20, 52);
c1.constructing = true;
c1.progress = 0.3;
c1.hp = c1.maxHp * 0.35;
const c2 = game.addBuilding('farm', PLAYER, 24, 52);
c2.constructing = true;
c2.progress = 0.75;
c2.hp = c2.maxHp * 0.75;
const d1 = game.addBuilding('townhall', ENEMY, 27, 52);
d1.hp = d1.maxHp * 0.4;
const d2 = game.addBuilding('tower', ENEMY, 32, 52);
d2.hp = d2.maxHp * 0.2;
const d3 = game.addBuilding('lumbermill', PLAYER, 35, 52);
d3.hp = d3.maxHp * 0.6;

// Lingering effects.
for (const [x, y] of [[44, 37], [45.5, 37.5], [43, 38]]) {
  game.addEffect({ type: 'corpse', x: x * TILE, y: y * TILE, unitType: 'footman', owner: ENEMY, facing: 1, life: 999 });
}
game.addEffect({ type: 'rubble', x: 39.5 * TILE, y: 37 * TILE, size: 3, life: 999 });

game.revealMap = params.get('fog') !== '1';
game.updateFog();

// The brick prototype scene: footmen of both sides, farms in every state,
// a copse, a pond and a path. It sits on top of the standard scene's stage.
if (style === 'brick') {
  for (let y = 35; y < 48; y++) for (let x = 15; x < 40; x++) map.set(x, y, T.GRASS);
  for (const b of [...game.buildings]) if (b.x + b.size > 14 && b.x < 41 && b.y + b.size > 34 && b.y < 49) game.removeBuilding(b);
  for (const u of [...game.units]) if (u.tx >= 14 && u.tx < 41 && u.ty >= 34 && u.ty < 49) game.kill(u);
  game.cleanup();
  for (let x = 15; x < 40; x++) map.set(x, 38, T.DIRT);
  for (let y = 43; y < 47; y++) for (let x = 16; x < 20; x++) if ((x - 17.5) ** 2 + (y - 44.8) ** 2 < 4.2) map.set(x, y, T.WATER);
  for (let y = 40; y < 47; y++) for (let x = 33; x < 39; x++) if ((x - 35.5) ** 2 + (y - 43) ** 2 < 9) map.set(x, y, T.TREE);
  map.set(31, 45, T.ROCK);
  map.set(21, 46, T.STUMP);
  game.addBuilding('farm', PLAYER, 21, 40);
  game.addBuilding('farm', PLAYER, 24, 40);
  const half = game.addBuilding('farm', PLAYER, 27, 40);
  half.constructing = true;
  half.progress = 0.55;
  half.hp = half.maxHp * 0.6;
  game.addBuilding('farm', ENEMY, 30, 40);
  game.addBuilding('farm', ENEMY, 22, 43);
  const blues = [];
  const reds = [];
  for (let i = 0; i < 4; i++) {
    blues.push(game.addUnit('footman', PLAYER, 21 + i, 36));
    reds.push(game.addUnit('footman', ENEMY, 28 + i, 36));
  }
  blues.push(game.addUnit('peasant', PLAYER, 25, 39), game.addUnit('archer', PLAYER, 20, 37), game.addUnit('knight', PLAYER, 19, 36));
  reds.push(game.addUnit('knight', ENEMY, 32, 37), game.addUnit('archer', ENEMY, 33, 36));
  blues[4].carry = { type: 'gold', amount: 10 };
  setTimeout(() => {
    game.commandAttack(blues.slice(0, 3), reds[0]);
    game.commandAttack(reds.slice(0, 3), blues[0]);
    game.commandMove([blues[4]], 33, 39);
  }, 300);
}

const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const renderer = new Renderer3D(canvas, game, stage, { style });
const preset = PRESETS[focus] || PRESETS.overview;

function resize() {
  renderer.resize(stage.clientWidth, stage.clientHeight);
}
resize();
window.addEventListener('resize', resize);
renderer.rig.distance = renderer.rig.goalDistance = preset.d;
renderer.rig.centerOn(preset.x, preset.z);

// Fog demo: only the lineup is visible; the east is explored but dark.
if (params.get('fog') === '1') {
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (x > 55) game.fog.explored[y * map.w + x] = 1;
}

const selection = new Set([lineup[0].id, lineup[6].id, lineup[9].id, blue[0].id]);
const markers = [
  { x: 35 * TILE, y: 34 * TILE, color: '#5aff6a', t: 0, life: 1e9 },
  { x: 37 * TILE, y: 34 * TILE, color: '#ff5040', t: 0, life: 1e9 },
];
const barracks = game.buildings.find((b) => b.type === 'barracks' && b.owner === PLAYER && !b.constructing);
if (barracks) game.setRally(barracks, 30, 37, null);
let elapsed = 0;
let fightStarted = false;
let last = performance.now();
const frameState = { frames: 0 };

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;
  game.update(STEP);
  game.events.length = 0;
  if (!fightStarted && elapsed > 0.2) {
    fightStarted = true;
    game.commandAttack(blue, red[0]);
    game.commandAttack(red, blue[0]);
  }
  for (const w of walkers) {
    if (!w.order && !w.moving) game.commandMove([w], w.tx < 26 ? 34 : 21, w.ty);
  }
  // Keep the demo explosions coming.
  if (Math.floor(elapsed / 2) !== Math.floor((elapsed - dt) / 2)) {
    game.addEffect({ type: 'explosion', x: 46 * TILE, y: 37.5 * TILE, size: 2, life: 1.2 });
    game.addEffect({ type: 'dust', x: 41 * TILE, y: 36 * TILE, size: 2, life: 0.8 });
    game.addEffect({ type: 'hit', x: 44.5 * TILE, y: 31 * TILE, life: 0.3 });
  }
  renderer.syncTerrain(null);
  renderer.render({
    time: game.time,
    dt,
    selection,
    hover: lineup[3],
    markers,
    alerts: [],
    dragRect: null,
    placement: focus === 'effects' || focus === 'overview' ? { type: 'barracks', x: 34, y: 33, tileOk: (tx) => tx < 36 } : null,
  });
  frameState.frames++;
  window.__showcase = {
    ready: frameState.frames > 30,
    frames: frameState.frames,
    calls: renderer.renderer.info.render.calls,
    triangles: renderer.renderer.info.render.triangles,
    geometries: renderer.renderer.info.memory.geometries,
  };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
