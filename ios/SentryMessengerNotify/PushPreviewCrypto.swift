import Foundation
import CryptoKit

/// Native decryption of E2E push-notification previews — the iOS equivalent of
/// the web service worker's `decryptPreview` (`web/src/app/crypto/push-preview.js`).
///
/// Wire format (base64url), identical to the web sender:
///   [65 bytes ephemeral P-256 public key, uncompressed X9.63 0x04‖X‖Y]
///   [12 bytes AES-GCM IV]
///   [ciphertext ‖ 16-byte GCM tag]
///
/// Scheme: ECDH(P-256) → HKDF-SHA256(salt = 32 zero bytes, info =
/// "sentry-push-preview-v1") → AES-256-GCM. The recipient's PKCS#8 private key is
/// provisioned into a shared Keychain group so the Notification Service Extension
/// can decrypt while the app isn't running. The server only ever sees ciphertext.
enum PushPreviewCrypto {

    /// HKDF `info`, must match the web (`push-preview.js` `HKDF_INFO`).
    private static let hkdfInfo = Data("sentry-push-preview-v1".utf8)

    struct Preview {
        let title: String?
        let body: String?
    }

    /// Decrypt a base64url preview blob with the recipient's PKCS#8 private key
    /// (also base64url). Returns nil on any failure so the caller falls back to a
    /// generic alert.
    static func decrypt(blobB64u: String, privateKeyPKCS8B64u: String) -> Preview? {
        guard let blob = base64urlDecode(blobB64u),
              blob.count > 65 + 12 + 16,
              let pkcs8 = base64urlDecode(privateKeyPKCS8B64u) else { return nil }

        let ephPub = blob.subdata(in: 0..<65)
        let iv = blob.subdata(in: 65..<77)
        let sealed = blob.subdata(in: 77..<blob.count)
        let ctLen = sealed.count - 16
        let ciphertext = sealed.subdata(in: 0..<ctLen)
        let tag = sealed.subdata(in: ctLen..<sealed.count)

        do {
            let priv = try P256.KeyAgreement.PrivateKey(derRepresentation: pkcs8)
            let eph = try P256.KeyAgreement.PublicKey(x963Representation: ephPub)
            let shared = try priv.sharedSecretFromKeyAgreement(with: eph)
            let key = shared.hkdfDerivedSymmetricKey(
                using: SHA256.self,
                salt: Data(count: 32),
                sharedInfo: hkdfInfo,
                outputByteCount: 32
            )
            let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: iv),
                                            ciphertext: ciphertext,
                                            tag: tag)
            let plain = try AES.GCM.open(box, using: key)
            return parse(plain)
        } catch {
            return nil
        }
    }

    /// The web encrypts a JSON object `{title, body, msgType}`; tolerate a bare
    /// string too.
    private static func parse(_ data: Data) -> Preview {
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return Preview(title: obj["title"] as? String, body: obj["body"] as? String)
        }
        let text = String(data: data, encoding: .utf8)
        return Preview(title: nil, body: text)
    }

    // MARK: base64url

    private static func base64urlDecode(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let pad = (4 - b.count % 4) % 4
        b += String(repeating: "=", count: pad)
        return Data(base64Encoded: b)
    }
}
