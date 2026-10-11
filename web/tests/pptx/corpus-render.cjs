const __pptxRuntime=require('./runtime.cjs');
const {loadCorpus}=require('./corpus-inputs.cjs');
'use strict';
// Operational rendering and exact visual comparison are separate gates.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = __pptxRuntime.playwright();
const { PNG } = require(process.env.PNGJS_MODULE || 'pngjs');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const root = option('--root', __pptxRuntime.repoRoot);
const corpus = path.resolve(option('--corpus', process.env.PPTX_CORPUS_CACHE || require('node:os').tmpdir() + '/sentry-pptx-corpus'));
let pinnedInputs;
const out = path.resolve(option('--out', path.join(__pptxRuntime.outputDir, 'corpus-results')));
const baselineRoot = option('--baseline', process.env.PPTX_OFFICE_BASELINES_DIR || null);
const timeout = Number(option('--timeout', '180000'));
const concurrency = Math.max(1, Math.min(4, Number(option('--concurrency', '2'))));
const sourcePath = path.join(root, 'web/src/app/ui/mobile/viewers/pptx-viewer.js');
const sourceBytes = fs.readFileSync(sourcePath);
const { createViewerBundle, initAuditHost } = require('./viewer-bundle.cjs');
let bundle;
const jszipPath = path.join(root, 'web/src/assets/libs/jszip.min.js');
const cssPath = path.join(root, 'web/src/assets/app-modals.css');
const profiles = [{ id: 'desktop', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  { id: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }];
function comparePng(actualPath, expectedPath, diffPath) {
  const a = PNG.sync.read(fs.readFileSync(actualPath));
  const b = PNG.sync.read(fs.readFileSync(expectedPath));
  if (a.width !== b.width || a.height !== b.height) return { status: 'fail', reason: 'pixel-dimensions', actual: [a.width, a.height], expected: [b.width, b.height] };
  const diff = new PNG({ width: a.width, height: a.height });
  let differentPixels = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const different = a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3];
    if (different) differentPixels++;
    diff.data[i] = different ? 255 : 0; diff.data[i + 1] = 0; diff.data[i + 2] = 0; diff.data[i + 3] = different ? 255 : 0;
  }
  if (differentPixels) fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return { status: differentPixels ? 'fail' : 'pass', differentPixels, totalPixels: a.width * a.height, tolerance: 0, diff: differentPixels ? diffPath : null };
}
async function render(browser, input, profile) {
  const specimen=pinnedInputs.files.find(f=>f.path===input);if(!specimen)throw new Error('Input is not in authoritative selection');
  const relative = specimen.file;
  const id = specimen.id;
  const dir = path.join(out, id, profile.id);
  fs.mkdirSync(dir, { recursive: true });
  const bytes = fs.readFileSync(input);
  if(sha256(bytes)!==specimen.sha256)throw new Error('Pinned input changed before rendering');
  const result = { file: relative, id, profile: profile.id, inputSha256: sha256(bytes), inputVerification:specimen.integrity, bytes: bytes.length, viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, exceptions: [], console: [], logs: [], operationalStatus: 'fail', visualStatus: 'unverified', visualReason: 'No authenticated Microsoft PowerPoint visual baseline', playbackStatus: 'unverified', playbackReason: 'Animation, transition, audio and video playback require runtime and Microsoft timeline baselines', slides: [] };
  const context = await browser.newContext(profile);
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.on('pageerror', e => result.exceptions.push(String(e.stack || e)));
  page.on('console', m => result.console.push({ type: m.type(), text: m.text() }));
  try {
    await initAuditHost(page);await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="modal" class="modal"><div class="modal-panel"><div id="modalTitle"></div><div id="modalBody" class="modal-body"></div></div></div>');
    await page.addStyleTag({ path: cssPath });
    // Expand the modal scroll area for reproducible full-document capture.
    await page.addStyleTag({ content: 'html,body{margin:0;width:100%;background:#222}.modal.pptx-modal{position:relative!important;display:block!important;inset:auto!important;width:100%!important;height:auto!important}.modal.pptx-modal .modal-panel{position:relative!important;height:auto!important;max-height:none!important;width:100%!important;margin:0!important}.modal.pptx-modal .modal-body{height:auto!important;max-height:none!important;overflow:visible!important}.pptx-toolbar{position:relative!important}.pptx-stage{padding-top:8px!important;overflow:visible!important}' });
    await page.addScriptTag({ path: jszipPath });
    await page.addScriptTag({ content: 'window.__auditLogs=[];' + bundle.content });
    const evaluation = page.evaluate(async ({ base64, name }) => {
      const binary = atob(base64); const data = Uint8Array.from(binary, c => c.charCodeAt(0));
      const zip = await JSZip.loadAsync(data);
      const presentation = new DOMParser().parseFromString(await zip.file('ppt/presentation.xml').async('string'), 'application/xml');
      if (presentation.getElementsByTagName('parsererror').length) throw new Error('Invalid presentation XML');
      const ids = [...presentation.getElementsByTagNameNS('*', 'sldId')].map(e => e.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || e.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships', 'id'));
      const size = presentation.getElementsByTagNameNS('*', 'sldSz')[0];
      const relFile = zip.file('ppt/_rels/presentation.xml.rels');
      const rels = new DOMParser().parseFromString(relFile ? await relFile.async('string') : '', 'application/xml');
      const relMap = Object.fromEntries([...rels.getElementsByTagNameNS('*', 'Relationship')].map(e => [e.getAttribute('Id'), e.getAttribute('Target')]));
      const expectedOrder = ids.map(id => relMap[id] || null);
      const dynamicInventory = [];
      const xmlToPart = new Map();
      for (const part of Object.keys(zip.files).filter(n => /^ppt\/slides\/[^/]+\.xml$/.test(n))) {
        const rawXml = await zip.file(part).async('string');
        // Duplicate content cannot identify a unique source part, so keep ambiguity explicit.
        xmlToPart.set(rawXml, xmlToPart.has(rawXml) ? null : part);
        const xml = new DOMParser().parseFromString(rawXml, 'application/xml');
        const count = name => xml.getElementsByTagNameNS('*', name).length;
        dynamicInventory.push({ part, timing: count('timing'), transitions: count('transition'), videoFiles: count('videoFile'), audioFiles: count('audioFile'), media: count('media'), audioNodes: count('audio'), videoNodes: count('video') });
      }
      const mediaParts = Object.keys(zip.files).filter(n => /^ppt\/media\//.test(n) && !zip.files[n].dir);
      const actualOrder = [];
      window.audit.observeBuild(xml => actualOrder.push(xmlToPart.get(xml) ?? null));
      const rendered = await window.audit.renderPptxViewer({ blob: new Blob([data]), name, modalApi: {} });
      await document.fonts.ready;
      const normalizedExpectedOrder = expectedOrder.map(target => target ? new URL(target, 'https://audit.invalid/ppt/presentation.xml').pathname.slice(1) : null);
      const orderStatus = actualOrder.includes(null) || normalizedExpectedOrder.includes(null) ? 'unverified' : JSON.stringify(actualOrder) === JSON.stringify(normalizedExpectedOrder) ? 'pass' : 'fail';
      return { rendered, expectedCount: ids.length, expectedOrder, actualOrder, orderStatus, dynamicInventory, mediaParts, slideSizeEmu: size ? { w: Number(size.getAttribute('cx')), h: Number(size.getAttribute('cy')) } : null, fontDiagnostics: document.getElementById('modalBody').pptxFontDiagnostics || [], logs: window.__auditLogs, slides: [...document.querySelectorAll('.pptx-slide-canvas')].map(c => ({ width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight, png: c.toDataURL('image/png') })) };
    }, { base64: bytes.toString('base64'), name: path.basename(input) });
    let timer;
    const rendered = await Promise.race([evaluation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Render timeout ${timeout} ms`)), timeout); })]).finally(() => clearTimeout(timer));
    Object.assign(result, { expectedCount: rendered.expectedCount, expectedOrder: rendered.expectedOrder, actualOrder: rendered.actualOrder, orderStatus: rendered.orderStatus, dynamicInventory: rendered.dynamicInventory, mediaParts: rendered.mediaParts, slideSizeEmu: rendered.slideSizeEmu, actualCount: rendered.slides.length, viewerReturn: rendered.rendered, fontDiagnostics: rendered.fontDiagnostics, logs: rendered.logs });
    for (const [index, slide] of rendered.slides.entries()) {
      const filename = `slide-${String(index + 1).padStart(3, '0')}.png`;
      const png = Buffer.from(slide.png.split(',')[1], 'base64'); delete slide.png;
      fs.writeFileSync(path.join(dir, filename), png);
      result.slides.push({ number: index + 1, ...slide, canvasPng: path.join(dir, filename), pngSha256: sha256(png) });
      await page.locator('.pptx-slide').nth(index).screenshot({ path: path.join(dir, `slide-${String(index + 1).padStart(3, '0')}-screen.png`) });
    }
    await page.screenshot({ path: path.join(dir, 'fullpage.png'), fullPage: true });
    result.fullpage = path.join(dir, 'fullpage.png');
    result.operationalStatus = rendered.rendered === true && result.actualCount > 0 && result.actualCount === result.expectedCount && result.orderStatus !== 'fail' && !result.exceptions.length && !result.logs.length && !result.fontDiagnostics.some(d => d.code === 'fallback-font-load-failed' || d.code === 'embedded-font-load-failed') ? 'pass' : 'fail';
    if (baselineRoot) result.visualReason='Generic baseline metadata is not authenticated; use official-static-compare.cjs with strict Office capture provenance.';
  } catch (e) { result.exceptions.push(String(e.stack || e)); }
  finally { await context.close(); fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n'); }
  console.log(`${result.operationalStatus.toUpperCase()} operational / ${result.visualStatus.toUpperCase()} visual: ${relative} (${profile.id}) ${result.actualCount ?? 0}/${result.expectedCount ?? '?'} slides`);
  return result;
}
async function main() {
  bundle = await createViewerBundle(sourcePath, 'window.audit={renderPptxViewer,cleanupPptxViewer,observeBuild: observer=>{const native=buildSlideCanvas;buildSlideCanvas=async(...args)=>{observer(args[0]);return native(...args);};}};');
  fs.mkdirSync(out, { recursive: true });
  pinnedInputs=await loadCorpus({cache:corpus});
  const inputs = pinnedInputs.files.map(f=>f.path);
  if (!inputs.length) throw new Error(`No PPTX corpus in ${corpus}`);
  const browser = await chromium.launch(__pptxRuntime.launchOptions());
  const tasks = inputs.flatMap(file => profiles.map(profile => ({ file, profile })));
  const results = []; let cursor = 0;
  const startedAt = new Date().toISOString();
  try { await Promise.all(Array.from({ length: concurrency }, async () => { while (cursor < tasks.length) { const task = tasks[cursor++]; results.push(await render(browser, task.file, task.profile)); } })); }
  finally { await browser.close(); }
  results.sort((a, b) => a.file.localeCompare(b.file) || a.profile.localeCompare(b.profile));
  const corpusManifest = pinnedInputs.manifestPath;
  const report = { issue: 'SEN-2600', parentIssue: 'SEN-2597', startedAt, finishedAt: new Date().toISOString(), sourcePath, sourceSha256: bundle.sourceSha256, dependencyHashes: bundle.dependencyHashes, bundleSha256: bundle.bundleSha256, changedDependencies: bundle.changedDependencies(), sourceCommit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceChangedDuringRun: bundle.changedDependencies().length > 0, jszipSha256: sha256(fs.readFileSync(jszipPath)), cssSha256: sha256(fs.readFileSync(cssPath)), chromiumVersion: await browser.version(), corpusManifest: corpusManifest ? { path: corpusManifest, sha256: sha256(fs.readFileSync(corpusManifest)) } : null, comparisonPolicy: 'exact RGBA, tolerance 0; no baseline means unverified, never pass; static runs never prove playback conformance', results };
  report.status = report.sourceChangedDuringRun ? 'fail' : results.some(r => r.operationalStatus === 'fail' || r.visualStatus === 'fail' || r.playbackStatus === 'fail') ? 'fail' : report.sourceChangedDuringRun || results.some(r => r.visualStatus !== 'pass' || r.playbackStatus !== 'pass') ? 'unverified' : 'pass';
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const previousBootstrapError = path.join(out, 'bootstrap-error.json');
  if (fs.existsSync(previousBootstrapError)) fs.unlinkSync(previousBootstrapError);
  console.log(`Overall: ${report.status}; ${results.length} document/profile runs; source ${report.sourceSha256}`);
  process.exitCode = report.status === 'fail' ? 1 : report.status === 'unverified' ? 3 : 0;
}
function selfTest() {
  const dir = path.join(out, 'comparator-self-test'); fs.mkdirSync(dir, { recursive: true });
  const a = new PNG({ width: 2, height: 2 }); a.data.fill(255);
  const original = path.join(dir, 'original.png'), changed = path.join(dir, 'changed.png'), resized = path.join(dir, 'resized.png');
  fs.writeFileSync(original, PNG.sync.write(a)); a.data[0] = 254; fs.writeFileSync(changed, PNG.sync.write(a));
  fs.writeFileSync(resized, PNG.sync.write(new PNG({ width: 1, height: 1 })));
  const checks = [comparePng(original, original, path.join(dir, 'same-diff.png')).status === 'pass', comparePng(original, changed, path.join(dir, 'changed-diff.png')).differentPixels === 1, comparePng(original, resized, path.join(dir, 'resized-diff.png')).reason === 'pixel-dimensions'];
  if (!checks.every(Boolean)) throw new Error('Exact PNG comparator self-test failed');
  console.log('PASS exact PNG comparator: identical accepted, 1/255 channel difference rejected, size difference rejected');
}
if (require.main === module) (args.includes('--self-test') ? Promise.resolve().then(selfTest) : main()).catch(e => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'bootstrap-error.json'), JSON.stringify({ issue: 'SEN-2600', timestamp: new Date().toISOString(), sourcePath, sourceSha256: sha256(sourceBytes), status: 'blocked', operationalStatus: 'not-executed', visualStatus: 'unverified', playbackStatus: 'unverified', error: String(e.stack || e) }, null, 2) + '\n');
  console.error(e); process.exitCode = 2;
});
module.exports = { comparePng };
