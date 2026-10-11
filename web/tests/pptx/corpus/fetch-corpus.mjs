import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runFile = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_INFLATED = 256 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// Verify every ZIP member, including data-descriptor archives, without extracting paths.
// This is a package-integrity check, never a rendering or Office conformance verdict.
export function verifyZip(bytes, specimen) {
  if (bytes.length > MAX_ARCHIVE || bytes.length < 22) throw new Error('Invalid archive size');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('ZIP end-of-central-directory missing');
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) throw new Error('Multi-disk ZIP is unsupported');
  if (count === 0xffff || centralSize === 0xffffffff || cursor === 0xffffffff) throw new Error('ZIP64 is unsupported');
  const centralEnd = cursor + centralSize;
  if (!count || centralEnd !== end) throw new Error('Invalid central-directory bounds');
  let totalInflated = 0;
  const entries = new Map();
  const rawNames = new Set();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > centralEnd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid central-directory entry');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCRC = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const originalSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > centralEnd || flags & 1 || ![0, 8].includes(method)) throw new Error('Unsupported or invalid ZIP member');
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const nameKey = rawName.toString('hex');
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (rawNames.has(nameKey) || name.startsWith('/') || name.split(/[\\/]/).includes('..')) throw new Error('Duplicate or unsafe ZIP member path');
    rawNames.add(nameKey);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid local ZIP header');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const dataStart = localOffset + 30 + localNameLength + bytes.readUInt16LE(localOffset + 28);
    if (!bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(rawName) || bytes.readUInt16LE(localOffset + 8) !== method) throw new Error('Local/central ZIP metadata mismatch');
    if (dataStart + compressedSize > bytes.length || originalSize > MAX_INFLATED - totalInflated) throw new Error('Invalid ZIP data bounds or inflated size');
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const payload = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(originalSize, 1) });
    if (payload.length !== originalSize || crc32(payload) !== expectedCRC) throw new Error(`ZIP CRC or size mismatch: ${name}`);
    totalInflated += payload.length;
    // Keep only package XML needed for inventory; media is checked then released.
    entries.set(name, name === 'ppt/presentation.xml' ? payload : null);
    cursor = next;
  }
  if (cursor !== centralEnd || !entries.has('[Content_Types].xml') || !entries.has('_rels/.rels')) throw new Error('Incomplete OPC package');
  let slideCount = null;
  if (specimen.format === 'pptx') {
    const presentation = entries.get('ppt/presentation.xml');
    if (!presentation) throw new Error('Presentation part missing');
    slideCount = (presentation.toString('utf8').match(/<(?:[A-Za-z_][\w.-]*:)?sldId(?=[\s/>])/g) || []).length;
    if (slideCount !== specimen.features.slides) throw new Error(`Slide inventory mismatch: ${slideCount} vs ${specimen.features.slides}`);
  } else if (specimen.format === 'xlsx') {
    if (!entries.has('xl/workbook.xml')) throw new Error('Supplementary workbook part missing');
  } else throw new Error('Unknown specimen format');
  return { members: count, inflatedBytes: totalInflated, slides: slideCount, crcVerified: true };
}

export function verifySpecimen(bytes, specimen) {
  if (bytes.length !== specimen.size_bytes) throw new Error('Source byte-count mismatch');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== specimen.sha256) throw new Error('Source SHA256 mismatch');
  return { sha256, ...verifyZip(bytes, specimen) };
}

function validateManifest(manifest) {
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported corpus manifest');
  const ids = new Set();
  for (const item of manifest.files) {
    if (ids.has(item.id) || !item.id || path.basename(item.file) !== item.file) throw new Error('Duplicate ID or unsafe cache filename');
    ids.add(item.id);
    if (!/^[a-f0-9]{40}$/.test(item.source_commit) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Unpinned specimen');
    const url = new URL(item.raw_url);
    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || decodeURIComponent(url.pathname) !== `/${item.source_repo}/${item.source_commit}/${item.source_path}` || url.search || url.hash) throw new Error('Source URL does not match pinned repository path');
    if (!item.license || !item.license_files?.length) throw new Error('License provenance missing');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node fetch-corpus.mjs [--cache DIR] [--manifest FILE] [--verify-only] [--id ID ...]');
    console.log('Downloads pinned specimens and verifies SHA256/ZIP CRC/package inventory. Microsoft rendering/playback acceptance remains unverified.');
    console.log('Cache: PPTX_CORPUS_CACHE or system temporary directory. Network fetch preserves curl proxy and TLS settings.');
    return;
  }
  let manifestPath = path.join(here, 'manifest.json');
  let cache = process.env.PPTX_CORPUS_CACHE || path.join(os.tmpdir(), 'sentry-pptx-corpus');
  let verifyOnly = false;
  const requested = [];
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--verify-only') verifyOnly = true;
    else if (['--cache', '--manifest', '--id'].includes(option)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Value required for ${option}`);
      if (option === '--cache') cache = value;
      else if (option === '--manifest') manifestPath = value;
      else requested.push(value);
    } else throw new Error(`Unknown option: ${option}`);
  }
  manifestPath = path.resolve(manifestPath);
  cache = path.resolve(cache);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  for (const id of requested) if (!manifest.files.some(item => item.id === id)) throw new Error(`Unknown specimen ID: ${id}`);
  const selected = manifest.files.filter(item => !requested.length || requested.includes(item.id));
  await fs.mkdir(cache, { recursive: true });
  const results = [];
  const resolved = [];
  for (const item of selected) {
    const destination = path.join(cache, item.file);
    const temporary = `${destination}.${process.pid}.download`;
    try {
      for (const license of item.license_files) await fs.access(path.resolve(path.dirname(manifestPath), license));
      let bytes = await fs.readFile(destination).catch(() => null);
      let checks;
      if (bytes) {
        try { checks = verifySpecimen(bytes, item); }
        catch (error) { if (verifyOnly) throw error; }
      }
      if (!checks) {
        if (verifyOnly) throw new Error('Cached specimen missing');
        // curl preserves inherited HTTP(S)_PROXY and CA trust. No direct-route or insecure fallback.
        await runFile('curl', ['--fail', '--location', '--proto', '=https', '--tlsv1.2', '--silent', '--show-error', '--max-time', '120', '--max-filesize', String(MAX_ARCHIVE), '--retry', '2', '--retry-delay', '1', '--output', temporary, '--', item.raw_url], { maxBuffer: 65536 });
        bytes = await fs.readFile(temporary);
        checks = verifySpecimen(bytes, item);
        await fs.rename(temporary, destination);
      }
      results.push({ id: item.id, status: 'structure-verified', ...checks });
      resolved.push({ ...item, path: destination });
      console.log(`${item.id}: structure-verified${checks.slides === null ? '' : ` (${checks.slides} slides)`}`);
    } catch (error) {
      results.push({ id: item.id, status: 'failed', error: String(error.message || error).slice(0,1000) });
      console.error(`${item.id}: failed`);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  const report = { manifest: manifestPath, selected: selected.length, fullManifestCount: manifest.files.length, results, microsoftAcceptance: 'unverified', structuralVerificationIsRenderingAcceptance: false };
  const stem = path.basename(manifestPath, '.json');
  await fs.writeFile(path.join(cache, `${stem}-fetch-report.json`), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(cache, `${stem}-resolved.json`), JSON.stringify({ ...manifest, files: resolved }, null, 2));
  console.log(`Structure verified: ${resolved.length}/${selected.length}; Microsoft rendering/playback acceptance: unverified.`);
  if (resolved.length !== selected.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
