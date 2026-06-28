import SwiftUI

/// Single source of truth for "which URL the web shell should show".
///
/// Fed by three inputs, all converging here:
///   1. Native NFC login (LoginView → scanned tag URL)
///   2. `scanNFC` bridge re-auth (NativeBridge)
///   3. NTAG424 universal-link cold start / foreground (App `.onContinueUserActivity`)
///
/// Only first-party hosts are accepted, so an arbitrary external link cannot
/// drive the shell into a foreign origin.
final class SessionRouter: ObservableObject {
    @Published var sessionURL: URL?

    func open(_ url: URL) {
        guard let host = url.host, AppConfig.allowedNavigationHosts.contains(host) else { return }
        sessionURL = url
    }
}
