# iOS 原生通話/視訊處置規劃（CallKit + PushKit）

> 狀態：P0–P3 已實作（待實機驗證）；P4 收尾與 PoC 驗證進行中
> 對象：iOS 原生殼層 `SentryMessenger`（WKWebView 包裝 web messenger）
> 目標：讓語音/視訊通話在 iOS 上具備「通訊軟體等級」的原生體驗——鎖屏來電、背景續通、被關閉時喚醒接聽、納入系統通話記錄。

---

## 1. 現況評估

### 1.1 通話目前怎麼運作

- 通話/視訊完全在 **WKWebView 內以 WebRTC（JS）** 執行，程式碼在 `web/src/app/features/calls/*`。
- 信令（invite / offer / answer / ICE / hangup / rekey）走既有的 **WebSocket**（`web/src/app/features/calls/signaling.js` → `ws-integration.js`）。
- 端對端金鑰由 `key-manager.js` 管理（insertable streams），媒體由 `media-session.js` 控制。
- iOS 殼層僅做兩件事與通話相關：
  - `WebViewModel.swift` 對第一方網域**自動授權相機/麥克風**（`requestMediaCapturePermissionFor`），避免雙重權限詢問。
  - `Info.plist` 具備 `NSCameraUsageDescription`、`NSMicrophoneUsageDescription`。

### 1.2 缺什麼（與「通訊軟體標準」相比）

| 能力 | 現況 | 說明 |
|------|------|------|
| 鎖屏/系統來電 UI | ❌ | 無 CallKit，來電只能在 App 前景由 web overlay 顯示 |
| 背景續通（切背景/鎖屏不中斷） | ❌ | `UIBackgroundModes` 只有 `remote-notification`，缺 `voip`/`audio` |
| App 被關閉時喚醒接聽 | ❌ | 無 PushKit / VoIP push；WebSocket 在 App 被殺後不存在 |
| 系統通話記錄、靜音/喇叭與系統整合 | ❌ | 無 CallKit `CXProvider` |
| 音訊 session 正確設定 | ⚠️ | 未顯式設定 `AVAudioSession`，背景音訊與中斷處理不足 |
| 後端發起來電推播 | ⚠️ | `data-worker/src/apns.js` 已有 token-based APNs sender，但只發 `alert`，未發 `voip` |

### 1.3 既有可複用的基礎

- **APNs sender**：`data-worker/src/apns.js`（ES256 provider JWT、Web Crypto，Cloudflare Worker 相容）。VoIP push 可沿用同一把 `.p8` 金鑰，只需改 `apns-push-type: voip` 與 topic `<bundleId>.voip`。
- **原生橋接**：`NativeBridge.swift`（JS→原生 actions、原生→JS `window.SentryNative.onEvent`）。新增通話相關 action/event 即可。
- **推播註冊管線**：`AppDelegate.swift` + `Notifications.swift`（`.sentryRegisterPush` / `.sentryPushToken`）。PushKit 走平行管線即可。
- **Bundle id**：`red.sentry.messenger`（VoIP topic 將為 `red.sentry.messenger.voip`）。

---

## 2. 架構挑戰：JS WebRTC ↔ 原生 CallKit

CallKit/PushKit 是原生框架，WebRTC 媒體卻在 WKWebView 的 JS 裡。兩者必須透過 `NativeBridge` 雙向同步狀態：

```
                ┌─────────────────────── 原生 (Swift) ───────────────────────┐
  APNs VoIP ───▶│ PushKit(PKPushRegistry) ──▶ CallKit(CXProvider) ──▶ 來電 UI │
   push         │        │  reportNewIncomingCall（必須同步）        │         │
                │        ▼                                            ▼         │
                │  AVAudioSession(playAndRecord) ◀── didActivate audio session │
                └──────────────┬─────────────────────────────▲──────────────────┘
                    bridge: native→JS                bridge: JS→native
                  (answer/end/mute/audioReady)     (callStarted/ended/state)
                ┌──────────────▼─────────────────────────────┴──────────────────┐
                │           WKWebView / JS WebRTC（既有 calls/*）                  │
                │   signaling.js（WS）、media-session.js、key-manager.js          │
                └────────────────────────────────────────────────────────────────┘
```

關鍵約束：
- **PushKit 強制要求**：收到 VoIP push 後必須在**同一次回呼內同步**呼叫 `CXProvider.reportNewIncomingCall`，否則 iOS 13+ 會終止 App 並懲罰（之後不再送 VoIP push）。因此「收 push → 報 CallKit 來電」必須先於任何 web/WebRTC 初始化完成。
- **音訊 session 由 CallKit 主導**：在 `provider(didActivate:)` 後才啟動 WebRTC 音訊；WKWebose 的 WebRTC 需確認能沿用此 session（須實測，可能要在 `provider(didActivate:)` 後再透過 bridge 通知 JS 開始 `getUserMedia`/播放）。

---

## 3. 目標架構與資料流

### 3.1 來電（App 在背景/被關閉）

