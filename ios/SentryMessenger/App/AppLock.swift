import Foundation
import SwiftUI
import LocalAuthentication

/// How the app re-gates access when returning to the foreground / cold launch
/// while logged in. User-selectable in the native lock settings (iOS App only).
enum LockMode: String, CaseIterable {
    case none      // no re-lock
    case faceid    // biometric (FaceID/TouchID)
    case nfc       // tap the NTAG424 card (strongest: physical possession)

    var title: String {
        switch self {
        case .none:   return "關閉"
        case .faceid: return "FaceID"
        case .nfc:    return "感應 NFC 卡"
        }
    }
}

/// Small factory so Keychain reads and explicit biometric checks can share a
/// pre-authenticated `LAContext` and a consistent prompt.
enum LAContextFactory {
    static func make(reason: String) -> LAContext? {
        let ctx = LAContext()
        ctx.localizedReason = reason
        return ctx
    }
}

/// Drives the lock overlay. Owned by the full app (`SentryMessengerApp`); the
/// App Clip never instantiates it.
///
/// Gate timing: on cold launch and on every foreground return, if a session is
/// logged in and `lockMode != .none`, the UI is locked until the user passes the
/// chosen challenge. Failure keeps the lock (retryable) and never logs out.
@MainActor
final class AppLockManager: ObservableObject {
    /// Shared so the per-WebView `NativeBridge` and the app-level UI reference the
    /// same lock state without plumbing it through SwiftUI.
    static let shared = AppLockManager()

    @Published private(set) var isLocked = false
    @Published private(set) var mode: LockMode = KeychainStore.lockMode
    @Published var lastError: String?
    /// Set by the `openLockSettings` bridge action; the app presents the sheet.
    @Published var showSettings = false

    /// Returns whether a web session is currently active (set by the app).
    var isLoggedIn: () -> Bool = { false }

    /// NFC verification round-trip: hand the scanned SDM URL to the web layer,
    /// which confirms it resolves to the logged-in account, then calls back.
    /// Wired by `NativeBridge`.
    var verifyNfcUrl: ((URL, @escaping (Bool) -> Void) -> Void)?

    private let nfc = NFCLoginService()
    private var unlocking = false
    /// Set while our own unlock UI (NFC scan sheet / FaceID prompt) is presented.
    /// That system UI backgrounds the app, which would otherwise re-arm the lock
    /// (`.background` → `lockNow`) and re-lock on the following foreground
    /// (`.active` → `evaluateLockOnForeground`) — re-locking right after a
    /// successful unlock. Consumed by the first foreground evaluation after the
    /// unlock UI is dismissed so a *genuine* later background still re-locks.
    private var ignoreForegroundRelock = false

    private init() {
        // The login scan (LoginView's own NFCLoginService) also presents the
        // system NFC sheet, which backgrounds the app. Without this, the foreground
        // return right after a fresh login would trigger `evaluateLockOnForeground`
        // and pop the lock screen. `NFCLoginService` signals every scan (login or
        // unlock) so we suppress that one re-lock uniformly.
        NotificationCenter.default.addObserver(
            forName: .sentryNfcSessionWillBegin, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.ignoreForegroundRelock = true }
        }
    }

    func refreshMode() { mode = KeychainStore.lockMode }

    func setMode(_ newMode: LockMode) {
        KeychainStore.lockMode = newMode
        mode = newMode
    }

    /// Evaluate whether the UI should be locked right now (called on launch and
    /// on each foreground transition).
    func evaluateLockOnForeground() {
        // This foreground was caused by dismissing our own unlock UI (NFC/FaceID),
        // not a genuine return from background — don't re-lock; let the in-flight
        // (or just-completed) unlock govern `isLocked`. One-shot.
        if ignoreForegroundRelock {
            ignoreForegroundRelock = false
            return
        }
        refreshMode()
        guard mode != .none, isLoggedIn() else { isLocked = false; return }
        isLocked = true
        attemptUnlock()
    }

    /// Begin the unlock challenge for the current mode.
    func attemptUnlock() {
        guard isLocked, !unlocking else { return }
        lastError = nil
        switch mode {
        case .none:
            isLocked = false
        case .faceid:
            unlockWithBiometrics()
        case .nfc:
            unlockWithNFC()
        }
    }

    private func unlockWithBiometrics() {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
            lastError = "此裝置無法使用生物辨識"
            return
        }
        unlocking = true
        // The biometric prompt backgrounds/inactivates the scene; don't let the
        // resulting foreground transition re-lock right after a success.
        ignoreForegroundRelock = true
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "解鎖 SENTRY Messenger") { [weak self] ok, error in
            Task { @MainActor in
                guard let self else { return }
                self.unlocking = false
                if ok {
                    self.isLocked = false
                } else if let error, !Self.isUserCancel(error) {
                    self.lastError = error.localizedDescription
                }
            }
        }
    }

    private func unlockWithNFC() {
        unlocking = true
        // The system NFC scan sheet backgrounds the app; don't let the resulting
        // foreground transition re-lock right after a successful unlock.
        ignoreForegroundRelock = true
        nfc.beginSession(prompt: "請感應您的安全卡片以解鎖") { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let url):
                    // Verify the card resolves to the logged-in account via web.
                    guard let verify = self.verifyNfcUrl else {
                        // No verifier wired — fail closed (stay locked).
                        self.unlocking = false
                        self.lastError = "無法驗證卡片"
                        return
                    }
                    verify(url) { ok in
                        Task { @MainActor in
                            self.unlocking = false
                            if ok { self.isLocked = false }
                            else { self.lastError = "卡片與目前帳號不符" }
                        }
                    }
                case .failure(let error):
                    self.unlocking = false
                    if !NFCLoginService.isCancellation(error) {
                        self.lastError = error.localizedDescription
                    }
                }
            }
        }
    }

    /// Lock immediately (e.g. user tapped "lock now").
    func lockNow() {
        // Our own unlock UI (NFC/FaceID) just backgrounded the app — that's not a
        // genuine background, so don't re-arm the lock.
        guard !ignoreForegroundRelock else { return }
        guard mode != .none, isLoggedIn() else { return }
        isLocked = true
    }

    private static func isUserCancel(_ error: Error) -> Bool {
        (error as NSError).code == LAError.userCancel.rawValue
    }
}
