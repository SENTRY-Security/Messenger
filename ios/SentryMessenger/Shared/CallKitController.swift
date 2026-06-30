import Foundation
import CallKit
import AVFoundation
import UIKit

/// Native CallKit integration (P1 — foreground).
///
/// Wraps `CXProvider` (system call UI / lock-screen / recents) and
/// `CXCallController` (request transactions). The actual WebRTC media still runs
/// in the WKWebView; this layer only mirrors call *state* into the OS and relays
/// the user's actions on the system UI (answer / end / mute) back to the web
/// layer via the supplied callbacks.
///
/// Mapping: the web layer identifies calls by a string `callId`. CallKit needs a
/// `UUID`, so we keep a `callId → UUID` map and translate both ways.
///
/// Wiring: `NativeBridge` owns an instance, forwards JS `callIncoming/started/...`
/// actions here, and provides the `on*` callbacks that emit events back to JS.
final class CallKitController: NSObject {

    /// Shared instance so both the WebView bridge (`NativeBridge`) and the VoIP
    /// push path (`VoipPushService`) report into the same provider. The push
    /// path may run before any WebView exists (cold launch), so this must be a
    /// process-wide singleton.
    static let shared = CallKitController()

    /// Emitted when the user answers via the system UI. Web should run its
    /// "accept" path (send call-accept + acceptIncomingCallMedia).
    /// If a call is answered before the web layer has attached this callback
    /// (cold launch from a VoIP push), the callId is queued and replayed once
    /// the callback is set.
    var onAnswer: ((_ callId: String) -> Void)? {
        didSet {
            guard onAnswer != nil, let pending = pendingAnsweredCallId else { return }
            pendingAnsweredCallId = nil
            onAnswer?(pending)
        }
    }
    private var pendingAnsweredCallId: String?
    /// Emitted when the user ends/declines via the system UI. Web should run its
    /// reject (if ringing) or hangup (if connected) path. Cold-launch decline is
    /// queued and replayed once the callback attaches (symmetric to `onAnswer`).
    var onEnd: ((_ callId: String) -> Void)? {
        didSet {
            guard onEnd != nil, let pending = pendingEndedCallId else { return }
            pendingEndedCallId = nil
            onEnd?(pending)
        }
    }
    private var pendingEndedCallId: String?
    /// Emitted when a new incoming call is rejected because another call is
    /// already active (busy). Web should send `call-busy` to the caller.
    var onBusy: ((_ callId: String) -> Void)?
    /// Emitted when the user toggles mute via the system UI.
    var onMute: ((_ callId: String, _ muted: Bool) -> Void)?
    /// Emitted after CallKit activates the audio session — web may (re)start media.
    var onAudioReady: ((_ callId: String) -> Void)?

    /// The call currently occupying the device (answered/connected or outgoing).
    /// Used to reject concurrent incoming calls as busy (single-call app).
    private var activeCallId: String?
    /// Per-call missed-call safety net: auto-end an unanswered incoming call.
    private var incomingTimers: [UUID: DispatchWorkItem] = [:]
    private let incomingTimeout: TimeInterval = 40

    private let provider: CXProvider
    private let callController = CXCallController()

    /// callId(String) ↔ UUID bookkeeping.
    private var idToUUID: [String: UUID] = [:]
    private var uuidToId: [UUID: String] = [:]
    /// Tracks whether each active call is video, for audio-session config.
    private var videoFlags: [UUID: Bool] = [:]
    /// Calls already presented as incoming, so a VoIP-push report and a later
    /// web-side `callIncoming` for the same callId don't double-report.
    private var reportedIncoming: Set<UUID> = []

    override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallsPerCallGroup = 1
        config.maximumCallGroups = 1
        config.supportedHandleTypes = [.generic]
        // Privacy: don't surface peer identifiers into the system Recents list.
        config.includesCallsInRecents = false
        // App glyph on the system call UI. CallKit uses it as a template (only the
        // alpha channel matters). LogoMark is a vector; render it at a retina-
        // friendly size so it stays crisp on the call screen.
        if let logo = UIImage(named: "LogoMark") {
            let side: CGFloat = 120
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
            let icon = renderer.image { _ in
                logo.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
            }
            config.iconTemplateImageData = icon.pngData()
        }
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    // MARK: callId ↔ UUID

    private func uuid(for callId: String, createIfMissing: Bool = true) -> UUID? {
        if let existing = idToUUID[callId] { return existing }
        guard createIfMissing else { return nil }
        // Reuse the callId as a UUID when it already is one (keeps both ends aligned).
        let new = UUID(uuidString: callId) ?? UUID()
        idToUUID[callId] = new
        uuidToId[new] = callId
        return new
    }

    private func forget(_ uuid: UUID) {
        videoFlags[uuid] = nil
        reportedIncoming.remove(uuid)
        cancelIncomingTimer(uuid)
        if let callId = uuidToId[uuid] {
            idToUUID[callId] = nil
            if activeCallId == callId { activeCallId = nil }
        }
        uuidToId[uuid] = nil
    }

    // MARK: missed-call timeout

    private func startIncomingTimer(_ uuid: UUID) {
        cancelIncomingTimer(uuid)
        let work = DispatchWorkItem { [weak self] in
            guard let self, let callId = self.uuidToId[uuid] else { return }
            // Never answered/connected in time → end the system call as missed.
            self.reportEnded(callId: callId, reason: "unanswered")
        }
        incomingTimers[uuid] = work
        DispatchQueue.main.asyncAfter(deadline: .now() + incomingTimeout, execute: work)
    }

    private func cancelIncomingTimer(_ uuid: UUID) {
        incomingTimers[uuid]?.cancel()
        incomingTimers[uuid] = nil
    }

