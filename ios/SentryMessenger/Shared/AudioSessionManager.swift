import Foundation
import AVFoundation

/// Centralised `AVAudioSession` configuration for voice/video calls (P0).
///
/// WebRTC media itself runs inside the WKWebView (WebKit owns capture/playback),
/// but the **audio session category** is process-wide. Configuring it to
/// `.playAndRecord` with the `.voiceChat`/`.videoChat` mode is what lets call
/// audio keep running when the app is backgrounded or the screen is locked
/// (paired with the `audio` UIBackgroundMode in Info.plist).
///
/// When CallKit is active it will activate/deactivate the session via
/// `provider(didActivate:)`; `CallKitController` calls `activate()`/`deactivate()`
/// here so both the CallKit and non-CallKit paths share one configuration.
///
/// NOTE (PoC item): coordination between this session and WebKit's internal
/// WebRTC audio unit needs on-device validation — see `docs/native-calls-plan.md`.
enum AudioSessionManager {

    /// Configure the shared session for an in-progress call. Idempotent.
    /// - Parameter video: use `.videoChat` (speaker-default) vs `.voiceChat` (earpiece-default).
    static func configureForCall(video: Bool) {
        let session = AVAudioSession.sharedInstance()
        do {
            // No `.defaultToSpeaker`: let the mode pick the natural route (voiceChat
            // → earpiece, videoChat → speaker) so the in-app speaker toggle can
            // override it both ways via `setSpeaker`.
            try session.setCategory(
                .playAndRecord,
                mode: video ? .videoChat : .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP]
            )
        } catch {
            print("[AudioSession] configure failed: \(error.localizedDescription)")
        }
    }

    /// Activate the session. Called by CallKit's `didActivate` (preferred) or
    /// directly on the non-CallKit fallback path.
    static func activate() {
        do {
            try AVAudioSession.sharedInstance().setActive(true, options: [])
        } catch {
            print("[AudioSession] activate failed: \(error.localizedDescription)")
        }
    }

    /// Toggle speaker (loudspeaker) vs the mode's default route (earpiece for
    /// voice). Web/Safari on iOS can't control routing, so this is native-only.
    static func setSpeaker(_ on: Bool) {
        do {
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(on ? .speaker : .none)
        } catch {
            print("[AudioSession] setSpeaker failed: \(error.localizedDescription)")
        }
    }

    /// Whether audio is currently routed to the built-in loudspeaker.
    static var isSpeakerOn: Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
    }

    /// Release the session when a call ends, restoring other audio.
    static func deactivate() {
        do {
            try AVAudioSession.sharedInstance().setActive(
                false, options: [.notifyOthersOnDeactivation])
        } catch {
            print("[AudioSession] deactivate failed: \(error.localizedDescription)")
        }
    }
}
