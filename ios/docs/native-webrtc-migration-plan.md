# 原生 WebRTC 通話 — Migration 計畫（mid-term）

> 目標：把通話的**媒體層**從「WKWebView 內的 WebRTC」搬到**原生 WebRTC**
> （`RTCPeerConnection` / `RTCAudioSession` + CallKit），**沿用**現有的 signaling
> （帳號 WebSocket）、Cloudflare TURN、E2EE 金鑰交換協定。純瀏覽器版維持不變。
>
> 動機：WebView 內 WebRTC 一直在跟 iOS 借資源，已踩到的雷——音訊 session 互搶
> （`AudioSession beginInterruption`）、本地網路權限造成 ICE 候選為 0、背景被掛起、
> 路由控制受限——在原生堆疊大多會根本消失（`RTCAudioSession`＋CallKit 是 Apple 官方
> 組合；ICE 由原生收集、無 WKWebView 的 mDNS/本地網路限制）。

## 0. 重要前提與限制（先讀）

- **E2EE 不需重寫媒體加密**：1:1 通話為 **P2P + TURN（relay 只轉發加密封包）**，
  WebRTC 的 **DTLS-SRTP 即為端到端加密**（金鑰在兩端 DTLS 交握產生，TURN/伺服器看不到
  明文）。因此原生改用標準 WebRTC 即保有媒體 E2EE，**不需**重做 frame-level 加密。
  → 需沿用的是「**通話授權/signaling 的 E2EE**」：`call-invite/accept` 與 TURN 憑證
  申請所用的帳號驗證、以及目前 `deriveCallTokenFromDR`（由 Double Ratchet 衍生的
  通話 token）。這些是**協定**，原生端照打即可，不必重做密碼學原語。
- **本環境無法功能驗證**：CI 僅 `xcodebuild` 編譯（`CODE_SIGNING_ALLOWED=NO`），
  無法實際撥號。**每個階段都需實機驗證**；「編得過」不等於「打得通」。
- **feature flag 隔離**：全程以 Info.plist `UseNativeCalls`（預設 `false`）切換，
  關閉時完全走現有 WKWebView 路線，確保隨時可回退、不影響線上。
- **App Clip 不納入**：Clip 維持 WebView 通話（容量/能力限制）；原生通話僅完整 App。

## 1. 現況（web 通話模組）

`web/src/app/features/calls/`：
- `signaling.js` — 透過帳號 WS 收送 `call-invite/ringing/accept/reject/offer/answer/
  candidate/rekey/end` 等信令。
- `media-session.js` — 建 `RTCPeerConnection`、`getUserMedia`、ICE 組裝
  （base STUN `stun.cloudflare.com` + `/api/v1/calls/turn-credentials` 的 TURN）、
  SDP、軌道、視訊渲染。
- `network-config.js` — ICE 設定（`iceTransportPolicy`、`relayOnlyAfterAttempts` 等）。
- `state.js` — 通話狀態機（`CALL_SESSION_STATUS`：INCOMING/OUTGOING/CONNECTING/IN_CALL/…）。
- `key-manager.js` / `identity.js` — 通話金鑰 epoch、對端身分。
- `events.js` — 通話事件匯流排。
- UI：`web/src/app/ui/mobile/call-overlay.js`（漂浮卡、控制列）。

既有原生（保留並擴充）：
- `CallKitController`（`CXProvider`/`CXCallController`）、`AudioSessionManager`、
  `VoipPushService`（PushKit）、`NativeBridge`（JS↔native）。

## 2. 目標架構（hybrid：原生媒體 + 沿用協定）

新增 `ios/SentryMessenger/Calls/`（完整 App target）：

