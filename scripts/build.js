// Bundles the game, three.js included, into one self-contained HTML file that
// runs from file:// with no server: `npm run build` -> dist/ironvale.html.
// Also writes dist/ironvale.fragment.html (the same page without the
// <html>/<head>/<body> wrapper) for hosts that supply their own.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function build() {
  const result = await esbuild({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    legalComments: 'inline',
    write: false,
    logLevel: 'warning',
  });
  const js = result.outputFiles[0].text;
  const css = await readFile(join(root, 'styles.css'), 'utf8');
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const head = html.match(/<!-- BUILD:HEAD -->([\s\S]*?)<!-- \/BUILD:HEAD -->/)[1].trim();
  const body = html.match(/<!-- BUILD:BODY -->([\s\S]*?)<!-- \/BUILD:BODY -->/)[1].trim();
  const safeJs = js.replace(/<\/script/gi, '<\\/script');

  const fragment = `${head}\n<style>\n${css}\n</style>\n${body}\n<script>\n${safeJs}\n</script>\n`;
  const standalone = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n<style>\n${css}\n</style>\n</head>\n<body>\n${body}\n<script>\n${safeJs}\n</script>\n</body>\n</html>\n`;

  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/ironvale.html'), standalone);
  await writeFile(join(root, 'dist/ironvale.fragment.html'), fragment);
  console.log(`Built dist/ironvale.html (${(standalone.length / 1024).toFixed(0)} KB)`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
