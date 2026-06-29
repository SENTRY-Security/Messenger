import Foundation
import PushKit
import CallKit

/// PushKit VoIP push handling (P2).
///
/// Registers for VoIP pushes and, on each incoming push, **synchronously**
/// reports the call to CallKit via the shared `CallKitController`. iOS 13+
/// mandates that every received VoIP push results in a `reportNewIncomingCall`
/// before the handler returns, otherwise the app is terminated and future VoIP
/// pushes are withheld — so reporting happens first, before any web/WebRTC work.
///
/// The VoIP token is published via `.sentryVoipToken`; `NativeBridge` forwards it
/// to the web layer, which registers it on the backend (`/d1/push/voip/subscribe`).
///
/// Owned/retained by `AppDelegate` (full app only — App Clips can't use PushKit).
final class VoipPushService: NSObject {
    private let registry: PKPushRegistry

    override init() {
        registry = PKPushRegistry(queue: .main)
        super.init()
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
    }

    /// No-op trigger to force lazy creation from AppDelegate at launch.
    func start() {}
}

extension VoipPushService: PKPushRegistryDelegate {
    func pushRegistry(_ registry: PKPushRegistry,
                      didUpdate pushCredentials: PKPushCredentials,
                      for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(name: .sentryVoipToken, object: token)
    }

    func pushRegistry(_ registry: PKPushRegistry,
                      didInvalidatePushTokenFor type: PKPushType) {
        // Token revoked; the backend prunes stale tokens on send (410/BadDeviceToken).
    }

    /// Modern entry point — MUST report an incoming call before `completion()`.
    func pushRegistry(_ registry: PKPushRegistry,
                      didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType,
                      completion: @escaping () -> Void) {
        guard type == .voIP else { completion(); return }
        let dict = payload.dictionaryPayload
        let callId = (dict["callId"] as? String) ?? UUID().uuidString
        let hasVideo = (dict["kind"] as? String) == "video"
        // Peer identity is E2EE-opaque in the push; show a generic handle until
        // the web layer resolves the real name after the call connects.
        CallKitController.shared.reportIncoming(callId: callId, peerName: "SENTRY", hasVideo: hasVideo)
        completion()
    }
}