1. 主叫送出 `call-invite` 信令；後端 `account-ws.js` 偵測被叫**離線或在背景**。
2. 後端以 `apns.js`（新增 `sendVoip()`）對被叫的 **VoIP token** 發 `apns-push-type: voip` push，payload 含 `callId`、主叫識別、`kind`(audio/video)。
3. iOS `PKPushRegistry didReceiveIncomingPushWith` → **同步** `CXProvider.reportNewIncomingCall`（顯示鎖屏來電）。
4. 使用者接聽 → CallKit `CXAnswerCallAction` → 原生喚起/前景化 WebView，並透過 bridge 送 `callAnswered{callId}`。
5. Web 收到後連上 WebSocket、用既有信令完成 offer/answer，開始媒體。
6. `provider(didActivate:)` 設定 `AVAudioSession` → bridge 通知 JS `audioReady` → WebRTC 開始送收音訊。

### 3.2 來電（App 在前景）

- 可選擇仍走 CallKit（一致體驗），或維持 web overlay。建議**前景也走 CallKit**以統一通話記錄與音訊路由；web overlay 保留為 in-call 控制面板。

### 3.3 撥出

1. Web 發起 → bridge `callStarted{callId, kind, peer}`。
2. 原生 `CXStartCallAction` 註冊一通 outgoing call（納入系統記錄、正確音訊路由）。
3. 通話結束（任一端 hangup / 失敗）→ bridge `callEnded{callId, reason}` → 原生 `CXProvider.reportCall(endedAt:reason:)`。

---

## 4. 需要的改動清單

### 4.1 iOS 原生

- **能力 / 設定**
  - `project.yml`：`SentryMessenger` target 加入 `UIBackgroundModes`: `voip`, `audio`（保留 `remote-notification`）。
  - 加入 **Push Notifications** capability（已備註需付費帳號）；PushKit 不需額外 entitlement，但需 VoIP 背景模式。
  - 確認 `AVAudioSession` 類別於通話時設為 `.playAndRecord`、`.videoChat`/`.voiceChat` 模式。
- **新增檔案（Shared/，與 Clip 共用視需求）**
  - `CallKitController.swift`：封裝 `CXProvider` + `CXCallController`（report incoming/outgoing、answer/end/mute/hold action handlers、`didActivate/didDeactivate` 音訊）。
  - `VoipPushService.swift`：`PKPushRegistry` 委派，註冊 VoIP token、收 push 後同步報 CallKit。
  - `CallBridge.swift`（或擴充 `NativeBridge.swift`）：通話相關 JS↔原生 action/event。
- **AppDelegate**：初始化 `VoipPushService`、把 VoIP token 經 bridge/後端註冊。

### 4.2 NativeBridge 新增協定

JS → 原生（`postMessage({action,payload})`）：
- `callStarted` `{ callId, kind, peerName, peerAvatar }`
- `callEnded` `{ callId, reason }`
- `callStateChanged` `{ callId, muted, video, speaker }`
- `registerVoipToken`（或由原生主動上報）

原生 → JS（`window.SentryNative.onEvent(name,data)`）：
- `callAnswered` `{ callId }`
- `callDeclined` / `callEndedByUser` `{ callId }`
- `callMuteToggled` `{ callId, muted }`
- `audioReady` `{ callId }`（CallKit 啟用音訊後才送收媒體）
- `voipToken` `{ token, platform:'ios' }`

### 4.3 後端（data-worker）

- `apns.js`：新增 `sendVoip(token, { callId, kind, caller })`，設 `apns-push-type: voip`、`apns-topic: red.sentry.messenger.voip`、高優先級、payload 不含敏感明文（沿用 E2E 不落地原則，僅帶 `callId` 與加密化識別）。
- VoIP token 儲存：新增端點/欄位保存裝置的 VoIP token（與既有 APNs token 分開；遵守 CLAUDE.md「資料表異動一律用 migration」）。
- `account-ws.js`：在 `call-invite` 信令時，若被叫無活躍 WS（離線/背景），觸發 `sendVoip()`。
- 設定：`APNS_*` 既有環境變數沿用；確認 VoIP topic / env（sandbox vs production）。

### 4.4 Web（calls/*）

- 在通話生命週期關鍵點呼叫 bridge（撥出開始、接通、掛斷、靜音切換）；僅在 `isNativeApp()` 為真時啟用。
- 監聽原生事件（`callAnswered`/`audioReady`/`callEndedByUser`）驅動既有 `acceptIncomingCallMedia`/`endCallMediaSession`。
- 確認 WKWebView WebRTC 能在 CallKit 主導的 `AVAudioSession` 下正常送收（**需實機驗證**）。

### 4.5 文件

- 更新 `ios/README.md`（新增 CallKit/PushKit 段落、背景模式、bridge action 表）。
- 更新根 `README.md` 安全特性/架構段落如有涉及（依 CLAUDE.md 文件同步規範）。

---

## 5. 分階段實作建議

