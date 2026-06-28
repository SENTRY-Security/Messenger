import SwiftUI

/// Entry point #2 — App Clip (PARTIAL / scaffold).
///
/// An NTAG424 tap can launch this lightweight clip on devices without the full
/// app installed. The tag URL arrives as a `NSUserActivityTypeBrowsingWeb`
/// invocation; we load it directly. If launched without a URL (e.g. from the
/// App Clip card), we fall back to the native NFC login screen.
///
/// TODO (to discuss later):
///   - Configure the App Clip's Advanced/Default Experience + invocation URL in
///     App Store Connect, and the `appclips:` associated domain.
///   - Decide which features the clip exposes vs. prompting full-app install
///     (SKOverlay / "Open in App").
///   - Ephemeral notification permission, account hand-off to the full app.
@main
struct SentryMessengerClipApp: App {
    @State private var invocationURL: URL?

    var body: some Scene {
        WindowGroup {
            Group {
                if let invocationURL {
                    WebContainerView(url: invocationURL)
                } else {
                    LoginView { invocationURL = $0 }
                }
            }
            .preferredColorScheme(.dark)
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL, url.host.map(AppConfig.allowedTagHosts.contains) == true {
                    invocationURL = url
                }
            }
        }
    }
}
