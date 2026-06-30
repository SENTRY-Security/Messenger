import Foundation

/// Cross-target seam for the native encrypted local cache (mid-term migration
/// Tier 3, option A — cache ciphertext only). The full app injects
/// `LocalCacheService` into `NativeBridge.localCache`; the App Clip leaves it nil
/// so the `cache*` actions are no-ops and the web always fetches from network.
///
/// Gated by `AppConfig.useNativeLocalCache` (Info.plist `UseNativeLocalCache`,
/// default false). Stores only **encrypted** backend responses on disk with
/// Data Protection (`.completeFileProtection`); plaintext is never persisted, and
/// everything is wiped on logout. This is a scoped exception to the otherwise
/// strict local-zero-persistence model (mirrors the existing iOS secure-session
/// exception).
protocol LocalCacheHandler: AnyObject {
    /// Handle a web→native cache action: `cacheGet` ({rid, key}) → emits
    /// `cacheValue` ({rid, data|null}); `cachePut` ({key, data}); `cacheDelete`
    /// ({key}); `cacheClear` ({}).
    func handle(action: String, payload: [String: Any])

    /// Native→web channel (set by `NativeBridge`). Emits `cacheValue`.
    var sendToWeb: ((String, [String: Any]) -> Void)? { get set }
}
