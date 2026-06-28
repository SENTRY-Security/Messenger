import Foundation
import WebKit
import UIKit

/// Bridges messages between the web app and native iOS.
///
/// JS → native:
///   `window.webkit.messageHandlers.sentryNative.postMessage({ action, payload })`
///   Supported actions: `ready`, `haptic`, `registerPush`, `scanNFC`, `share`.
///
/// native → JS:
///   `window.SentryNative.onEvent(name, data)` is invoked (the web app should
///   define it). Emitted events: `nfcResult`, `nfcError`, `pushToken`.
final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let nfc = NFCLoginService()

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self, selector: #selector(handlePushToken(_:)),
            name: .sentryPushToken, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleOpenURL(_:)),
            name: .sentryOpenURL, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == AppConfig.bridgeName else { return }
        let body = message.body as? [String: Any] ?? [:]
        let action = body["action"] as? String ?? ""
        let payload = body["payload"] as? [String: Any] ?? [:]

        switch action {
        case "ready":
            break
        case "haptic":
            triggerHaptic(payload["style"] as? String ?? "medium")
        case "registerPush":
            NotificationCenter.default.post(name: .sentryRegisterPush, object: nil)
        case "scanNFC":
            startNFCLogin()
        case "share":
            if let text = payload["text"] as? String {
                presentShare(text: text, urlString: payload["url"] as? String)
            }
        default:
            print("[NativeBridge] unhandled action: \(action)")
        }
    }

    // MARK: NFC login

    /// Entry point #1 (in-web button): the web login button calls
    /// `postMessage({action:'scanNFC'})`; we present the NFC sheet and, on a
    /// valid tag, navigate the web view to the dynamic SDM URL.
    func startNFCLogin() {
        nfc.beginSession(prompt: "請將卡片靠近手機頂端") { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let url):
                    self?.webView?.load(URLRequest(url: url))
                    self?.sendEvent("nfcResult", data: ["url": url.absoluteString])
                case .failure(let error):
                    self?.sendEvent("nfcError", data: [
                        "message": error.localizedDescription,
                        "code": NFCLoginService.code(for: error),
                    ])
                }
            }
        }
    }

    // MARK: native → JS

    func sendEvent(_ name: String, data: [String: Any] = [:]) {
        guard let webView else { return }
        let json = (try? JSONSerialization.data(withJSONObject: data))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let js = "window.SentryNative && window.SentryNative.onEvent && window.SentryNative.onEvent(\(name.jsQuoted), \(json));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func sendPushToken(_ token: String) {
        sendEvent("pushToken", data: ["token": token, "platform": "ios"])
    }

    @objc private func handlePushToken(_ note: Notification) {
        guard let token = note.object as? String else { return }
        sendPushToken(token)
    }

    /// Navigate the existing web view to a notification's deep link, in place,
    /// so the web session/state is preserved.
    @objc private func handleOpenURL(_ note: Notification) {
        guard let url = note.object as? URL,
              let host = url.host,
              AppConfig.allowedNavigationHosts.contains(host) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.load(URLRequest(url: url))
        }
    }

    // MARK: helpers

    private func triggerHaptic(_ style: String) {
        let mapping: [String: UIImpactFeedbackGenerator.FeedbackStyle] = [
            "light": .light, "medium": .medium, "heavy": .heavy, "soft": .soft, "rigid": .rigid,
        ]
        UIImpactFeedbackGenerator(style: mapping[style] ?? .medium).impactOccurred()
    }

    private func presentShare(text: String, urlString: String?) {
        var items: [Any] = [text]
        if let urlString, let url = URL(string: urlString) { items.append(url) }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        UIApplication.shared.topViewController?.present(vc, animated: true)
    }
}

private extension String {
    /// Single-quote and escape a string for safe inlining into JS.
    var jsQuoted: String {
        let escaped = self
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "'\(escaped)'"
    }
}
