import Foundation
#if canImport(WebRTC)
import WebRTC
#endif

/// Native WebRTC call controller — mid-term migration **P0 skeleton**.
///
/// Gated by `AppConfig.useNativeCalls` (Info.plist `UseNativeCalls`, default
/// false). When disabled, calls run inside the WKWebView exactly as today; this
/// type does nothing. Subsequent phases wire the signaling client, peer
/// connection, CallKit and native UI. See
/// `ios/docs/native-webrtc-migration-plan.md`.
///
/// Full app only — not compiled into the App Clip (this file lives outside
/// `Shared/`, and the Clip does not link the WebRTC package).
final class NativeCallController {
    static let shared = NativeCallController()

    /// Whether the native call path is enabled for this build.
    var isEnabled: Bool { AppConfig.useNativeCalls }

    #if canImport(WebRTC)
    /// Lazily created so the (heavy) WebRTC stack only initialises when the
    /// native path is actually enabled.
    private lazy var factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        let decoderFactory = RTCDefaultVideoDecoderFactory()
        return RTCPeerConnectionFactory(encoderFactory: encoderFactory,
                                        decoderFactory: decoderFactory)
    }()
    #endif

    private init() {}

    /// Called once at launch. P0: verifies the WebRTC dependency links and is
    /// otherwise a no-op. Real call setup arrives in P1 (signaling + peer
    /// connection + CallKit).
    func bootstrapIfEnabled() {
        guard isEnabled else { return }
        #if canImport(WebRTC)
        _ = factory  // touch the factory so the WebRTC framework link is exercised.
        print("[NativeCall] P0 skeleton enabled — WebRTC RTCPeerConnectionFactory ready")
        #else
        print("[NativeCall] enabled but WebRTC framework not linked — check SPM package")
        #endif
    }
}
