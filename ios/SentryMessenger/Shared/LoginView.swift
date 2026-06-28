import SwiftUI

/// Native NFC login entry (entry point #1, native variant).
///
/// Tapping the button presents the system NFC sheet; on a valid NTAG424 tap the
/// dynamic SDM URL is handed back via `onScanned`, which the caller loads in the
/// web view to complete login. Also reused as the App Clip's fallback screen.
struct LoginView: View {
    var onScanned: (URL) -> Void

    @State private var scanning = false
    @State private var errorText: String?
    private let nfc = NFCLoginService()

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "wave.3.right.circle.fill")
                .font(.system(size: 76))
                .foregroundStyle(.tint)

            Text("SENTRY Messenger")
                .font(.title2.bold())
                .foregroundStyle(.white)

            Text("感應您的安全卡片以登入")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if let errorText {
                Text(errorText)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Spacer()

            Button(action: scan) {
                HStack {
                    Image(systemName: "dot.radiowaves.left.and.right")
                    Text(scanning ? "感應中…" : "感應卡片登入")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .disabled(scanning || !NFCLoginService.isAvailable)
            .padding(.horizontal, 24)

            if !NFCLoginService.isAvailable {
                Text("此裝置不支援 NFC")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.bottom, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
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
