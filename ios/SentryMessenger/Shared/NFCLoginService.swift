import Foundation
import CoreNFC

/// Reads the NDEF URI written by an NTAG424 tag.
///
/// With Secure Dynamic Messaging (SDM) the tag rewrites its URL on every tap
/// with fresh `PICCData`/`CMAC` query params, so handing the scanned URL to the
/// web app — which verifies the CMAC server-side (data-worker NTAG424 logic) —
/// performs a one-tap, replay-resistant login. The AES master key never leaves
/// the backend, so the client only needs to read the (already-signed) URL.
final class NFCLoginService: NSObject {
    enum NFCError: LocalizedError {
        case unavailable
        case noURLFound
        case invalidHost

        var errorDescription: String? {
            switch self {
            case .unavailable: return "此裝置不支援 NFC 讀取"
            case .noURLFound:  return "卡片中找不到登入連結"
            case .invalidHost: return "卡片連結網域不被信任"
            }
        }
    }

    private var session: NFCNDEFReaderSession?
    private var completion: ((Result<URL, Error>) -> Void)?

    /// Whether the current device can read NFC (false on simulator / iPad).
    static var isAvailable: Bool { NFCNDEFReaderSession.readingAvailable }

    /// Presents the system NFC scanning sheet and resolves with the tag URL.
    func beginSession(prompt: String, completion: @escaping (Result<URL, Error>) -> Void) {
        guard NFCNDEFReaderSession.readingAvailable else {
            completion(.failure(NFCError.unavailable)); return
        }
        self.completion = completion
        let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: true)
        session.alertMessage = prompt
        self.session = session
        session.begin()
    }

    private func finish(_ result: Result<URL, Error>) {
        completion?(result)
        completion = nil
        session = nil
    }
}

extension NFCLoginService: NFCNDEFReaderSessionDelegate {
    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        let urls = messages.flatMap { $0.records }.compactMap { url(from: $0) }
        guard let url = urls.first else {
            session.invalidate(errorMessage: NFCError.noURLFound.localizedDescription)
            finish(.failure(NFCError.noURLFound)); return
        }
        guard let host = url.host, AppConfig.allowedTagHosts.contains(host) else {
            session.invalidate(errorMessage: NFCError.invalidHost.localizedDescription)
            finish(.failure(NFCError.invalidHost)); return
        }
        session.alertMessage = "登入中…"
        session.invalidate()
        finish(.success(url))
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        // If a URL was already delivered, the invalidation is expected — ignore it.
        guard completion != nil else { return }
        finish(.failure(error))
    }

    /// Decode an NDEF URI (or text) record into a URL.
    private func url(from record: NFCNDEFPayload) -> URL? {
        if let uri = record.wellKnownTypeURIPayload() { return uri }
        if let text = String(data: record.payload, encoding: .utf8) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let u = URL(string: trimmed), u.scheme != nil { return u }
        }
        return nil
    }
}
