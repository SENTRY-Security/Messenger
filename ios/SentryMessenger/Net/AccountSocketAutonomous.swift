import Foundation

/// Autonomous native account WebSocket (mid-term migration, Option B step B2).
///
/// Unlike B1 (where the web drove connect / auth / heartbeat / reconnect through
/// a `NativeWebSocket` shim and native was a dumb pipe), here **native owns the
/// whole connection lifecycle**: it fetches the WS token, opens the socket,
/// sends the auth frame, drives the application-level heartbeat, and reconnects
/// with backoff — all without the WebView. This is what keeps call signaling
/// healthy when the app is backgrounded mid-call (audio background mode keeps the
/// process alive, so `URLSession` + native timers keep running while the WebView
/// JS is throttled).
///
/// The web hands over the credentials once (`wsConfigure`) and then only sends /
/// receives application messages (`wsSendApp` / `wsMsg`); connection state is
/// surfaced as `wsUp` / `wsDown`. E2EE keys never leave the web — only the WS
/// token (short-lived, server-issued) and account digest are used here.
///
/// Full app only. Token request mirrors web `requestWsToken`: POST
/// `{apiOrigin}/api/v1/ws/token` with JSON `{account_token, account_digest,
/// session_ts}` → `{token, ws_url}`.
final class AccountSocketAutonomous: NSObject, URLSessionWebSocketDelegate {

    var sendToWeb: ((String, [String: Any]) -> Void)?

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?

    // Credentials, set by `configure` (from web).
    private var accountToken: String?
    private var accountDigest: String?
    private var deviceId: String?
    private var apiOrigin: String?
    private var sessionTs: Int?

    private var connecting = false
    private var stopped = true
    private var authed = false
    private var reconnectAttempts = 0
    private var pendingApp: [String] = []
    private var pingTimer: DispatchSourceTimer?

    private let queue = DispatchQueue(label: "red.sentry.account-socket.auto")
    private let pingInterval: TimeInterval = 25
    private let maxReconnectDelay: TimeInterval = 30

    override init() {
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.waitsForConnectivity = true
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }

    // MARK: web → native control

    func configure(accountToken: String?, accountDigest: String?, deviceId: String?,
                   apiOrigin: String?, sessionTs: Int?) {
        queue.async {
            if let t = accountToken { self.accountToken = t }
            if let d = accountDigest { self.accountDigest = d }
            if let dev = deviceId { self.deviceId = dev }
            if let o = apiOrigin, !o.isEmpty { self.apiOrigin = o }
            if let ts = sessionTs { self.sessionTs = ts }
        }
    }

    /// Connect if configured and not already connected/connecting.
    func ensure() {
        queue.async {
            self.stopped = false
            guard self.task == nil, !self.connecting else { return }
            guard self.accountDigest != nil, (self.accountToken != nil || self.accountDigest != nil) else { return }
            self.connectNow()
        }
    }

    func sendApp(_ data: String) {
        queue.async {
            guard let task = self.task, self.authed else { self.enqueue(data); return }
            task.send(.string(data)) { [weak self] error in
                if error != nil { self?.queue.async { self?.enqueue(data) } }
            }
        }
    }

    /// Logout / teardown: stop reconnecting and drop the socket + credentials.
    func closeAndClear() {
        queue.async {
            self.stopped = true
            self.teardownSocket(code: .normalClosure)
            self.accountToken = nil
            self.accountDigest = nil
            self.deviceId = nil
            self.sessionTs = nil
            self.pendingApp.removeAll()
        }
    }

    // MARK: connection

    private func connectNow() {
        connecting = true
        authed = false
        fetchToken { [weak self] token, wsUrl in
            guard let self else { return }
            self.queue.async {
                guard !self.stopped else { self.connecting = false; return }
                guard let token, let url = self.buildWsURL(token: token, wsUrl: wsUrl) else {
                    self.connecting = false
                    self.scheduleReconnect()
                    return
                }
                let task = self.session.webSocketTask(with: url)
                task.taskDescription = "auto"
                self.task = task
                self.pendingAuthToken = token
                task.resume()
                self.receive(task)
            }
        }
    }

    private var pendingAuthToken: String?

