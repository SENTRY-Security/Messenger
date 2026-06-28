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

### 2) App Clip（部分實作，稍後討論）
- `SentryMessengerClip` target。NTAG424 感應可在「未安裝完整 App」的裝置上
  喚起 App Clip，URL 以 `NSUserActivityTypeBrowsingWeb` 進入後直接載入。
- 待辦：App Store Connect 的 App Clip 體驗設定、`appclips:` associated domain
  的 apple-app-site-association、與完整 App 的帳號接力、ephemeral 通知等。

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
| `nfcError`  | `{ message }`                 |
| `pushToken` | `{ token, platform: 'ios' }`  |

## 需在 Apple Developer 啟用的能力（Capabilities）

- **Near Field Communication Tag Reading**（NFC，NDEF）
- **Push Notifications**（如需推播；entitlement 內 `aps-environment` 上架請改 `production`）
- **Associated Domains**（universal links / App Clip）
- **App Clips**（完整 App 嵌入 Clip）

> 設定團隊簽章：在 `project.yml` 的 `settings.base.DEVELOPMENT_TEAM` 填入
> Team ID，或於 Xcode 的 Signing & Capabilities 選擇團隊。

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
