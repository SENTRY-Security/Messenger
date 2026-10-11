#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifySpecimen, crc32 } from '../corpus/fetch-corpus.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
function artifact(root, file) {
  requireValue(nonempty(file) && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'Unsafe artifact path');
  const candidate = fs.realpathSync(path.join(root, file));
  requireValue(candidate.startsWith(fs.realpathSync(root) + path.sep), 'Artifact escapes collection directory');
  return fs.readFileSync(candidate);
}
export function verifyPNG(bytes) {
  requireValue(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Invalid PNG signature');
  let offset = 8, header, end = false; const compressed = [];
  while (offset < bytes.length) {
    requireValue(offset + 12 <= bytes.length, 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    requireValue(offset + length + 12 <= bytes.length, 'PNG chunk out of bounds');
    requireValue(crc32(bytes.subarray(offset + 4, offset + 8 + length)) === bytes.readUInt32BE(offset + 8 + length), 'PNG CRC mismatch');
    if (type === 'IHDR') {
      requireValue(offset === 8 && length === 13 && !header, 'Invalid PNG IHDR');
      header = {width: bytes.readUInt32BE(offset + 8), height: bytes.readUInt32BE(offset + 12),
        bitDepth: bytes[offset + 16], colorType: bytes[offset + 17], interlace: bytes[offset + 20]};
      requireValue(header.width > 0 && header.height > 0 && header.width * header.height <= 50000000 &&
        header.bitDepth === 8 && [0, 2, 4, 6].includes(header.colorType) && !header.interlace &&
        bytes[offset + 18] === 0 && bytes[offset + 19] === 0, 'Unsupported PNG dimensions or encoding');
    } else if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    else if (type === 'IEND') { requireValue(length === 0 && offset + 12 === bytes.length, 'Invalid PNG end'); end = true; }
    else requireValue(type === 'PLTE' || /^[a-z]/.test(type), 'Unknown critical PNG chunk');
    offset += length + 12;
  }
  requireValue(header && end && compressed.length, 'Incomplete PNG');
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[header.colorType];
  const stride = header.width * channels + 1, size = stride * header.height;
  const raster = inflateSync(Buffer.concat(compressed), {maxOutputLength: size});
  requireValue(raster.length === size, 'PNG inflated size mismatch');
  for (let y = 0; y < header.height; y++) requireValue(raster[y * stride] <= 4, 'Invalid PNG row filter');
  return {...header, sha256: digest(bytes), crcVerified: true};
}
export function readOriginalSlides(file) {
  const r = spawnSync(process.env.PYTHON || 'python3', [path.join(here, 'source-slides.py'), file],
    {encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024});
  if (r.error || r.status !== 0) throw Error('Original XML/relationship inspection failed; installed Python 3 is required');
  return JSON.parse(r.stdout);
}
export async function validateMacStatic({receiptFile, sourceFile, manifestFile = path.join(here, '../corpus/manifest.json')}) {
  const manifestBytes = fs.readFileSync(manifestFile), manifest = JSON.parse(manifestBytes);
  const receipt = JSON.parse(fs.readFileSync(receiptFile)), root = path.dirname(path.resolve(receiptFile));
  requireValue(manifest.schema_version === 1 && Array.isArray(manifest.files) && manifest.files.length > 0 &&
    new Set(manifest.files.map(x => x.id)).size === manifest.files.length, 'Invalid authoritative corpus manifest');
  requireValue(receipt.schema === 'powerpoint-mac-static/v1', 'Unexpected Mac collection schema');
  const item = manifest.files.find(x => x.id === receipt.sourceId);
  requireValue(item && item.format === 'pptx', 'Unknown pinned PPTX source');
  const integrity = verifySpecimen(fs.readFileSync(sourceFile), item);
  requireValue(receipt.sourceSHA256Before === item.sha256 && receipt.sourceSHA256After === item.sha256 &&
    receipt.sourceCommit === item.source_commit && receipt.sourceURL === item.raw_url, 'Original source provenance mismatch');
  requireValue(receipt.powerPoint?.bundleIdentifier === 'com.microsoft.Powerpoint' && nonempty(receipt.powerPoint.version) &&
    nonempty(receipt.powerPoint.build) && nonempty(receipt.macOS?.version) && nonempty(receipt.macOS?.build), 'Missing native PowerPoint/Mac version provenance');
  requireValue(nonempty(receipt.collectedAt) && Number.isFinite(Date.parse(receipt.collectedAt)), 'Missing collection timestamp');
  const capture = receipt.capture;
  requireValue(capture?.method === 'PowerPoint File > Export > PNG' && capture.unmodifiedOriginalOpened === true &&
    capture.originalSaved === false && capture.repairDialogObserved === false, 'Original native export contract not met');
  const original = readOriginalSlides(sourceFile);
  requireValue(Number.isInteger(capture.width) && capture.width > 0 && capture.height ===
    Math.round(capture.width * original.sizeEMU.cy / original.sizeEMU.cx), 'Export dimensions do not preserve original slide aspect');
  requireValue(Array.isArray(receipt.slides) && receipt.slides.length === original.slides.length &&
    original.slides.length === item.features.slides, 'Missing or extra exported pages');
  requireValue(Array.isArray(receipt.fonts?.substitutionWarnings) && nonempty(receipt.fonts.snapshotFile), 'Font inventory/warning provenance missing');
  const fontInventory = artifact(root, receipt.fonts.snapshotFile);
  requireValue(fontInventory.length > 0 && digest(fontInventory) === receipt.fonts.sha256, 'Font inventory empty or SHA mismatch');
  const filenames = new Set(), pages = [];
  for (let index = 0; index < original.slides.length; index++) {
    const expected = original.slides[index], page = receipt.slides[index];
    requireValue(page.number === expected.number && page.pptxSlideId === expected.pptxSlideId &&
      page.relationshipId === expected.relationshipId && page.part === expected.part && page.hidden === expected.hidden,
      'Exported slide identity/order mismatch');
    requireValue(!filenames.has(page.file), 'Duplicate PNG artifact'); filenames.add(page.file);
    const png = verifyPNG(artifact(root, page.file));
    requireValue(png.width === capture.width && png.height === capture.height && page.width === png.width &&
      page.height === png.height && page.sha256 === png.sha256, 'PNG dimension/hash mismatch');
    pages.push({...expected, file: page.file, ...png});
  }
  // A collector's declaration is reviewable provenance, never proof of Microsoft authorship or pixel equality.
  requireValue(verifySpecimen(fs.readFileSync(sourceFile), item).sha256 === integrity.sha256, 'Original changed during import');
  return {schema: 'powerpoint-mac-static-validation/v1', sourceId: item.id, sourceSHA256: item.sha256,
    sourceCommit: item.source_commit, sourceURL: item.raw_url, manifestSHA256: digest(manifestBytes),
    integrity, pages, collectorDeclaredEngine: 'Microsoft PowerPoint for Mac',
    result: 'structure-verified-native-provenance-review-required', contentIdentityVerified: false,
    pixelComparisonPass: false, playbackPass: false, fullMicrosoftAcceptance: 'unverified',
    fontSubstitutionWarnings: receipt.fonts.substitutionWarnings,
    limits: ['No native Mac collection has been performed by this importer.',
      'Receipt/version claims require independent review against actual collection evidence.',
      'Static export does not verify animations, transitions, audio, video or bookmark timing.']};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--help') console.log('node web/tests/pptx/mac/import-static.mjs receipt.json original.pptx output.json [manifest.json]\nValidates unchanged pinned input, all ZIP CRCs, original slide relationships and raw PNGs; exits 3 for structurally valid/unverified collection.');
  else try {
    const [, , receiptFile, sourceFile, outputFile, manifestFile] = process.argv;
    requireValue(receiptFile && sourceFile && outputFile, 'receipt, original PPTX and output file are required');
    requireValue(!fs.existsSync(outputFile), 'Validation output already exists; preserve prior collection results');
    requireValue(![receiptFile, sourceFile, manifestFile].filter(Boolean).some(f => path.resolve(f) === path.resolve(outputFile)), 'Output must not overwrite an input');
    const result = await validateMacStatic({receiptFile, sourceFile, manifestFile});
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({sourceId: result.sourceId, pages: result.pages.length, result: result.result, fullMicrosoftAcceptance: 'unverified'})); process.exitCode = 3;
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
