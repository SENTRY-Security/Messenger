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

| 模組 | 職責 | 對應 web | 狀態 |
|---|---|---|---|
| `CallPeerConnection` | 單通 `RTCPeerConnection`、SDP、ICE（非 trickle）、`RTCAudioSession` manual audio、音軌 | media-session.js（媒體半部） | ✅ P1 #90 |
| `NativeCallController` | orchestrator：per-call peer 生命週期、iceServers 轉換、SDP/state 回送、CallKit 音訊閘門 | 部分 media-session | ✅ P1 #91 |
| `native-media-bridge.js`（web） | 把媒體（SDP offer/answer、mute、teardown）交給原生引擎；沿用 signaling 送 call-offer/answer | media-session.js 接縫 | ✅ P1 #92 |
| `CallMediaCapturer` | `RTCCameraVideoCapturer`（前後鏡頭/翻轉）、視訊軌 | getUserMedia | ⬜ P2 |
| `CallVideoView` | `RTCMTLVideoView` 本地/遠端渲染 | video elements | ⬜ P2 |
| `NativeCallUI`（SwiftUI） | 來電卡/通話中控制（沿用現有兩排+自動隱藏設計） | call-overlay.js | ⬜ P3 |

**信令（WS）放哪？— 分階段決策（取代原 (A)/(B) 二選一）**

原生需要一條到帳號 WS 的連線來收送信令。兩種放法：
- **(A) 原生自建 WS**（`URLSessionWebSocketTask`）＋帳號驗證＋`deriveCallTokenFromDR`。
  與 WebView 完全解耦，但要在 Swift 重現連線/驗證/重連/信令封套，且 Double Ratchet
  金鑰狀態在 web 層（IndexedDB / JS crypto）→ 等於在原生重做一份密碼學協定（plan §0
  明示要避免）。
- **(B) 信令續留 WKWebView 的 JS**（web 維持帳號 WS），native 與 web 以 bridge 交換
  SDP。重寫最少，但通話時需 WebView 存活；背景被 suspend 時 JS 的 WS 會停擺。

**決策**：
- **P1–P3（前景通話）採 (B)**。前景痛點是「沒聲音」＝媒體層 `AVAudioSession` 互搶，
  已由原生 `RTCAudioSession` manual audio 解掉（#90/#91）；前景時 WebView 本就存活，
  信令走 JS 無虞。拉原生 WS 不解任何現有 bug，只增成本。**此即目前實作。**
- **P4（背景/鎖屏續通）才重評估**。VoIP push 喚醒後 App 在背景時，WKWebView 可能被
  suspend/throttle → JS 的 WS 停擺 → 接聽/重連失敗；此時「信令在原生」才有價值。
- **即使到 P4 也不整條帳號 WS 搬家**：建議「**web 發短期通話 token + WS URL，原生只在
  單通通話期間開一條 scoped 信令 WS**（只收送 offer/answer/end，通話結束即關）」。
  金鑰衍生與 DR 仍留 web，Swift 只碰通話信令、碰不到帳號協定全貌 → 背景續通與低維護
  成本兼得，避免重做 DR/驗證。

### 2.1 WS 原生化最終決策（使用者選定 Option B：原生接管整條帳號 WS）

> 背景：後端 `account-ws.js`（Durable Object）採**帳號層單一活躍連線**——任何新 socket
> 通過驗證即以 `sessionTs` 比較關閉其餘連線（不分 device）。故「原生另開一條平行帳號
> WS」會踢掉 WebView 的 WS（反之亦然），naive 做法不可行。Call token / E2EE envelope 由
> Double Ratchet 衍生、**不經 WS、後端不驗證**，故金鑰一律留 web，只有媒體 signaling
> 是搬遷對象。

**決策（使用者選 B）**：原生擁有那條唯一的帳號 WS，web 改走 bridge transport。分階段：

- **B1（已實作，旗標關）**：原生 `AccountSocketService`（`URLSessionWebSocketTask`）擁有
  實際連線；web 端 `NativeWebSocket` shim 模擬瀏覽器 `WebSocket` 介面（onopen/onmessage/
  onclose/onerror/send/close/readyState），`ws-integration.js` 僅換 `new WebSocket` 一行。
  連線 URL/token 取得、auth、心跳、重連仍由 web 既有邏輯驅動（透過 shim）；**位元組傳輸
  由 WebKit 移到 URLSession**。旗標 `UseNativeAccountSocket`（Info.plist，預設 false）。
  bridge 動作 `wsOpen/wsSend/wsClose` ↔ 事件 `wsEvent{id,kind,...}`。
- **B2（已實作，旗標關）**：原生 `AccountSocketAutonomous` 自取 token（`/api/v1/ws/token`，
  web 經 `wsConfigure` 交付 `account_token`/digest/deviceId/apiOrigin）、自開 socket、送 auth、
  驅動 25s 心跳、backoff 重連。web `ws-integration.js` 在原生模式短路：以 pseudo `wsConn`
  保留 send 佇列語意，連線狀態收 `wsUp`/`wsDown`、訊息收 `wsMsg`，自身心跳/重連停用
  （`startHeartbeat` 在原生模式 no-op，避免誤關原生 socket）。4409/4401 終止並沿用
  forced-logout。**背景自主**：通話切背景（audio mode 進程存活）時 URLSession + 原生計時器
  續跑，信令不因 WebView throttle 而斷。bridge 動作 `wsConfigure/wsEnsureNative/wsSendApp/
  wsCloseNative` ↔ 事件 `wsUp/wsMsg/wsDown`。
  - 註：`account_token` 經 bridge 交付原生、僅存記憶體（登出即清）；後續可改 Keychain 以
    支援背景冷啟動自取 token（P4）。通話信令由原生 `NativeCallController` 直接處理為後續優化。
