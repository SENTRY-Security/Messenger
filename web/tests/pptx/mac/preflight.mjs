#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function collectMacPreflight() {
  const record = {schema: 'powerpoint-mac-preflight/v1', timestamp: new Date().toISOString(),
    platform: process.platform, architecture: process.arch, result: 'unavailable',
    applicationLaunched: false, sourceOpened: false, nativeExportExecuted: false,
    fullMicrosoftAcceptance: 'unverified', recordingPermission: 'not-probed'};
  if (process.platform !== 'darwin') return {...record, reason: 'Actual macOS host required'};
  const application = process.env.MAC_POWERPOINT_APP || '/Applications/Microsoft PowerPoint.app';
  const plist = path.join(application, 'Contents/Info.plist');
  if (!fs.existsSync(plist)) return {...record, reason: 'Installed Microsoft PowerPoint application not found'};
  const run = (exe, args) => {
    const r = spawnSync(exe, args, {encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024});
    if (r.error || r.status !== 0) throw Error('Read-only readiness command failed: ' + path.basename(exe));
    return r.stdout.trim();
  };
  const read = key => run('/usr/libexec/PlistBuddy', ['-c', 'Print :' + key, plist]);
  record.powerPoint = {bundleIdentifier: read('CFBundleIdentifier'), version: read('CFBundleShortVersionString'),
    build: read('CFBundleVersion'), infoPlistSHA256: sha(fs.readFileSync(plist))};
  if (record.powerPoint.bundleIdentifier !== 'com.microsoft.Powerpoint') throw Error('Unexpected application bundle identifier');
  record.macOS = {version: run('/usr/bin/sw_vers', ['-productVersion']), build: run('/usr/bin/sw_vers', ['-buildVersion'])};
  const dictionary = run('/usr/bin/sdef', [application]);
  record.scriptingDictionary = {sha256: sha(Buffer.from(dictionary)), bytes: Buffer.byteLength(dictionary),
    readable: dictionary.includes('<dictionary'), exportCommandListed: /<command\b[^>]*name="export"/.test(dictionary)};
  record.result = record.scriptingDictionary.readable ? 'installed-app-observed-unexecuted' : 'dictionary-unavailable';
  return record;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--help') console.log('node web/tests/pptx/mac/preflight.mjs [output.json]\nRead-only macOS/app/version/sdef inspection; does not launch PowerPoint or claim export readiness.');
  else try {
    const r = collectMacPreflight(), text = JSON.stringify(r, null, 2) + '\n';
    if (process.argv[2]) fs.writeFileSync(process.argv[2], text); else process.stdout.write(text);
    // Even installed-app observation is not collection or full acceptance.
    process.exitCode = 3;
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
