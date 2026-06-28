import Foundation

/// App Group-backed store for App Clip ↔ full app hand-off.
///
/// ONLY non-sensitive flags belong here. Per the project's security model
/// (zero local persistence of secrets), tokens/keys must NOT be written here —
/// the full app re-authenticates. For sensitive hand-off use a Keychain access
/// group instead (TODO, requires `keychain-access-groups` entitlement).
enum SharedStore {
    static let appGroup = "group.red.sentry.app.SENTRY-Messenger"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    /// Timestamp of the most recent App Clip launch — lets the full app know the
    /// user arrived via a clip (e.g. to streamline onboarding).
    static var lastClipLaunch: Date? {
        get { defaults?.object(forKey: "lastClipLaunch") as? Date }
        set { defaults?.set(newValue, forKey: "lastClipLaunch") }
    }
}
