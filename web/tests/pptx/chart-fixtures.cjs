 'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { inflateRawSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');
const runtime = require('./runtime.cjs');
// The original pinned manifest is authoritative; a resolved manifest supplies paths only.
function filesFromVerifiedZip(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && !(bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length)) end--;
  if (end < 0) throw Error('Verified ZIP lost end-of-directory');
  let cursor = bytes.readUInt32LE(end + 16); const count = bytes.readUInt16LE(end + 10), files = {};
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(cursor + 10), length = bytes.readUInt32LE(cursor + 20), nameLength = bytes.readUInt16LE(cursor + 28), flags = bytes.readUInt16LE(cursor + 8);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1');
    const offset = bytes.readUInt32LE(cursor + 42), start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    if (/\.(?:xml|rels)$/.test(name)) { const compressed = bytes.subarray(start, start + length), payload = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, bytes.readUInt32LE(cursor + 24)) }); files[name] = payload.toString('utf8'); }
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  return files;
}
module.exports = async function chartFixtures() {
  const verify = await import(pathToFileURL(path.join(__dirname, 'corpus/fetch-corpus.mjs')).href);
  const provenance = [], extractDir = path.join(runtime.outputDir, 'fixtures/chart-sources'); fs.mkdirSync(extractDir, {recursive:true});
  const loadManifest = (name, cache) => { const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', name + '.json'), 'utf8')); const resolvedFile = path.join(cache, name + '-resolved.json'); const resolved = fs.existsSync(resolvedFile) ? JSON.parse(fs.readFileSync(resolvedFile, 'utf8')).files : []; return { manifest, cache, resolved }; };
  const native = loadManifest('manifest', process.env.PPTX_CORPUS_CACHE || path.join(os.tmpdir(), 'sentry-pptx-corpus'));
  const supplementary = loadManifest('supplementary-chartml', process.env.PPTX_CHARTML_CACHE || path.join(os.tmpdir(), 'sentry-chartml-corpus'));
  const read = (inventory, id) => {
    const specimen = inventory.manifest.files.find(f => f.id === id); if (!specimen) throw Error('Missing pinned chart specimen: ' + id);
    const file = inventory.resolved.find(f => f.id === id)?.path || path.join(inventory.cache, specimen.file);
    if (!fs.existsSync(file)) throw Error('Missing chart corpus input ' + file + '; run corpus/fetch-corpus.mjs for both manifests before this suite.');
    const bytes = fs.readFileSync(file), checked = verify.verifySpecimen(bytes, specimen), files = filesFromVerifiedZip(bytes);
    const extracted = [];
    for (const [part, xml] of Object.entries(files)) if (/^(ppt|xl)\/charts\/chart(?:Ex)?\d+\.xml$/.test(part)) { const target = path.join(extractDir, id + '__' + part.replaceAll('/', '_')); fs.writeFileSync(target, xml); extracted.push({part,sha256:runtime.digest(Buffer.from(xml)),fixture:path.relative(runtime.outputDir,target)}); }
    provenance.push({id,kind:specimen.format === 'pptx' ? 'authentic native PPTX input' : 'authentic supplementary XLSX input; not native PPTX or Microsoft golden',sourceUrl:specimen.source_url,sourceCommit:specimen.source_commit,sourceSha256:checked.sha256,crcVerified:checked.crcVerified,extracted}); return files;
  };
  const names = ['scatter-chart','bar-chart','line-chart','pie-chart','radar-chart','chart-picture-bg','chart-texture-bg','chart-slide-bg'];
  const corpus = names.map(name => { const files = read(native, 'apache__poi__' + name), part = Object.keys(files).find(p=>/^ppt\/charts\/chart\d+\.xml$/.test(p)); if (!part) throw Error('Pinned native specimen has no ChartML part: ' + name); return {file:name+'.pptx',part,xml:files[part]}; });
  const funnelFiles = read(native, 'LibreOffice__core__funnel-pp1'), funnelXml = funnelFiles['ppt/charts/chartEx1.xml']; if (!funnelXml) throw Error('Pinned native funnel ChartEx part missing');
  const workbookFiles = read(supplementary, 'LibreOffice__core__SimpleHistogram');
  const chartExWorkbooks = ['boxWhisker','waterfall','treemap','sunburst'].map(name => ({name,part:'xl/charts/chartEx1.xml',files:read(supplementary,'LibreOffice__core__'+name)}));
  const nativeChartEx = ['01','02','03'].map(number => { const name='Of16-'+number, files=read(native,'dotnet__Open-XML-SDK__'+name); return {name,part:'ppt/charts/chartEx1.xml',files}; });
  const threeDNative = {id:'ChristopherVR__ooxml__three-d-charts',files:read(native,'ChristopherVR__ooxml__three-d-charts')};
  const styledNative={id:'scanny__python-pptx__cht-chart-type',part:'ppt/charts/chart7.xml',files:read(native,'scanny__python-pptx__cht-chart-type')};
  fs.writeFileSync(path.join(runtime.outputDir,'chart-corpus-provenance.json'),JSON.stringify({provenance,fullAcceptance:'unverified'},null,2));
  return {corpus,funnelXml,workbookFiles,chartExWorkbooks,nativeChartEx,threeDNative,styledNative,provenance};
};

module.exports.filesFromVerifiedZip = filesFromVerifiedZip;
