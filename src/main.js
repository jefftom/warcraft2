// Entry point: owns the game loop, screens and session lifecycle.

import { Game } from './game.js';
import { STEP, PLAYER, TILE, DIFFICULTY } from './config.js';
import { Renderer, Minimap } from './renderer.js';
import { Controller } from './controller.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { formatTime } from './util.js';

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  canvas: $('game'),
  stage: $('stage'),
  minimap: $('minimap'),
  info: $('info'),
  commands: $('commands'),
  tooltip: $('tooltip'),
  messages: $('messages'),
  gold: $('gold'),
  wood: $('wood'),
  food: $('food'),
  clock: $('clock'),
  overlay: $('overlay'),
};
const screens = { title: $('screen-title'), pause: $('screen-pause'), end: $('screen-end') };

const HELP_HTML = `
<h3>Controls</h3>
<table>
<tr><td>Click or drag</td><td>Select a unit or box a group</td></tr>
<tr><td>Right-click</td><td>Move, attack, mine, chop or deliver, depending on what you click</td></tr>
<tr><td>Shift + click</td><td>Add or remove a unit from the selection</td></tr>
<tr><td>Double-click</td><td>Select every unit of that type on screen</td></tr>
<tr><td>Ctrl + 1 to 9</td><td>Save a control group. Press the number to recall it, twice to jump there</td></tr>
<tr><td>Arrows, edges, wheel</td><td>Scroll the map</td></tr>
<tr><td>Minimap</td><td>Click to look; right-click to send the selection</td></tr>
<tr><td>Space</td><td>Center on the selection</td></tr>
<tr><td>Esc</td><td>Cancel an order, or open this menu</td></tr>
</table>
<p>Every order button shows its hotkey in the corner. With a Town Hall or Barracks selected, right-click the map to set a rally point.</p>
<h3>Getting started</h3>
<ul>
<li>Right-click the gold mine or the forest edge with Peasants selected. They carry 10 gold or lumber per trip back to the Town Hall.</li>
<li>Every unit eats 1 food. Each Farm feeds 4 more.</li>
<li>A Barracks trains Footmen. A Lumber Mill unlocks Archers and Guard Towers. A Blacksmith unlocks Knights and upgrades.</li>
<li>The red army attacks in waves: the first comes around minute 7 on Easy, 5 on Normal and 3½ on Hard. Destroy every red building and unit to win.</li>
</ul>`;
document.querySelectorAll('.help-body').forEach((el) => {
  el.innerHTML = HELP_HTML;
});

const ERROR_RE = /^(Not enough|Can't|Requires|The |Too close|You must|Something|Already|Food limit|Target)/;

const audio = new Audio();
let settings = loadSettings();
let session = null;
let state = 'title';
let acc = 0;
let last = performance.now();
let pending = null;
let demoClock = 0;

// The 3D renderer pulls in three.js; it is loaded lazily so the classic view
// still works if WebGL (or the library) is unavailable.
let Renderer3D = null;
let renderer3dError = null;

function loadSettings() {
  const fallback = { difficulty: 'normal', speed: 1, view: '3d' };
  try {
    const s = JSON.parse(localStorage.getItem('ironvale.settings') || '{}');
    return {
      difficulty: DIFFICULTY[s.difficulty] ? s.difficulty : fallback.difficulty,
      speed: [0.75, 1, 1.5].includes(s.speed) ? s.speed : fallback.speed,
      view: s.view === '2d' || s.view === '3d' ? s.view : fallback.view,
    };
  } catch {
    return fallback;
  }
}

function saveSettings() {
  try {
    localStorage.setItem('ironvale.settings', JSON.stringify(settings));
  } catch {
    // Settings simply won't persist.
  }
}

function syncSettingButtons() {
  document.querySelectorAll('.seg').forEach((seg) => {
    const key = seg.dataset.setting;
    seg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(String(settings[key]) === b.dataset.v));
    });
  });
}

