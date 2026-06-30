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

        // Load the tag URL directly and let the web complete login. The web's
        // `/sdm/exchange` is the authoritative, CMAC-validated, counter-advancing
        // auth gate and rejects forged/invalid tags itself.
        //
        // INCIDENT FIX: the previous native pre-check (`SdmValidator.verify` →
        // `/sdm/verify`) was fail-CLOSED — any non-200 / network failure /
        // `ok:false` left the user on the login screen with no navigation, which
        // blocked ALL logins whenever that endpoint was unreachable. The pre-check
        // is redundant with the web exchange, so it no longer gates navigation.
        sdmError = nil
        validating = false
        sessionURL = url
    }
}
