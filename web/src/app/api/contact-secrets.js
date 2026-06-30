import { fetchWithTimeout, jsonReq } from '../core/http.js';
import { buildAccountPayload } from '../core/store.js';
import { log } from '../core/log.js';
import { isNativeCacheMode, cacheGet, cachePut } from '../features/native-cache.js';

function buildAccountHeaders() {
  const payload = buildAccountPayload();
  const headers = {};
  if (payload.account_token) headers['X-Account-Token'] = payload.account_token;
  if (payload.account_digest) headers['X-Account-Digest'] = payload.account_digest;
  return headers;
}

function safeParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function uploadContactSecretsBackup({
  payload,
  checksum,
  snapshotVersion,
  entries,
  updatedAt,
  bytes,
  withDrState,
  deviceLabel,
  deviceId,
  reason
} = {}, fetchOptions = {}) {
  const overrides = { payload, reason: reason || 'auto' };
  if (checksum != null) overrides.checksum = checksum;
  if (snapshotVersion != null) overrides.snapshot_version = snapshotVersion;
  if (Number.isFinite(entries)) overrides.entries = entries;
  if (Number.isFinite(updatedAt)) overrides.updated_at = updatedAt;
  if (Number.isFinite(bytes)) overrides.bytes = bytes;
  if (Number.isFinite(withDrState)) overrides.with_dr_state = withDrState;
  if (deviceLabel) overrides.device_label = deviceLabel;
  if (deviceId) overrides.device_id = deviceId;
  const body = buildAccountPayload({ overrides });
  const request = jsonReq(body);
  const merged = { ...request, ...fetchOptions };
  const r = await fetchWithTimeout('/api/v1/contact-secrets/backup', merged, 20000);
  const data = safeParse(await r.text());
  log({ contactSecretsBackupUpload: { status: r.status, ok: r.ok } });
  return { r, data };
}

export async function fetchContactSecretsBackup({ limit = 1, version } = {}) {
  const headers = buildAccountHeaders();
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', String(limit));
  if (version) qs.set('version', String(version));
  const url = `/api/v1/contact-secrets/backup?${qs.toString()}`;

  // Native local cache (Tier 3): network-first, fall back to the cached ciphertext
  // when offline / on failure. The cached value is the encrypted backup payload —
  // the caller still decrypts in memory, so only ciphertext lives on disk.
  const cacheKey = isNativeCacheMode()
    ? `cs-backup:${buildAccountPayload().account_digest || ''}:${limit}:${version || ''}`
    : null;

  try {
    const r = await fetchWithTimeout(url, { method: 'GET', headers }, 20000);
    const text = await r.text();
    const data = safeParse(text);
    log({ contactSecretsBackupFetch: { status: r.status, ok: r.ok } });
    if (cacheKey && r.ok && text) cachePut(cacheKey, text);
    return { r, data };
  } catch (err) {
    if (cacheKey) {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        log({ contactSecretsBackupFetch: { fromCache: true } });
        return { r: { ok: true, status: 200, fromCache: true }, data: safeParse(cached) };
      }
    }
    throw err;
  }
}
