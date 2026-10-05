// Scripted interaction checks for the 3D view in headless Chromium.
//   node tools/check3d.mjs [--out DIR]
// Clicks units where they appear on screen, box-selects, issues orders,
// places a building, uses the minimap and zoom, and swaps between the 3D and
// classic views several times. Prints a JSON report; exits 1 on failure.

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outArg = process.argv.indexOf('--out');
const out = resolve(outArg > 0 ? process.argv[outArg + 1] : join(root, '.shots/check3d'));
const require = createRequire(import.meta.url);
let playwright;
for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js']) {
  try {
    playwright = require(c);
    break;
  } catch {
    // next
  }
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
await mkdir(out, { recursive: true });

const browser = await playwright.chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

try {
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.setItem('ironvale.settings', JSON.stringify({ view: '3d', speed: 1 })));
  await page.reload();
  await page.waitForTimeout(2500);
  check('title demo uses the 3D renderer', (await page.evaluate(() => window.__ironvale.session.renderer.constructor.name)) === 'Renderer3D');
  await page.click('#btn-start');
  await page.waitForTimeout(1500);

  const stage = await page.locator('#stage').boundingBox();
  const unitScreen = () =>
    page.evaluate(() => {
      const s = window.__ironvale.session;
      const p = { x: 0, y: 0, z: 0, rx: 0, ry: 0 };
      return s.game.units
        .filter((u) => u.owner === 0 && !u.hidden)
        .map((u) => {
          s.renderer.unitScreen(u, p);
          return { id: u.id, x: p.x, y: p.y };
        });
    });

  // 1. Click a peasant where it is drawn.
  let us = await unitScreen();
  await page.mouse.click(stage.x + us[0].x, stage.y + us[0].y);
  await page.waitForTimeout(200);
  let sel = await page.evaluate(() => window.__ironvale.session.controller.selection);
  check('clicking a unit selects it', sel.length === 1 && sel[0] === us[0].id, JSON.stringify({ sel, want: us[0].id }));

  // 2. Box-select all peasants.
  us = await unitScreen();
  const xs = us.map((u) => u.x);
  const ys = us.map((u) => u.y);
  await page.mouse.move(stage.x + Math.min(...xs) - 30, stage.y + Math.min(...ys) - 30);
  await page.mouse.down();
  await page.mouse.move(stage.x + Math.max(...xs) + 30, stage.y + Math.max(...ys) + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  sel = await page.evaluate(() => window.__ironvale.session.controller.selection);
  check('box selection picks every peasant', sel.length === us.length, `${sel.length}/${us.length}`);
  await page.screenshot({ path: join(out, '1-selected.png') });

  // 3. Right-click the gold mine: peasants start harvesting.
  const mine = await page.evaluate(() => {
    const s = window.__ironvale.session;
    const st = s.game.starts[0];
    const m = s.game.nearestMine(st.x + 2, st.y + 2, 20);
    const p = s.renderer.rig.project(m.x + m.size / 2, 0.6, m.y + m.size / 2);
    return { x: p.x, y: p.y, id: m.id };
  });
  await page.mouse.click(stage.x + mine.x, stage.y + mine.y, { button: 'right' });
  await page.waitForTimeout(300);
  const orders = await page.evaluate(() => window.__ironvale.session.game.units.filter((u) => u.owner === 0).map((u) => u.order && u.order.type));
  check('right-clicking the mine orders harvesting', orders.every((o) => o === 'harvest'), JSON.stringify(orders));

  // 4. Picking the town hall by clicking its roof.
  const hall = await page.evaluate(() => {
    const s = window.__ironvale.session;
    const b = s.game.buildings.find((x) => x.owner === 0 && x.type === 'townhall');
    const h = s.renderer.layers.buildings.metrics(b).height;
    const p = s.renderer.rig.project(b.x + b.size / 2, h * 0.7, b.y + b.size / 2);
    return { x: p.x, y: p.y, id: b.id };
  });
  await page.mouse.click(stage.x + hall.x, stage.y + hall.y);
  await page.waitForTimeout(200);
  sel = await page.evaluate(() => window.__ironvale.session.controller.selection);
  check('clicking the town hall roof selects it', sel.length === 1 && sel[0] === hall.id, JSON.stringify(sel));

  // 5. Train a peasant with the hotkey.
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  const queued = await page.evaluate(() => window.__ironvale.session.game.buildings.find((x) => x.owner === 0 && x.type === 'townhall').queue.length);
  check('hotkey P queues a peasant', queued === 1, `queue ${queued}`);

  // 6. Placement preview for a farm with a free peasant.
  await page.evaluate(() => {
    const s = window.__ironvale.session;
    const u = s.game.units.find((x) => x.owner === 0 && !x.hidden);
    s.game.commandStop([u]);
    s.controller.setSelection([u]);
  });
  await page.keyboard.press('b');
  await page.keyboard.press('f');
  const spot = await page.evaluate(() => {
    const s = window.__ironvale.session;
    const b = s.game.buildings.find((x) => x.owner === 0 && x.type === 'townhall');
    for (let r = 4; r < 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = b.x + dx;
          const y = b.y + dy;
          if (s.game.canPlace('farm', 0, x, y).ok) {
            const p = s.renderer.rig.project(x + 1, 0, y + 1);
            if (p.x > 40 && p.y > 40 && p.x < s.renderer.width - 40 && p.y < s.renderer.height - 40) return { x: p.x, y: p.y, tx: x, ty: y };
          }
        }
      }
    }
    return null;
  });
  if (spot) {
    await page.mouse.move(stage.x + spot.x, stage.y + spot.y);
    await page.waitForTimeout(400);
    const preview = await page.evaluate(() => window.__ironvale.session.controller.frame(0).placement);
    check('placement preview follows the mouse', preview && Math.abs(preview.x - spot.tx) <= 1 && Math.abs(preview.y - spot.ty) <= 1, JSON.stringify({ preview, spot }));
    await page.screenshot({ path: join(out, '2-placement.png') });
    await page.mouse.click(stage.x + spot.x, stage.y + spot.y);
    await page.waitForTimeout(300);
    const building = await page.evaluate(() => window.__ironvale.session.game.units.some((u) => u.order && u.order.type === 'build'));
    check('clicking places a build order', building);
  } else {
    check('found a farm site on screen', false);
  }

  // 7. Minimap click moves the camera; zoom changes distance.
  const before = await page.evaluate(() => ({ ...window.__ironvale.session.renderer.rig.target }));
  const mm = await page.locator('#minimap').boundingBox();
  await page.mouse.click(mm.x + mm.width * 0.7, mm.y + mm.height * 0.7);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ ...window.__ironvale.session.renderer.rig.target }));
  check('minimap click moves the camera', Math.hypot(after.x - before.x, after.z - before.z) > 10, JSON.stringify({ before, after }));
  const d0 = await page.evaluate(() => window.__ironvale.session.renderer.rig.goalDistance);
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  const d1 = await page.evaluate(() => window.__ironvale.session.renderer.rig.goalDistance);
  check('mouse wheel zooms out', d1 > d0, `${d0} -> ${d1}`);
  await page.screenshot({ path: join(out, '3-zoomed.png') });

  // 8. Swap views repeatedly: no context leaks or errors.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Escape');
    await page.click('#btn-quit');
    await page.waitForTimeout(500);
    await page.click(`.seg[data-setting="view"] button[data-v="${i % 2 ? '3d' : '2d'}"]`);
    await page.waitForTimeout(500);
    await page.click('#btn-start');
    await page.waitForTimeout(500);
  }
  const kind = await page.evaluate(() => window.__ironvale.session.renderer.constructor.name);
  check('view switching ends on the expected renderer', kind === 'Renderer3D', kind);
  check('no WebGL context warnings', !errors.some((e) => /WebGL context|CONTEXT_LOST/i.test(e)));
  await page.screenshot({ path: join(out, '4-after-switching.png') });
} catch (err) {
  check('script ran to completion', false, String(err && err.stack));
} finally {
  await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ checks, errors, screenshots: out }, null, 1));
process.exit(failed.length ? 1 : 0);
