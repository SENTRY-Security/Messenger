const __pptxRuntime = require('./runtime.cjs');
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const FONT_VARIANTS = ['Regular', 'Bold', 'Italic', 'BoldItalic'];
const FONT_ASSET_NAMES = [...FONT_VARIANTS.map(v => `Carlito-${v}.ttf`), 'OFL.txt', 'AUTHORS.txt'];

function checkProductionFontAssets(root = __pptxRuntime.repoRoot) {
  const files = FONT_ASSET_NAMES.map(name => {
    const sourcePath = path.join(root, 'web/src/assets/fonts/carlito', name);
    const distPath = path.join(root, 'web/dist/assets/fonts/carlito', name);
    const sourceSha256 = fs.existsSync(sourcePath) ? digest(fs.readFileSync(sourcePath)) : null;
    const distSha256 = fs.existsSync(distPath) ? digest(fs.readFileSync(distPath)) : null;
    return { name, sourcePath, distPath, sourceSha256, distSha256, matches: sourceSha256 !== null && distSha256 === sourceSha256 };
  });
  return { status: files.every(f => f.matches) ? 'pass' : 'fail', files };
}

// A real origin is needed for production FontFace URLs; about:blank cannot resolve /assets.
// This origin is fulfilled locally and serves the exact checked-in product assets.
async function initAuditHost(page, root = __pptxRuntime.repoRoot) {
  const origin = 'https://pptx-audit.local';
  const publicRoot = path.resolve(root, 'web/src');
  const evidence = { origin, fontResponses: [] };
  await page.route(origin + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/' || url.pathname === '/audit') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    }
    if (!url.pathname.startsWith('/assets/fonts/carlito/')) return route.fulfill({ status: 404, body: 'Audit host resource not found' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return route.fulfill({ status: 400, body: 'Invalid resource path' }); }
    const file = path.resolve(publicRoot, '.' + pathname);
    if (!file.startsWith(publicRoot + path.sep)) return route.fulfill({ status: 403, body: 'Resource outside public root' });
    if (!fs.existsSync(file)) {
      evidence.fontResponses.push({ path: pathname, status: 404 });
      return route.fulfill({ status: 404, body: 'Product font asset missing' });
    }
    const bytes = fs.readFileSync(file);
    evidence.fontResponses.push({ path: pathname, status: 200, sha256: digest(bytes), bytes: bytes.length });
    return route.fulfill({ status: 200, contentType: file.endsWith('.ttf') ? 'font/ttf' : 'text/plain', body: bytes });
  });
  await page.goto(origin + '/audit', { waitUntil: 'domcontentloaded' });
  return evidence;
}

// Keep actual renderer module imports intact. Only host-app integrations are mocked.
async function createViewerBundle(viewer, exposeCode) {
  const root = path.resolve(path.dirname(viewer), '../../../../../..');
  const esbuild = require(path.join(root, 'web/node_modules/esbuild'));
  const sourceBytes = fs.readFileSync(viewer);
  const dependencies = new Map([[path.resolve(viewer), digest(sourceBytes)]]);
  for (const name of FONT_ASSET_NAMES) {
    const font = path.join(root, 'web/src/assets/fonts/carlito', name);
    if (fs.existsSync(font)) dependencies.set(font, digest(fs.readFileSync(font)));
  }
  const result = await esbuild.build({
    stdin: { contents: sourceBytes.toString('utf8') + '\n' + exposeCode, sourcefile: path.basename(viewer), resolveDir: path.dirname(viewer), loader: 'js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', metafile: true,
    plugins: [{ name: 'pptx-audit-host-integrations', setup(build) {
      build.onResolve({ filter: /^(\.\.\/\.\.\/\.\.\/core\/log\.js|\.\.\/ui-utils\.js|\/locales\/index\.js)$/ }, args => ({ path: args.path, namespace: 'pptx-host-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'pptx-host-mock' }, args => ({ loader: 'js', contents:
        args.path.endsWith('/log.js') ? 'export const log = value => globalThis.__auditLogs?.push(value);' :
        args.path.endsWith('/ui-utils.js') ? 'export const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\\\"", "&quot;");' :
        'export const t = value => value;' }));
      build.onLoad({ filter: /\.m?js$/, namespace: 'file' }, args => {
        const bytes = fs.readFileSync(args.path); dependencies.set(path.resolve(args.path), digest(bytes));
        return { contents: bytes.toString('utf8'), loader: 'js', resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  const dependencyHashes = Object.fromEntries([...dependencies].sort(([a], [b]) => a.localeCompare(b)));
  const content = result.outputFiles[0].text;
  return { content, sourceSha256: digest(sourceBytes), dependencyHashes, bundleSha256: digest(content), changedDependencies: () => Object.entries(dependencyHashes).filter(([file, hash]) => !fs.existsSync(file) || digest(fs.readFileSync(file)) !== hash).map(([file]) => file) };
}
module.exports = { createViewerBundle, initAuditHost, checkProductionFontAssets };
