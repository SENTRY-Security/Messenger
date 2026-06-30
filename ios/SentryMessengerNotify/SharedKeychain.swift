import Foundation
import Security

/// Tiny Keychain store shared between the main app and the Notification Service
/// Extension via a common keychain-access-group, used to hand the app-provisioned
/// push-preview private key (PKCS#8, base64url) to the NSE.
///
/// Accessibility is `afterFirstUnlockThisDeviceOnly` (NOT `whenUnlocked`) so the
/// extension can read the key when a push arrives with the screen **locked** —
/// the whole point of decrypting previews in the background. This is a *narrow,
/// justified* relaxation: this key decrypts notification previews only (sender
/// name + short text); it cannot decrypt message content and never touches the
/// master key / KEK (those stay `whenUnlockedThisDeviceOnly`). See
/// `ios/docs/native-webrtc-migration-plan.md` §4.1 for the protection-class
/// rationale.
///
/// NOTE: the access group must be listed in BOTH targets' `keychain-access-groups`
/// entitlement. The prefix is this project's Apple team id (see `project.yml`
/// `DEVELOPMENT_TEAM`); adjust if the App ID prefix differs from the team id.
enum SharedKeychain {
    static let accessGroup = "HW8N8C46HG.red.sentry.shared"
    private static let service = "red.sentry.messenger.pushPreview"
    private static let account = "previewPrivateKey"

    /// App side: store the PKCS#8 private key (base64url). Overwrites any prior.
    @discardableResult
    static func setPreviewPrivateKey(_ value: String) -> Bool {
        deletePreviewPrivateKey()
        guard let data = value.data(using: .utf8) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    /// NSE side: read the private key (no prompt; readable while locked after the
    /// first unlock since boot).
    static func previewPrivateKey() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func deletePreviewPrivateKey() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
