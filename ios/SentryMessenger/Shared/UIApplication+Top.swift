import UIKit

extension UIApplication {
    /// The top-most presented view controller of the key window, used to present
    /// native UI (share sheet, SFSafariViewController) over the web shell.
    var topViewController: UIViewController? {
        let root = connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?
            .rootViewController
        var top = root
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
