import Foundation
import CryptoKit

/// Owns this device's E2E push-preview keypair (full app side).
///
/// The keypair is generated once and the **private key never leaves native** —
/// it's stored (PKCS#8, base64url) in the shared Keychain group so the
/// Notification Service Extension can read it to decrypt previews. Only the
/// **public key** (X9.63 / uncompressed P-256, base64url) is handed to the web
/// layer, which registers it with the backend (`/d1/push/apns/subscribe`) so
/// senders can encrypt a per-device preview.
///
/// Mirrors the web service-worker scheme (`web/src/app/crypto/push-preview.js`):
/// P-256 ECDH + HKDF-SHA256 + AES-256-GCM.
enum PushPreviewKey {

    /// Get-or-create the keypair; returns the public key (base64url X9.63, 65
    /// bytes) for backend registration. Stable across launches (derived from the
    /// stored private key).
    static func ensurePublicKeyB64u() -> String? {
        if let existing = loadPrivateKey() {
            return b64u(existing.publicKey.x963Representation)
        }
        let priv = P256.KeyAgreement.PrivateKey()
        let stored = SharedKeychain.setPreviewPrivateKey(b64u(priv.derRepresentation))
        guard stored else { return nil }
        return b64u(priv.publicKey.x963Representation)
    }

    /// Forget the keypair (logout). The next registration generates a fresh one.
    static func clear() {
        SharedKeychain.deletePreviewPrivateKey()
    }

    private static func loadPrivateKey() -> P256.KeyAgreement.PrivateKey? {
        guard let b64 = SharedKeychain.previewPrivateKey(),
              let der = b64uDecode(b64),
              let key = try? P256.KeyAgreement.PrivateKey(derRepresentation: der) else { return nil }
        return key
    }

    // MARK: base64url

    private static func b64u(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func b64uDecode(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b += String(repeating: "=", count: (4 - b.count % 4) % 4)
        return Data(base64Encoded: b)
    }
}
