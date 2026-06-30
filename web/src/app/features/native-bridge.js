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

/** Public alias so other modules (e.g. native-call-bridge) can message the shell. */
export function postNativeMessage(action, payload) {
  postNative(action, payload);
}

// Generic native→JS event subscribers. The shell only knows
// `window.SentryNative.onEvent`, so we fan that single entry point out to any
// number of feature listeners (push, calls, …).
const nativeEventListeners = new Set();

/** Subscribe to a native→JS event (e.g. 'callAnswered'). Returns an unsubscribe fn. */
export function onNativeEvent(name, handler) {
  if (typeof handler !== 'function') return () => {};
  const entry = { name, handler };
  nativeEventListeners.add(entry);
  return () => nativeEventListeners.delete(entry);
}

function dispatchNativeEvent(name, data) {
  for (const entry of Array.from(nativeEventListeners)) {
    if (entry.name !== name) continue;
    try { entry.handler(data || {}); } catch { /* ignore */ }
  }
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

// The PushKit VoIP token arrives at app launch — before login — so the account
// digest may not be known yet. Cache it and retry until login completes.
let pendingVoipToken = null;
// APNs environment of the build that produced the token (sandbox | production).
// The backend routes the VoIP push to the matching gateway.
let pendingVoipEnv = null;
let voipRetryTimer = null;

async function registerVoipToken(token, environment) {
  if (token) pendingVoipToken = token;
  if (environment) pendingVoipEnv = environment;
  if (!pendingVoipToken) return;
  const accountDigest = getAccountDigest();
  if (!accountDigest) {
    // Not logged in yet — retry shortly (bounded by the interval lifetime).
    if (!voipRetryTimer) {
      voipRetryTimer = setInterval(() => {
        if (getAccountDigest()) { clearInterval(voipRetryTimer); voipRetryTimer = null; registerVoipToken(); }
      }, 3000);
    }
    return;
  }
  if (voipRetryTimer) { clearInterval(voipRetryTimer); voipRetryTimer = null; }
  let deviceId;
  try { deviceId = await ensureDeviceId(); } catch { /* optional */ }
  try {
    await fetch('/d1/push/voip/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountDigest, deviceId, token: pendingVoipToken, environment: pendingVoipEnv || undefined }),
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
        if (name === 'voipToken' && data && data.token) registerVoipToken(data.token, data.environment);
      } catch { /* ignore */ }
      // Fan out to feature listeners (calls, …).
      dispatchNativeEvent(name, data);
    },
  };
}

// Self-install on import so the shell's callbacks always have a target.
initNativeBridge();
