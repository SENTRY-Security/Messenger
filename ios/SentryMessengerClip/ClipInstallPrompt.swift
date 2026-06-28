import StoreKit
import UIKit

/// Presents the system App Clip overlay inviting the user to install the full
/// app. Only renders when the clip is distributed via the App Store; it is a
/// no-op in development builds.
enum ClipInstallPrompt {
    static func present() {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })
        else { return }

        let config = SKOverlay.AppClipConfiguration(position: .bottom)
        SKOverlay(configuration: config).present(in: scene)
    }
}
