import UIKit
#if canImport(WebRTC)
import WebRTC
#endif

#if canImport(WebRTC)
/// User actions from the native call UI. Lifecycle-affecting actions (end, mute)
/// are relayed to the web call state machine so it stays the single source of
/// truth; pure media controls (flip / speaker / video) are applied natively.
protocol NativeCallViewControllerDelegate: AnyObject {
    func callUIDidTapEnd()
    func callUIDidToggleMute(_ muted: Bool)
    func callUIDidToggleSpeaker(_ on: Bool)
    func callUIDidTapFlipCamera()
    func callUIDidToggleVideo(_ enabled: Bool)
}

/// Full-screen native call surface (mid-term migration P3): native video render
/// (`NativeCallVideoView`) + a two-row, tap-to-reveal / auto-hide control bar and
/// a top bar with the peer name and call status. Presented for native **video**
/// calls (where native rendering is required); audio-only native calls keep the
/// web overlay. Full app only.
final class NativeCallViewController: UIViewController {

    weak var delegate: NativeCallViewControllerDelegate?

    let videoView = NativeCallVideoView(frame: .zero)

    private let topBar = UIView()
    private let nameLabel = UILabel()
    private let statusLabel = UILabel()
    private let controlsBar = UIView()

    private var muteButton: UIButton!
    private var speakerButton: UIButton!
    private var videoButton: UIButton!

    private var muted = false
    private var speakerOn = false
    private var videoEnabled = true
    private var controlsHideWork: DispatchWorkItem?

    private let peerName: String

    init(peerName: String) {
        self.peerName = peerName.isEmpty ? "SENTRY" : peerName
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        videoView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(videoView)
        NSLayoutConstraint.activate([
            videoView.topAnchor.constraint(equalTo: view.topAnchor),
            videoView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            videoView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            videoView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        setupTopBar()
        setupControls()

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleBackgroundTap))
        videoView.addGestureRecognizer(tap)

        revealControls()
    }

    func updateStatus(_ text: String) {
        statusLabel.text = text
    }

    // MARK: top bar

