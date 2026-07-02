# CLAUDE.md

## 語言

- 一律使用繁體中文回覆，包含說明、commit message 摘要、錯誤訊息解釋等。
- 程式碼中的註解與變數名稱維持英文。

## 系統前提

- **單裝置架構**：每個帳號固定一個 deviceId，不支援多裝置、不支援多裝置同時登入。
- **新登入踢舊連線**：同一帳號的新登入階段（session）會踢掉舊的登入階段，確保同時只有一個活躍連線。

## Linear 開發治理規範（Claude Code × Linear）

> Linear 是本 repo 的**唯一工作真相來源**。以下規範適用於每一次 Claude Code session。
>
> **實際座標**：Team `SENTRY 核心團隊`（issue 前綴 `SEN`）、Initiative `SENTRY Messenger`。
> iOS 完整 App 與 App Clip 的工作歸 project **`Messenger iOS`**；web（iOS Safari／PWA）的工作歸 project **`Messenger iOS Web`**；後端（data-worker / D1 / R2）沿用同 team，掛回對應功能 issue。

### 1. Linear 是唯一工作真相來源

- 所有**尚未完成、需追蹤、需決策、需驗收、或可能影響後續開發**的事項，都必須存在於 Linear issue。
- 待辦**不得只**留在 session 對話、`TODO` 註解、commit message、PR 描述、個人記憶或臨時文件；這些位置可放補充資訊，但不能取代 Linear issue。

### 2. 動工前先搜尋 Linear（禁止重複建檔）

- 修改程式碼前，先以下列條件搜尋（`list_issues` / 關鍵字查詢）：repo 名、project 名、功能名、模組名、錯誤訊息、相關關鍵字、可能的舊名或同義詞。
- 處理原則：**相同** issue → 直接更新原 issue；**高度重疊** → 更新原 issue，不得另建；**部分相關** → 先建立關聯再決定是否開子 issue；**完全無相符** → 才新建。
- 已存在者一律以 `save_issue` 帶 `id` 更新，不得為求方便另開重複 issue。

### 3. 新 issue 最低完整度

新 issue 至少包含：可搜尋的具體標題、Team、Project、Assignee、Priority、正確狀態、問題背景、目標、範圍、**不包含的範圍**、驗收條件、技術／產品限制、相關檔案／模組／路徑、Parent 或相關 issue、關係（Blocks／Blocked by／Related to）、以及 Milestone（若該 project 已有適用者）。

標題禁止只寫「修 Bug／優化／重構／處理問題／待確認」，須寫出**具體元件＋行為＋問題**，例如「Messenger iOS：掛斷視訊通話後未同步通知對端」。

### 4. 父 issue 與可執行子 issue 分開

- 父 issue 表示一個交付目標／MVP／大型範圍，**不承載大量細節實作**。
- 實際工作拆成可驗收的子 issue，子 issue 必須設 Parent；父 issue 狀態依子 issue 與整體驗收更新。
- 不得因父 issue 已存在就把所有衍生工作塞進同一描述，也不得把父 issue 與子 issue 當成同層級待辦。

### 5. 開始實作前更新 issue

正式改碼前：將處理中的 issue 設為**進行中**，並在 issue 留下本次**執行計畫**（預計修改的模組、預計驗證方式、已知風險或待確認事項）。計畫需精簡，但足以讓下一個 session 不依賴本次對話即可理解方向。

### 6. 開發中發現衍生事項

符合任一條件時**建立衍生 issue**：超出目前範圍／本 session 無法合理完成／需不同負責人／需產品或架構決策／會阻擋其他工作／是獨立缺陷或風險或技術債／需後續驗收部署觀察／為避免擴大變更而暫不處理。

不需另開的情況：只是目前實作的小步驟、可在本 issue 範圍內直接完成、無獨立驗收價值、不需後續追蹤——此時仍把資訊更新回目前 issue。

衍生 issue 建立後**必須設定至少一項關係**（Parent／Blocks／Blocked by／Related to），不得留下孤立 issue。

### 7. 產品決策與技術實作分開

遇未拍板的產品或架構選擇時，建立或更新**「決策：…」issue**：列出選項、各選項影響、建議方案、是否阻擋實作。未獲決策前不得把個人假設當成正式產品方向；可先做不影響決策結果的中立工作，但須在 issue 註明。

### 8. 程式碼存在 ≠ issue 完成

issue 需歷經 **Implemented → Integrated → Verified → Done** 四階段（本 team 無自訂狀態時，用現有狀態＋issue 留言明確標示階段；「程式碼已合併但尚待實機驗證」用**待審查**）。**禁止因「程式碼看起來已存在」就關閉 issue**。關閉前至少核對：實際入口可用、串接完成、測試通過、錯誤路徑已處理、權限與安全條件符合、驗收條件逐項達成、部署／migration 完成、文件是否需更新。

### 9. 測試與驗收紀錄

issue 完成前須在 Linear 記錄：執行了哪些測試、測試結果、未執行的測試及原因、已知限制、可能回歸風險、是否需人工驗收、是否需部署後觀察。不得只寫「已完成／測試正常」而無具體內容。

### 10. Commit／PR 與 Linear 互相連結

取得 commit／PR 資訊時更新回 issue，至少記錄：branch、commit SHA 或連結、PR 連結、主要變更、相關測試、部署／migration 注意事項。commit 與 PR 標題盡量包含 Linear issue ID（如 `SEN-83`）。

### 11. Session 結束前完整同步

每次 session 結束前對本次處理的所有 issue 做一次同步：更新狀態、寫入完成內容／主要檔案模組／測試結果／commit 或 PR／剩餘工作／阻擋事項；建立所有需後續追蹤的衍生 issue 並確認關係正確；確認沒有待辦只存在於本次 session；確認已完成 issue 符合驗收條件後才關閉。工作未完者，留言須足以讓全新 session 不依賴本次對話即可接手。

### 12. 決策與設計留檔

所有設計（架構方案、安全機制、方案評估）與重大架構／安全決策，以 issue 形式留檔（決策類用「決策：…」標題，含決策理由與否決方案），不得只留在對話或 commit。

### 13. 每次 session 起始自動爬取

session 開始時自動 `list_issues` 爬取 `Messenger iOS` / `Messenger iOS Web` 現況，比對 repo 實際狀態，處理可處理項目，發現 issue 與現況不符時主動更新。

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
