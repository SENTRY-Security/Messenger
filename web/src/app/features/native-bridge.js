// Native (iOS WKWebView) bridge integration.
//
// The native shell exposes `window.webkit.messageHandlers.sentryNative` and
// calls back into `window.SentryNative.onEvent(name, data)`. In the native app
// WKWebView cannot receive Web Push, so notifications go through APNs: we ask the
// shell to register (`registerPush`), receive the device token via the
// `pushToken` event, and store it on the backend keyed by the account digest.

import { getAccountDigest, ensureDeviceId } from '../core/store.js';

export function isNativeApp() {
  return typeof window !== 'undefined'
    && !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sentryNative);
}

function postNative(action, payload) {
  if (!isNativeApp()) return;
  try {
    window.webkit.messageHandlers.sentryNative.postMessage({ action, payload: payload || {} });
  } catch { /* ignore */ }
}

/** Ask the native shell to register for APNs push (triggers the iOS prompt). */
export function requestNativePush() {
  postNative('registerPush');
}

async function registerApnsToken(token) {
  const accountDigest = getAccountDigest();
  if (!accountDigest || !token) return;
  let deviceId;
  try { deviceId = await ensureDeviceId(); } catch { /* optional */ }
  try {
    await fetch('/d1/push/apns/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountDigest, deviceId, token }),
    });
  } catch { /* best-effort */ }
}

/** Install the receiver the native shell calls into. Idempotent. */
export function initNativeBridge() {
  if (typeof window === 'undefined') return;
  const prev = window.SentryNative || {};
  window.SentryNative = {
    ...prev,
    onEvent(name, data) {
      try {
        if (name === 'pushToken' && data && data.token) registerApnsToken(data.token);
      } catch { /* ignore */ }
    },
  };
}

// Self-install on import so the shell's callbacks always have a target.
initNativeBridge();
