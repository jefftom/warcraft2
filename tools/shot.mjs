// Screenshots the 3D showcase or the real game in headless Chromium.
//
//   node tools/shot.mjs --focus units [--out DIR] [--wait 3000] [--fog]
//   node tools/shot.mjs --page game [--view 3d|2d] [--out DIR]
//   node tools/shot.mjs --focus all            (every showcase preset)
//   node tools/shot.mjs --url /.shots/x/test.html --name test   (any page in the repo)
//
// Prints console errors and renderer stats (draw calls, triangles) as JSON.
// Needs `npm install` (three) and Playwright's Chromium.

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
    return acc;
  }, []),
);
const out = resolve(args.out || join(root, '.shots'));
const width = Number(args.width || 1400);
const height = Number(args.height || 860);
const wait = Number(args.wait || 3000);

async function loadPlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright/index.js'];
  const require = createRequire(import.meta.url);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      // try the next one
    }
  }
  throw new Error('Playwright not found. Install it with `npm i -D playwright`.');
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
await mkdir(out, { recursive: true });
const report = [];

async function shoot(url, name, prepare) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message} ${e.stack?.split('\n')[1] || ''}`));
  await page.goto(url);
  if (prepare) await prepare(page);
  await page.waitForTimeout(wait);
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file });
  const stats = await page.evaluate(() => window.__showcase || null).catch(() => null);
  report.push({ name, file, stats, errors });
  await page.close();
}

try {
  if (args.url) {
    // Any page under the repo, e.g. --url /.shots/units/test.html
    await shoot(`${base}${args.url.startsWith('/') ? '' : '/'}${args.url}`, args.name || 'custom');
  } else if (args.page === 'game') {
    const view = args.view || '3d';
    await shoot(`${base}/index.html`, `game-title-${view}`, async (page) => {
      await page.evaluate((v) => localStorage.setItem('ironvale.settings', JSON.stringify({ view: v })), view);
      await page.reload();
    });
    await shoot(`${base}/index.html`, `game-start-${view}`, async (page) => {
      await page.evaluate((v) => localStorage.setItem('ironvale.settings', JSON.stringify({ view: v })), view);
      await page.reload();
      await page.waitForTimeout(1500);
      await page.click('#btn-start');
    });
  } else {
    const all = ['overview', 'units', 'unitsclose', 'fight', 'buildings', 'townhall', 'workshops', 'construction', 'foliage', 'effects', 'fog'];
    const focuses = args.focus === 'all' ? all : (args.focus || 'overview').split(',');
    for (const f of focuses) {
      const fog = f === 'fog' || args.fog ? '&fog=1' : '';
      await shoot(`${base}/tools/showcase.html?focus=${f}${fog}`, `showcase-${f}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify(report, null, 1));