- 安全：shim/transport 不改變 auth 內容（仍送 `{type:'auth',accountDigest,token}`），
  自訂關閉碼 4401/4409 原樣回傳 web，沿用既有 forced-logout 處理；單裝置不變式不受影響。

## 3. 依賴

- **WebRTC framework**：採用維護中的 SPM 套件 `stasel/WebRTC`（binaryTarget，
  預編 `WebRTC.xcframework`）。於 `project.yml` 的 `packages` + 完整 App target
  `dependencies` 加入；App Clip **不**連結（容量）。
- 風險：framework 數百 MB；CI 需能解析/下載 SPM。若拖垮 CI，改評估 pin 版本或快取。

## 4. 分階段計畫（每階段一 PR；feature branch；需實機驗證才併 main）

- **P0 依賴與骨架（可編譯驗證）**：加 `UseNativeCalls` 旗標 + WebRTC SPM 依賴 +
  空殼 `NativeCallController`（旗標關時不啟用）。驗收：CI 綠（含依賴可編譯）。
- **P1 撥出/接聽（語音）** ✅（程式完成，旗標關，待實機驗證）：原生 `CallPeerConnection`
  音訊 + `NativeCallController` orchestrator + CallKit 音訊閘門（manual audio）；
  signaling 採 **(B)**，仍走 web 帳號 WS，媒體經 `native-media-bridge.js` ↔ 原生交換
  SDP；TURN 由 web 取得後以 `iceServers` 傳入原生。step1 #90 / step2 #91 / step3 #92。
  驗收：**實機** App↔App 語音雙向通（開 `UseNativeCalls` 旗標）。
- **P2 視訊** ✅（程式完成，旗標關，待實機）：P2a `CallPeerConnection` 視訊擷取
  （`RTCCameraVideoCapturer`）/軌道/翻轉/遠端軌道（#94）；P2b 渲染併入 P3 原生 UI
  （`RTCMTLVideoView` 本地 PiP + 遠端全螢幕），避免 native-video-under-web 透明穿透的脆弱。
- **P3 原生通話 UI** ✅（程式完成，旗標關，待實機）：`NativeCallVideoView`（Metal 渲染、
  本地 PiP 可拖曳）+ `NativeCallViewController`（兩排控制列 + 點擊顯示/自動隱藏、頂部對端
  名稱/狀態），由 `NativeCallController` 於**視訊**通話 present/dismiss；End/Mute 回灌 web
  狀態機（callEndedByUser/callMuteToggled），翻鏡頭/擴音/視訊開關走原生。**語音通話維持
  web overlay**（無渲染需求）。
- **P4 背景/鎖屏/VoIP**（**需實機 + 安全決策，暫不盲做**）：現況分析見下。
- **P5 收尾**：靜音/擴音/路由（`RTCAudioSession` + `overrideOutputAudioPort`）、
  錯誤/重連、與 web 狀態/通話紀錄一致、移除該情境對 WebView 媒體的依賴。
- **P6 灰度**：旗標預設仍關 → 內測開 → 驗證穩定後預設開、web 媒體路徑退役（App）。

### 4.1 P4 現況分析（為何暫停盲做，待實機/決策）

**通話中切背景（mid-call background）— 預期已可運作，待實機驗證**：
- 音訊：原生 `RTCAudioSession` manual audio + CallKit + `UIBackgroundModes: audio` →
  進程於背景存活、音訊續播。
- 信令：B2 原生 WS 擁有連線 + 25s 心跳 → WebView JS 被 throttle 時連線仍由 URLSession 維持。
- 視訊：`RTCMTLVideoView` 背景暫停渲染、回前景恢復；CallKit 提供鎖屏 UI。
- → P1+P2+P3+B2 組合理論上已覆蓋「通話中切背景續通」；**只需實機確認**，無明顯缺口。

**冷啟動（App 被殺）VoIP 接聽 — 有根本性糾葛，需決策**：
- VoIP push 喚醒須向 CallKit 報來電；但**通話金鑰/envelope 由 web 的 Double Ratchet 衍生**，
  冷啟動時 WebView 尚未載入 → 仍需把 WebView 拉起做金鑰設定（與既有 web 路線同一限制）。
- 若要原生在冷啟動「自取 WS token」需 `account_token` 落 Keychain；但本專案 iOS 安全模型
  將解封用 KEK/`account_token` 以 **`biometryCurrentSet`** 存 Keychain（FaceID 綁定）→
  **背景 VoIP 喚醒時無生物辨識上下文、讀不到**。故「Keychain account_token 背景冷啟動自取
  token」與現行 FaceID-gated 模型**直接衝突**，非單純工程、屬安全決策（要不要為通話另存一份
  較低保護等級的 token？由誰決定？）。
- 結論：冷啟動背景接聽不宜盲做；待實機驗證「通話中切背景」後，再就金鑰/token 的背景可得性
  做專門設計與決策。

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