    // MARK: state in (from web via NativeBridge)

    /// Incoming call → present the system incoming-call UI.
    func reportIncoming(callId: String, peerName: String, hasVideo: Bool) {
        guard let id = uuid(for: callId) else { return }

        // Busy: another call is already active. iOS still requires that a VoIP
        // push results in a reported call, so report this one then immediately
        // end it as busy and let web notify the caller (`call-busy`).
        if let active = activeCallId, active != callId {
            guard !reportedIncoming.contains(id) else { return }
            reportedIncoming.insert(id)
            let update = CXCallUpdate()
            update.remoteHandle = CXHandle(type: .generic, value: peerName.isEmpty ? "SENTRY" : peerName)
            update.hasVideo = hasVideo
            provider.reportNewIncomingCall(with: id, update: update) { [weak self] error in
                guard let self else { return }
                if let error { print("[CallKit] busy reportIncoming failed: \(error.localizedDescription)") }
                self.provider.reportCall(with: id, endedAt: nil, reason: .remoteEnded)
                self.onBusy?(callId)
                self.forget(id)
            }
            return
        }

        videoFlags[id] = hasVideo
        // Idempotent: if already presented (e.g. via VoIP push), don't re-report.
        guard !reportedIncoming.contains(id) else { return }
        reportedIncoming.insert(id)
        activeCallId = callId  // a ringing call occupies the device (single-call app)
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: peerName.isEmpty ? "SENTRY" : peerName)
        update.hasVideo = hasVideo
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        provider.reportNewIncomingCall(with: id, update: update) { [weak self] error in
            guard let self else { return }
            if let error {
                print("[CallKit] reportIncoming failed: \(error.localizedDescription)")
                self.forget(id)
            } else {
                self.startIncomingTimer(id)  // missed-call safety net
            }
        }
    }

    /// Outgoing call → register it so it appears as an active system call.
    func reportOutgoing(callId: String, peerName: String, hasVideo: Bool) {
        guard let id = uuid(for: callId) else { return }
        videoFlags[id] = hasVideo
        activeCallId = callId
        let handle = CXHandle(type: .generic, value: peerName.isEmpty ? "SENTRY" : peerName)
        let action = CXStartCallAction(call: id, handle: handle)
        action.isVideo = hasVideo
        callController.request(CXTransaction(action: action)) { error in
            if let error { print("[CallKit] startCall failed: \(error.localizedDescription)") }
        }
        // `provider(perform: CXStartCallAction)` reports startedConnecting once the
        // system accepts the transaction.
    }

    /// Call became fully connected (media flowing).
    func reportConnected(callId: String) {
        guard let id = uuid(for: callId, createIfMissing: false) else { return }
        activeCallId = callId
        cancelIncomingTimer(id)
        provider.reportOutgoingCall(with: id, connectedAt: nil)
    }

    /// Reflect a mute change initiated from the web UI back into CallKit.
    func reportMuted(callId: String, muted: Bool) {
        guard let id = uuid(for: callId, createIfMissing: false) else { return }
        let action = CXSetMutedCallAction(call: id, muted: muted)
        callController.request(CXTransaction(action: action)) { error in
            if let error { print("[CallKit] setMuted failed: \(error.localizedDescription)") }
        }
    }

    /// Call ended from the web side (peer hung up, failure, local hangup already
    /// processed by web). Tear down the system call.
    func reportEnded(callId: String, reason: String) {
        guard let id = uuid(for: callId, createIfMissing: false) else { return }
        let cxReason: CXCallEndedReason
        switch reason {
        case "rejected", "declined": cxReason = .declinedElsewhere
        case "failed", "error":      cxReason = .failed
        case "unanswered", "timeout": cxReason = .unanswered
        case "remote", "hangup", "cancelled", "ended": cxReason = .remoteEnded
        default: cxReason = .remoteEnded
        }
        provider.reportCall(with: id, endedAt: nil, reason: cxReason)
        forget(id)
    }
}

// MARK: - CXProviderDelegate

extension CallKitController: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        // System reset (e.g. another call app) — drop everything.
        for uuid in Array(uuidToId.keys) { forget(uuid) }
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        // Set the audio category BEFORE CallKit activates the session (and before
        // WebKit starts its WebRTC audio unit). Activation itself is left to
        // CallKit → didActivate.
        AudioSessionManager.configureForCall(video: videoFlags[action.callUUID] ?? false)
        // System accepted our outgoing call → mark connecting in the UI.
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let callId = uuidToId[action.callUUID] else { action.fail(); return }
        activeCallId = callId
        cancelIncomingTimer(action.callUUID)
        // Configure the audio category before CallKit activates the session and
        // before WebKit starts its WebRTC audio unit.
        AudioSessionManager.configureForCall(video: videoFlags[action.callUUID] ?? false)
        if let onAnswer { onAnswer(callId) } else { pendingAnsweredCallId = callId }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        guard let callId = uuidToId[action.callUUID] else { action.fail(); return }
        if let onEnd { onEnd(callId) } else { pendingEndedCallId = callId }
        forget(action.callUUID)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        guard let callId = uuidToId[action.callUUID] else { action.fail(); return }
        onMute?(callId, action.isMuted)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // CallKit has already activated the session; the category was set in the
        // answer/start action. Do NOT reconfigure the category or re-activate here
        // — WebKit's WebRTC audio unit runs on this session and re-setting the
        // category mid-call interrupts it (a common cause of silent CallKit
        // calls). Just tell web the route is up so it can (re)start playback.
        if let callId = uuidToId.values.first { onAudioReady?(callId) }
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        AudioSessionManager.deactivate()
    }
}
