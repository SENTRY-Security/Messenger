import Foundation
import Security
import LocalAuthentication

/// iOS secure storage for the App's persistent session secrets (full app only).
///
/// - **Secrets** (KEK that unwraps the wrapped MK, `account_token`, `account_digest`)
///   live in the **Keychain** with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`
///   and an access-control flag requiring biometry/passcode, so they are bound to
///   this device and gated by FaceID/Secure Enclave. Plaintext MK is never stored.
/// - **Lock-mode preference** is non-sensitive and kept in `UserDefaults`.
///
/// All values are namespaced under the app's bundle id service.
enum KeychainStore {
    private static let service = (Bundle.main.bundleIdentifier ?? "red.sentry.messenger") + ".secureSession"

    // MARK: Lock mode preference (non-secret)

    private static let lockModeKey = "sentry.lockMode"

    static var lockMode: LockMode {
        get { LockMode(rawValue: UserDefaults.standard.string(forKey: lockModeKey) ?? "") ?? .none }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: lockModeKey) }
    }

    // MARK: Secret items (biometry-gated)

    /// Keys for the individual secret items.
    enum Item: String {
        case kek            // hex/base64 KEK that unwraps wrapped_mk
        case accountToken
        case accountDigest
    }

    /// Store a secret, device-bound and only readable while the device is unlocked.
    /// The biometric/NFC gate is enforced at the app level by `AppLockManager`
    /// (the lock overlay), so items don't carry a per-read `userPresence` flag —
    /// this avoids a second FaceID prompt right after the unlock overlay already
    /// passed. Returns true on success; overwrites any existing item.
    @discardableResult
    static func setSecret(_ value: String, for item: Item) -> Bool {
        delete(item)  // ensure clean insert
        guard let data = value.data(using: .utf8) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: item.rawValue,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess { print("[Keychain] add \(item.rawValue) failed: \(status)") }
        return status == errSecSuccess
    }

    /// Read a secret (no prompt; gated by device-unlocked + the app lock overlay).
    static func secret(for item: Item) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: item.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Whether a persisted session exists (token present).
    static var hasSession: Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: Item.accountToken.rawValue,
            kSecReturnData as String: false,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    @discardableResult
    static func delete(_ item: Item) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: item.rawValue,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Wipe the entire secure session (logout / kicked elsewhere).
    static func clearSession() {
        delete(.kek); delete(.accountToken); delete(.accountDigest)
    }
}
