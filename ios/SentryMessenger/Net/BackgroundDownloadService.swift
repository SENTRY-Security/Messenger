import Foundation

/// Native background media downloader (mid-term migration Tier 2, option B).
///
/// Downloads an encrypted media blob from its presigned URL using a **background**
/// `URLSession`, so the transfer survives the app being suspended or terminated
/// (the OS relaunches the app to finish and calls
/// `handleEventsForBackgroundURLSession`). The still-encrypted bytes are staged to
/// a cache file and handed back to the web layer via the `sentry-dl://` scheme
/// (no base64 over the JS bridge); the web decrypts as usual.
///
/// Encryption/decryption stay in the web layer — native only owns the byte
/// transport. Full app only.
final class BackgroundDownloadService: NSObject, BackgroundDownloadHandler {
    static let shared = BackgroundDownloadService()

    var sendToWeb: ((String, [String: Any]) -> Void)?

    /// Stored by the AppDelegate's `handleEventsForBackgroundURLSession` so we can
    /// tell the system we're done processing background events.
    var backgroundCompletion: (() -> Void)?

    private static let sessionId = "red.sentry.messenger.bgdownload"
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// taskIdentifier → web transfer id.
    private var idByTask: [Int: String] = [:]
    private let lock = NSLock()

    private override init() {
        super.init()
        try? FileManager.default.createDirectory(at: BackgroundDownloadPaths.dir,
                                                 withIntermediateDirectories: true)
        _ = session  // ensure the background session is reconnected at launch
    }

    // MARK: BackgroundDownloadHandler

    func handle(action: String, payload: [String: Any]) {
        guard AppConfig.useNativeMediaDownload else { return }
        guard let id = payload["id"] as? String, !id.isEmpty else { return }
        switch action {
        case "bgDownload":
            if let urlStr = payload["url"] as? String, let url = URL(string: urlStr) {
                start(id: id, url: url)
            } else {
                emitDone(id: id, ok: false, status: 0, error: "bad-url")
            }
        case "bgDownloadClear":
            try? FileManager.default.removeItem(at: BackgroundDownloadPaths.file(for: id))
        default:
            break
        }
    }

    private func start(id: String, url: URL) {
        let task = session.downloadTask(with: url)
        task.taskDescription = id
        lock.lock(); idByTask[task.taskIdentifier] = id; lock.unlock()
        task.resume()
    }

    private func emitDone(id: String, ok: Bool, status: Int, error: String?) {
        var payload: [String: Any] = ["id": id, "ok": ok, "status": status]
        if let error { payload["error"] = error }
        DispatchQueue.main.async { [weak self] in self?.sendToWeb?("bgDownloadDone", payload) }
    }
}

// MARK: - URLSessionDownloadDelegate

extension BackgroundDownloadService: URLSessionDownloadDelegate {
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        let id = downloadTask.taskDescription ?? {
            lock.lock(); defer { lock.unlock() }; return idByTask[downloadTask.taskIdentifier]
        }() ?? ""
        guard !id.isEmpty else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        let dest = BackgroundDownloadPaths.file(for: id)
        // Move synchronously here — `location` is only valid during this callback.
        do {
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: location, to: dest)
            if status == 0 || (200...299).contains(status) {
                emitDone(id: id, ok: true, status: status, error: nil)
            } else {
                emitDone(id: id, ok: false, status: status, error: "http-\(status)")
            }
        } catch {
            emitDone(id: id, ok: false, status: status, error: error.localizedDescription)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let taskId = task.taskIdentifier
        lock.lock(); let id = idByTask[taskId]; idByTask[taskId] = nil; lock.unlock()
        if let error, let id, !id.isEmpty {
            let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
            emitDone(id: id, ok: false, status: status, error: error.localizedDescription)
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in
            self?.backgroundCompletion?()
            self?.backgroundCompletion = nil
        }
    }
}
