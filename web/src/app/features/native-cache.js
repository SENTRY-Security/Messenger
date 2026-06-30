// Native encrypted local cache (mid-term migration Tier 3, option A).
//
// When the native app injects `window.USE_NATIVE_LOCAL_CACHE = true`, the web can
// cache **encrypted** backend responses in a native Data-Protection store
// (`LocalCacheService`) for offline reads and faster launches. Only ciphertext is
// stored; the web still decrypts in memory. No-op on pure web / App Clip / when
// the flag is off — every getter resolves null and putters are ignored, so call
// sites transparently fall back to the network.

import { isNativeApp, postNativeMessage, onNativeEvent } from './native-bridge.js';

export function isNativeCacheMode() {
  return typeof window !== 'undefined'
    && window.USE_NATIVE_LOCAL_CACHE === true
    && isNativeApp();
}

let seq = 0;
const pending = new Map(); // rid → resolve
let wired = false;

function ensureWired() {
  if (wired) return;
  wired = true;
  onNativeEvent('cacheValue', (d) => {
    const resolve = d && pending.get(d.rid);
    if (!resolve) return;
    pending.delete(d.rid);
    resolve(typeof d.data === 'string' ? d.data : null);
  });
}

/** Read a cached string by key (null on miss / disabled / timeout). */
export function cacheGet(key) {
  if (!isNativeCacheMode() || !key) return Promise.resolve(null);
  ensureWired();
  const rid = `c${++seq}`;
  return new Promise((resolve) => {
    pending.set(rid, resolve);
    setTimeout(() => { if (pending.has(rid)) { pending.delete(rid); resolve(null); } }, 5000);
    postNativeMessage('cacheGet', { rid, key });
  });
}

/** Store a string (expected to be ciphertext) under key. */
export function cachePut(key, data) {
  if (!isNativeCacheMode() || !key || typeof data !== 'string') return;
  postNativeMessage('cachePut', { key, data });
}

export function cacheDelete(key) {
  if (!isNativeCacheMode() || !key) return;
  postNativeMessage('cacheDelete', { key });
}

/** Wipe the entire native cache (logout). */
export function cacheClear() {
  if (!isNativeCacheMode()) return;
  postNativeMessage('cacheClear', {});
}
