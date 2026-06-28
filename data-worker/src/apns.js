/**
 * Apple Push Notification service (APNs) sender for Cloudflare Workers.
 *
 * Token-based (provider JWT) auth — RFC 7519 ES256 over the .p8 EC P-256 key —
 * using only the Web Crypto API (no Node.js crypto). The native iOS app needs
 * this because WKWebView cannot receive Web Push; APNs is the parallel transport
 * to web-push.js.
 *
 * Usage:
 *   const apns = createAPNs({
 *     teamId: env.APNS_TEAM_ID,
 *     keyId: env.APNS_KEY_ID,
 *     p8: env.APNS_KEY_P8,                 // -----BEGIN PRIVATE KEY----- … (PKCS#8)
 *     topic: env.APNS_TOPIC,               // bundle id
 *     environment: env.APNS_ENV,           // 'production' | 'sandbox'
 *   });
 *   if (apns.enabled) await apns.send(deviceToken, { title, body, url, badge });
 */

// ── base64 / PEM helpers ─────────────────────────────────────────

function base64UrlEncode(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : (input instanceof Uint8Array ? input : new Uint8Array(input));
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcs8FromPem(pem) {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  return der;
}

// ── Main export ──────────────────────────────────────────────────

export function createAPNs({ teamId, keyId, p8, topic, environment, fetchImpl } = {}) {
  const enabled = Boolean(teamId && keyId && p8);
  const host = environment === 'sandbox'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';
  const doFetch = fetchImpl || fetch;

  let cachedKey = null;
  let cachedJwt = null;
  let cachedJwtIat = 0;

  async function importKey() {
    if (cachedKey) return cachedKey;
    cachedKey = await crypto.subtle.importKey(
      'pkcs8', pkcs8FromPem(p8),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['sign']
    );
    return cachedKey;
  }

  /** Build (or reuse) the provider JWT. APNs accepts a token for up to 1h; we
   *  refresh after ~50 min. */
  async function providerJwt(nowSeconds) {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    if (cachedJwt && (now - cachedJwtIat) < 3000) return cachedJwt;
    const header = base64UrlEncode(JSON.stringify({ alg: 'ES256', kid: keyId }));
    const payload = base64UrlEncode(JSON.stringify({ iss: teamId, iat: now }));
    const signingInput = `${header}.${payload}`;
    const key = await importKey();
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, key,
      new TextEncoder().encode(signingInput)
    );
    cachedJwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
    cachedJwtIat = now;
    return cachedJwt;
  }

  /**
   * Send a notification to a single device token.
   * @returns {Promise<{ok:boolean,status:number,gone:boolean,reason?:string}>}
   *   `gone` = the token is invalid and should be deleted.
   */
  async function send(deviceToken, notification = {}, opts = {}) {
    if (!enabled) return { ok: false, status: 0, gone: false, reason: 'apns_disabled' };
    if (!deviceToken) return { ok: false, status: 0, gone: false, reason: 'missing_token' };

    const aps = { alert: {}, sound: 'default' };
    if (notification.title) aps.alert.title = notification.title;
    if (notification.body) aps.alert.body = notification.body;
    if (typeof notification.badge === 'number') aps.badge = notification.badge;
    if (Object.keys(aps.alert).length === 0) {
      // Title/body are E2E-opaque in this app; still send a generic alert so iOS
      // shows something while the web layer renders the real (decrypted) content.
      aps.alert.title = 'SENTRY MESSENGER';
    }
    const body = { aps };
    if (notification.url) body.url = notification.url;
    if (notification.type) body.type = notification.type;
    if (notification.encrypted_preview) body.encrypted_preview = notification.encrypted_preview;

    let jwt;
    try {
      jwt = await providerJwt();
    } catch (err) {
      return { ok: false, status: 0, gone: false, reason: `jwt_error:${err?.message || err}` };
    }

    const res = await doFetch(`${host}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': opts.topic || topic || '',
        'apns-push-type': 'alert',
        'apns-priority': '10',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 200) return { ok: true, status: 200, gone: false };

    let reason = '';
    try { reason = (await res.json())?.reason || ''; } catch { /* no body */ }
    // 410 Unregistered, or 400 BadDeviceToken/DeviceTokenNotForTopic → drop it.
    const gone = res.status === 410
      || reason === 'BadDeviceToken'
      || reason === 'Unregistered'
      || reason === 'DeviceTokenNotForTopic';
    return { ok: false, status: res.status, gone, reason };
  }

  return { enabled, send, _providerJwt: providerJwt };
}
