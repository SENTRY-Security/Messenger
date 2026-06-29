import SwiftUI

/// Entry point #2 — App Clip (PARTIAL / scaffold).
///
/// An NTAG424 tap can launch this lightweight clip on devices without the full
/// app installed. The tag URL arrives as a `NSUserActivityTypeBrowsingWeb`
/// invocation and is routed into the web shell via `SessionRouter`. The clip is
/// always entered via the card tap, so it does NOT show the native NFC login —
/// `ClipRootView` loads the web shell directly (password login lives in web).
///
/// TODO (to discuss later):
///   - Configure the App Clip's Advanced/Default Experience + invocation URL in
///     App Store Connect, and the `appclips:` associated domain (AASA).
///   - SKOverlay / "Open in App" prompt to install the full app.
///   - Account hand-off to the full app (shared App Group / Keychain).
///   - Ephemeral notification permission.
@main
struct SentryMessengerClipApp: App {
    @StateObject private var router = SessionRouter()

    var body: some Scene {
        WindowGroup {
            ClipRootView(router: router)
                .preferredColorScheme(.dark)
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { router.open(url) }
                }
                .onOpenURL { router.open($0) }
                .onAppear {
                    SharedStore.lastClipLaunch = Date()
                    // Invite installing the full app shortly after launch.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        ClipInstallPrompt.present()
                    }
                }
        }
    }
}