| 階段 | 內容 | 狀態 | 產出 / 驗收 |
|------|------|------|-------------|
| **P0 背景續通** | 加 `audio` 背景模式、`AudioSessionManager` 設定 `AVAudioSession` | ✅ 已實作 | 實機：通話中按 Home / 鎖屏，語音持續 |
| **P1 CallKit 前景整合** | `CallKitController` + bridge（撥出/接通/掛斷/靜音） | ✅ 已實作 | 撥出與接聽顯示原生 UI；通話進系統記錄；靜音同步 |
| **P2 PushKit 喚醒** | `voip` 背景模式 + `VoipPushService`；收 VoIP push → 同步報 CallKit | ✅ 已實作 | App 被關閉時，對方來電仍跳鎖屏來電並可接聽 |
| **P3 後端 VoIP push** | `apns.js sendVoip` + `voip_tokens`（migration 0022）+ `account-ws` 於 call-invite 離線觸發 + worker 端點 | ✅ 已實作 | 端到端：離線被叫收到鎖屏來電 |
| **P4 收尾／驗證** | 邊界情境（忙線拒接、未接逾時、冷啟動拒接重放）已於 `CallKitController` 實作；通話記錄 UI 與實機 PoC 待辦 | ⏳ 進行中 | 各情境穩定；音訊 PoC 通過 |

實作落點：
- iOS：`AudioSessionManager.swift`、`CallKitController.swift`（singleton + 冷啟動接聽重放）、
  `App/VoipPushService.swift`（僅完整 App）、`NativeBridge.swift`（通話 action/event、轉發 voipToken）、
  `Info.plist`（`audio`+`voip` 背景模式）。
- 後端：`apns.js`（`sendVoip`）、`migrations/0022_add_voip_tokens.sql`、`worker.js`
  （`/d1/push/voip/{subscribe,unsubscribe}`）、`account-ws.js`（`_sendVoipNotifications` +
  call-invite 離線觸發）。
- Web：`native-bridge.js`（voipToken → `/d1/push/voip/subscribe`，登入前快取重試）、
  `native-call-bridge.js`、`call-overlay.js`。

P4 已實作的原生邊界處理（`CallKitController`）：
- **忙線拒接**：已有通話時的新來電會被報告後立即結束（滿足 VoIP 必報要求），不打斷現有通話。
- **未接逾時**：來電顯示後 40 秒未接通則自動結束為「未接」，避免 CallKit UI 卡住（web 未連線時的安全網）。
- **冷啟動拒接重放**：接聽與拒接皆支援在 web 就緒前先排隊、就緒後重放。
- **`reportIncoming` 冪等**：VoIP push 與 web 對同一 callId 不重複報告。

**尚待（實機 / 帳號）**：WKWebView WebRTC × CallKit 音訊 PoC、冷啟動端到端時序、通話記錄 UI
對齊、App Store 憑證與 VoIP topic 設定。

---

## 6. 風險與待驗證項

- **WKWebView WebRTC 與 CallKit 音訊 session 的相容性**：這是最大不確定點。原生 CallKit 期望由 `provider(didActivate:)` 提供音訊 session，但 WebRTC 在 WKWebView 內由 WebKit 管理音訊。需先做 PoC 驗證能否協調（可能需要在 audio 啟用後再讓 JS 開始媒體，或接受 WebKit 自管音訊而 CallKit 僅作 UI/記錄層）。
  - **修正（待實機重測）**：實測「接聽後沒聲音」。已調整為 Apple 標準時序——音訊
    `setCategory` 移至 `CXAnswerCallAction`/`CXStartCallAction`（CallKit 啟用 session
    前），`provider(didActivate:)` **不再重設 category／重新 activate**（避免打斷 WebKit
    音訊單元）；並讓 web 的 `audioReady` 呼叫 `recoverCallMediaOnResume()` 在路由就緒後
    重啟遠端播放。若仍無聲，下一步改採「WebKit 完全自管音訊、移除所有 `AudioSessionManager`
    的 category/activate 呼叫，CallKit 僅作 UI/記錄」。
- **VoIP push 嚴格規範**：iOS 13+ 要求收到即報來電，違反會被停送。後端只在「確有來電」時發送。
- **App Clip 限制**：App Clip 不支援 PushKit/背景續通；通話原生整合僅適用完整 App，Clip 維持現狀（或引導安裝完整 App）。
- **隱私/E2E**：VoIP push payload 不得帶明文訊息或可識別個資，沿用「敏感資料不落地」原則，只帶 `callId` 等最小資訊。
- **憑證/帳號**：需 Apple 付費開發者帳號、Push Notifications capability、VoIP Services 憑證（同 `.p8` 可用）。
- **電量/背景**：`audio` 背景模式需確保僅通話期間啟用，避免審核質疑與耗電。

---

## 7. 下一步

1. 確認要先做的階段（建議先 **P0+P1**，可立即提升體驗且不依賴後端/憑證）。
2. P0 之前先做 **WKWebView WebRTC × CallKit 音訊 PoC**（最高風險，宜先驗證）。
3. 確認 Apple 帳號與 Push 憑證狀態，以排程 P2/P3。
