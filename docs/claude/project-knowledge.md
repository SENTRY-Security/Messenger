# Project Knowledge：SENTRY Messenger（架構與現況細節）

> CLAUDE.md 的延伸詳情檔。**只寫已由程式碼／設定驗證的事實**，每項附出處；更新需附證據（維護規則見 `maintenance.md`）。
> 最後同步：2026-07-11（main @ `598bca8`；深度盤點 by Explore agent + 主線核驗）。

## 1. 系統組成與技術棧

| 元件 | 技術 | 說明 |
|---|---|---|
| `web/` | 純前端 SPA，esbuild（`web/build.mjs`），部署 Cloudflare Pages | 入口 `web/src/index.html` 與 `web/src/pages/{app,login,logout,ephemeral,debug,mic-test,pwa-push}.html` |
| `data-worker/` | Cloudflare Worker（`src/worker.js`，約 10400 行） | 唯一後端；D1＋KV＋Durable Objects＋R2（S3 相容 API）＋Containers |
| `ios/` | Swift + XcodeGen（`ios/project.yml`），WKWebView 殼層 | 3 targets：`SentryMessenger`（完整 App）、`SentryMessengerClip`（App Clip）、`SentryMessengerNotify`（NSE） |

data-worker bindings（`data-worker/wrangler.toml`）：D1 `message_db`（UAT：`message_db_uat`）、KV `AUTH_KV`、DO `AccountWebSocket`／`RateLimiter`／`BrowserSession`、Containers（`Dockerfile.safe`，UAT 停用）、R2 bucket `message-media`（經 `@aws-sdk/client-s3`）。

## 2. 認證與加密（安全核心）

- **帳號認證**：NTAG424 NFC SDM（`/api/v1/auth/sdm/*`）＋ OPAQUE（`@cloudflare/opaque-ts`，`/api/v1/auth/opaque/*`）。
- **E2EE**：X3DH + Double Ratchet，實作在 `web/src/shared/crypto/dr.js`（827 行）＋ `prekeys.js`；`web/src/app/crypto/*` 多為 re-export shim。`dr.js:1-15` 明文規定**禁止 fallback/retry/rollback/resync/降級**，解密失敗直接 fail——這是安全紅線的程式碼層依據。
- **媒體**：分塊 AES-256-GCM 加密後經 `sign-put-chunked` 簽名直傳 R2；聯絡人／金鑰／MK 密文存 D1（`contact_secret_backups`、`device_backup`）。
- **單裝置踢線**：`data-worker/src/account-ws.js:236-245`（DO 比較 `sessionTs`，舊連線 `close(4409,'replaced')`）。
- **iOS 金鑰**：MK 僅記憶體，`POST /api/v1/mk/fetch`（`worker.js:~7736`）重取 wrapped MK；WS token `POST /api/v1/ws/token`（`:~8000`）→ `/ws` DO 升級。
- **NSE 推播預覽**：ECDH P-256 + HKDF + AES-256-GCM，預覽私鑰經 App Group Keychain 共享，不觸碰 DR 主鑰（SEN-80）。
- **30 天試用起算**（SEN-1428，2026-08-26 起）：於**密碼設定完成**（OPAQUE 註冊記錄寫入，`register-finish` 與 `/d1/opaque/store` 兩路徑）時一次性發放，**不在帳號建立（NFC exchange）時**。`grantTrialSubscription()` 冪等：`TRIAL-{digest}` token 或既有 `subscriptions` row 存在即跳過——密碼重設不重發不延長。儲值延展為 `max(expires_at, now) + days`（`docs/topup-system-spec.md`）。

## 3. API 面概覽（`data-worker/src/worker.js`）

前綴 `/api/v1/`：`auth/sdm/*`、`auth/opaque/*`、`mk/{store,update,fetch}`、`messages/*`（secure、atomic-send、by-counter、batch-latest、delete、gap-count…）、`media/*`（sign-put/get ＋ chunked 系列、copy）、`calls/*`（invite、cancel、acknowledge、network-config、turn-credentials）、`keys/{publish,bundle}`、`devkeys/*`、`biz-conv/*`、`ephemeral/*`（create-link、consume、key-exchange…）、`subscription/*`、`push/*`、`admin/{set-brand,purge-account}`、`apps/instance/*`（Genymotion 雲端 Android）、`health`、`status`。WebSocket：`/ws`。

