import UserNotifications

/// Notification Service Extension: decrypts the E2E `encrypted_preview` carried by
/// the APNs push and replaces the generic "SENTRY MESSENGER" alert with the real
/// sender + preview text — something the WKWebView app cannot do while it isn't
/// running.
///
/// The push must arrive with `aps.mutable-content = 1` (set by the backend when an
/// `encrypted_preview` is present) for iOS to invoke this extension. On any
/// failure (no key, no/invalid preview, timeout) the original generic alert is
/// delivered unchanged.
final class NotificationService: UNNotificationServiceExtension {

    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        let mutable = (request.content.mutableCopy() as? UNMutableNotificationContent)
        bestAttempt = mutable
        guard let mutable else { contentHandler(request.content); return }

        let info = request.content.userInfo
        guard let blob = info["encrypted_preview"] as? String, !blob.isEmpty,
              let privKey = SharedKeychain.previewPrivateKey(),
              let preview = PushPreviewCrypto.decrypt(blobB64u: blob, privateKeyPKCS8B64u: privKey) else {
            contentHandler(mutable)  // deliver the generic alert as-is
            return
        }

        if let title = preview.title, !title.isEmpty { mutable.title = title }
        if let body = preview.body, !body.isEmpty { mutable.body = body }
        contentHandler(mutable)
    }

    override func serviceExtensionTimeWillExpire() {
        // System is about to kill us — deliver whatever we have.
        if let contentHandler, let bestAttempt { contentHandler(bestAttempt) }
    }
}
