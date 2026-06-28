import UIKit
import SafariServices

/// Opens links that should leave the messenger shell:
/// web links (non first-party) in an in-app Safari sheet, and system schemes
/// (tel/mailto/sms/maps…) via the OS.
enum ExternalLink {
    static func open(_ url: URL) {
        let scheme = url.scheme?.lowercased() ?? ""
        guard scheme == "http" || scheme == "https" else {
            UIApplication.shared.open(url)
            return
        }
        let safari = SFSafariViewController(url: url)
        safari.modalPresentationStyle = .formSheet
        UIApplication.shared.topViewController?.present(safari, animated: true)
    }
}
