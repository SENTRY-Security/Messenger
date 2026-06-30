import Foundation
import WebKit

/// Where background-downloaded (still-encrypted) media blobs are staged.
enum BackgroundDownloadPaths {
    static let scheme = "sentry-dl"
    /// `<caches>/sentrydl/` — app-private, not backed up by the scheme itself.
    static var dir: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("sentrydl", isDirectory: true)
    }
    /// File for a transfer id (id is sanitised to a safe filename component).
    static func file(for id: String) -> URL {
        dir.appendingPathComponent(safe(id))
    }
    /// Keep only `[A-Za-z0-9_-]` so a web-supplied id can't traverse the path.
    static func safe(_ id: String) -> String {
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        let cleaned = String(id.filter { allowed.contains($0) })
        return cleaned.isEmpty ? "_" : cleaned
    }
}

/// Serves the background-downloaded encrypted blob back to the web layer over a
/// custom scheme (`sentry-dl://file/<id>`), so the (up to 1 GB) ciphertext never
/// crosses the JS bridge as base64. The web then decrypts it exactly as if it had
/// fetched the presigned URL itself. Read-only and scoped strictly to the
/// `sentrydl` cache directory.
///
/// Mid-term migration Tier 2 (background attachment download). Gated end-to-end by
/// `UseNativeMediaDownload`; when off the web never fetches this scheme.
final class MediaDownloadSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "sentry-dl", code: -1)); return
        }
        // sentry-dl://file/<id>
        let id = url.lastPathComponent
        let fileURL = BackgroundDownloadPaths.file(for: id)
        guard let data = try? Data(contentsOf: fileURL) else {
            let resp = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1",
                                       headerFields: ["Access-Control-Allow-Origin": "*"])!
            urlSchemeTask.didReceive(resp)
            urlSchemeTask.didFinish()
            return
        }
        let headers = [
            "Content-Type": "application/octet-stream",
            "Content-Length": String(data.count),
            // Permissive CORS so a remote-origin (https) page can fetch() it.
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
        ]
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
