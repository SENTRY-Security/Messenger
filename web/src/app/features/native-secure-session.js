// Native (iOS) secure-session glue — App-only, no-op on web.
//
// Responsibilities:
//  1. NFC unlock verification: when the native lock overlay scans the user's
//     NTAG424 card, the shell sends `nfcUnlockScanned { url }`. We do a READ-ONLY
//     SDM exchange (does NOT mutate the live session store) and confirm the card
//     resolves to the currently logged-in account, then reply `nfcUnlockResult`.
//  2. Thin helpers for the rest of the app: open the native lock settings, store
//     / clear the secure session in the Keychain.
//
// NOTE: the cold-launch key re-fetch (secureLoad → /api/v1/mk/fetch → unwrap MK)
// is wired in the login bootstrap; this module only owns the lock-gate glue and
// the store/clear helpers. All functions are inert unless `isNativeApp()`.

import { isNativeApp, postNativeMessage, onNativeEvent } from './native-bridge.js';
import { parseSdmParams } from './sdm.js';
import { sdmExchange } from '../api/auth.js';
import { getAccountDigest } from '../core/store.js';

let installed = false;

/** Open the native lock-mode settings sheet (None / FaceID / NFC). */
export function openNativeLockSettings() {
  postNativeMessage('openLockSettings');
}

/** Persist the secure session in the iOS Keychain after a successful login. */
export function storeSecureSession({ kek, accountToken, accountDigest } = {}) {
  if (!isNativeApp()) return;
  postNativeMessage('secureStore', {
    kek: kek || '',
    account_token: accountToken || '',
    account_digest: accountDigest || ''
  });
}

/** Wipe the Keychain secure session (logout / kicked elsewhere). */
export function clearSecureSession() {
  if (!isNativeApp()) return;
  postNativeMessage('clearSecureSession');
}

// Verify a scanned card resolves to the logged-in account, WITHOUT touching the
// live session store (uses the low-level sdmExchange, not exchangeSDM).
async function verifyNfcUnlock(url) {
  try {
    const p = parseSdmParams(url);
    if (!p) return false;
    const { r, data } = await sdmExchange({
      uid: p.uidHex, sdmmac: p.sdmmac, sdmcounter: p.sdmcounter, nonce: p.nonce
    });
    if (!r.ok || !data) return false;
    const current = (getAccountDigest() || '').toUpperCase();
    const scanned = String(data.account_digest || '').toUpperCase();
    return !!current && current === scanned;
  } catch {
    return false;
  }
}

/** Install native event handlers. Idempotent; no-op outside the iOS shell. */
export function initNativeSecureSession() {
  if (installed || !isNativeApp()) return;
  installed = true;

  onNativeEvent('nfcUnlockScanned', async ({ url }) => {
    const ok = await verifyNfcUnlock(url);
    postNativeMessage('nfcUnlockResult', { ok });
  });
}

// Self-install on import so the shell's lock-gate callbacks have a target.
initNativeSecureSession();
