import Foundation

/// Cross-target seam for the native WebRTC call engine (mid-term migration P1).
///
/// `NativeBridge` lives in the shared sources (compiled into both the full app
/// and the App Clip), but the native media stack (`RTCPeerConnection`,
/// `RTCAudioSession`, the WebRTC SPM package) is **full-app only** — the App
/// Clip neither links WebRTC nor uses CallKit. The full app injects an
/// implementation into `NativeBridge.nativeCalls`; the App Clip leaves it nil so
/// the `nativeCall*` bridge actions become no-ops and calls keep running inside
/// the WKWebView.
///
/// Gated end-to-end by `AppConfig.useNativeCalls` (Info.plist `UseNativeCalls`,
/// default false): when disabled the web is never told to use the native path,
/// so this handler is never exercised.
protocol NativeCallHandler: AnyObject {
    /// Whether the native call path is enabled for this build/flag.
    var isEnabled: Bool { get }

    /// Handle a web→native call action. Supported actions:
    /// `nativeCallStart` (outgoing: create offer), `nativeCallReceiveOffer`
    /// (incoming: apply remote offer, create answer), `nativeCallReceiveAnswer`
    /// (caller: apply remote answer), `nativeCallMute`, `nativeCallEnd`.
    func handle(action: String, payload: [String: Any])

    /// CallKit audio gate: enable WebRTC rendering only while CallKit holds the
    /// shared `AVAudioSession` active (`didActivate` → true, `didDeactivate` →
    /// false). This is the manual-audio handoff that removes the WKWebView ↔
    /// CallKit session war.
    func setCallAudio(active: Bool)

    /// Native→web channel, set by `NativeBridge` to its `sendEvent`. Used to push
    /// `nativeCallLocalSDP` (offer/answer to relay over the account WS) and
    /// `nativeCallState` (aggregate connection state) back to the web layer.
    var sendToWeb: ((String, [String: Any]) -> Void)? { get set }
}