| 模組 | 職責 | 對應 web |
|---|---|---|
| `NativeCallController` | 通話狀態機、與 CallKit/Audio 整合、生命週期 | state.js + 部分 media-session |
| `CallSignalingClient` | 用既有帳號 WS 收送信令（offer/answer/candidate/…） | signaling.js |
| `PeerConnectionManager` | `RTCPeerConnection`、SDP、ICE、軌道、`RTCAudioSession` | media-session.js |
| `CallMediaCapturer` | `RTCCameraVideoCapturer`（前後鏡頭/翻轉）、`RTCAudioTrack` | getUserMedia |
| `CallVideoView` | `RTCMTLVideoView` 本地/遠端渲染 | video elements |
| `TurnCredentialsService` | 打 `/api/v1/calls/turn-credentials` 取 Cloudflare TURN | api/calls.js |
| `NativeCallUI`（SwiftUI） | 來電卡/通話中控制（沿用現有兩排+自動隱藏設計） | call-overlay.js |

**WS 共用**：原生需要一條到帳號 WS 的連線來送信令。兩種選項：
- (A) 原生自建 WS（`URLSessionWebSocketTask`）＋帳號驗證（沿用 token）。最乾淨、與
  WebView 解耦，但要在原生重現連線/驗證/重連。
- (B) 信令仍經 WKWebView 的 JS（web 維持 WS），native 與 web 以 bridge 交換
  SDP/candidate。較少重寫，但 native↔web 來回、且通話時仍需 WebView 存活。
  → **建議 (A)**（原生通話的價值就在脫離 WebView）；(B) 可作為過渡。

## 3. 依賴

- **WebRTC framework**：採用維護中的 SPM 套件 `stasel/WebRTC`（binaryTarget，
  預編 `WebRTC.xcframework`）。於 `project.yml` 的 `packages` + 完整 App target
  `dependencies` 加入；App Clip **不**連結（容量）。
- 風險：framework 數百 MB；CI 需能解析/下載 SPM。若拖垮 CI，改評估 pin 版本或快取。

## 4. 分階段計畫（每階段一 PR；feature branch；需實機驗證才併 main）

- **P0 依賴與骨架（可編譯驗證）**：加 `UseNativeCalls` 旗標 + WebRTC SPM 依賴 +
  空殼 `NativeCallController`（旗標關時不啟用）。驗收：CI 綠（含依賴可編譯）。
- **P1 撥出/接聽（語音）**：`CallSignalingClient`（WS）+ `PeerConnectionManager`
  音訊 + TURN 憑證 + CallKit 撥出/接聽。驗收：**實機** App↔App 語音雙向通。
- **P2 視訊**：`CallMediaCapturer` 視訊 + `RTCMTLVideoView` 本地/遠端 + 翻轉鏡頭。
  驗收：實機雙向視訊。
- **P3 原生通話 UI**：SwiftUI 來電卡/控制列（兩排+自動隱藏），取代該情境的 web overlay。
- **P4 背景/鎖屏/VoIP**：與 `VoipPushService` 整合，背景續通、鎖屏接聽。
- **P5 收尾**：靜音/擴音/路由（`RTCAudioSession` + `overrideOutputAudioPort`）、
  錯誤/重連、與 web 狀態/通話紀錄一致、移除該情境對 WebView 媒體的依賴。
- **P6 灰度**：旗標預設仍關 → 內測開 → 驗證穩定後預設開、web 媒體路徑退役（App）。

## 5. 風險與緩解

- **無法在此功能驗證** → 全程 feature flag、分階段、實機驗收；main 永遠保有可用的
  WebView 路線。
- **信令協定對齊**：以 `signaling.js`/後端為準逐欄位比對；先用後端 log 驗證互通。
- **CI 依賴體積**：先單獨一個 PR 驗證「加依賴後仍能編譯」，再疊功能。
- **雙實作維護成本**：signaling/TURN/E2EE 為共用協定；client 分家無法避免，於 P6
  以旗標收斂、文件記錄協定為單一真相。

## 6. 不做 / 暫不做

- App Clip 原生通話（維持 WebView）。
- 多人通話 / SFU（若未來需要，另案評估 Cloudflare Realtime SFU）。
- frame-level 媒體加密（P2P DTLS-SRTP 已是 E2EE，不需要）。
