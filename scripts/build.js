// Bundles the game into a single self-contained HTML file that runs from
// file:// with no server: `npm run build` -> dist/ironvale.html.
//
// The source uses plain ES modules with named imports/exports only, so a tiny
// module wrapper is enough; no bundler dependency is needed.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\};?\s*$/gm;
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(class|function|const|let)\s+([A-Za-z_$][\w$]*)/gm;

async function collect(file, seen, order) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = await readFile(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    await collect(resolve(dirname(file), m[2]), seen, order);
  }
  order.push({ file, src });
}

function wrap({ file, src }) {
  const id = relative(root, file);
  const exportsList = [];
  let body = src.replace(IMPORT_RE, (_, names, from) => {
    const dep = relative(root, resolve(dirname(file), from));
    const binds = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => n.replace(/\s+as\s+/, ': '))
      .join(', ');
    return `const { ${binds} } = __modules[${JSON.stringify(dep)}];`;
  });
  body = body.replace(EXPORT_LIST_RE, (_, names) => {
    for (const n of names.split(',').map((x) => x.trim()).filter(Boolean)) exportsList.push(n);
    return '';
  });
  body = body.replace(EXPORT_DECL_RE, (m, kind, name) => {
    exportsList.push(name);
    return m.replace(/^export\s+/, '');
  });
  if (/^\s*(export|import)\s/m.test(body)) throw new Error(`Unsupported import/export syntax in ${id}`);
  return `__modules[${JSON.stringify(id)}] = (() => {\n${body}\nreturn { ${exportsList.join(', ')} };\n})();\n`;
}

async function build() {
  const order = [];
  await collect(join(root, 'src/main.js'), new Set(), order);
  const js = `(() => {\n'use strict';\nconst __modules = {};\n${order.map(wrap).join('\n')}\n})();`;
  const css = await readFile(join(root, 'styles.css'), 'utf8');
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const head = html.match(/<!-- BUILD:HEAD -->([\s\S]*?)<!-- \/BUILD:HEAD -->/)[1].trim();
  const body = html.match(/<!-- BUILD:BODY -->([\s\S]*?)<!-- \/BUILD:BODY -->/)[1].trim();
  const safeJs = js.replace(/<\/script/gi, '<\\/script');

  // Fragment: page content without document wrapper (for hosts that add one).
  const fragment = `${head}\n<style>\n${css}\n</style>\n${body}\n<script>\n${safeJs}\n</script>\n`;
  // Standalone: a complete document you can open straight from disk.
  const standalone = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n<style>\n${css}\n</style>\n</head>\n<body>\n${body}\n<script>\n${safeJs}\n</script>\n</body>\n</html>\n`;

  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/ironvale.html'), standalone);
  await writeFile(join(root, 'dist/ironvale.fragment.html'), fragment);
  console.log(`Built dist/ironvale.html (${(standalone.length / 1024).toFixed(1)} KB, ${order.length} modules)`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
