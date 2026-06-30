import SwiftUI

/// App Clip root.
///
/// The clip is **always invoked by an NTAG424 tap** — the SDM URL arrives via
/// `NSUserActivityTypeBrowsingWeb` and is CMAC-validated by `SessionRouter`
/// before loading. The clip therefore never shows the native NFC scan screen:
///   - validated SDM URL → web shell (web shows the password login)
///   - validating       → status spinner
///   - invalid / no URL  → status message (never the native NFC login)
struct ClipRootView: View {
    @ObservedObject var router: SessionRouter

    var body: some View {
        if let url = router.sessionURL {
            WebContainerView(url: url)
                .id(url)
                .transition(.opacity)
        } else if router.validating {
            ClipStatusView(message: "驗證安全卡片中…", showSpinner: true)
        } else if let err = router.sdmError {
            ClipStatusView(message: err, showSpinner: false)
        } else {
            ClipStatusView(message: "請以您的安全卡片開啟。", showSpinner: false)
        }
    }
}

/// Minimal branded status screen for the clip (no NFC scan button).
struct ClipStatusView: View {
    let message: String
    var showSpinner: Bool

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.059, green: 0.090, blue: 0.165),
                         Color(red: 0.008, green: 0.024, blue: 0.090)],
                startPoint: .top, endPoint: .bottom
            ).ignoresSafeArea()

            GeometryReader { geo in
                VStack(spacing: 16) {
                    Image("LogoMark")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 52, height: 52)
                        .foregroundStyle(.white)
                    Text("SENTRY MESSENGER")
                        .font(.system(size: 15, weight: .bold))
                        .tracking(3)
                        .foregroundStyle(Color(red: 0.878, green: 0.949, blue: 0.996))
                    if showSpinner {
                        ProgressView().progressViewStyle(.circular).tint(.white)
                    }
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(Color(red: 0.580, green: 0.639, blue: 0.722))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 36)
                }
                .frame(width: geo.size.width)
                // Bias slightly above true center so the block reads as vertically
                // centered in the visible area above the system "Get the full App"
                // banner the App Clip pins to the bottom of the screen.
                .position(x: geo.size.width / 2, y: geo.size.height * 0.42)
            }
        }
    }
}
