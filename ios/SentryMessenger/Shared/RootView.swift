import SwiftUI

/// Switches between the native NFC login screen and the web shell, driven by
/// `SessionRouter`. Shared by the full app and the App Clip.
///
/// - Native login button → NFC tap → `router.open(url)`.
/// - NTAG424 universal-link launch → `router.open(url)` (skips the login screen).
/// - Re-auth from inside the web app uses the `scanNFC` bridge action, which
///   navigates the existing web view directly (no RootView change needed).
struct RootView: View {
    @ObservedObject var router: SessionRouter

    var body: some View {
        if let url = router.sessionURL {
            WebContainerView(url: url)
                .transition(.opacity)
        } else {
            LoginView { url in
                withAnimation { router.open(url) }
            }
        }
    }
}
