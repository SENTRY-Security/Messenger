import SwiftUI

@main
struct SentryMessengerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var router = SessionRouter()

    var body: some Scene {
        WindowGroup {
            RootView(router: router)
                .preferredColorScheme(.dark)
                // NTAG424 universal-link (https) cold start / foreground.
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { router.open(url) }
                }
                // Custom-scheme deep links, if ever configured.
                .onOpenURL { router.open($0) }
        }
    }
}
