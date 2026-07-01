import Foundation
import AVFoundation
import CoreMedia
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
    /// The remote video track arrived (unified-plan `didAdd rtpReceiver`). Nil
    /// when the remote removes video. P2: the native video layer renders it.
    func callPeer(_ peer: CallPeerConnection, didReceiveRemoteVideoTrack track: RTCVideoTrack?)
}

extension CallPeerConnectionDelegate {
    // Optional: audio-only callers (P1) need not implement video.
    func callPeer(_ peer: CallPeerConnection, didReceiveRemoteVideoTrack track: RTCVideoTrack?) {}
}

final class CallPeerConnection: NSObject {
    weak var delegate: CallPeerConnectionDelegate?
    let callId: String
    private let hasVideo: Bool

    private let factory: RTCPeerConnectionFactory
    private var pc: RTCPeerConnection?
    private var localAudioTrack: RTCAudioTrack?

    // Video (P2). Created only for video calls. The capturer feeds frames into
    // the local video source; rendering is done by the native video layer.
    private var localVideoTrack: RTCVideoTrack?
    private var videoCapturer: RTCCameraVideoCapturer?
    private(set) var remoteVideoTrack: RTCVideoTrack?
    private var cameraPosition: AVCaptureDevice.Position = .front

    /// Exposed so the native video layer can render the local self-preview.
    var localVideoTrackForRender: RTCVideoTrack? { localVideoTrack }

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

        // CallKit owns audio session activation: manual mode so WebRTC does not
        // activate the session itself (CallKit does, in `didActivate`). Manual
        // mode is enabled once at launch (NativeCallController.bootstrap) so it is
        // already set before any CallKit activation; re-assert defensively here.
        //
        // Do NOT set `isAudioEnabled = false` here: for an outgoing call the peer
        // is created AFTER CallKit's `didActivate` has already fired (which set it
        // true), so forcing false would clobber the enabled audio and it would
        // never re-enable → silent call. `isAudioEnabled` is driven solely by
        // CallKit `didActivate`(true) / `didDeactivate`(false) and `close()`.
        RTCAudioSession.sharedInstance().useManualAudio = true

        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        config.bundlePolicy = .maxBundle
        config.rtcpMuxPolicy = .require
        config.continualGatheringPolicy = .gatherOnce

        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc = factory.peerConnection(with: config, constraints: constraints, delegate: self)

        addLocalAudio()
        if hasVideo { addLocalVideo() }
    }

    private func addLocalAudio() {
        let audioConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let source = factory.audioSource(with: audioConstraints)
        let track = factory.audioTrack(with: source, trackId: "audio0")
        localAudioTrack = track
        pc?.add(track, streamIds: ["stream0"])
    }

    // MARK: video (P2)

    /// Create the local camera video track and start capture (front camera).
    private func addLocalVideo() {
        let source = factory.videoSource()
        let capturer = RTCCameraVideoCapturer(delegate: source)
        let track = factory.videoTrack(with: source, trackId: "video0")
        localVideoTrack = track
        videoCapturer = capturer
        pc?.add(track, streamIds: ["stream0"])
        startCapture(position: cameraPosition)
    }

    /// Pick the best capture format for `position` (target ~720p / 30fps) and
    /// start the camera. No-op where the device/format is unavailable (e.g. the
    /// simulator), so audio negotiation still proceeds.
    private func startCapture(position: AVCaptureDevice.Position) {
        guard let capturer = videoCapturer else { return }
        let devices = RTCCameraVideoCapturer.captureDevices()
        guard let device = devices.first(where: { $0.position == position }) ?? devices.first else { return }
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        let target = 1280 * 720
        let format = formats.min(by: { lhs, rhs in
            let l = CMVideoFormatDescriptionGetDimensions(lhs.formatDescription)
            let r = CMVideoFormatDescriptionGetDimensions(rhs.formatDescription)
            let lArea = Int(l.width) * Int(l.height)
            let rArea = Int(r.width) * Int(r.height)
            return abs(lArea - target) < abs(rArea - target)
        }) ?? formats.last
        guard let chosen = format else { return }
        let maxFps = chosen.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 30
        let fps = Int(min(30, maxFps))
        cameraPosition = position
        capturer.startCapture(with: device, format: chosen, fps: fps)
    }

    /// Flip between front and back cameras (P2 control).
    func switchCamera() {
        startCapture(position: cameraPosition == .front ? .back : .front)
    }

    /// Enable / disable the local video track (camera on/off toggle).
    func setVideoEnabled(_ enabled: Bool) {
        localVideoTrack?.isEnabled = enabled
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
            guard let self else { return }
            if let error { print("[NativeCall] createOffer error=\(error.localizedDescription) callId=\(self.callId)"); return }
            guard let sdp else { return }
            self.pc?.setLocalDescription(sdp) { err in
                if let err { print("[NativeCall] setLocal(offer) error=\(err.localizedDescription) callId=\(self.callId)") }
                self.waitForGatheringThenEmit(type: "offer")
            }
        }
    }

    /// Incoming: apply the remote offer, create an answer, wait for ICE, hand back.
    func receiveOffer(sdp: String) {
        let remote = RTCSessionDescription(type: .offer, sdp: sdp)
        pc?.setRemoteDescription(remote) { [weak self] error in
            guard let self else { return }
            if let error { print("[NativeCall] setRemote(offer) error=\(error.localizedDescription) callId=\(self.callId)"); return }
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            self.pc?.answer(for: constraints) { sdp, error in
                if let error { print("[NativeCall] createAnswer error=\(error.localizedDescription) callId=\(self.callId)"); return }
                guard let sdp else { return }
                self.pc?.setLocalDescription(sdp) { err in
                    if let err { print("[NativeCall] setLocal(answer) error=\(err.localizedDescription) callId=\(self.callId)") }
                    self.waitForGatheringThenEmit(type: "answer")
                }
            }
        }
    }

    /// Outgoing caller: apply the remote answer.
    func receiveAnswer(sdp: String) {
        let remote = RTCSessionDescription(type: .answer, sdp: sdp)
        pc?.setRemoteDescription(remote) { [weak self] error in
            if let error { print("[NativeCall] setRemote(answer) error=\(error.localizedDescription) callId=\(self?.callId ?? "")") }
        }
    }

    func setMuted(_ muted: Bool) {
        localAudioTrack?.isEnabled = !muted
    }

    func close() {
        videoCapturer?.stopCapture()
        videoCapturer = nil
        pc?.close()
        pc = nil
        localAudioTrack = nil
        localVideoTrack = nil
        remoteVideoTrack = nil
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
        let candCount = sdp.components(separatedBy: "a=candidate").count - 1
        print("[NativeCall] emit \(type) callId=\(callId) candidates=\(candCount) mVideo=\(sdp.contains("m=video")) wantVideo=\(hasVideo)")
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
        print("[NativeCall] pcState=\(newState.rawValue) callId=\(callId)")
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.delegate?.callPeer(self, didChangeState: newState)
        }
    }
    // Unified-plan remote track arrival → surface remote video to the renderer.
    func peerConnection(_ pc: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
        print("[NativeCall] remoteTrack kind=\(rtpReceiver.track?.kind ?? "nil") callId=\(callId)")
        guard let videoTrack = rtpReceiver.track as? RTCVideoTrack else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.remoteVideoTrack = videoTrack
            self.delegate?.callPeer(self, didReceiveRemoteVideoTrack: videoTrack)
        }
    }

    // Unused delegate methods (required by protocol).
    func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        print("[NativeCall] iceState=\(newState.rawValue) callId=\(callId)")
    }
    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
#endif
