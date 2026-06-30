import Foundation

/// Cross-target seam for the native background media downloader (mid-term
/// migration Tier 2). The full app injects `BackgroundDownloadService` into
/// `NativeBridge.backgroundDownload`; the App Clip leaves it nil so the `bg*`
/// actions are no-ops and the web downloads media itself.
///
/// Gated by `AppConfig.useNativeMediaDownload` (Info.plist
/// `UseNativeMediaDownload`, default false): when off the web never routes media
/// downloads through native.
protocol BackgroundDownloadHandler: AnyObject {
    /// Handle a web→native action: `bgDownload` ({id, url}) starts a background
    /// download; `bgDownloadClear` ({id}) deletes the staged file.
    func handle(action: String, payload: [String: Any])

    /// Native→web channel, set by `NativeBridge` to its `sendEvent`. Emits
    /// `bgDownloadDone` ({id, ok, status?, error?}) when a download finishes.
    var sendToWeb: ((String, [String: Any]) -> Void)? { get set }
}
