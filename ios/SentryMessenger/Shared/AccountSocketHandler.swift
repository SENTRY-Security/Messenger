import Foundation

/// Cross-target seam for the native account WebSocket transport (mid-term
/// migration, Option B — native owns the single account WS).
///
/// `NativeBridge` (shared) routes `ws*` actions here; the full app injects
/// `AccountSocketService` into `NativeBridge.accountSocket`, while the App Clip
/// leaves it nil so the web keeps opening its own `WebSocket`.
///
/// Gated by `AppConfig.useNativeAccountSocket` (Info.plist
/// `UseNativeAccountSocket`, default false): when off, the web never routes
/// through the bridge, so this handler is never exercised.
///
/// The web side talks to this via a `NativeWebSocket` shim that mimics the
/// browser `WebSocket` interface, so the existing `ws-integration.js` connect /
/// auth / heartbeat / reconnect logic is preserved unchanged — only the
/// underlying byte transport moves from WebKit to `URLSession`.
protocol AccountSocketHandler: AnyObject {
    /// Handle a web→native socket action: `wsOpen` ({id, url}), `wsSend`
    /// ({id, data}), `wsClose` ({id, code, reason}).
    func handle(action: String, payload: [String: Any])

    /// Native→web channel, set by `NativeBridge` to its `sendEvent`. Used to push
    /// the single `wsEvent` ({id, kind: open|message|close|error, data?, code?,
    /// reason?}) the shim fans out to the matching socket instance.
    var sendToWeb: ((String, [String: Any]) -> Void)? { get set }
}
