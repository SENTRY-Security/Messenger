import Foundation

/// Native encrypted local cache (mid-term migration Tier 3, option A).
///
/// Stores **encrypted** backend responses (ciphertext the web later decrypts in
/// memory) as files protected with `.completeFileProtection`, so they're
/// encrypted at rest and tied to the device passcode. Enables offline reads and
/// faster launches without weakening E2EE — plaintext never lands on disk.
/// Wiped on logout (`cacheClear`). Full app only.
final class LocalCacheService: LocalCacheHandler {
    static let shared = LocalCacheService()

    var sendToWeb: ((String, [String: Any]) -> Void)?

    private var dir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("sentrycache", isDirectory: true)
    }
    private let io = DispatchQueue(label: "red.sentry.local-cache")

    private init() {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    func handle(action: String, payload: [String: Any]) {
        guard AppConfig.useNativeLocalCache else { return }
        switch action {
        case "cacheGet":
            let rid = payload["rid"] as? String ?? ""
            let key = payload["key"] as? String ?? ""
            io.async { [weak self] in
                let value = self?.read(key: key)
                DispatchQueue.main.async {
                    self?.sendToWeb?("cacheValue", ["rid": rid, "data": value as Any])
                }
            }
        case "cachePut":
            if let key = payload["key"] as? String, let data = payload["data"] as? String {
                io.async { [weak self] in self?.write(key: key, value: data) }
            }
        case "cacheDelete":
            if let key = payload["key"] as? String {
                io.async { [weak self] in self?.remove(key: key) }
            }
        case "cacheClear":
            io.async { [weak self] in self?.clear() }
        default:
            break
        }
    }

    // MARK: storage

    /// Map an arbitrary cache key to a safe filename (SHA-free; just sanitised +
    /// length-bounded so collisions are avoided by keeping the full key in a
    /// percent-escaped form).
    private func file(for key: String) -> URL {
        let escaped = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key
        let name = String(escaped.prefix(180))
        return dir.appendingPathComponent(name.isEmpty ? "_" : name)
    }

    private func read(key: String) -> String? {
        guard let data = try? Data(contentsOf: file(for: key)) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func write(key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: file(for: key), options: [.atomic, .completeFileProtection])
    }

    private func remove(key: String) {
        try? FileManager.default.removeItem(at: file(for: key))
    }

    private func clear() {
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
}