document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const key = seg.dataset.setting;
    settings[key] = key === 'speed' ? Number(b.dataset.v) : b.dataset.v;
    saveSettings();
    syncSettingButtons();
    audio.unlock();
    audio.play('select');
    // Show the new view straight away behind the title screen.
    if (key === 'view' && state === 'title') startDemo();
  });
});

// ---- sessions -----------------------------------------------------------

// A canvas keeps whichever context it first hands out (2D or WebGL), so every
// session gets a fresh one.
function freshCanvas() {
  const c = document.createElement('canvas');
  c.id = 'game';
  c.setAttribute('aria-label', 'Battlefield');
  els.canvas.replaceWith(c);
  els.canvas = c;
  return c;
}

function makeRenderer(game) {
  if (settings.view === '3d' && Renderer3D) {
    try {
      return new Renderer3D(freshCanvas(), game, els.stage);
    } catch (err) {
      renderer3dError = err;
      console.warn('3D view unavailable; using the classic view.', err);
    }
  }
  return new Renderer(freshCanvas(), game);
}

function createSession(game, demo) {
  if (session) session.dispose();
  const renderer = makeRenderer(game);
  const minimap = new Minimap(els.minimap, game);
  const controller = new Controller(game, els.canvas, els.minimap, audio, renderer);
  const ui = new UI(game, controller, els);
  controller.onMessage = (t) => ui.message(t);
  controller.onMenu = () => togglePause();
  controller.enabled = !demo;
  session = {
    game,
    renderer,
    minimap,
    controller,
    ui,
    demo,
    dispose() {
      controller.dispose();
      ui.dispose();
      renderer.dispose();
    },
  };
  els.messages.textContent = '';
  acc = 0;
  resize();
}

function startDemo() {
  const game = new Game({ difficulty: 'normal', playerAI: 'normal', revealMap: true });
  // Skip the quiet opening so the title screen shows towns already growing.
  for (let t = 0; t < 150; t += STEP) game.update(STEP);
  game.events.length = 0;
  createSession(game, true);
  demoClock = Math.random() * 100;
  state = 'title';
  els.app.classList.add('attract');
  showScreen('title');
}

function startGame() {
  audio.unlock();
  const game = new Game({ difficulty: settings.difficulty });
  createSession(game, false);
  state = 'playing';
  els.app.classList.remove('attract');
  showScreen(null);
  session.ui.message('Put your Peasants to work, then build Farms and a Barracks.');
  els.canvas.focus?.();
}

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  els.overlay.classList.toggle('dim', name === 'pause' || name === 'end');
  if (name) {
    const btn = screens[name].querySelector('button.primary');
    btn?.focus({ preventScroll: true });
  }
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    showScreen('pause');
  } else if (state === 'paused') {
    state = 'playing';
    showScreen(null);
  }
}

function endGame(winner) {
  state = 'over';
  const g = session.game;
  const won = winner === PLAYER;
  audio.play(won ? 'victory' : 'defeat');
  $('end-eyebrow').textContent = `${DIFFICULTY[g.difficulty].label} enemy · ${formatTime(g.time)}`;
  $('end-title').textContent = won ? 'Victory' : 'Defeat';
  $('end-text').textContent = won
    ? 'The red stronghold lies in ruins. Ironvale is yours.'
    : 'Your last stronghold has fallen. The red banners fly over Ironvale.';
  const [you, foe] = g.players;
  const rows = [
    ['Gold mined', 'goldMined'],
    ['Lumber harvested', 'woodHarvested'],
    ['Units trained', 'unitsTrained'],
    ['Units lost', 'unitsLost'],
    ['Enemies slain', 'kills'],
    ['Buildings completed', 'buildingsBuilt'],
    ['Buildings razed', 'razed'],
  ];
  $('end-stats').innerHTML =
    '<thead><tr><th></th><th class="you">You</th><th class="foe">Enemy</th></tr></thead><tbody>' +
    rows.map(([label, key]) => `<tr><td>${label}</td><td>${you.stats[key]}</td><td>${foe.stats[key]}</td></tr>`).join('') +
    '</tbody>';
  showScreen('end');
}

