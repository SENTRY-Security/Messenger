# CLAUDE.md

## 語言

- 一律使用繁體中文回覆，包含說明、commit message 摘要、錯誤訊息解釋等。
- 程式碼中的註解與變數名稱維持英文。

## 系統前提

- **單裝置架構**：每個帳號固定一個 deviceId，不支援多裝置、不支援多裝置同時登入。
- **新登入踢舊連線**：同一帳號的新登入階段（session）會踢掉舊的登入階段，確保同時只有一個活躍連線。

## Linear 進度追蹤

- **單一事實來源**：所有開發進度一律以 Linear 追蹤（team `SENTRY 核心團隊`、initiative `SENTRY Messenger`）。iOS 完整 App 與 App Clip 的工作歸 project **`Messenger iOS`**；web（iOS Safari／PWA）的工作歸 project **`Messenger iOS Web`**。
- **設計與議題自動建 issue**：所有設計（架構方案、安全機制、方案評估）與議題（新功能、bug、技術債、重構）在開工前必須自動建立對應的 Linear issue；重大架構／安全決策以「決策紀錄：…」形式的 issue 留檔（含決策理由與否決方案）。
- **自動爬取與處理**：每次工作階段開始時，自動爬取（`list_issues`）相關 project 的 issue 現況，比對 repo 實際狀態，處理可處理的項目；發現 issue 與現況不符時主動更新。
- **自動更新狀態**：工作進行中隨進度更新 issue 狀態（待辦清單 → 準備執行 → 進行中 → 待審查 → 已完成／已取消／已阻塞）。程式碼已合併但尚待實機驗證者用「待審查」；PR 合併後把 PR 連結附到 issue。
- **不重複建檔**：建 issue 前先以 query 查詢避免重複；已存在者以更新（`save_issue` 帶 `id`）代替新建。

## 資料庫

- **資料表異動一律使用 migration**：所有新增 / 修改 / 刪除 D1 資料表的操作，必須透過 `data-worker/migrations/` 下的 SQL migration 檔處理，不得在程式碼中使用 `CREATE TABLE IF NOT EXISTS` 進行隱式建表（`ensureDataTables` 的 auto-create 僅作為舊環境相容 fallback，不得用於新功能）。

## 文件同步

- **README.md 必須與 repo 現狀對齊**：每次對 repo 進行功能性改動（新增功能、修改 API、變更架構、調整安全機制、新增/移除模組等），必須檢查 `README.md` 是否需要同步更新。若相關段落（功能列表、架構圖、安全特性表、端點文件、技術棧、目錄結構等）與改動不一致，須在同一次 commit 或同一個 PR 內一併更新。

## 架構原則

- **本地零持久化**：不在本地儲存任何持久性資料。
- **敏感資料加密上傳**：所有敏感資料（訊息、金鑰、聯絡人等）加密後上傳至後端（D1 / R2）。
- **登出清除**：使用者登出時清除所有本地資料（IndexedDB、LocalStorage、記憶體狀態）。
- **登入注水還原**：重新登入時從後端拉取加密資料，解密後注水（hydrate）還原至本地狀態。

## iOS App 模式例外（僅原生 App，web 版不適用）

> 以下僅適用於 iOS 原生 App（以 `isNativeApp()` / bundle 守衛），純 web 版維持上述「本地零持久化／背景登出」原則不變。詳見 `ios/docs/app-secure-session-plan.md`。

- **保持登入**：iOS App **不做背景計時自動登出**，使用者切背景/鎖屏後仍保持登入。
- **他處登入仍踢線**：單裝置原則不變——他處登入仍會 force-logout 踢掉本機（不在此例外範圍）。
- **金鑰不落地、每次重取**：MK 僅存記憶體；每次開啟以 `account_token` 向 `POST /api/v1/mk/fetch` 重新拉取 `wrapped_mk`（密文），於記憶體解封，不持久化明文金鑰。
- **iOS 安全儲存**：解封用 KEK 與 `account_token` 存於 **Keychain**（`biometryCurrentSet` + `whenUnlockedThisDeviceOnly`，FaceID/Secure Enclave 綁定）；拉取資料以密文落地（Data Protection `.completeFileProtection`）。
- **FaceID 解鎖**：使用者可於設定啟用；啟用後冷啟動與回前景需 FaceID，失敗則鎖定可重試、不登出。
- **原生加密本地快取（旗標 `UseNativeLocalCache`，預設關）**：完整 App 可將**後端回傳的密文**快取於原生 Data Protection 儲存（`.completeFileProtection`），供離線讀取／加速啟動。**僅密文落地、明文一律不持久化**（解密仍在記憶體），**登出時清除**。屬「本地零持久化」之窄範圍 iOS 例外（同 secure-session 例外精神）；純 web／App Clip 不適用。詳見 `ios/docs/native-webrtc-migration-plan.md` 之 Tier 評估與 `ios/README.md`。
