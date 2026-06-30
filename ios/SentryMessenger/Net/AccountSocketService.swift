import Foundation

/// Native account WebSocket transport (mid-term migration, Option B step B1).
///
/// Owns the actual account WS connection(s) via `URLSessionWebSocketTask`, so the
/// realtime byte transport lives in `URLSession` (native networking) instead of
/// WebKit. The web's `ws-integration.js` drives connect / auth / heartbeat /
/// reconnect exactly as before, but through a `NativeWebSocket` shim that maps
/// the browser `WebSocket` interface onto the `ws*` bridge actions handled here.
///
/// Each shim instance carries a string `id`; this service keeps one task per id
/// (a reconnect creates a new id, the old one is closed), so overlapping
/// teardown never crosses wires. Custom close codes (4401 / 4409) are passed
/// through to the web so the existing forced-logout handling still fires.
///
/// Full app only — the App Clip keeps the in-WebView WebSocket.
///
/// B1 scope: native owns the socket bytes. Autonomous token-fetch / heartbeat /
/// reconnect (true background independence) is B2; here the web still drives
/// those over the shim.
final class AccountSocketService: NSObject, AccountSocketHandler {
    static let shared = AccountSocketService()

    var sendToWeb: ((String, [String: Any]) -> Void)?

    private var session: URLSession!
    /// id → live task. Mutated only on `queue`.
    private var tasks: [String: URLSessionWebSocketTask] = [:]
    /// task identifier → shim id, to resolve delegate callbacks back to a shim.
    private var idByTaskId: [Int: String] = [:]
    private let queue = DispatchQueue(label: "red.sentry.account-socket")

    private override init() {
        super.init()
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    // MARK: AccountSocketHandler

    func handle(action: String, payload: [String: Any]) {
        guard AppConfig.useNativeAccountSocket else { return }
        guard let id = payload["id"] as? String, !id.isEmpty else { return }
        switch action {
        case "wsOpen":
            if let urlStr = payload["url"] as? String { open(id: id, urlStr: urlStr) }
        case "wsSend":
            if let data = payload["data"] as? String { send(id: id, data: data) }
        case "wsClose":
            close(id: id, code: payload["code"] as? Int, reason: payload["reason"] as? String)
        default:
            break
        }
    }

    // MARK: socket lifecycle

    private func open(id: String, urlStr: String) {
        guard let url = URL(string: urlStr) else {
            emit(id: id, kind: "error")
            emit(id: id, kind: "close", code: 1006, reason: "bad-url")
            return
        }
        queue.async {
            // Replace any prior task for this id (defensive; ids are unique).
            self.tasks[id]?.cancel(with: .goingAway, reason: nil)
            let task = self.session.webSocketTask(with: url)
            task.taskDescription = id
            self.tasks[id] = task
            self.idByTaskId[task.taskIdentifier] = id
            task.resume()
            self.receive(id: id, task: task)
            // `didOpenWithProtocol` (delegate) emits the 'open' event.
        }
    }

    private func send(id: String, data: String) {
        queue.async {
            guard let task = self.tasks[id] else { return }
            task.send(.string(data)) { [weak self] error in
                if error != nil { self?.emit(id: id, kind: "error") }
            }
        }
    }

    private func close(id: String, code: Int?, reason: String?) {
        queue.async {
            guard let task = self.tasks.removeValue(forKey: id) else { return }
            self.idByTaskId[task.taskIdentifier] = nil
            let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code ?? 1000) ?? .normalClosure
            task.cancel(with: closeCode, reason: reason?.data(using: .utf8))
        }
    }

    /// Recursive receive loop — re-arms itself after each frame.
    private func receive(id: String, task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.emit(id: id, kind: "message", data: text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.emit(id: id, kind: "message", data: text)
                    }
                @unknown default:
                    break
                }
                // Continue only if this task is still the active one for the id.
                self.queue.async {
                    if self.tasks[id] === task { self.receive(id: id, task: task) }
                }
            case .failure:
                // The delegate's didCloseWith / didCompleteWithError emits 'close';
                // surface an error here so the web can react if no close follows.
                self.emit(id: id, kind: "error")
            }
        }
    }

    // MARK: native → web

    private func emit(id: String, kind: String, data: String? = nil, code: Int? = nil, reason: String? = nil) {
        var payload: [String: Any] = ["id": id, "kind": kind]
        if let data { payload["data"] = data }
        if let code { payload["code"] = code }
        if let reason { payload["reason"] = reason }
        DispatchQueue.main.async { [weak self] in
            self?.sendToWeb?("wsEvent", payload)
        }
    }

    private func forget(taskId: Int) -> String? {
        guard let id = idByTaskId[taskId] else { return nil }
        idByTaskId[taskId] = nil
        if tasks[id]?.taskIdentifier == taskId { tasks[id] = nil }
        return id
    }
}

// MARK: - URLSessionWebSocketDelegate

extension AccountSocketService: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        guard let id = webSocketTask.taskDescription else { return }
        emit(id: id, kind: "open")
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                    reason: Data?) {
        let taskId = webSocketTask.taskIdentifier
        queue.async {
            let id = self.forget(taskId: taskId) ?? webSocketTask.taskDescription
            guard let id else { return }
            let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) }
            self.emit(id: id, kind: "close", code: closeCode.rawValue, reason: reasonStr)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        let taskId = task.taskIdentifier
        queue.async {
            guard let id = self.forget(taskId: taskId) else { return }
            // If we got here without a clean close frame, report an abnormal close
            // so the web reconnect logic kicks in.
            if error != nil {
                self.emit(id: id, kind: "close", code: 1006, reason: error?.localizedDescription)
            }
        }
    }
}
