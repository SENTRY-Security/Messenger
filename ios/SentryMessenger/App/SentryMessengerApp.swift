import SwiftUI

@main
struct SentryMessengerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var router = SessionRouter()
    @ObservedObject private var lock = AppLockManager.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView(router: router)
                    .preferredColorScheme(.dark)
                    // NTAG424 universal-link (https) cold start / foreground.
                    .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                        if let url = activity.webpageURL { router.open(url) }
                    }
                    // Custom-scheme deep links, if ever configured.
                    .onOpenURL { router.open($0) }

                // Secure-session re-lock overlay (FaceID / NFC). Covers everything.
                if lock.isLocked {
                    LockOverlayView(lock: lock)
                        .transition(.opacity)
                        .zIndex(10)
                }
            }
            .onAppear {
                // Tell the lock manager how to detect a logged-in session.
                lock.isLoggedIn = { router.sessionURL != nil }
                lock.evaluateLockOnForeground()
            }
            .sheet(isPresented: $lock.showSettings) {
                LockSettingsView(lock: lock) { lock.showSettings = false }
            }
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                // Returning to the foreground → re-evaluate the lock.
                lock.evaluateLockOnForeground()
            case .background:
                // Re-arm the lock so the next foreground requires unlock.
                lock.lockNow()
            default:
                break
            }
        }
    }
}
