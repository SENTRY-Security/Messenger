import SwiftUI

/// App Clip root.
///
/// The clip is **always invoked by an NTAG424 tap** — the SDM URL arrives via
/// `NSUserActivityTypeBrowsingWeb`. Re-scanning the card inside the clip makes no
/// sense, so the clip never shows the native NFC login screen (`LoginView`).
/// Instead it loads the web shell directly:
///   - the scanned SDM URL when present (→ web shows the password login), or
///   - the web base URL otherwise (the web login / password page).
///
/// `.id(...)` re-creates the web container if the invocation URL arrives slightly
/// after first render, so a late `onContinueUserActivity` still loads correctly.
struct ClipRootView: View {
    @ObservedObject var router: SessionRouter

    private var loadURL: URL { router.sessionURL ?? AppConfig.startURL }

    var body: some View {
        WebContainerView(url: loadURL)
            .id(loadURL)
            .transition(.opacity)
    }
}
