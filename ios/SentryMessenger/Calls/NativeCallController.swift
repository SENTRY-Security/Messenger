import Foundation
import UIKit
#if canImport(WebRTC)
import WebRTC
#endif

/// Native WebRTC call orchestrator — mid-term migration **P1**.
///
/// Owns the per-call `CallPeerConnection`(s) and is the full app's
/// implementation of `NativeCallHandler`. Gated by `AppConfig.useNativeCalls`
/// (Info.plist `UseNativeCalls`, default false): when disabled, calls run inside
/// the WKWebView exactly as today and this type does nothing.
///
/// Responsibilities (the media half of the hybrid architecture — see
/// `ios/docs/native-webrtc-migration-plan.md`):
///   - web→native: build / tear down peer connections, produce SDP offers,
///     consume remote offers/answers, mute. Signaling stays in the web layer
///     (relayed over the existing account WebSocket); this layer only handles
///     media + SDP.
///   - native→web: hand back local SDP (`nativeCallLocalSDP`) for the web to
///     relay, and aggregate connection state (`nativeCallState`).
///   - CallKit audio gate: `setCallAudio(active:)` flips `RTCAudioSession`
///     manual audio so WebRTC renders only while CallKit owns the session.
///
/// Full app only — not compiled into the App Clip (this file lives outside
/// `Shared/`, and the Clip does not link the WebRTC package).
final class NativeCallController: NativeCallHandler {
    static let shared = NativeCallController()

    /// Whether the native call path is enabled for this build.
    var isEnabled: Bool { AppConfig.useNativeCalls }

    /// Native→web channel, wired by `NativeBridge` (see `NativeBridge.nativeCalls`).
    var sendToWeb: ((String, [String: Any]) -> Void)?

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

    /// Active peer connections keyed by the web's string `callId`. Single-call
    /// app, but a map keeps lifecycle robust against overlapping teardown.
    private var peers: [String: CallPeerConnection] = [:]

    /// Presented native call UI (video calls only). Audio-only native calls keep
    /// the web overlay.
    private var callVC: NativeCallViewController?
    private var callVCCallId: String?
    #endif

    private init() {}

    /// Called once at launch. Verifies the WebRTC dependency links; real call
    /// setup is driven by `handle(action:)` from the web layer.
    func bootstrapIfEnabled() {
        guard isEnabled else { return }
        #if canImport(WebRTC)
        _ = factory  // touch the factory so the WebRTC framework link is exercised.
        print("[NativeCall] P1 orchestrator enabled — WebRTC factory ready")
        #else
        print("[NativeCall] enabled but WebRTC framework not linked — check SPM package")
        #endif
    }

    // MARK: NativeCallHandler

    func handle(action: String, payload: [String: Any]) {
        guard isEnabled else { return }
        let callId = payload["callId"] as? String ?? ""
        guard !callId.isEmpty else { return }

        #if canImport(WebRTC)
        let hasVideo = (payload["kind"] as? String) == "video" || (payload["video"] as? Bool == true)
        let peerName = (payload["peerName"] as? String) ?? ""
        switch action {
        case "nativeCallStart":
            // Outgoing: build the peer and create an offer for the web to relay.
            let peer = makePeer(callId: callId, hasVideo: hasVideo, payload: payload)
            if hasVideo { presentCallUI(callId: callId, peerName: peerName, peer: peer) }
            peer.createOffer()
        case "nativeCallReceiveOffer":
            // Incoming: build the peer, apply the remote offer, create an answer.
            let peer = makePeer(callId: callId, hasVideo: hasVideo, payload: payload)
            if hasVideo { presentCallUI(callId: callId, peerName: peerName, peer: peer) }
            if let sdp = payload["sdp"] as? String { peer.receiveOffer(sdp: sdp) }
        case "nativeCallReceiveAnswer":
            // Caller: apply the remote answer to the in-flight outgoing peer.
            if let sdp = payload["sdp"] as? String { peers[callId]?.receiveAnswer(sdp: sdp) }
        case "nativeCallMute":
            peers[callId]?.setMuted((payload["muted"] as? Bool) ?? false)
        case "nativeCallSwitchCamera":
            peers[callId]?.switchCamera()
        case "nativeCallSetVideo":
            peers[callId]?.setVideoEnabled((payload["enabled"] as? Bool) ?? true)
        case "nativeCallEnd":
            tearDown(callId: callId)
        default:
            print("[NativeCall] unhandled action: \(action)")
        }
        #endif
    }

    func setCallAudio(active: Bool) {
        guard isEnabled else { return }
        #if canImport(WebRTC)
        CallPeerConnection.setAudioSessionActive(active)
        #endif
    }

    // MARK: peer lifecycle

    #if canImport(WebRTC)
    /// Build (or replace) the peer connection for a call. Single-call app, so any
    /// existing peer for the id is torn down first.
    private func makePeer(callId: String, hasVideo: Bool, payload: [String: Any]) -> CallPeerConnection {
        if let existing = peers[callId] { existing.close() }
        let peer = CallPeerConnection(callId: callId,
                                      hasVideo: hasVideo,
                                      factory: factory,
                                      iceServers: iceServers(from: payload))
        peer.delegate = self
        peers[callId] = peer
        return peer
    }

