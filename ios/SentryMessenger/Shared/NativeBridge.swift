import Foundation
import WebKit
import UIKit
import AVFoundation

/// Bridges messages between the web app and native iOS.
///
/// JS → native:
///   `window.webkit.messageHandlers.sentryNative.postMessage({ action, payload })`
///   Supported actions: `ready`, `haptic`, `registerPush`, `scanNFC`, `share`,
///   and call lifecycle: `callIncoming`, `callStarted`, `callConnected`,
///   `callStateChanged`, `callEnded`.
///
/// native → JS:
///   `window.SentryNative.onEvent(name, data)` is invoked (the web app should
///   define it). Emitted events: `nfcResult`, `nfcError`, `pushToken`, and from
///   CallKit: `callAnswered`, `callEndedByUser`, `callMuteToggled`, `audioReady`.
final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let nfc = NFCLoginService()
    /// App Clips cannot use CallKit/PushKit; calls only run in the full app.
    private let isAppClip = (Bundle.main.bundleIdentifier ?? "").hasSuffix(".Clip")
    /// App Clip only: remembers each call's video flag (the web's `callConnected`
    /// carries no kind) so the audio session can re-configure with the right mode.
    private var clipCallVideo: [String: Bool] = [:]

    /// Secure-session / app-lock handler, provided by the full app at launch
    /// (`SecureSessionController`). Stays nil in the App Clip, where the
    /// secure-session actions are no-ops.
    static var secureSession: SecureSessionBridge?

    /// Native WebRTC call engine, provided by the full app at launch
    /// (`NativeCallController`). Stays nil in the App Clip, where the native
    /// `nativeCall*` actions are no-ops (calls run inside the WKWebView).
    static var nativeCalls: NativeCallHandler?

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self, selector: #selector(handlePushToken(_:)),
            name: .sentryPushToken, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleVoipToken(_:)),
            name: .sentryVoipToken, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleOpenURL(_:)),
            name: .sentryOpenURL, object: nil)
        // Keep the web call UI's speaker button in sync with the actual audio
        // route (system route changes, Bluetooth connect, CallKit activation).
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification, object: nil)
        wireCallKit()
    }

    @objc private func handleRouteChange(_ note: Notification) {
        sendEvent("audioRouteChanged", data: ["speaker": AudioSessionManager.isSpeakerOn])
    }

    /// Attach this bridge's webview-relaying callbacks to the shared CallKit
    /// controller. Replays any answer that arrived before attach (cold launch).
    /// No-op in the App Clip (CallKit unavailable there).
    private func wireCallKit() {
        guard !isAppClip else { return }
        let callKit = CallKitController.shared
        callKit.onEnd = { [weak self] callId in
            self?.sendEvent("callEndedByUser", data: ["callId": callId])
        }
        callKit.onMute = { [weak self] callId, muted in
            self?.sendEvent("callMuteToggled", data: ["callId": callId, "muted": muted])
        }
        callKit.onAudioReady = { [weak self] callId in
            self?.sendEvent("audioReady", data: ["callId": callId])
        }
        callKit.onPresentInApp = { [weak self] callId in
            // Foreground incoming: CallKit was skipped, so tell the web to show
            // its in-app floating incoming card for this call.
            self?.sendEvent("incomingCallPresentation", data: ["callId": callId, "mode": "in-app"])
        }
        // Assign onAnswer last: its didSet replays a queued cold-launch answer.
        callKit.onAnswer = { [weak self] callId in
            self?.sendEvent("callAnswered", data: ["callId": callId])
        }
        // Let the secure-session handler push events (e.g. nfcUnlockScanned) to web.
        NativeBridge.secureSession?.sendToWeb = { [weak self] name, data in
            self?.sendEvent(name, data: data)
        }
        // Let the native call engine push SDP / state back to web.
        NativeBridge.nativeCalls?.sendToWeb = { [weak self] name, data in
            self?.sendEvent(name, data: data)
        }
        // CallKit audio gate: only render WebRTC audio while CallKit owns the
        // session (manual-audio handoff). Decoupled so CallKitController stays
        // Clip-safe / WebRTC-agnostic.
        callKit.onAudioSessionActive = { active in
            NativeBridge.nativeCalls?.setCallAudio(active: active)
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == AppConfig.bridgeName else { return }
        let body = message.body as? [String: Any] ?? [:]
        let action = body["action"] as? String ?? ""
        let payload = body["payload"] as? [String: Any] ?? [:]

        switch action {
        case "ready":
            break
        case "haptic":
            triggerHaptic(payload["style"] as? String ?? "medium")
        case "registerPush":
            NotificationCenter.default.post(name: .sentryRegisterPush, object: nil)
        case "scanNFC":
            startNFCLogin()
        case "share":
            if let text = payload["text"] as? String {
                presentShare(text: text, urlString: payload["url"] as? String)
            }
        case "callIncoming", "callStarted", "callConnected", "callStateChanged", "callEnded":
            handleCallAction(action, payload: payload)
        case "setAudioRoute":
            // Speaker / earpiece toggle from the in-app call UI (web on iOS can't
            // control routing, so this is native-only).
            let speaker = (payload["speaker"] as? Bool) ?? ((payload["route"] as? String) == "speaker")
            AudioSessionManager.setSpeaker(speaker)
            sendEvent("audioRouteChanged", data: ["speaker": AudioSessionManager.isSpeakerOn])
        case "playSound":
            // Native playback of bundled in-app sounds (call tones, notify, click)
            // instead of WKWebView HTML5/WebAudio. `file` = basename incl. ext.
            if let file = payload["file"] as? String, !file.isEmpty {
                NativeAudioPlayer.shared.play(file: file, loop: (payload["loop"] as? Bool) ?? false)
            }
        case "stopSound":
            if let file = payload["file"] as? String, !file.isEmpty {
                NativeAudioPlayer.shared.stop(file: file)
            }
        case "stopAllSounds":
            NativeAudioPlayer.shared.stopAll()
        case "secureStore", "secureLoad", "clearSecureSession",
             "getLockMode", "setLockMode", "openLockSettings", "lockNow", "nfcUnlockResult":
            // Routed to the full app's secure-session handler (nil in App Clip).
            NativeBridge.secureSession?.handle(action: action, payload: payload)
        case "nativeCallStart", "nativeCallReceiveOffer", "nativeCallReceiveAnswer",
             "nativeCallMute", "nativeCallEnd":
            // Native WebRTC media engine (full app only; nil in App Clip). Only
            // exercised when `UseNativeCalls` is on — the web checks the injected
            // `window.USE_NATIVE_CALLS` before emitting these.
            NativeBridge.nativeCalls?.handle(action: action, payload: payload)
        default:
            print("[NativeBridge] unhandled action: \(action)")
        }
    }

    // MARK: Calls (CallKit bridge, P1/P2)

    /// JS → native call lifecycle. The web call layer emits these as the call
    /// state machine advances. The full app mirrors them into CallKit; the App
    /// Clip has no CallKit but still must drive the AVAudioSession itself.
    private func handleCallAction(_ action: String, payload: [String: Any]) {
        let callId = payload["callId"] as? String ?? ""
        guard !callId.isEmpty else { return }
        let peerName = payload["peerName"] as? String ?? ""
        let hasVideo = (payload["kind"] as? String) == "video" || (payload["video"] as? Bool == true)

        // App Clip: no CallKit/PushKit, so configure the shared AVAudioSession for
        // the call here. Without `.playAndRecord`/`voiceChat` the WKWebView WebRTC
        // has no record route → no call audio, and capture can fail → one-way video.
        // Mirrors the CallKit audio lifecycle the full app gets for free.
        if isAppClip {
            DispatchQueue.main.async {
                switch action {
                case "callIncoming":
                    self.clipCallVideo[callId] = hasVideo
                    AudioSessionManager.configureForCall(video: hasVideo)
                    AudioSessionManager.activate()
                    // No CallKit in the Clip → tell web to show its in-app incoming
                    // card; otherwise the callee receives the call but sees no
                    // accept/reject UI (the web suppresses native incoming cards by
                    // default, expecting CallKit to present them).
                    self.sendEvent("incomingCallPresentation", data: ["callId": callId, "mode": "in-app"])
                case "callStarted":
                    self.clipCallVideo[callId] = hasVideo
                    AudioSessionManager.configureForCall(video: hasVideo)
                    AudioSessionManager.activate()
                case "callConnected":
                    let video = self.clipCallVideo[callId] ?? hasVideo
                    AudioSessionManager.configureForCall(video: video)
                    AudioSessionManager.activate()
                    // Route is up → tell web to (re)start media (mirrors the full
                    // app's CallKit didActivate → audioReady).
                    self.sendEvent("audioReady", data: ["callId": callId])
                case "callEnded":
                    self.clipCallVideo[callId] = nil
                    AudioSessionManager.deactivate()
                default:
                    break
                }
            }
            return
        }

        DispatchQueue.main.async {
            let callKit = CallKitController.shared
            switch action {
            case "callIncoming":
                callKit.reportIncoming(callId: callId, peerName: peerName, hasVideo: hasVideo)
            case "callStarted":
                callKit.reportOutgoing(callId: callId, peerName: peerName, hasVideo: hasVideo)
            case "callConnected":
                callKit.reportConnected(callId: callId)
            case "callStateChanged":
                if let muted = payload["muted"] as? Bool {
                    callKit.reportMuted(callId: callId, muted: muted)
                }
            case "callEnded":
                callKit.reportEnded(callId: callId, reason: payload["reason"] as? String ?? "ended")
            default:
                break
            }
        }
    }

    // MARK: NFC login

    /// Entry point #1 (in-web button): the web login button calls
    /// `postMessage({action:'scanNFC'})`; we present the NFC sheet and, on a
    /// valid tag, navigate the web view to the dynamic SDM URL.
    func startNFCLogin() {
        nfc.beginSession(prompt: "請將卡片靠近手機頂端") { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let url):
                    self?.webView?.load(URLRequest(url: url))
                    self?.sendEvent("nfcResult", data: ["url": url.absoluteString])
                case .failure(let error):
                    self?.sendEvent("nfcError", data: [
                        "message": error.localizedDescription,
                        "code": NFCLoginService.code(for: error),
                    ])
                }
            }
        }
    }

    // MARK: native → JS

    func sendEvent(_ name: String, data: [String: Any] = [:]) {
        guard let webView else { return }
        let json = (try? JSONSerialization.data(withJSONObject: data))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let js = "window.SentryNative && window.SentryNative.onEvent && window.SentryNative.onEvent(\(name.jsQuoted), \(json));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func sendPushToken(_ token: String) {
        sendEvent("pushToken", data: ["token": token, "platform": "ios"])
    }

    @objc private func handlePushToken(_ note: Notification) {
        guard let token = note.object as? String else { return }
        sendPushToken(token)
    }

    /// Forward the PushKit VoIP token to the web layer, which uploads it to the
    /// backend (`/d1/push/voip/subscribe`) keyed by the account digest.
    @objc private func handleVoipToken(_ note: Notification) {
        guard let token = note.object as? String else { return }
        let environment = (note.userInfo?["environment"] as? String) ?? "production"
        sendEvent("voipToken", data: ["token": token, "platform": "ios", "environment": environment])
    }

    /// Navigate the existing web view to a notification's deep link, in place,
    /// so the web session/state is preserved.
    @objc private func handleOpenURL(_ note: Notification) {
        guard let url = note.object as? URL,
              let host = url.host,
              AppConfig.allowedNavigationHosts.contains(host) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.load(URLRequest(url: url))
        }
    }

    // MARK: helpers

    private func triggerHaptic(_ style: String) {
        let mapping: [String: UIImpactFeedbackGenerator.FeedbackStyle] = [
            "light": .light, "medium": .medium, "heavy": .heavy, "soft": .soft, "rigid": .rigid,
        ]
        UIImpactFeedbackGenerator(style: mapping[style] ?? .medium).impactOccurred()
    }

    private func presentShare(text: String, urlString: String?) {
        var items: [Any] = [text]
        if let urlString, let url = URL(string: urlString) { items.append(url) }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        UIApplication.shared.topViewController?.present(vc, animated: true)
    }
}

private extension String {
    /// Single-quote and escape a string for safe inlining into JS.
    var jsQuoted: String {
        let escaped = self
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "'\(escaped)'"
    }
}
