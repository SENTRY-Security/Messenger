# 上架檢查清單（App Store / TestFlight）

> CI（macOS）只驗證**編譯**。下列步驟需在 macOS + Apple Developer 帳號完成，
> 多數無法由 CI 代勞（需簽章憑證與 App Store Connect 設定）。

## 1. Apple Developer Portal
- App ID：`red.sentry.app.SENTRY-Messenger`、App Clip ID：`…​.Clip`（Team `HW8N8C46HG`）。
- 啟用 Capabilities：
  - Near Field Communication Tag Reading（NDEF）
  - Push Notifications
  - Associated Domains
  - App Groups（`group.red.sentry.app.SENTRY-Messenger`）
  - App Clips（完整 App）
- 建立 APNs 金鑰（.p8）供後端發送（topic = bundle id）。

## 2. 簽章
- Xcode Signing & Capabilities 選擇 Team `HW8N8C46HG`（已寫入 `project.yml`）。
- `aps-environment` 上架/TestFlight 改為 `production`（見 entitlements）。

## 3. Associated Domains / AASA
- AASA 由 `web/functions/(.well-known/)apple-app-site-association.ts` 提供，含
  `applinks` 與 `appclips`。
- 部署後驗證：`curl -sSL https://app.message.sentry.red/.well-known/apple-app-site-association`
  應回傳含上述 appID 的 JSON（`content-type: application/json`，無重導）。

## 4. App Store Connect
- 建立 App 紀錄（bundle id 對齊）。
- App Clip：設定預設體驗（Default App Clip Experience）與**進階體驗** URL
  （NTAG424 連結網域），上傳 App Clip Card 圖。
- 隱私問卷：對應 `PrivacyInfo.xcprivacy`（本 App 不追蹤；UserDefaults 理由 CA92.1）。
- Export Compliance：`ITSAppUsesNonExemptEncryption = false`（Info.plist 已設）。

## 5. 建置與上傳
```bash
cd ios
xcodegen generate
xcodebuild -project SentryMessenger.xcodeproj -scheme SentryMessenger \
  -configuration Release -sdk iphoneos -archivePath build/SentryMessenger.xcarchive archive
xcodebuild -exportArchive -archivePath build/SentryMessenger.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export
```
（`ExportOptions.plist` 依團隊簽章方式自行建立；CI 免簽章僅供編譯驗證。）

## 6. 待辦（需後端配合）
- APNs sender：data-worker 新增 APNs 發送與 token 儲存（見 `ios/README.md` 推播章節）。
- App Clip 進階體驗 URL 與 AASA 對應的實際 NTAG424 連結格式確認。

## 7. 實機測試重點（CI 無法涵蓋）
- NTAG424 感應登入（App 內按鈕 / App 外連結冷啟動 / App Clip 喚起）。
- WebRTC 語音/視訊（相機麥克風權限）、檔案/相機上傳。
- 推播註冊、通知點擊深連結。
