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

        // Embedded web bundle: serve the UI from the app over a custom scheme and
        // tell the web layer which absolute backend origin to call.
        if AppConfig.useBundledWeb, let root = BundledWebSchemeHandler.rootURL {
            config.setURLSchemeHandler(BundledWebSchemeHandler(rootDirectory: root), forURLScheme: AppConfig.bundleScheme)
            let js = "window.API_ORIGIN = '\(AppConfig.apiOrigin)';"
            controller.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        // Native call path feature flag (Info.plist `UseNativeCalls`). The web
        // call layer reads `window.USE_NATIVE_CALLS`: when true it hands media to
        // the native WebRTC engine via the bridge (`nativeCall*`) and keeps only
        // signaling/E2EE in JS; when false it runs WebRTC inside the WKWebView as
        // before. Injected for both bundled and remote web. App Clip leaves the
        // engine nil, so this stays false-effective there regardless.
        let nativeCallsJS = "window.USE_NATIVE_CALLS = \(AppConfig.useNativeCalls ? "true" : "false");"
        controller.addUserScript(WKUserScript(source: nativeCallsJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        // Native account WebSocket transport flag (Info.plist `UseNativeAccountSocket`).
        // When true, ws-integration.js routes through the NativeWebSocket shim so
        // the account WS bytes are owned by URLSession (AccountSocketService) instead
        // of WebKit. App Clip leaves the handler nil, so this stays false-effective.
        let nativeWsJS = "window.USE_NATIVE_ACCOUNT_SOCKET = \(AppConfig.useNativeAccountSocket ? "true" : "false");"
        controller.addUserScript(WKUserScript(source: nativeWsJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        // Native background media download (Tier 2). Register the handback scheme
        // (`sentry-dl://`) the native downloader serves staged ciphertext over, and
        // expose the flag. When off the web never fetches this scheme.
        config.setURLSchemeHandler(MediaDownloadSchemeHandler(), forURLScheme: BackgroundDownloadPaths.scheme)
        let nativeDlJS = "window.USE_NATIVE_MEDIA_DOWNLOAD = \(AppConfig.useNativeMediaDownload ? "true" : "false");"
        controller.addUserScript(WKUserScript(source: nativeDlJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        // Native encrypted local cache (Tier 3). When true the web caches encrypted
        // backend responses via the native Data-Protection store for offline / faster
        // launch. App Clip leaves the handler nil, so this stays false-effective.
        let nativeCacheJS = "window.USE_NATIVE_LOCAL_CACHE = \(AppConfig.useNativeLocalCache ? "true" : "false");"
        controller.addUserScript(WKUserScript(source: nativeCacheJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        controller.add(bridge, name: AppConfig.bridgeName)
        bridge.webView = webView

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isOpaque = false
        webView.backgroundColor = .black
        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Safari Web Inspector for debug builds
        }

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        load(AppConfig.resolveLoadURL(url))
    }

    func load(_ url: URL) {
        loadError = nil
        webView.load(URLRequest(url: url))
    }

    func reload() {
        loadError = nil
        if webView.url == nil {
            load(AppConfig.useBundledWeb ? AppConfig.bundledStartURL : AppConfig.startURL)
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

    /// Keep first-party navigations in-app; send everything else to an external
    /// browser. Sub-resource / iframe loads (third-party media, TURN, etc.) are
    /// always allowed.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let scheme = url.scheme?.lowercased() ?? ""

        // Web-internal schemes handled by WebKit itself.
        if ["blob", "data", "about", "javascript"].contains(scheme) {
            decisionHandler(.allow); return
        }
        // Non-web schemes (tel/mailto/sms/maps…) → hand to the OS.
        if scheme != "http" && scheme != "https" {
            decisionHandler(.cancel)
            ExternalLink.open(url)
            return
        }
        // Gate main-frame navigations (treat target=_blank / nil frame as main).
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if isMainFrame, let host = url.host, !AppConfig.allowedNavigationHosts.contains(host) {
            decisionHandler(.cancel)
            ExternalLink.open(url)
            return
        }
        decisionHandler(.allow)
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
        // Links opened with target=_blank have no target frame. Load first-party
        // URLs in the same web view; send external ones to the browser.
        guard let url = navigationAction.request.url else { return nil }
        if let host = url.host, AppConfig.allowedNavigationHosts.contains(host) {
            webView.load(URLRequest(url: url))
        } else {
            ExternalLink.open(url)
        }
        return nil
    }

    /// Grant camera/microphone to first-party origins so WebRTC voice/video
    /// calls work without a second (web-level) permission dance.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(AppConfig.allowedNavigationHosts.contains(origin.host) ? .grant : .prompt)
    }
}
