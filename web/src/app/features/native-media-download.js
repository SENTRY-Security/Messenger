// Native background media download (mid-term migration Tier 2, option B).
//
// When the native app injects `window.USE_NATIVE_MEDIA_DOWNLOAD = true`, a
// single-shot encrypted media download is routed through a native background
// `URLSession` (survives app suspension) instead of a JS `fetch`. The native
// side stages the (still-encrypted) bytes to disk and serves them back over the
// `sentry-dl://` scheme, so the ciphertext never crosses the JS bridge as
// base64. The web then decrypts exactly as before.
//
// Fully fallback-safe: any failure (no native, flag off, handback fetch blocked,
// download error) throws, and the caller falls back to the normal web download.

import { isNativeApp, postNativeMessage, onNativeEvent } from './native-bridge.js';

export function isNativeMediaDownloadMode() {
  return typeof window !== 'undefined'
    && window.USE_NATIVE_MEDIA_DOWNLOAD === true
    && isNativeApp();
}

let seq = 0;
const pending = new Map(); // id → { resolve, reject }
let wired = false;

function ensureWired() {
  if (wired) return;
  wired = true;
  onNativeEvent('bgDownloadDone', (d) => {
    const p = d && pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d);
    else p.reject(new Error(d.error || ('bg download failed (status ' + (d.status || 0) + ')')));
  });
}

/**
 * Download an encrypted media blob via the native background session and return
 * its bytes (Uint8Array). Throws on any failure so the caller can fall back.
 */
export async function nativeBackgroundDownload(url) {
  if (!isNativeMediaDownloadMode() || !url) throw new Error('native media download unavailable');
  ensureWired();
  const id = `dl${++seq}`;
  await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Safety timeout so a lost event doesn't hang the download forever.
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('bg download timeout')); }
    }, 120_000);
    postNativeMessage('bgDownload', { id, url });
  });
  try {
    // Read the staged ciphertext over the app-served scheme (no base64 bridge).
    const res = await fetch(`${'sentry-dl'}://file/${id}`);
    if (!res.ok) throw new Error('bg handback fetch failed (status ' + res.status + ')');
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    postNativeMessage('bgDownloadClear', { id });
  }
}