    private func tearDown(callId: String) {
        peers.removeValue(forKey: callId)?.close()
        dismissCallUI(callId: callId)
    }

    // MARK: native call UI (video)

    private func presentCallUI(callId: String, peerName: String, peer: CallPeerConnection) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            // Single-call app: replace any stale UI.
            if let existing = self.callVC { existing.dismiss(animated: false) }
            let vc = NativeCallViewController(peerName: peerName)
            vc.delegate = self
            self.callVC = vc
            self.callVCCallId = callId
            UIApplication.shared.topViewController?.present(vc, animated: true) {
                vc.videoView.setLocalTrack(peer.localVideoTrackForRender)
                if let remote = peer.remoteVideoTrack { vc.videoView.setRemoteTrack(remote) }
                vc.updateStatus("連線中…")
            }
        }
    }

    private func dismissCallUI(callId: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.callVCCallId == callId, let vc = self.callVC else { return }
            vc.videoView.detach()
            vc.dismiss(animated: true)
            self.callVC = nil
            self.callVCCallId = nil
        }
    }

    /// Resolve the peer for the currently presented call UI (UI actions).
    private var activeUIPeer: CallPeerConnection? {
        guard let id = callVCCallId else { return nil }
        return peers[id]
    }

    /// Map the web's `iceServers` (Cloudflare STUN + TURN credentials it already
    /// fetched) into `RTCIceServer`. Falls back to Cloudflare STUN if absent.
    private func iceServers(from payload: [String: Any]) -> [RTCIceServer] {
        guard let raw = payload["iceServers"] as? [[String: Any]], !raw.isEmpty else {
            return [RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])]
        }
        return raw.compactMap { dict in
            let urls: [String]
            if let arr = dict["urls"] as? [String] { urls = arr }
            else if let one = dict["urls"] as? String { urls = [one] }
            else if let one = dict["url"] as? String { urls = [one] }
            else { return nil }
            if let username = dict["username"] as? String,
               let credential = dict["credential"] as? String {
                return RTCIceServer(urlStrings: urls, username: username, credential: credential)
            }
            return RTCIceServer(urlStrings: urls)
        }
    }
    #endif
}

#if canImport(WebRTC)
extension NativeCallController: CallPeerConnectionDelegate {
    func callPeer(_ peer: CallPeerConnection, didProduceLocalSDP sdp: String, type: String) {
        // Hand the full SDP (candidates embedded, non-trickle) back to the web to
        // relay over the account WS as a call-offer / call-answer.
        DispatchQueue.main.async { [weak self] in
            self?.sendToWeb?("nativeCallLocalSDP",
                             ["callId": peer.callId, "sdp": sdp, "type": type])
        }
    }

    func callPeer(_ peer: CallPeerConnection, didChangeState state: RTCPeerConnectionState) {
        let name: String
        switch state {
        case .new: name = "new"
        case .connecting: name = "connecting"
        case .connected: name = "connected"
        case .disconnected: name = "disconnected"
        case .failed: name = "failed"
        case .closed: name = "closed"
        @unknown default: name = "unknown"
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.sendToWeb?("nativeCallState", ["callId": peer.callId, "state": name])
            if self.callVCCallId == peer.callId {
                switch state {
                case .connecting: self.callVC?.updateStatus("連線中…")
                case .connected: self.callVC?.updateStatus("通話中")
                case .disconnected: self.callVC?.updateStatus("連線中斷，重連中…")
                default: break
                }
            }
            if state == .closed || state == .failed {
                self.peers.removeValue(forKey: peer.callId)
                self.dismissCallUI(callId: peer.callId)
            }
        }
    }

    func callPeer(_ peer: CallPeerConnection, didReceiveRemoteVideoTrack track: RTCVideoTrack?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.callVCCallId == peer.callId else { return }
            self.callVC?.videoView.setRemoteTrack(track)
        }
    }
}

extension NativeCallController: NativeCallViewControllerDelegate {
    func callUIDidTapEnd() {
        guard let callId = callVCCallId else { return }
        // Relay to the web call state machine (it runs the real hangup, which
        // loops back as nativeCallEnd → tearDown → dismiss).
        sendToWeb?("callEndedByUser", ["callId": callId])
    }

    func callUIDidToggleMute(_ muted: Bool) {
        guard let callId = callVCCallId else { return }
        activeUIPeer?.setMuted(muted)
        sendToWeb?("callMuteToggled", ["callId": callId, "muted": muted])
    }

    func callUIDidToggleSpeaker(_ on: Bool) {
        AudioSessionManager.setSpeaker(on)
        sendToWeb?("audioRouteChanged", ["speaker": AudioSessionManager.isSpeakerOn])
    }

    func callUIDidTapFlipCamera() {
        activeUIPeer?.switchCamera()
    }

    func callUIDidToggleVideo(_ enabled: Bool) {
        activeUIPeer?.setVideoEnabled(enabled)
    }
}
#endif
