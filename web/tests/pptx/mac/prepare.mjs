#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {verifySpecimen} from '../corpus/fetch-corpus.mjs';
import {readOriginalSlides} from './import-static.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
try {
  if (process.argv[2] === '--help') {
    console.log('node web/tests/pptx/mac/prepare.mjs specimen-id new-output-directory [cache-directory]\nWrites an explicitly unexecuted collection template after full pinned PPTX verification.');
  } else {
    const [, , id, output, cacheArg] = process.argv;
    if (!id || !output) throw Error('Specimen ID and new output directory are required');
    if (fs.existsSync(output)) throw Error('Collection directory already exists; do not merge runs');
    const manifest = JSON.parse(fs.readFileSync(path.join(here, '../corpus/manifest.json')));
    const item = manifest.files.find(x => x.id === id);
    if (!item || item.format !== 'pptx') throw Error('Unknown pinned native PPTX specimen');
    const cache = cacheArg || process.env.PPTX_CORPUS_CACHE || path.join(os.tmpdir(), 'sentry-pptx-corpus');
    const source = path.join(cache, item.file), integrity = verifySpecimen(fs.readFileSync(source), item);
    const original = readOriginalSlides(source);
    fs.mkdirSync(output, {recursive: true});
    fs.writeFileSync(path.join(output, 'source-plan.json'), JSON.stringify({schema: 'powerpoint-mac-source-plan/v1',
      sourceId: id, sourceFile: item.file, sourceSHA256: item.sha256, sourceCommit: item.source_commit,
      sourceURL: item.raw_url, integrity, ...original, collectionExecuted: false, fullMicrosoftAcceptance: 'unverified'}, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'receipt.template.json'), JSON.stringify({schema: 'powerpoint-mac-static/v1',
      sourceId: id, sourceCommit: item.source_commit, sourceURL: item.raw_url,
      sourceSHA256Before: null, sourceSHA256After: null, collectedAt: null,
      powerPoint: {bundleIdentifier: 'com.microsoft.Powerpoint', version: null, build: null}, macOS: {version: null, build: null},
      capture: {method: 'PowerPoint File > Export > PNG', width: 960, height: Math.round(960 * original.sizeEMU.cy / original.sizeEMU.cx),
        unmodifiedOriginalOpened: null, originalSaved: null, repairDialogObserved: null},
      fonts: {snapshotFile: null, sha256: null, substitutionWarnings: []},
      slides: original.slides.map(s => ({number: s.number, pptxSlideId: s.pptxSlideId, relationshipId: s.relationshipId,
        part: s.part, hidden: s.hidden, file: null, sha256: null, width: null, height: null}))}, null, 2) + '\n');
    console.log(JSON.stringify({verifiedSource: id, slides: original.slides.length, collectionExecuted: false}));
    process.exitCode = 3;
  }
} catch (e) {console.error(e.message); process.exitCode = 2;}
