import Foundation

extension Notification.Name {
    /// Posted by the web bridge to ask the host app to register for push.
    /// Observed only by the full app's AppDelegate (no-op in the App Clip).
    static let sentryRegisterPush = Notification.Name("red.sentry.messenger.registerPush")

    /// Posted by the host app once an APNs device token is available.
    /// `object` is the hex token `String`.
    static let sentryPushToken = Notification.Name("red.sentry.messenger.pushToken")

    /// Posted when a notification is tapped and carries a first-party URL to
    /// open. `object` is the `URL`. The web bridge navigates the existing web
    /// view in place (no shell reset).
    static let sentryOpenURL = Notification.Name("red.sentry.messenger.openURL")

    /// Posted by `VoipPushService` once a PushKit VoIP token is available.
    /// `object` is the hex token `String`. Forwarded to web as `voipToken`.
    static let sentryVoipToken = Notification.Name("red.sentry.messenger.voipToken")
}
