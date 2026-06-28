import SwiftUI
import WebKit

/// Thin SwiftUI wrapper that displays a `WKWebView` owned by `WebViewModel`.
struct WebViewRepresentable: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
