import Foundation

/// Full-app implementation of `SecureSessionBridge`: persists the secure session
/// in the Keychain, drives the app lock, and round-trips NFC-unlock verification
/// to the web layer. Injected into `NativeBridge.secureSession` at launch.
final class SecureSessionController: SecureSessionBridge {
    static let shared = SecureSessionController()

    /// Native→web channel (set by `NativeBridge`).
    var sendToWeb: ((String, [String: Any]) -> Void)?

    /// Pending NFC-unlock verification callback, awaiting the web's `nfcUnlockResult`.
    private var pendingNfcVerify: ((Bool) -> Void)?

    private init() {
        // When the lock manager needs to verify a tapped card, push the SDM URL to
        // web (which confirms it resolves to the logged-in account) and await reply.
        DispatchQueue.main.async {
            AppLockManager.shared.verifyNfcUrl = { [weak self] url, completion in
                guard let self else { completion(false); return }
                self.pendingNfcVerify = completion
                self.sendToWeb?("nfcUnlockScanned", ["url": url.absoluteString])
            }
        }
    }

    func handle(action: String, payload: [String: Any]) {
        switch action {
        case "secureStore":
            if let kek = payload["kek"] as? String { KeychainStore.setSecret(kek, for: .kek) }
            if let tok = payload["account_token"] as? String { KeychainStore.setSecret(tok, for: .accountToken) }
            if let dig = payload["account_digest"] as? String { KeychainStore.setSecret(dig, for: .accountDigest) }

        case "secureLoad":
            // Reveal stored secrets to web AFTER the lock overlay has passed, so web
            // can call /api/v1/mk/fetch and unwrap the MK in memory.
            var data: [String: Any] = ["hasSession": KeychainStore.hasSession]
            if let tok = KeychainStore.secret(for: .accountToken) { data["account_token"] = tok }
            if let dig = KeychainStore.secret(for: .accountDigest) { data["account_digest"] = dig }
            if let kek = KeychainStore.secret(for: .kek) { data["kek"] = kek }
            sendToWeb?("secureSessionLoaded", data)

        case "clearSecureSession":
            KeychainStore.clearSession()

        case "getLockMode":
            DispatchQueue.main.async { [weak self] in
                self?.sendToWeb?("lockMode", ["mode": AppLockManager.shared.mode.rawValue])
            }

        case "setLockMode":
            if let raw = payload["mode"] as? String, let m = LockMode(rawValue: raw) {
                DispatchQueue.main.async { AppLockManager.shared.setMode(m) }
            }

        case "openLockSettings":
            DispatchQueue.main.async { AppLockManager.shared.showSettings = true }

        case "lockNow":
            DispatchQueue.main.async { AppLockManager.shared.lockNow() }

        case "nfcUnlockResult":
            let ok = (payload["ok"] as? Bool) ?? false
            let cb = pendingNfcVerify
            pendingNfcVerify = nil
            cb?(ok)

        default:
            break
        }
    }
}
