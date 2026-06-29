import Foundation

/// Cross-target seam for the App's secure-session / app-lock features.
///
/// `NativeBridge` lives in the shared sources (compiled into both the full app
/// and the App Clip), but Keychain / FaceID / NFC-unlock logic is full-app only.
/// The full app injects an implementation into `NativeBridge.secureSession`; the
/// App Clip leaves it nil so the related bridge actions become no-ops.
protocol SecureSessionBridge: AnyObject {
    /// Handle a web→native secure-session action (`secureStore`, `secureLoad`,
    /// `clearSecureSession`, `getLockMode`, `setLockMode`, `openLockSettings`,
    /// `lockNow`, `nfcUnlockResult`).
    func handle(action: String, payload: [String: Any])

    /// Native→web channel, set by `NativeBridge` to its `sendEvent`. Used to push
    /// events such as `secureSessionLoaded`, `lockMode`, and `nfcUnlockScanned`.
    var sendToWeb: ((String, [String: Any]) -> Void)? { get set }
}
