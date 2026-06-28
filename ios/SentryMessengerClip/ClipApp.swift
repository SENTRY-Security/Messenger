import SwiftUI

/// Entry point #2 — App Clip (PARTIAL / scaffold).
///
/// An NTAG424 tap can launch this lightweight clip on devices without the full
/// app installed. The tag URL arrives as a `NSUserActivityTypeBrowsingWeb`
/// invocation and is routed into the web shell via `SessionRouter`. If launched
/// without a URL (e.g. from the App Clip card) the native NFC login is shown.
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
            RootView(router: router)
                .preferredColorScheme(.dark)
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { router.open(url) }
                }
                .onOpenURL { router.open($0) }
        }
    }
}
