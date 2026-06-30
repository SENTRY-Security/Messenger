import Foundation
import AVFoundation

/// Native playback of bundled in-app sounds (call ringtones/tones, message
/// notification, UI click).
///
/// The web shell routes sound playback here (via `NativeBridge` `playSound` /
/// `stopSound` / `stopAllSounds`) when running inside the native app instead of
/// using HTML5 `Audio` / WebAudio in the WKWebView, which is unreliable on iOS
/// (autoplay gating, route/mute handling, suspension when backgrounded).
///
/// Sound files are bundled from `Shared/Sounds/` into both the full app and the
/// App Clip. Callers pass the file basename incl. extension (e.g. `call-in.mp3`).
/// Used from the main thread (WKScriptMessage handlers run on main).
final class NativeAudioPlayer: NSObject {
    static let shared = NativeAudioPlayer()

    /// Active players keyed by sound file basename, so a sound can be stopped or
    /// restarted individually (e.g. a looping ringtone).
    private var players: [String: AVAudioPlayer] = [:]

    /// Play a bundled sound. `loop` true marks a ringtone (loops until stopped).
    func play(file: String, loop: Bool) {
        let name = (file as NSString).deletingPathExtension
        let ext = (file as NSString).pathExtension
        guard !name.isEmpty, !ext.isEmpty,
              let url = Bundle.main.url(forResource: name, withExtension: ext) else {
            print("[NativeAudio] missing sound: \(file)")
            return
        }
        // Looping sounds are ringtones played before/around call connect. Give
        // them a playable session ONLY when a call doesn't already own one:
        // reconfiguring or re-activating an active `.playAndRecord` call session
        // interrupts the WKWebView WebRTC audio unit (heard as "no call audio"),
        // and must never downgrade it to `.playback` (which kills the mic).
        // Short tones (accepted/ended) and notify/click play on the current
        // session and never reconfigure.
        if loop {
            let session = AVAudioSession.sharedInstance()
            if session.category != .playAndRecord {
                try? session.setCategory(.playback, options: [.mixWithOthers])
                try? session.setActive(true, options: [])
            }
        }
        stop(file: file)
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            player.numberOfLoops = loop ? -1 : 0
            player.prepareToPlay()
            player.play()
            players[file] = player
        } catch {
            print("[NativeAudio] play failed \(file): \(error.localizedDescription)")
        }
    }

    func stop(file: String) {
        players[file]?.stop()
        players[file] = nil
    }

    func stopAll() {
        for player in players.values { player.stop() }
        players.removeAll()
    }
}