$('btn-start').addEventListener('click', startGame);
$('btn-resume').addEventListener('click', togglePause);
$('btn-restart').addEventListener('click', startGame);
$('btn-again').addEventListener('click', startGame);
$('btn-quit').addEventListener('click', () => startDemo());
$('btn-title').addEventListener('click', () => startDemo());
$('btn-menu').addEventListener('click', () => {
  audio.unlock();
  togglePause();
});
const soundBtn = $('btn-sound');
function syncSound() {
  soundBtn.textContent = audio.muted ? 'Sound off' : 'Sound on';
  soundBtn.setAttribute('aria-pressed', String(audio.muted));
}
soundBtn.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  syncSound();
});
syncSound();

// ---- events from the simulation -------------------------------------------

function handleEvents() {
  const { game, controller, ui, demo } = session;
  for (const e of game.events) {
    if (e.type === 'gameOver') {
      pending = demo ? 'demo' : { winner: e.winner };
      continue;
    }
    if (demo) continue;
    if (e.type === 'sound') playPositional(e);
    else if (e.type === 'message') {
      ui.message(e.text);
      if (ERROR_RE.test(e.text)) audio.play('error');
    } else if (e.type === 'alert' && e.owner === PLAYER) {
      audio.play('alert');
      controller.alerts.push({ x: e.x, y: e.y, t: 0 });
    }
  }
  game.events.length = 0;
}

function playPositional(e) {
  const { game } = session;
  if (e.x === undefined) {
    if (e.owner === PLAYER) audio.play(e.name);
    return;
  }
  if (!game.fog.isVisible(Math.floor(e.x / TILE), Math.floor(e.y / TILE))) return;
  if (session.renderer.isOnScreen(e.x, e.y, 160)) audio.play(e.name);
  else if (e.owner === PLAYER && (e.name === 'complete' || e.name === 'ready')) audio.play(e.name, 0.5);
}

// ---- layout and loop ----------------------------------------------------------

function resize() {
  if (!session) return;
  const r = els.stage.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width));
  const h = Math.max(1, Math.floor(r.height));
  session.renderer.resize(w, h);
  session.controller.setViewSize(w, h);
}

window.addEventListener('resize', resize);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(els.stage);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') togglePause();
});

function panDemo(dt) {
  const { game, renderer } = session;
  demoClock += dt;
  const W = game.map.w * TILE;
  const H = game.map.h * TILE;
  renderer.centerOn(W * (0.5 + 0.36 * Math.sin(demoClock * 0.045)), H * (0.5 + 0.36 * Math.sin(demoClock * 0.031 + 1.3)));
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (session) {
    const { game, controller, renderer, minimap, ui, demo } = session;
    if (demo || state === 'playing') {
      acc += dt * (demo ? 1 : settings.speed);
      let n = 0;
      while (acc >= STEP && n < 12) {
        game.update(STEP);
        acc -= STEP;
        n++;
      }
      if (n === 12) acc = 0;
    }
    if (demo) panDemo(dt);
    handleEvents();
    controller.update(state === 'playing' ? dt : 0);
    renderer.syncTerrain(minimap);
    const view = controller.frame(game.time, dt);
    renderer.render(view);
    minimap.render(view, renderer.footprint());
    ui.update();
  }
  if (pending) {
    const p = pending;
    pending = null;
    if (p === 'demo') startDemo();
    else endGame(p.winner);
  }
  requestAnimationFrame(frame);
}

// Handy for poking at the game from the browser console.
window.__ironvale = {
  get session() {
    return session;
  },
  get renderer3dError() {
    return renderer3dError;
  },
};

async function boot(data) {
  if (data && data.settings) {
    settings = { ...settings, ...data.settings };
  }
  syncSettingButtons();
  try {
    ({ Renderer3D } = await import('./three/index.js'));
  } catch (err) {
    renderer3dError = err;
    console.warn('Could not load the 3D renderer; using the classic view.', err);
  }
  startDemo();
  requestAnimationFrame(frame);
}

const hot = typeof window !== 'undefined' ? window.claude?.hot : undefined;
if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ settings }));
if (hot && typeof hot.ready === 'function') hot.ready(boot);
else boot(hot?.data ?? {});
