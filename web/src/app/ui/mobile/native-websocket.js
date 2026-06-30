// NativeWebSocket — a browser-`WebSocket`-shaped shim backed by the iOS native
// account socket transport (mid-term migration, Option B step B1).
//
// When the native app injects `window.USE_NATIVE_ACCOUNT_SOCKET = true`, the
// account WS bytes are owned by the native URLSession (`AccountSocketService`)
// instead of WebKit. This shim exposes the exact surface `ws-integration.js`
// uses (`onopen` / `onmessage` / `onclose` / `onerror` / `send` / `close` /
// `readyState` + the numeric ready-state constants), so the existing connect /
// auth / heartbeat / reconnect logic is preserved unchanged — only the byte
// transport moves. Pure web / App Clip never construct this.
//
// Protocol: each instance has a string `id`. It posts `wsOpen` {id, url},
// `wsSend` {id, data}, `wsClose` {id, code, reason} to native, and receives a
// single `wsEvent` {id, kind: open|message|close|error, data?, code?, reason?}
// fanned out to the matching instance.

import { isNativeApp, postNativeMessage, onNativeEvent } from '../../features/native-bridge.js';

/** True when the native app has enabled the native account-socket transport. */
export function isNativeAccountSocketMode() {
  return typeof window !== 'undefined'
    && window.USE_NATIVE_ACCOUNT_SOCKET === true
    && isNativeApp();
}

let seq = 0;
const instances = new Map(); // id → NativeWebSocket

let wired = false;
function ensureWired() {
  if (wired) return;
  wired = true;
  // Single native→web listener fans wsEvent out to the owning instance.
  onNativeEvent('wsEvent', (data) => {
    const inst = data && instances.get(data.id);
    if (inst) inst._onNative(data);
  });
}

export class NativeWebSocket {
  static get CONNECTING() { return 0; }
  static get OPEN() { return 1; }
  static get CLOSING() { return 2; }
  static get CLOSED() { return 3; }

  constructor(url) {
    ensureWired();
    this._id = `ws${++seq}`;
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    instances.set(this._id, this);
    postNativeMessage('wsOpen', { id: this._id, url });
  }

  send(data) {
    // ws-integration always sends JSON strings; coerce defensively.
    const text = typeof data === 'string' ? data : String(data);
    postNativeMessage('wsSend', { id: this._id, data: text });
  }

  close(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 2; // CLOSING
    postNativeMessage('wsClose', { id: this._id, code: typeof code === 'number' ? code : 1000, reason: reason || '' });
  }

  _onNative(data) {
    switch (data.kind) {
      case 'open':
        this.readyState = 1; // OPEN
        try { this.onopen && this.onopen({}); } catch { /* ignore */ }
        break;
      case 'message':
        // Mirror the browser MessageEvent shape used by ws-integration.
        try { this.onmessage && this.onmessage({ data: data.data }); } catch { /* ignore */ }
        break;
      case 'close':
        this.readyState = 3; // CLOSED
        instances.delete(this._id);
        try { this.onclose && this.onclose({ code: typeof data.code === 'number' ? data.code : 1006, reason: data.reason || '' }); } catch { /* ignore */ }
        break;
      case 'error':
        // A close event usually follows; don't drop the instance yet.
        try { this.onerror && this.onerror({}); } catch { /* ignore */ }
        break;
      default:
        break;
    }
  }
}
