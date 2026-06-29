import SwiftUI

/// Native NFC login entry (entry point #1, native variant).
///
/// Tapping the button presents the system NFC sheet; on a valid NTAG424 tap the
/// dynamic SDM URL is handed back via `onScanned`, which the caller loads in the
/// web view to complete login. Also reused as the App Clip's fallback screen.
///
/// Visual language mirrors the web login page (`web/src/pages/login.html`):
/// dark slate gradient backdrop, white monochrome logo above the wordmark,
/// and a cyan→indigo gradient primary button.
struct LoginView: View {
    var onScanned: (URL) -> Void

    @State private var scanning = false
    @State private var errorText: String?
    private let nfc = NFCLoginService()

    // ── Web login palette (see login.html :root tokens) ──
    private let cyan = Color(red: 0.220, green: 0.741, blue: 0.973)   // #38bdf8
    private let indigo = Color(red: 0.388, green: 0.400, blue: 0.945) // #6366f1
    private let brandText = Color(red: 0.878, green: 0.949, blue: 0.996) // #e0f2fe
    private let muted = Color(red: 0.580, green: 0.639, blue: 0.722)  // #94a3b8

    private var backdrop: LinearGradient {
        LinearGradient(
            stops: [
                .init(color: Color(red: 0.059, green: 0.090, blue: 0.165), location: 0.0),  // #0f172a
                .init(color: Color(red: 0.118, green: 0.161, blue: 0.231), location: 0.65), // #1e293b
                .init(color: Color(red: 0.008, green: 0.024, blue: 0.090), location: 1.0)   // #020617
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var accent: LinearGradient {
        LinearGradient(colors: [cyan, indigo], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            Image("LogoMark")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 60, height: 60)
                .foregroundStyle(.white)
                .shadow(color: cyan.opacity(0.45), radius: 18)
                .shadow(color: indigo.opacity(0.30), radius: 40)
                .padding(.bottom, 20)

            Text("SENTRY MESSENGER")
                .font(.system(size: 19, weight: .bold))
                .tracking(4)
                .foregroundStyle(brandText)
                .shadow(color: cyan.opacity(0.5), radius: 18)

            Text("感應您的安全卡片以登入")
                .font(.subheadline)
                .tracking(0.5)
                .foregroundStyle(muted)
                .padding(.top, 10)

            if let errorText {
                Text(errorText)
                    .font(.footnote)
                    .foregroundStyle(Color(red: 0.988, green: 0.647, blue: 0.647)) // #fca5a5
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 14)
            }

            Spacer()

            Button(action: scan) {
                HStack(spacing: 8) {
                    Image(systemName: "dot.radiowaves.left.and.right")
                    Text(scanning ? "感應中…" : "感應卡片登入")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .foregroundStyle(.white)
                .background(accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: indigo.opacity(0.30), radius: 16, y: 8)
            }
            .opacity((scanning || !NFCLoginService.isAvailable) ? 0.55 : 1)
            .disabled(scanning || !NFCLoginService.isAvailable)
            .padding(.horizontal, 24)

            if !NFCLoginService.isAvailable {
                Text("此裝置不支援 NFC")
                    .font(.caption)
                    .foregroundStyle(muted)
                    .padding(.top, 10)
            }
        }
        .padding(.bottom, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(backdrop.ignoresSafeArea())
    }

    private func scan() {
        scanning = true
        errorText = nil
        nfc.beginSession(prompt: "請將卡片靠近手機頂端") { result in
            DispatchQueue.main.async {
                scanning = false
                switch result {
                case .success(let url):
                    onScanned(url)
                case .failure(let error):
                    // Don't show a scary error when the user simply dismissed the sheet.
                    errorText = NFCLoginService.isCancellation(error) ? nil : error.localizedDescription
                }
            }
        }
    }
}
