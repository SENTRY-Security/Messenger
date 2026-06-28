import SwiftUI
import WebKit

/// Owns the single long-lived `WKWebView` and publishes its load state to
/// SwiftUI. The web view is created once and reused for the app's lifetime so
/// the web messenger's in-memory session/state survives view redraws.
final class WebViewModel: NSObject, ObservableObject {
    @Published var isLoading = false
    @Published var loadError: String?

    let webView: WKWebView
    let bridge = NativeBridge()

    init(url: URL) {
        let config = WKWebViewConfiguration()
        // WebRTC voice/video calls + inline media playback.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()

        let controller = WKUserContentController()
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        controller.add(bridge, name: AppConfig.bridgeName)
        bridge.webView = webView

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .black
        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Safari Web Inspector for debug builds
        }

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        load(url)
    }

    func load(_ url: URL) {
        loadError = nil
        webView.load(URLRequest(url: url))
    }

    func reload() {
        loadError = nil
        if webView.url == nil {
            load(AppConfig.startURL)
        } else {
            webView.reload()
        }
    }

    @objc private func handleRefresh() {
        webView.reload()
    }

    private func finish(withError error: Error) {
        isLoading = false
        webView.scrollView.refreshControl?.endRefreshing()
        let ns = error as NSError
        // Ignore the "cancelled" error WebKit emits when a load is superseded.
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        loadError = error.localizedDescription
    }
}

// MARK: - Navigation

extension WebViewModel: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
        loadError = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        webView.scrollView.refreshControl?.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(withError: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(withError: error)
    }
}

// MARK: - UI (new windows, target=_blank)

extension WebViewModel: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // Links opened with target=_blank have no target frame; load them in
        // the same web view instead of silently dropping them.
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }
}
