import SwiftUI

/// Single source of truth for "which URL the web shell should show".
///
/// Fed by three inputs, all converging here:
///   1. Native NFC login (LoginView → scanned tag URL)
///   2. `scanNFC` bridge re-auth (NativeBridge)
///   3. NTAG424 universal-link cold start / foreground (App `.onContinueUserActivity`)
///
/// Only first-party hosts are accepted, so an arbitrary external link cannot
/// drive the shell into a foreign origin. SDM tag-wake URLs are additionally
/// **CMAC-validated** with the backend (non-consuming `/sdm/verify`) before the
/// web login loads, so a forged or invalid tag never reaches the web shell.
final class SessionRouter: ObservableObject {
    @Published var sessionURL: URL?
    /// Set when an SDM tag-wake URL fails validation; surfaced by the UI.
    @Published var sdmError: String?
    /// True while an SDM URL is being validated (UI may show a spinner).
    @Published var validating = false

    func open(_ url: URL) {
        guard let host = url.host, AppConfig.allowedNavigationHosts.contains(host) else { return }

        // Plain in-app navigation (no SDM params) loads directly.
        guard SdmValidator.hasSdmParams(url) else {
            sdmError = nil
            sessionURL = url
            return
        }

        // SDM tag-wake: verify the CMAC server-side BEFORE loading the web login.
        sdmError = nil
        validating = true
        SdmValidator.verify(url) { [weak self] ok in
            DispatchQueue.main.async {
                guard let self else { return }
                self.validating = false
                if ok {
                    self.sessionURL = url
                } else {
                    self.sdmError = "卡片驗證失敗，請重新感應有效的安全卡片。"
                }
            }
        }
    }
}