    private func setupTopBar() {
        topBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(topBar)
        NSLayoutConstraint.activate([
            topBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            topBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            topBar.trailingAnchor.constraint(equalTo: view.leadingAnchor, constant: 220),
        ])

        nameLabel.text = peerName
        nameLabel.textColor = .white
        nameLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        nameLabel.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.text = ""
        statusLabel.textColor = UIColor(white: 1, alpha: 0.75)
        statusLabel.font = .systemFont(ofSize: 13, weight: .regular)
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        topBar.addSubview(nameLabel)
        topBar.addSubview(statusLabel)
        NSLayoutConstraint.activate([
            nameLabel.topAnchor.constraint(equalTo: topBar.topAnchor),
            nameLabel.leadingAnchor.constraint(equalTo: topBar.leadingAnchor),
            statusLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 2),
            statusLabel.leadingAnchor.constraint(equalTo: topBar.leadingAnchor),
            statusLabel.bottomAnchor.constraint(equalTo: topBar.bottomAnchor),
        ])
    }

    // MARK: controls

    private func setupControls() {
        controlsBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controlsBar)
        NSLayoutConstraint.activate([
            controlsBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controlsBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controlsBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
        ])

        muteButton = makeButton(systemName: "mic.fill", action: #selector(tapMute))
        speakerButton = makeButton(systemName: "speaker.wave.2.fill", action: #selector(tapSpeaker))
        let flipButton = makeButton(systemName: "arrow.triangle.2.circlepath.camera.fill", action: #selector(tapFlip))
        videoButton = makeButton(systemName: "video.fill", action: #selector(tapVideo))
        let endButton = makeButton(systemName: "phone.down.fill", action: #selector(tapEnd), tint: .white, background: UIColor.systemRed)

        // Row 1: media toggles. Row 2: end.
        let row1 = UIStackView(arrangedSubviews: [muteButton, speakerButton, flipButton, videoButton])
        row1.axis = .horizontal
        row1.distribution = .equalSpacing
        row1.alignment = .center

        let row2 = UIStackView(arrangedSubviews: [endButton])
        row2.axis = .horizontal
        row2.alignment = .center

        let stack = UIStackView(arrangedSubviews: [row1, row2])
        stack.axis = .vertical
        stack.spacing = 18
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        controlsBar.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: controlsBar.topAnchor),
            stack.bottomAnchor.constraint(equalTo: controlsBar.bottomAnchor),
            stack.centerXAnchor.constraint(equalTo: controlsBar.centerXAnchor),
            row1.widthAnchor.constraint(equalTo: controlsBar.widthAnchor, multiplier: 0.82),
        ])
    }

    private func makeButton(systemName: String, action: Selector,
                            tint: UIColor = .white,
                            background: UIColor = UIColor(white: 1, alpha: 0.18)) -> UIButton {
        let b = UIButton(type: .system)
        let cfg = UIImage.SymbolConfiguration(pointSize: 22, weight: .medium)
        b.setImage(UIImage(systemName: systemName, withConfiguration: cfg), for: .normal)
        b.tintColor = tint
        b.backgroundColor = background
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: 58).isActive = true
        b.heightAnchor.constraint(equalToConstant: 58).isActive = true
        b.layer.cornerRadius = 29
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    // MARK: actions

    @objc private func tapEnd() { delegate?.callUIDidTapEnd() }

    @objc private func tapMute() {
        muted.toggle()
        let cfg = UIImage.SymbolConfiguration(pointSize: 22, weight: .medium)
        muteButton.setImage(UIImage(systemName: muted ? "mic.slash.fill" : "mic.fill", withConfiguration: cfg), for: .normal)
        muteButton.backgroundColor = muted ? UIColor(white: 1, alpha: 0.9) : UIColor(white: 1, alpha: 0.18)
        muteButton.tintColor = muted ? .black : .white
        delegate?.callUIDidToggleMute(muted)
        revealControls()
    }

    @objc private func tapSpeaker() {
        speakerOn.toggle()
        speakerButton.backgroundColor = speakerOn ? UIColor(white: 1, alpha: 0.9) : UIColor(white: 1, alpha: 0.18)
        speakerButton.tintColor = speakerOn ? .black : .white
        delegate?.callUIDidToggleSpeaker(speakerOn)
        revealControls()
    }

    @objc private func tapFlip() {
        delegate?.callUIDidTapFlipCamera()
        revealControls()
    }

    @objc private func tapVideo() {
        videoEnabled.toggle()
        let cfg = UIImage.SymbolConfiguration(pointSize: 22, weight: .medium)
        videoButton.setImage(UIImage(systemName: videoEnabled ? "video.fill" : "video.slash.fill", withConfiguration: cfg), for: .normal)
        videoView.setLocalHidden(!videoEnabled)
        delegate?.callUIDidToggleVideo(videoEnabled)
        revealControls()
    }

    /// Reflect the actual route when the system changes it (e.g. Bluetooth).
    func syncSpeaker(_ on: Bool) {
        speakerOn = on
        speakerButton.backgroundColor = on ? UIColor(white: 1, alpha: 0.9) : UIColor(white: 1, alpha: 0.18)
        speakerButton.tintColor = on ? .black : .white
    }

    // MARK: auto-hide

    @objc private func handleBackgroundTap() {
        if controlsBar.alpha > 0.5 { hideControls() } else { revealControls() }
    }

    private func revealControls() {
        controlsHideWork?.cancel()
        UIView.animate(withDuration: 0.2) {
            self.controlsBar.alpha = 1
            self.topBar.alpha = 1
        }
        let work = DispatchWorkItem { [weak self] in self?.hideControls() }
        controlsHideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: work)
    }

    private func hideControls() {
        controlsHideWork?.cancel()
        UIView.animate(withDuration: 0.3) {
            self.controlsBar.alpha = 0
            self.topBar.alpha = 0
        }
    }
}
#endif
