import UIKit
import UserNotifications

/// Hosts UIKit-only lifecycle hooks that SwiftUI's App protocol does not expose,
/// chiefly Apple Push Notification (APNs) registration.
///
/// Decoupled from the web layer via `NotificationCenter`: the web bridge posts
/// `.sentryRegisterPush`, and we publish the resulting token back via
/// `.sentryPushToken`. This keeps `NativeBridge` shareable with the App Clip,
/// which has no AppDelegate.
///
/// NOTE: Push requires enabling the "Push Notifications" capability and a paid
/// Apple Developer account. The code compiles and runs without it.
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// PushKit VoIP registry (P2). Retained for the app lifetime so VoIP pushes
    /// keep waking the app. Created at launch so the token is available early.
    private let voipPush = VoipPushService()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(registerForPushNotifications),
            name: .sentryRegisterPush, object: nil)
        voipPush.start()  // register for VoIP pushes (PushKit)
        // Inject the full-app secure-session / app-lock handler into the bridge.
        NativeBridge.secureSession = SecureSessionController.shared
        // Inject the full-app native WebRTC call engine (nil in the App Clip).
        // No-op unless `UseNativeCalls` is on; bootstrap only touches WebRTC then.
        NativeBridge.nativeCalls = NativeCallController.shared
        NativeCallController.shared.bootstrapIfEnabled()
        // Inject the full-app native account WebSocket transport (nil in Clip).
        // No-op unless `UseNativeAccountSocket` is on (web routes through it then).
        NativeBridge.accountSocket = AccountSocketService.shared
        // Provide this device's push-preview public key for APNs registration
        // (enables the Notification Service Extension to decrypt previews).
        NativeBridge.pushPreviewPublicKey = { PushPreviewKey.ensurePublicKeyB64u() }
        return true
    }

    /// Prompt for notification permission, then register with APNs. Triggered by
    /// the web app (`registerPush` bridge action) so the prompt appears in a
    /// meaningful context rather than on cold launch.
    @objc func registerForPushNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(name: .sentryPushToken, object: token)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[Push] registration failed: \(error.localizedDescription)")
    }

    /// Clear the app badge whenever the app becomes active.
    func applicationDidBecomeActive(_ application: UIApplication) {
        UNUserNotificationCenter.current().setBadgeCount(0)
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    /// Show notifications even while the app is foregrounded.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .badge, .sound]
    }

    /// Notification tapped → if it carries a first-party `url`, ask the web
    /// bridge to navigate there (e.g. deep-link to a conversation).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        if let raw = info["url"] as? String, let url = URL(string: raw) {
            NotificationCenter.default.post(name: .sentryOpenURL, object: url)
        }
    }
}
