import Foundation

extension Notification.Name {
    /// Posted by the web bridge to ask the host app to register for push.
    /// Observed only by the full app's AppDelegate (no-op in the App Clip).
    static let sentryRegisterPush = Notification.Name("red.sentry.messenger.registerPush")

    /// Posted by the host app once an APNs device token is available.
    /// `object` is the hex token `String`.
    static let sentryPushToken = Notification.Name("red.sentry.messenger.pushToken")
}
