#!/usr/bin/env node
// Generated PNGs exercise import guards only; never presented as native Microsoft reference images.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {validateMacStatic, verifyPNG, readOriginalSlides} from './import-static.mjs';
import {collectMacPreflight} from './preflight.mjs';
import {crc32} from '../corpus/fetch-corpus.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), manifest = JSON.parse(fs.readFileSync(path.join(here, '../corpus/manifest.json')));
const item = manifest.files.find(x => x.id === 'scanny__python-pptx__txt-text');
const cache = process.env.PPTX_CORPUS_CACHE || path.join(os.tmpdir(), 'sentry-pptx-corpus');
const source = path.join(cache, item.file), original = readOriginalSlides(source), root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-import-guard-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const chunk = (type, data) => {const name = Buffer.from(type), b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); name.copy(b, 4); data.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return b;};
const width = 4, height = Math.round(width * original.sizeEMU.cy / original.sizeEMU.cx), ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
let assertions = 0;
try {
  assert.equal(verifyPNG(png).height, height); assertions++;
  const fonts = Buffer.from('VALIDATOR TEST INVENTORY; no actual Mac font capture\n'); fs.writeFileSync(path.join(root, 'fonts.txt'), fonts);
  const receipt = {schema: 'powerpoint-mac-static/v1', sourceId: item.id, sourceCommit: item.source_commit, sourceURL: item.raw_url,
    sourceSHA256Before: item.sha256, sourceSHA256After: item.sha256, collectedAt: new Date().toISOString(),
    powerPoint: {bundleIdentifier: 'com.microsoft.Powerpoint', version: 'TEST', build: 'TEST'}, macOS: {version: 'TEST', build: 'TEST'},
    capture: {method: 'PowerPoint File > Export > PNG', width, height, unmodifiedOriginalOpened: true, originalSaved: false, repairDialogObserved: false},
    fonts: {snapshotFile: 'fonts.txt', sha256: sha(fonts), substitutionWarnings: []},
    slides: original.slides.map(s => {const file = `test-slide-${s.number}.png`; fs.writeFileSync(path.join(root, file), png); return {...s, file, width, height, sha256: sha(png)};})};
  const receiptFile = path.join(root, 'receipt.json');
  const validate = async r => {fs.writeFileSync(receiptFile, JSON.stringify(r)); return validateMacStatic({receiptFile, sourceFile: source});};
  const result = await validate(receipt); assert.equal(result.fullMicrosoftAcceptance, 'unverified'); assert.equal(result.contentIdentityVerified, false); assert.equal(result.playbackPass, false); assertions += 3;
  const reject = async (mutate, pattern) => {const r = structuredClone(receipt); mutate(r); await assert.rejects(validate(r), pattern); assertions++;};
  await reject(r => r.sourceSHA256After = '0'.repeat(64), /provenance/);
  await reject(r => r.sourceCommit = '0'.repeat(40), /provenance/);
  await reject(r => r.slides.pop(), /pages/);
  await reject(r => r.slides[0].pptxSlideId = '999', /identity/);
  await reject(r => r.slides[0].part = 'ppt/slides/slide999.xml', /identity/);
  await reject(r => r.slides[0].file = '../outside.png', /Unsafe/);
  await reject(r => r.slides[1].file = r.slides[0].file, /Duplicate/);
  await reject(r => r.capture.height++, /aspect/);
  await reject(r => r.capture.originalSaved = true, /contract/);
  await reject(r => r.capture.repairDialogObserved = true, /contract/);
  await reject(r => r.powerPoint.bundleIdentifier = 'other.renderer', /native/);
  await reject(r => r.fonts.sha256 = '0'.repeat(64), /inventory/);
  const damaged = Buffer.from(png); damaged[40] ^= 1; assert.throws(() => verifyPNG(damaged), /CRC/); assertions++;
  fs.writeFileSync(path.join(root, receipt.slides[0].file), damaged); await assert.rejects(validate(receipt), /CRC/); assertions++;
  if (process.platform !== 'darwin') {const p = collectMacPreflight(); assert.equal(p.result, 'unavailable'); assert.equal(p.nativeExportExecuted, false); assertions += 2;}
  console.log(JSON.stringify({assertions, realPinnedInputVerified: item.id, nativeMacCollectionExecuted: false, fullMicrosoftAcceptance: 'unverified'}));
} finally {fs.rmSync(root, {recursive: true, force: true});}
