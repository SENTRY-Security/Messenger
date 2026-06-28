import SwiftUI

/// The post-login surface: the hosted web messenger plus a loading indicator
/// and an offline/error retry overlay.
struct WebContainerView: View {
    @StateObject private var model: WebViewModel

    init(url: URL) {
        _model = StateObject(wrappedValue: WebViewModel(url: url))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            WebViewRepresentable(webView: model.webView)
                .ignoresSafeArea(edges: .bottom)

            if model.isLoading && model.loadError == nil {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(.white)
            }

            if let error = model.loadError {
                ErrorOverlay(message: error) { model.reload() }
            }
        }
    }
}

private struct ErrorOverlay: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("無法載入")
                .font(.headline)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button(action: retry) {
                Text("重試")
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
    }
}
