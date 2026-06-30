import Foundation

/// Static configuration for the native shell (shared by the full app and the App Clip).
enum AppConfig {
    /// Base URL of the hosted web messenger.
    /// Override per-build via the Info.plist key `WebBaseURL` (e.g. point a UAT
    /// scheme at the preview deployment) without touching code.
    static var startURL: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "WebBaseURL") as? String,
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "https://app.message.sentry.red")!
    }

    /// Name registered for the JS → native message handler:
    /// `window.webkit.messageHandlers.sentryNative.postMessage(...)`
    static let bridgeName = "sentryNative"

    /// First-party messenger hosts. Single source of truth for both the NFC tag
    /// host whitelist and in-app navigation gating.
    static let messengerHosts: Set<String> = [
        "message.sentry.red",
        "app.message.sentry.red",
        "uat.message.sentry.red",
    ]

    /// Hosts accepted from a scanned NTAG424 tag. Prevents a rogue tag from
    /// redirecting login into an attacker-controlled origin.
    static var allowedTagHosts: Set<String> { messengerHosts }

    /// Main-frame navigations to hosts outside this set open in an external
    /// browser (SFSafariViewController) instead of inside the app shell.
    static var allowedNavigationHosts: Set<String> { messengerHosts }

    // ── Embedded web bundle (offline-capable shell) ──────────────────────
    //
    // When enabled, the FULL app serves the web UI from the embedded `WebApp/`
    // bundle through a custom scheme and talks to the backend at `apiOrigin`.
    // The App Clip always loads remotely (size limit). Toggle via Info.plist
    // `UseBundledWeb` = "true"; default off until the bundled build is
    // device-verified.

    static var useBundledWeb: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "UseBundledWeb") as? String)?.lowercased() == "true"
    }

    /// Native WebRTC call path (mid-term migration). When false (default) calls
    /// run inside the WKWebView as today. Toggle via Info.plist `UseNativeCalls`.
    /// See `docs/native-webrtc-migration-plan.md`. App Clip ignores this (no
    /// native call stack there).
    static var useNativeCalls: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "UseNativeCalls") as? String)?.lowercased() == "true"
    }

    /// Native account WebSocket transport (mid-term migration, Option B). When
    /// false (default) the web opens its own `WebSocket` as today. When true the
    /// native layer owns the single account WS (`AccountSocketService`) and the
    /// web routes through it via a `NativeWebSocket` shim. Toggle via Info.plist
    /// `UseNativeAccountSocket`. Full app only (App Clip keeps the WebView WS).
    static var useNativeAccountSocket: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "UseNativeAccountSocket") as? String)?.lowercased() == "true"
    }

    /// Native background media download (mid-term migration Tier 2). When true the
    /// web routes single-shot encrypted media downloads through a native
    /// background `URLSession` (survives suspension), handing the ciphertext back
    /// over the `sentry-dl://` scheme. Toggle via Info.plist `UseNativeMediaDownload`.
    /// Full app only; falls back to the web download path on any failure.
    static var useNativeMediaDownload: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "UseNativeMediaDownload") as? String)?.lowercased() == "true"
    }

    static let bundleScheme = "sentry-app"
    static let bundleHost = "app"
    /// Entry HTML inside `WebApp/` (relative path).
    static let bundledEntryPath = "pages/app.html"

    /// Absolute backend origin the bundled web calls (injected as
    /// `window.API_ORIGIN`). Override via Info.plist `ApiOrigin`.
    static var apiOrigin: String {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "ApiOrigin") as? String, !raw.isEmpty {
            return raw.trimmingCharacters(in: .whitespaces)
        }
        return "https://app.message.sentry.red"
    }

    static var bundledStartURL: URL {
        URL(string: "\(bundleScheme)://\(bundleHost)/\(bundledEntryPath)")!
    }

    /// Resolve which URL the web view should actually load. In bundled mode a
    /// first-party https URL (e.g. the NTAG424 SDM link) is mapped onto the
    /// embedded scheme, preserving path + query so the bundled web performs
    /// login against `apiOrigin`.
    static func resolveLoadURL(_ url: URL) -> URL {
        guard useBundledWeb else { return url }
        var comps = URLComponents()
        comps.scheme = bundleScheme
        comps.host = bundleHost
        let path = (url.path.isEmpty || url.path == "/") ? "/\(bundledEntryPath)" : url.path
        comps.path = path
        comps.query = url.query
        return comps.url ?? bundledStartURL
    }
}

