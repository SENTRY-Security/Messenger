import SwiftUI

/// Full-screen lock overlay shown while `AppLockManager.isLocked`. Covers the
/// WebView so no content is visible until the user passes the challenge.
struct LockOverlayView: View {
    @ObservedObject var lock: AppLockManager

    private let cyan = Color(red: 0.220, green: 0.741, blue: 0.973)
    private let indigo = Color(red: 0.388, green: 0.400, blue: 0.945)

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.059, green: 0.090, blue: 0.165),
                         Color(red: 0.008, green: 0.024, blue: 0.090)],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 18) {
                Image(systemName: lock.mode == .nfc ? "wave.3.right.circle.fill" : "lock.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.white)
                    .shadow(color: cyan.opacity(0.45), radius: 18)

                Text("SENTRY MESSENGER")
                    .font(.system(size: 16, weight: .bold))
                    .tracking(3)
                    .foregroundStyle(Color(red: 0.878, green: 0.949, blue: 0.996))

                Text(lock.mode == .nfc ? "感應您的安全卡片以解鎖" : "請以 FaceID 解鎖")
                    .font(.subheadline)
                    .foregroundStyle(Color(red: 0.580, green: 0.639, blue: 0.722))

                if let err = lock.lastError {
                    Text(err)
                        .font(.footnote)
                        .foregroundStyle(Color(red: 0.988, green: 0.647, blue: 0.647))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Button(action: { lock.attemptUnlock() }) {
                    HStack(spacing: 8) {
                        Image(systemName: lock.mode == .nfc ? "dot.radiowaves.left.and.right" : "faceid")
                        Text("解鎖")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .foregroundStyle(.white)
                    .background(
                        LinearGradient(colors: [cyan, indigo], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                }
                .padding(.horizontal, 40)
                .padding(.top, 8)
            }
        }
    }
}

/// Native lock-mode settings sheet (None / FaceID / NFC). Presented from the web
/// settings via the `openLockSettings` bridge action.
struct LockSettingsView: View {
    @ObservedObject var lock: AppLockManager
    var onDone: () -> Void

    private var nfcAvailable: Bool { NFCLoginService.isAvailable }

    var body: some View {
        NavigationView {
            List {
                Section(footer: Text("回到 App 時需通過所選方式才能解鎖。失敗可重試，不會登出。NFC 模式需要實體安全卡，安全性最高。")) {
                    ForEach(LockMode.allCases, id: \.self) { m in
                        let disabled = (m == .nfc && !nfcAvailable)
                        Button {
                            guard !disabled else { return }
                            lock.setMode(m)
                        } label: {
                            HStack {
                                Text(m.title + (disabled ? "（此裝置不支援）" : ""))
                                    .foregroundStyle(disabled ? .secondary : .primary)
                                Spacer()
                                if lock.mode == m {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                        }
                        .disabled(disabled)
                    }
                }
            }
            .navigationTitle("回到 App 解鎖")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成", action: onDone)
                }
            }
        }
    }
}
