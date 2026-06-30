# SENTRY Messenger — iOS

原生 iOS 外殼，以 `WKWebView` 包裝既有 web messenger，並以 **NTAG424** 卡片
感應作為登入入口。專案由 [XcodeGen](https://github.com/yonaskolb/XcodeGen)
依 `project.yml` 產生，`.xcodeproj` 不進版控。

## 需求

- Xcode 15+
- XcodeGen：`brew install xcodegen`
- 實機測試（NFC 在模擬器無法使用）

## 產生並開啟專案

```bash
cd ios
xcodegen generate
open SentryMessenger.xcodeproj
```

之後修改 `project.yml`（新增檔案/設定）後，重新執行 `xcodegen generate`。

## 兩種登入入口

### 1) App 內 NFC 登入
- 啟動後進入原生 `LoginView`，點「感應卡片登入」→ 系統 NFC 感應 UI 彈出。
  畫面採用品牌 Logo（`Assets.xcassets/LogoMark`，向量 template 染白）與深色漸層
  背景、青→靛漸層按鈕，視覺對齊 web 登入頁（`web/src/pages/login.html`）。
- 讀取 NTAG424 的 NDEF URI（SDM 每次感應產生新的 `PICCData`/`CMAC`），
  驗證網域於 `AppConfig.allowedTagHosts` 白名單內後，載入該動態 URL，由
  web/後端（data-worker 的 NTAG424 SDM 驗證）完成登入。
- web 端若要在「登入按鈕」直接觸發原生感應，可呼叫：
  ```js
  window.webkit.messageHandlers.sentryNative.postMessage({ action: 'scanNFC' });
  ```
  成功後原生會把 web view 導向動態 URL，並回呼
  `window.SentryNative.onEvent('nfcResult', { url })`。

> **冷啟動直接登入**：若在 App 外點到 NTAG424 的 universal link（https），系統會
> 以 `NSUserActivityTypeBrowsingWeb` 喚起 App，`SessionRouter` 驗證網域後直接載入
> 該動態 URL，跳過原生登入畫面。需設定 `applinks:` associated domain 與 AASA。

### 2) App Clip
- `SentryMessengerClip` target（bundle id `red.sentry.messenger.Clip`）。
  NTAG424 感應可在「未安裝完整 App」的裝置上喚起 App Clip，URL 以
  `NSUserActivityTypeBrowsingWeb` 進入後經 `SessionRouter` 載入。
- **AASA**：`web/functions/.well-known/apple-app-site-association.ts`（與 root 版）
  已加入 `appclips` 與 `applinks`，appID `HW8N8C46HG.red.sentry.messenger(.Clip)`。
- **引導安裝**：`ClipInstallPrompt` 以 `SKOverlay` 邀請安裝完整 App（僅 App Store
  發佈時生效）。
- **帳號接力**：App Group `group.red.sentry.app.SENTRY-Messenger` + `SharedStore`
  傳遞非敏感旗標；敏感 token 不落地，由完整 App 重新登入（或日後改用 Keychain
  access group）。
- **通話音訊**：Clip 無 CallKit，改由 `NativeBridge` 直接設定 `AVAudioSession`
  （`playAndRecord` + `voiceChat`/`videoChat`），並於接通時回拋 `audioReady` 讓 web
  （重）啟動媒體——否則 App↔Clip 通話會沒聲音、視訊單向。
- **來電卡**：Clip 無 CallKit，`callIncoming` 時 `NativeBridge` 自行回拋
  `incomingCallPresentation`，讓 web 顯示自家漂浮來電卡（否則 Clip 收到來電卻不顯示
  接聽/拒接 UI）。
- 待辦：App Store Connect 的 App Clip 預設/進階體驗 URL 設定、ephemeral 通知。

## JS ↔ 原生橋接（`NativeBridge`）

JS → 原生：`window.webkit.messageHandlers.sentryNative.postMessage({ action, payload })`

| action        | 說明                                  |
|---------------|---------------------------------------|
| `ready`       | web 啟動完成（保留）                   |
| `scanNFC`     | 觸發 NTAG424 感應登入                  |
| `registerPush`| 要求註冊 APNs 推播（顯示權限詢問）     |
| `haptic`      | 觸覺回饋（payload.style: light…rigid） |
| `share`       | 系統分享（payload.text / payload.url） |
| `callIncoming`| 來電 → CallKit 顯示系統來電 UI（payload: callId, kind, peerName） |
| `callStarted` | 撥出 → CallKit 登錄通話（payload: callId, kind, peerName） |
| `callConnected`| 通話接通（payload: callId）          |
| `callStateChanged`| 狀態變更（payload: callId, muted） |
| `callEnded`   | 通話結束（payload: callId, reason）    |
| `setAudioRoute`| 切換擴音/聽筒（payload: `speaker: true/false`）；web 在 iOS 無法控制路由，故原生代為覆寫 |
| `playSound`   | 原生播放內建音效（payload: `file` 基底檔名含副檔名、`loop`）；取代 WKWebView 的 HTML5/WebAudio |
| `stopSound`   | 停止指定音效（payload: `file`） |
| `stopAllSounds`| 停止所有音效 |
| `secureStore` | 存入 Keychain（payload: kek, account_token, account_digest） |
| `secureLoad`  | 解鎖後讀出 session（回 `secureSessionLoaded`） |
| `clearSecureSession`| 清除 Keychain session（登出/被踢） |
| `getLockMode` / `setLockMode` | 取得/設定鎖定模式（none/faceid/nfc，回 `lockMode`） |
| `openLockSettings` | 開啟原生鎖定設定面 |
| `lockNow`     | 立即上鎖                              |
| `nfcUnlockResult` | NFC 解鎖驗證結果（payload: ok）      |

原生 → JS：呼叫 `window.SentryNative.onEvent(name, data)`

| event       | data                          |
|-------------|-------------------------------|
| `nfcResult` | `{ url }`                     |
| `nfcError`  | `{ message, code }` — code: `unavailable` / `no_url` / `invalid_host` / `cancelled` / `system` |
| `pushToken` | `{ token, platform: 'ios' }`  |
| `voipToken` | `{ token, platform: 'ios', environment }` — PushKit VoIP token；`environment` 為 `sandbox`/`production`（dev 簽章為 sandbox），web 上報 `/d1/push/voip/subscribe`，後端據此選對應 APNs gateway |
| `callAnswered`    | `{ callId }` — 使用者於系統來電 UI 按接聽 |
| `callEndedByUser` | `{ callId }` — 使用者於系統 UI 按結束/拒接 |
| `callMuteToggled` | `{ callId, muted }` — 系統 UI 靜音切換   |
| `audioRouteChanged` | `{ speaker }` — 目前是否為擴音（系統路由變更/切換時回報，同步通話 UI 喇叭鈕） |
| `audioReady`      | `{ callId }` — CallKit 啟用音訊 session |
| `incomingCallPresentation` | `{ callId, mode: 'in-app' }` — 前景來電未走 CallKit，通知 web 顯示自家漂浮來電卡（否則前景來電兩邊都不顯示、無法接聽） |
| `secureSessionLoaded` | `{ hasSession, account_token?, account_digest?, kek? }` — 解鎖後送出 |
| `lockMode`        | `{ mode }` — 目前鎖定模式 |
| `nfcUnlockScanned`| `{ url }` — NFC 解鎖感應到卡片，web 驗證後回 `nfcUnlockResult` |

## 外殼行為（WebView）

- **導航白名單**：僅 `AppConfig.allowedNavigationHosts`（messenger 網域）的主框架
  導航留在 App 內；其他外部連結以 `SFSafariViewController` 開啟，`tel:`/`mailto:`
  等系統 scheme 交給 OS。子資源/iframe（媒體、TURN）一律允許。
- **WebRTC 權限**：第一方網域的相機/麥克風請求（`requestMediaCapturePermissionFor`）
  自動授權，避免雙重權限詢問。
- **本地網路（WebRTC ICE）**：WKWebView 內 WebRTC 收集 host/mDNS ICE 候選需要 iOS
  「本地網路」權限，故 Info.plist 宣告 `NSLocalNetworkUsageDescription`（App 與 Clip
  皆有）。缺少時候選會為 0、通話無法建立（瀏覽器無此限制故 web 版正常）。
- **通話原生整合（CallKit，P1）**：通話/視訊媒體仍在 WKWebView 內以 WebRTC 執行，
  原生層以 `CallKitController`（`CXProvider`/`CXCallController`）鏡射通話狀態到系統：
  撥出/來電顯示系統通話 UI、鎖屏接聽、靜音同步；系統來電 UI 顯示 App 圖示
  （`CXProviderConfiguration.iconTemplateImageData`，以 `LogoMark` 向量 template 渲染）。web 端 `native-call-bridge.js` 於通話
  生命週期透過 bridge 通知原生（`callIncoming`/`callStarted`/…），並監聽 CallKit 動作
  （`callAnswered`/`callEndedByUser`/`callMuteToggled`）回灌既有 accept/hangup/mute 流程。
- **前景/背景來電分流**：依大眾習慣，**App 前景**收到來電只顯示 web 的漂浮來電卡，
  **不**跳系統 CallKit banner（`reportIncoming` 以 `UIApplication.applicationState == .active`
  判斷前景則改 stash）；使用者**接通當下**才把通話以 active 註冊給 CallKit
  （`reportConnected` → `reportOutgoing`），讓背景續通由 CallKit 接手。**背景/鎖屏**
  則由 VoIP push 喚醒、走完整系統來電 UI（不變）。
- **背景續通（P0）**：`UIBackgroundModes` 加入 `audio`，`AudioSessionManager` 將
  `AVAudioSession` 設為 `playAndRecord` + `voiceChat`/`videoChat`，使通話切背景/鎖屏
  不中斷。
- **PushKit 喚醒（P2）**：`UIBackgroundModes` 加入 `voip`；`VoipPushService`
  （`PKPushRegistry`，僅完整 App，App Clip 不支援）註冊 VoIP token 並在收到 push 時
  **同步**以 `CallKitController.shared` 報來電。後端在被叫離線時，於 `call-invite`
  改發 VoIP push（`apns.js sendVoip` → `voip_tokens` → topic `<bundleId>.voip`）。
  冷啟動接聽會在 web 就緒後重放（`pendingAnsweredCallId`）。
  > **待實機驗證（PoC）**：WKWebView 內 WebRTC 音訊與 CallKit 主導的 `AVAudioSession`
  > 之協調需在實機確認；冷啟動「VoIP push → 接聽 → web 連線完成媒體」端到端時序亦需
  > 實機驗證。詳見 `docs/native-calls-plan.md`。
  > **原生媒體（mid-term，P1 已實作、旗標關）**：通話媒體層可由 WKWebView 內 WebRTC
  > 改為原生 WebRTC（`Calls/CallPeerConnection` + `NativeCallController` orchestrator
  > ＋ `RTCAudioSession` manual audio ＋ CallKit 音訊閘門），沿用既有 signaling（web
  > 帳號 WS）/TURN/E2EE（DTLS-SRTP）。web 端 `calls/native-media-bridge.js` 在
  > `window.USE_NATIVE_CALLS=true` 時把 SDP/mute/teardown 交給原生。以 feature flag
  > `UseNativeCalls`（Info.plist，預設 `false`）控制，關閉時完全走現有 WebView 路線。
  > 解決 WKWebView↔CallKit `AVAudioSession` 互搶（前景通話無聲）的根因。分階段（P1
  > 語音 ✅／P2 視訊／P3 原生 UI／P4 背景）與 signaling 放置決策見
  > `docs/native-webrtc-migration-plan.md`。**待實機驗證後才開旗標。**
  > **需求**：Apple 付費帳號、Push Notifications 能力（含 VoIP）、`<bundleId>.voip`
  > APNs topic，以及後端 `APNS_*` 環境變數。
  > **原生帳號 WebSocket（Option B，B1 已實作、旗標關）**：帳號 WS 的位元組傳輸可由
  > WebKit 移到原生 `URLSession`（`Net/AccountSocketService`），web 端以
  > `NativeWebSocket` shim 模擬 `WebSocket` 介面，`ws-integration.js` 僅換建構一行；
  > auth/心跳/重連邏輯不變。bridge 動作 `wsOpen/wsSend/wsClose`、事件 `wsEvent`。
  > 旗標 `UseNativeAccountSocket`（Info.plist，預設 `false`）。動機：後端帳號層**單一
  > 活躍連線**，原生另開平行 WS 會踢掉 WebView 連線，故由原生擁有唯一連線；背景自主
  > （token/心跳/重連入原生）為 B2。詳見 migration plan §2.1。
- **檔案上傳**：`<input type=file>` 由 WKWebView 原生支援（相機/相簿需 Info.plist
  權限字串，已具備）。
- **其他**：pull-to-refresh、載入錯誤重試、`target=_blank` 依白名單內外分流、
  鍵盤互動式收起。

## 推播（APNs）

iOS 的 WKWebView **不支援 Web Push**，因此原生 App 走 **APNs**：

1. web 呼叫 bridge `registerPush` → 原生顯示權限詢問並向 APNs 註冊。
2. 取得 device token 後，原生以 `pushToken` 事件回拋給 web（`{ token, platform: 'ios' }`）。
3. web/後端需把此 APNs token 與帳號 `digest` 綁定儲存。
4. 點擊通知：payload 的 `aps` 之外可帶第一方 `url`，原生會就地導航既有 web view
   到該 URL（深連結到對話），不重置 shell。

⚠️ **後端缺口（需 data-worker 配合，非 iOS 範圍）**：目前 `push_subscriptions`
為 Web Push（VAPID）。原生 APNs 需要新增 APNs sender（APNs key/p8、topic =
bundle id）與 token 儲存/發送路徑。iOS 端已備妥註冊與 token 上拋，待後端對接。

> entitlement `aps-environment` 上架/TestFlight 請改為 `production`。

## 需在 Apple Developer 啟用的能力（Capabilities）

- **Near Field Communication Tag Reading**（NFC，NDEF）
- **Push Notifications**（如需推播；entitlement 內 `aps-environment` 上架請改 `production`）
- **Associated Domains**（universal links / App Clip）
- **App Clips**（完整 App 嵌入 Clip）
- **App Groups**（`group.red.sentry.app.SENTRY-Messenger`，Clip ↔ App 接力）

> Bundle ID：App `red.sentry.messenger`、Clip `…​.Clip`；Team `HW8N8C46HG`
> （與線上 AASA 一致）。

> 設定團隊簽章：在 `project.yml` 的 `settings.base.DEVELOPMENT_TEAM` 填入
> Team ID，或於 Xcode 的 Signing & Capabilities 選擇團隊。

## 上架

詳見 [`RELEASE.md`](./RELEASE.md)：Capabilities、簽章、AASA 驗證、App Store Connect
App Clip 體驗、隱私問卷等。Privacy manifest（`PrivacyInfo.xcprivacy`）已隨 app 與
clip 一併打包（不追蹤；UserDefaults 理由 CA92.1）。

## 內嵌 web bundle（離線外殼，旗標控制）

完整 App 可改成把 web 編進 App、用自訂 scheme 從本地載入（離線可開、秒開），
App Clip 則因容量限制維持遠端載入。

- **開關**：Info.plist `UseBundledWeb`（預設 `false` = 遠端載入既有行為）。
  device 驗證通過後改 `true`。
- **產生 bundle**：`ios/scripts/bundle-web.sh`（跑 `web/build.mjs` 後把 `web/dist`
  複製到 `ios/WebApp/`，以 folder reference 打包）。release / 內嵌 build 前執行。
- **本地服務**：`BundledWebSchemeHandler` 以 `sentry-app://app/…` serve `WebApp/`。
- **API 位址**：原生在 documentStart 注入 `window.API_ORIGIN = AppConfig.apiOrigin`
  （Info.plist `ApiOrigin`）。web 的 http 與 WS 層已支援以此為絕對後端網址。
- **後端 CORS**：`CORS_ORIGINS` 已加入 `sentry-app://app`（實機請確認實際 Origin
  字串，必要時調整）。
- **NFC 登入**：內嵌模式下，掃到的 NTAG424 https 連結會被映射到
  `sentry-app://app/<entry>?<原 query>`，由內嵌 web 以 `apiOrigin` 完成 SDM 登入。

> ⚠️ 內嵌的執行期行為（載入、API/WS、SDM 登入、相機）無法由 CI 編譯驗證，
> 切換 `UseBundledWeb=true` 前請務必實機測試。完整離線「訊息」另需本地加密儲存
> 與同步（後續工程）。

## 設定載入網址

`Info.plist` 的 `WebBaseURL` 控制要載入的 web 站台（預設
`https://app.message.sentry.red`，與 NTAG424 標籤／App Clip／AASA 同一 host）。
可為 UAT 另建 scheme/configuration 覆寫。`ApiOrigin`（bundled 模式的後端）預設亦為
`https://app.message.sentry.red`。

## 目錄結構

```
ios/
├── project.yml                    # XcodeGen 專案定義
├── SentryMessenger/
│   ├── App/                       # 完整 App 專用（@main、AppDelegate、RootView）
│   ├── Shared/                    # App 與 Clip 共用（WebView、NFC、bridge、login）
│   └── Resources/                 # Info.plist、entitlements、Assets
└── SentryMessengerClip/           # App Clip（部分）
    ├── ClipApp.swift
    └── Resources/
```
