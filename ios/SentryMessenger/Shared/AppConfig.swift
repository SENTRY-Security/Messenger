import Foundation

/// Static configuration for the native shell (shared by the full app and the App Clip).
enum AppConfig {
    /// Base URL of the hosted web messenger.
    /// Override per-build via the Info.plist key `WebBaseURL` (e.g. point a UAT
    /// scheme at the preview deployment) without touching code.
    static var startURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "WebBaseURL") as? String,
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "https://message.sentry.red")!
    }

    /// Name registered for the JS → native message handler:
    /// `window.webkit.messageHandlers.sentryNative.postMessage(...)`
    static let bridgeName = "sentryNative"

    /// Hosts accepted from a scanned NTAG424 tag. Prevents a rogue tag from
    /// redirecting login into an attacker-controlled origin.
    static let allowedTagHosts: Set<String> = [
        "app.message.sentry.red",
        "uat.message.sentry.red",
        "message.sentry.red",
    ]
}