## 4. 資料層

Migrations：`data-worker/migrations/0001`〜`0023`（共 23 檔；新表一律走 migration，見 CLAUDE.md「資料庫」）。要點：
- 刪除語意：`deletion_cursors`（soft，min_ts）＋ `conversation_deletion_log`＋hard DELETE——**cache-first 禁用的根據**（ADR-003）。
- `0013`：`business_conversations` 取代舊 groups（`DROP TABLE groups/group_members/group_invites`）。
- `0015` Web Push、`0020` genymotion_instances、`0021-0023` APNs／VoIP／推播預覽公鑰。

## 5. CI/CD（`.github/workflows/`）

- `deploy.yml`：**push main 即部署 prod**（migrations apply --remote → wrangler deploy；Pages build → verify → cosign 簽章 → SLSA → deploy）。
- `deploy-uat.yml`：非 main 分支 push → UAT。
- `ios.yml`：`ios/**` 路徑觸發，XcodeGen＋xcodebuild 模擬器建置——**只編譯，無測試**。
- `verify-build.yml`：deploy 後＋每日 cron，重建比對 hash（可重現建置）。
- `e2e.yml.disabled`：已停用，且引用的 `scripts/test-{prekeys-devkeys,messages-secure}.mjs` 已不存在（追蹤：見 Linear 測試缺口 issue）。

## 6. iOS 旗標現況（`ios/SentryMessenger/Resources/Info.plist:62-103`，讀取邏輯 `Shared/AppConfig.swift:41-80`）

`UseBundledWeb`／`UseNativeCalls`／`UseNativeAccountSocket`／`UseNativeMediaDownload`／`UseNativeLocalCache` **全部預設 `false`**。開旗標實機驗證＝SEN-79/81/82 從「待審查」到「已完成」的唯一途徑。

## 7. 測試現況

**repo 無任何可執行的自動化單元／整合測試**：三個 package.json 均無 `test` script；`test/` 僅 `render-doc-screenshot.mjs`（文件渲染手動驗證腳本）；e2e workflow 已停用且腳本佚失。驗證手段＝CI 編譯＋`node web/build.mjs`＋`web/npm run verify`（建置完整性）＋實機人工驗證。

## 8. 已知技術債與文件落差（2026-07-11 盤點，Linear 已建檔追蹤）

1. `web/src/app/features/messages-flow/` 頂層 5 檔（`reconcile.js`/`presentation.js`/`server-api.js`/`crypto.js`/`state.js`）為 not-implemented stub（throw）；生產路徑 `messages-flow-facade.js` 未 import 它們（孤兒 stub，去留待決）。
2. 測試自動化缺口（見 §7）。
3. 文件落差：README 版本標示 `0.1.9`（`README.md:41`）vs `package.json` `0.2.0`；`PLAN-css-split.md` 已過時（實況 16 個 CSS 檔 vs 計畫 9 檔）；`ios/docs/app-secure-session-plan.md` 自述「Keychain/FaceID 待實作」但 `KeychainStore.swift`/`AppLock.swift` 等已存在（文件狀態落後，實際完成度待人工核對）。
4. 零星 hardcoded/DEPRECATED 註記：`worker.js:3378`（trim 參數硬編）、`calls/network-config.js:206`（斷網 fallback 設定）、`messages/ui/renderer.js:335`（DEPRECATED 舊函式殘留）、`ios .../SharedStore.swift:8`（keychain-access-group entitlement 未配）、`ClipApp.swift:11`（TODO 無說明）。

## 9. 歷史 plan 檔定位

`plan.md`（Web Push）與 `plan.ephemeral-e2ee.md`（Ephemeral E2EE）標題自帶「✔ COMPLETED (2026-03-24)」且與程式碼相符——**歷史實作記錄，非待辦**。`PLAN-css-split.md` 已過時（見 §8.3）。
