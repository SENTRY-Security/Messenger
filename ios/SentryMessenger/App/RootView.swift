import SwiftUI

/// App root. Starts at the native NFC login screen; after a successful tap the
/// scanned dynamic URL is loaded in the web messenger.
///
/// Re-authentication from inside the web app (e.g. expired session) is handled
/// separately via the `scanNFC` bridge action — see `NativeBridge`.
struct RootView: View {
    @State private var sessionURL: URL?

    var body: some View {
        if let sessionURL {
            WebContainerView(url: sessionURL)
                .transition(.opacity)
        } else {
            LoginView { url in
                withAnimation { sessionURL = url }
            }
        }
    }
}
