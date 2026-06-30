import UIKit
#if canImport(WebRTC)
import WebRTC
#endif

/// Native video surface for a call (mid-term migration P2b/P3).
///
/// Renders the remote stream full-screen and the local self-preview as a small
/// draggable picture-in-picture, both via `RTCMTLVideoView` (Metal). This lives
/// natively because the call media runs natively — a WKWebView `<video>` cannot
/// display a native `RTCVideoTrack`.
///
/// Full app only (depends on the WebRTC package).
#if canImport(WebRTC)
final class NativeCallVideoView: UIView {

    private let remoteView = RTCMTLVideoView(frame: .zero)
    private let localView = RTCMTLVideoView(frame: .zero)
    private let localContainer = UIView()

    private weak var remoteTrack: RTCVideoTrack?
    private weak var localTrack: RTCVideoTrack?

    /// Local PiP size and inset from the top-trailing safe area.
    private let pipSize = CGSize(width: 104, height: 152)
    private let pipInset: CGFloat = 12

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black

        remoteView.videoContentMode = .scaleAspectFill
        remoteView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(remoteView)
        NSLayoutConstraint.activate([
            remoteView.topAnchor.constraint(equalTo: topAnchor),
            remoteView.bottomAnchor.constraint(equalTo: bottomAnchor),
            remoteView.leadingAnchor.constraint(equalTo: leadingAnchor),
            remoteView.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])

        // Local PiP: rounded container, manually framed (top-trailing default),
        // draggable. Manual framing (not autolayout) so the pan gesture can move
        // it freely without fighting constraints.
        localContainer.backgroundColor = .black
        localContainer.layer.cornerRadius = 12
        localContainer.layer.masksToBounds = true
        localContainer.layer.borderWidth = 1
        localContainer.layer.borderColor = UIColor(white: 1, alpha: 0.2).cgColor
        localContainer.translatesAutoresizingMaskIntoConstraints = true
        addSubview(localContainer)

        localView.videoContentMode = .scaleAspectFill
        localView.frame = CGRect(origin: .zero, size: pipSize)
        localView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        localContainer.addSubview(localView)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        localContainer.addGestureRecognizer(pan)
        localContainer.isUserInteractionEnabled = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private var pipPositioned = false
    override func layoutSubviews() {
        super.layoutSubviews()
        // Place the PiP at the top-trailing safe-area corner on first layout;
        // afterwards the user's dragged position is preserved.
        if !pipPositioned, bounds.width > 0 {
            pipPositioned = true
            let x = bounds.width - safeAreaInsets.right - pipInset - pipSize.width
            let y = safeAreaInsets.top + pipInset
            localContainer.frame = CGRect(origin: CGPoint(x: x, y: y), size: pipSize)
        }
    }

    // MARK: track attachment

    func setRemoteTrack(_ track: RTCVideoTrack?) {
        if remoteTrack === track { return }
        remoteTrack?.remove(remoteView)
        remoteTrack = track
        track?.add(remoteView)
    }

    func setLocalTrack(_ track: RTCVideoTrack?) {
        if localTrack === track { return }
        localTrack?.remove(localView)
        localTrack = track
        track?.add(localView)
        localContainer.isHidden = (track == nil)
    }

    func setLocalHidden(_ hidden: Bool) {
        localContainer.isHidden = hidden || localTrack == nil
    }

    func detach() {
        remoteTrack?.remove(remoteView)
        localTrack?.remove(localView)
        remoteTrack = nil
        localTrack = nil
    }

    // MARK: PiP drag

    @objc private func handlePan(_ gr: UIPanGestureRecognizer) {
        guard let piece = gr.view else { return }
        let translation = gr.translation(in: self)
        piece.center = CGPoint(x: piece.center.x + translation.x, y: piece.center.y + translation.y)
        gr.setTranslation(.zero, in: self)
        if gr.state == .ended {
            // Snap horizontally to the nearer edge, clamp vertically.
            let half = piece.bounds.width / 2 + pipInset
            let x = piece.center.x < bounds.midX ? half : bounds.width - half
            let minY = safeAreaInsets.top + piece.bounds.height / 2 + pipInset
            let maxY = bounds.height - safeAreaInsets.bottom - piece.bounds.height / 2 - pipInset
            let y = min(max(piece.center.y, minY), maxY)
            UIView.animate(withDuration: 0.2) { piece.center = CGPoint(x: x, y: y) }
        }
    }
}
#endif