    /// POST {apiOrigin}/api/v1/ws/token → (token, ws_url). Mirrors web requestWsToken.
    private func fetchToken(_ completion: @escaping (_ token: String?, _ wsUrl: String?) -> Void) {
        let origin = (apiOrigin ?? "").trimmingCharacters(in: .whitespaces)
        guard let base = URL(string: origin.isEmpty ? "https://app.message.sentry.red" : origin),
              let endpoint = URL(string: "/api/v1/ws/token", relativeTo: base) else {
            completion(nil, nil); return
        }
        var body: [String: Any] = [:]
        if let t = accountToken { body["account_token"] = t }
        if let d = accountDigest { body["account_digest"] = d }
        if let ts = sessionTs { body["session_ts"] = ts }
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        session.dataTask(with: req) { data, _, _ in
            guard let data,
                  let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                completion(nil, nil); return
            }
            completion(json["token"] as? String, json["ws_url"] as? String)
        }.resume()
    }

    /// Prefer the worker-direct `ws_url`; else derive wss from apiOrigin + /api/ws.
    private func buildWsURL(token: String, wsUrl: String?) -> URL? {
        let dev = deviceId ?? ""
        if let wsUrl, var comp = URLComponents(string: wsUrl) {
            var items = comp.queryItems ?? []
            items.append(URLQueryItem(name: "token", value: token))
            if !dev.isEmpty { items.append(URLQueryItem(name: "deviceId", value: dev)) }
            comp.queryItems = items
            if let u = comp.url { return u }
        }
        let origin = (apiOrigin ?? "https://app.message.sentry.red")
        guard var comp = URLComponents(string: origin) else { return nil }
        comp.scheme = (comp.scheme == "http") ? "ws" : "wss"
        let prefix = (comp.path == "/" ? "" : comp.path).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        comp.path = prefix.isEmpty ? "/api/ws" : "/\(prefix)/api/ws"
        var items = [URLQueryItem(name: "token", value: token)]
        if !dev.isEmpty { items.append(URLQueryItem(name: "deviceId", value: dev)) }
        comp.queryItems = items
        return comp.url
    }

    private func receive(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case let .string(text) = message {
                    self.forwardMessage(text)
                } else if case let .data(d) = message, let text = String(data: d, encoding: .utf8) {
                    self.forwardMessage(text)
                }
                self.queue.async { if self.task === task { self.receive(task) } }
            case .failure:
                // didCloseWith / didCompleteWithError drives reconnect.
                break
            }
        }
    }

    private func forwardMessage(_ text: String) {
        emit("wsMsg", ["data": text])
    }

    // MARK: heartbeat

    private func startPing() {
        stopPing()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + pingInterval, repeating: pingInterval)
        timer.setEventHandler { [weak self] in
            guard let self, let task = self.task, self.authed else { return }
            task.send(.string("{\"type\":\"ping\"}")) { _ in }
        }
        timer.resume()
        pingTimer = timer
    }

    private func stopPing() {
        pingTimer?.cancel()
        pingTimer = nil
    }

    // MARK: reconnect

    private func scheduleReconnect() {
        guard !stopped else { return }
        let attempt = reconnectAttempts
        reconnectAttempts += 1
        let backoff = min(maxReconnectDelay, 2.0 * pow(2.0, Double(attempt)))
        queue.asyncAfter(deadline: .now() + backoff) { [weak self] in
            guard let self, !self.stopped, self.task == nil, !self.connecting else { return }
            self.connectNow()
        }
    }

    private func teardownSocket(code: URLSessionWebSocketTask.CloseCode) {
        stopPing()
        authed = false
        connecting = false
        if let task { task.cancel(with: code, reason: nil) }
        task = nil
        pendingAuthToken = nil
    }

    private func enqueue(_ data: String) {
        if pendingApp.count >= 64 { pendingApp.removeFirst() }
        pendingApp.append(data)
    }

    private func flushPending() {
        guard let task, authed else { return }
        let items = pendingApp
        pendingApp.removeAll()
        for data in items { task.send(.string(data)) { _ in } }
    }

    private func emit(_ name: String, _ payload: [String: Any]) {
        DispatchQueue.main.async { [weak self] in self?.sendToWeb?(name, payload) }
    }

    // MARK: URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        queue.async {
            guard webSocketTask === self.task, let token = self.pendingAuthToken,
                  let digest = self.accountDigest else { return }
            self.connecting = false
            self.reconnectAttempts = 0
            // Auth frame, identical to the web client.
            let auth: [String: Any] = ["type": "auth", "accountDigest": digest, "token": token]
            if let data = try? JSONSerialization.data(withJSONObject: auth),
               let str = String(data: data, encoding: .utf8) {
                webSocketTask.send(.string(str)) { _ in }
            }
            self.authed = true
            self.startPing()
            self.emit("wsUp", [:])
            self.flushPending()
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        queue.async {
            guard webSocketTask === self.task else { return }
            let code = closeCode.rawValue
            let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) }
            self.teardownSocket(code: .normalClosure)
            self.emit("wsDown", ["code": code, "reason": reasonStr ?? ""])
            // 4409 stale-session / 4401 invalid-token are terminal (web does the
            // forced logout); anything else → reconnect.
            if code == 4409 || code == 4401 { self.stopped = true } else { self.scheduleReconnect() }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        queue.async {
            guard let wst = task as? URLSessionWebSocketTask, wst === self.task else { return }
            self.teardownSocket(code: .abnormalClosure)
            self.emit("wsDown", ["code": 1006, "reason": error?.localizedDescription ?? ""])
            self.scheduleReconnect()
        }
    }
}
