'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repoRoot = path.resolve(__dirname, '../../..');
const outputDir = process.env.PPTX_RESULTS_DIR ? path.resolve(process.env.PPTX_RESULTS_DIR) : path.join(__dirname, '.results');
fs.mkdirSync(path.join(outputDir, 'fixtures'), { recursive: true });
const viewerDir = path.join(repoRoot, 'web/src/app/ui/mobile/viewers');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function sourceState() {
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:js|json|ts)$/.test(entry.name)) files.push(file);
  }};
  walk(viewerDir);
  const fontDir = path.join(repoRoot, 'web/src/assets/fonts/carlito');
  if (fs.existsSync(fontDir)) files.push(...fs.readdirSync(fontDir).map(name => path.join(fontDir,name)));
  return Object.fromEntries(files.sort().map(file => [path.relative(repoRoot,file), digest(fs.readFileSync(file))]));
}
function changedSources(before, after = sourceState()) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
}
function playwright() { return require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
function launchOptions() {
  return { headless: true, args: ['--no-sandbox'], ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) };
}
// Source mutation invalidates even a direct probe invocation, including pure module probes.
const initialSources = sourceState();
process.on('exit', code => {
  const changed = changedSources(initialSources);
  if (changed.length && (code === 0 || code === 3)) {
    console.error('INVALID: PPTX production sources changed during probe: ' + changed.join(', '));
    process.exitCode = 1;
  }
});
module.exports = { repoRoot, viewerDir, outputDir, playwright, launchOptions, sourceState, changedSources, digest };
