import Foundation
import WebKit

/// Serves the embedded `WebApp/` bundle over the custom `sentry-app://` scheme,
/// giving the full app an offline-capable, same-origin web shell. Only used when
/// `AppConfig.useBundledWeb` is on; the App Clip never registers this.
final class BundledWebSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(rootDirectory: URL) { self.root = rootDirectory }

    /// Locate the bundled web root (a folder reference named "WebApp").
    static var rootURL: URL? {
        Bundle.main.url(forResource: "WebApp", withExtension: nil)
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL)); return
        }
        // Map the request path to a file under the bundle root. Strip query.
        var rel = url.path
        if rel.hasPrefix("/") { rel.removeFirst() }
        if rel.isEmpty { rel = AppConfig.bundledEntryPath }

        let fileURL = root.appendingPathComponent(rel)
        // Prevent path traversal outside the bundle root.
        guard fileURL.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path),
              let data = try? Data(contentsOf: fileURL) else {
            let resp = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(resp)
            task.didFinish()
            return
        }

        let headers = [
            "Content-Type": Self.mimeType(for: fileURL.pathExtension),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ]
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "wasm": return "application/wasm"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "mp4": return "video/mp4"
        case "webm": return "video/webm"
        case "wav": return "audio/wav"
        case "mp3": return "audio/mpeg"
        default: return "application/octet-stream"
        }
    }
}
