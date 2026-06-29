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

原生 → JS：呼叫 `window.SentryNative.onEvent(name, data)`

| event       | data                          |
|-------------|-------------------------------|
| `nfcResult` | `{ url }`                     |
| `nfcError`  | `{ message, code }` — code: `unavailable` / `no_url` / `invalid_host` / `cancelled` / `system` |
| `pushToken` | `{ token, platform: 'ios' }`  |

## 外殼行為（WebView）

- **導航白名單**：僅 `AppConfig.allowedNavigationHosts`（messenger 網域）的主框架
  導航留在 App 內；其他外部連結以 `SFSafariViewController` 開啟，`tel:`/`mailto:`
  等系統 scheme 交給 OS。子資源/iframe（媒體、TURN）一律允許。
- **WebRTC 權限**：第一方網域的相機/麥克風請求（`requestMediaCapturePermissionFor`）
  自動授權，避免雙重權限詢問。
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
`https://message.sentry.red`）。可為 UAT 另建 scheme/configuration 覆寫。

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
