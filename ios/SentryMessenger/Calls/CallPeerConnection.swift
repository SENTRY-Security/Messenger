import Foundation
#if canImport(WebRTC)
import WebRTC
#endif

/// Native WebRTC peer connection for a single 1:1 call — mid-term migration P1.
///
/// Owns the `RTCPeerConnection` and its audio track. Audio runs through
/// `RTCAudioSession` in **manual** mode so CallKit (not WebKit) drives session
/// activation — this is the Apple-blessed combo that removes the WKWebView ↔
/// CallKit `AVAudioSession` war that makes WebView calls silent.
///
/// Signaling is unchanged: this layer produces / consumes full SDP and the web
/// shell relays it over the existing account WebSocket (`call-offer` /
/// `call-answer`). Matching the web client, ICE is **non-trickle** — we wait for
/// gathering to complete so all candidates are embedded in the SDP (iOS WebKit's
/// `addIceCandidate` is unreliable), so the local description handed back already
/// contains every candidate.
///
/// Full app only (lives outside `Shared/`; the App Clip does not link WebRTC).
#if canImport(WebRTC)
protocol CallPeerConnectionDelegate: AnyObject {
    /// A complete local SDP (offer or answer, candidates embedded) is ready to
    /// be sent to the peer via the web signaling layer.
    func callPeer(_ peer: CallPeerConnection, didProduceLocalSDP sdp: String, type: String)
    /// Aggregate connection state for UI / call lifecycle.
    func callPeer(_ peer: CallPeerConnection, didChangeState state: RTCPeerConnectionState)
}

final class CallPeerConnection: NSObject {
    weak var delegate: CallPeerConnectionDelegate?
    let callId: String
    private let hasVideo: Bool

    private let factory: RTCPeerConnectionFactory
    private var pc: RTCPeerConnection?
    private var localAudioTrack: RTCAudioTrack?

    /// How long to wait for ICE gathering before sending the SDP anyway.
    private let iceGatherTimeout: TimeInterval = 6

    init(callId: String,
         hasVideo: Bool,
         factory: RTCPeerConnectionFactory,
         iceServers: [RTCIceServer]) {
        self.callId = callId
        self.hasVideo = hasVideo
        self.factory = factory
        super.init()

        // CallKit owns audio session activation: use manual mode so WebRTC does
        // not activate the session itself (CallKit does, in `didActivate`).
        let rtcAudio = RTCAudioSession.sharedInstance()
        rtcAudio.useManualAudio = true
        rtcAudio.isAudioEnabled = false

        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        config.bundlePolicy = .maxBundle
        config.rtcpMuxPolicy = .require
        config.continualGatheringPolicy = .gatherOnce

        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc = factory.peerConnection(with: config, constraints: constraints, delegate: self)

        addLocalAudio()
    }

    private func addLocalAudio() {
        let audioConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let source = factory.audioSource(with: audioConstraints)
        let track = factory.audioTrack(with: source, trackId: "audio0")
        localAudioTrack = track
        pc?.add(track, streamIds: ["stream0"])
    }

    // MARK: CallKit audio gating

    /// Called from CallKit `didActivate` / `didDeactivate` so WebRTC starts/stops
    /// rendering only while CallKit holds the session active.
    static func setAudioSessionActive(_ active: Bool) {
        RTCAudioSession.sharedInstance().isAudioEnabled = active
    }

    // MARK: offer / answer

    /// Outgoing: create an offer, wait for ICE, hand back the full SDP.
    func createOffer() {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc?.offer(for: constraints) { [weak self] sdp, error in
            guard let self, let sdp, error == nil else { return }
            self.pc?.setLocalDescription(sdp) { _ in
                self.waitForGatheringThenEmit(type: "offer")
            }
        }
    }

    /// Incoming: apply the remote offer, create an answer, wait for ICE, hand back.
    func receiveOffer(sdp: String) {
        let remote = RTCSessionDescription(type: .offer, sdp: sdp)
        pc?.setRemoteDescription(remote) { [weak self] error in
            guard let self, error == nil else { return }
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            self.pc?.answer(for: constraints) { sdp, error in
                guard let sdp, error == nil else { return }
                self.pc?.setLocalDescription(sdp) { _ in
                    self.waitForGatheringThenEmit(type: "answer")
                }
            }
        }
    }

    /// Outgoing caller: apply the remote answer.
    func receiveAnswer(sdp: String) {
        let remote = RTCSessionDescription(type: .answer, sdp: sdp)
        pc?.setRemoteDescription(remote) { _ in }
    }

    func setMuted(_ muted: Bool) {
        localAudioTrack?.isEnabled = !muted
    }

    func close() {
        pc?.close()
        pc = nil
        localAudioTrack = nil
        RTCAudioSession.sharedInstance().isAudioEnabled = false
    }

    // MARK: ICE non-trickle (embed candidates in SDP)

    private var emitted = false
    private func waitForGatheringThenEmit(type: String) {
        emitted = false
        // If already complete, emit immediately; else wait for the delegate
        // callback or the timeout, whichever comes first.
        if pc?.iceGatheringState == .complete {
            emitLocalSDP(type: type)
            return
        }
        pendingEmitType = type
        DispatchQueue.main.asyncAfter(deadline: .now() + iceGatherTimeout) { [weak self] in
            self?.emitLocalSDP(type: type)
        }
    }

    private var pendingEmitType: String?
    private func emitLocalSDP(type: String) {
        guard !emitted, let sdp = pc?.localDescription?.sdp else { return }
        emitted = true
        pendingEmitType = nil
        delegate?.callPeer(self, didProduceLocalSDP: sdp, type: type)
    }
}

extension CallPeerConnection: RTCPeerConnectionDelegate {
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        if newState == .complete, let type = pendingEmitType {
            emitLocalSDP(type: type)
        }
    }
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.delegate?.callPeer(self, didChangeState: newState)
        }
    }
    // Unused delegate methods (required by protocol).
    func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
#endif
