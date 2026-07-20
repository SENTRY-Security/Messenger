# CLAUDE.md

## Project Identity

- **專案**：SENTRY Messenger — 零持久化、密文-only 的 E2EE 即時通訊產品。
- **Repository**：`SENTRY-Security/Messenger`（GitHub）。
- **所屬產品**：SENTRY Messenger（Linear Initiative 同名）；與 NEXUS／FORGE 為獨立產品線，僅共用 Claude Code × Linear 治理制度。
- **組成**：`web/`（SPA，Cloudflare Pages）＋ `data-worker/`（Cloudflare Worker：D1/KV/DO/R2）＋ `ios/`（完整 App／App Clip／NSE 三 target，WKWebView 殼層）。
- **成熟度**：pre-release（`package.json` 0.2.0；README 標 0.1.9，版本標示不一致→待確認）。**push main 即自動部署 prod**（`deploy.yml`）。
- **主要使用者**：待確認（repo 未明載）。

## Product Context

瀏覽器即用（也可經 NFC 卡片喚起 App Clip）的安全通訊：本地零持久化、伺服器只存密文、單裝置強制、NFC 硬體＋OPAQUE 認證。明確邊界：不做多裝置同步、不做伺服器可讀訊息、加密失敗不 fallback（fail-closed）。權限、安全、稽核與可逆性優先於操作便利；高風險選擇先建「決策：…」issue 供審查（治理 §7／§12）。

## 語言

- 一律使用繁體中文回覆，包含說明、commit message 摘要、錯誤訊息解釋等。
- 程式碼中的註解與變數名稱維持英文。

## 系統前提

- **單裝置架構**：每個帳號固定一個 deviceId，不支援多裝置、不支援多裝置同時登入。
- **新登入踢舊連線**：同一帳號的新登入階段（session）會踢掉舊的登入階段，確保同時只有一個活躍連線。

## AI 治理檔案索引（docs/claude/）

> 規範優先序：**本檔（CLAUDE.md）＞ `docs/claude/*`**。
> 舊 `AGENTS.md`／`SKILL.md`（messages-flow 重構時代規範）已於 2026-07-04 經使用者拍板**廢除刪檔**；歷史文件或舊分支若仍引用它們，一律改以本檔與 `docs/claude/*` 為準。

- `docs/claude/diagnostics.md` — 本 harness 三大失效模式與修法＋踩雷記錄。**每個 session 起手先讀**。
- `docs/claude/project-knowledge.md` — 架構／API／資料層／CI／旗標／技術債現況細節（本檔各摘要段的完整版）。改碼前讀。
- `docs/claude/model-dispatch.md` — 模型調度守則（派 subagent、model/effort 實際值、升降級、驗證不自驗）。派工前讀。
- `docs/claude/judgment-rubrics.md` — 判斷 rubric：何時升級／何時算完成／**安全紅線（§3，動紅線前必問使用者）**／方向錯訊號／合併前 checklist。
- `docs/claude/prompt-templates.md` — 交辦 subagent 的填空範本（搜尋／實作／重構／研究／審查）。
- `docs/claude/maintenance.md` — 上述檔案的修改權限與精簡規則。
- `docs/claude/letter-to-future-sessions.md` — 交接信：制度退化風險與低信心產出清單。

## Current Architecture（摘要，詳見 project-knowledge.md）

- **後端**：單一 Cloudflare Worker（`data-worker/src/worker.js`）；D1（23 個 migrations）、KV `AUTH_KV`、DO（`AccountWebSocket` 含單裝置踢線 `account-ws.js:236-245`、`RateLimiter`、`BrowserSession`）、R2 `message-media`（S3 API，媒體密文）。
- **認證**：NTAG424 NFC SDM ＋ OPAQUE。**E2EE**：X3DH + Double Ratchet（`web/src/shared/crypto/dr.js`，禁 fallback）；媒體分塊 AES-256-GCM 簽名直傳 R2。
- **前端**：esbuild SPA；`web/src/app/{api,core,crypto,features,ui}` ＋ `web/src/shared/`（真加密實作所在）。
- **iOS**：WKWebView 殼＋原生增強（通話 CallKit+WebRTC、帳號 WS、背景下載、加密快取、NSE 推播預覽），5 個旗標**全部預設關**（`Info.plist:62-103`）。

## Repository Map

- `data-worker/` — 後端 Worker＋`migrations/`（資料表異動唯一入口）
- `web/src/app/` — 前端應用（`features/messages-flow/` 頂層含孤兒 stub，勿接線，見 project-knowledge §8）
- `web/src/shared/crypto/` — E2EE 實作（安全紅線區）
- `ios/SentryMessenger{,Clip,Notify}/` — 三個 iOS target；`ios/docs/` 遷移計畫
- `docs/` — messages-flow 規格、security 文件（17 檔）、internal/business-conversation 草案
- `docs/claude/` — AI 治理檔；`outputs/` — session 交接產物
- `plan*.md` — 歷史 plan（已完成或過時，非待辦，見 project-knowledge §9）

## Development Commands（已驗證存在）

- **web build**：`cd web && npm run build`（=`node build.mjs`）；`npm run verify`（建置完整性）；`npm run preview`（wrangler pages dev）
- **部署**：root `npm run deploy:uat` / `deploy:prod`（wrangler）；正式部署走 CI（main→prod、其他分支→UAT）
- **migration**：新增 SQL 檔到 `data-worker/migrations/`，CI `wrangler d1 migrations apply --remote` 自動套用
- **iOS**：`cd ios && xcodegen generate` → xcodebuild（同 `ios.yml`）
- **不存在**：`npm test`／lint／typecheck script——全 repo 無自動化測試（見 project-knowledge §7），不得宣稱「測試通過」

## Current Status（同步於 2026-07-11）

- **已完成（Verified）**：原生通話 P0–P3（SEN-78）、NSE 推播預覽（SEN-80）、App Clip NFC（SEN-88）、web 原生模式整合（SEN-91）。
- **待實機驗證（待審查）**：原生帳號 WS（SEN-79）、背景媒體下載（SEN-81）、加密本地快取（SEN-82）——旗標全關，開旗標實機驗證前不得關閉。
- **進行中**：SEN-83 掛斷未同步（Urgent，等未掛斷端 log）、SEN-86 face-blur 微調（等實機回饋）。
- **暫緩**：SEN-87 內嵌 web bundle（CORS 未解，Low）。
- **技術債／風險**：messages-flow 孤兒 stub、無自動化測試安全網＋main 即 prod、文件落差（README 版本、PLAN-css-split、app-secure-session-plan）——皆已建 Linear issue 追蹤。

## Decision Log（有效決策索引；正文在 Linear 決策 issue）

- **ADR-001** 導入 Claude Code × Linear 治理 13 條 — SEN-137（PR #113/#114）。
- **ADR-002** P4 背景/VoIP 不降 Keychain 保護（維持 `whenUnlockedThisDeviceOnly`）— SEN-89（#98）。
- **ADR-003** cache-first 秒開判 UNSAFE 不做（刪除語意會回灌已刪訊息）；維持 network-first — SEN-82（#101/#102）。
- **ADR-004** 帳號 WS 採 Option B 原生全接管（單裝置唯一連線）— SEN-79（#95/#96）。
- **ADR-005** 廢除舊 AGENTS.md/SKILL.md，硬規則併入 judgment-rubrics §3 — SEN-153（`65fd68b`）。

## Linear Synchronization

- Workspace：`sentry-cybersecurity`；Team：`SENTRY 核心團隊`（`SEN`）；Initiative：`SENTRY Messenger`。
- Projects：`Messenger iOS`（`ba80ded1-…`）＝App＋App Clip＋後端對應功能；`Messenger iOS Web`（`4da496b8-…`）＝web/PWA。
- 本次知識同步：**2026-07-11**（branch `claude/linear-backlog-sync-98a7u1`）。同步原則＝下方治理 13 條；不在本檔累積流水帳。

## Agent Operating Instructions（補充守則）

- 修改前先讀 `docs/claude/project-knowledge.md` 與相關模組，理解現有實作後才動手；不得捏造需求。
- **不得因 Linear 沒有 issue 就假定工作不存在**——以 repo 證據為準，發現未建檔工作依治理 §6 補建。
- **不得因 Linear issue 標「已完成」就假定程式碼正確**——驗證一律回到 repo 與可執行證據。
- 新功能先判定是既有能力的延伸還是新能力；重大架構／安全決策發生時，同步更新本檔 Decision Log ＋ Linear 決策 issue。
- 本檔不記短期瑣事；Current Status 只在知識同步時整批更新。

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

**Assignee 為必填**：建立 issue 時不得留空。開發類型（Engineering／程式碼相關）一律指派給**目前 Linear MCP 的登入身分**（`save_issue` 帶 `assignee: "me"`）；非開發類需明確指定實際負責人。發現既有開發 issue 缺 assignee 時，依 §13 主動補上。

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

> 以下僅適用於 iOS 原生 App（以 `isNativeApp()` / bundle 守衛），純 web 版維持上述「本地零持久化／背景登出」原則不變。詳見 `ios/docs/app-secure-session-plan.md`（注意：該檔自述狀態落後於程式碼，以 repo 為準，見 project-knowledge §8）。

- **保持登入**：iOS App **不做背景計時自動登出**，使用者切背景/鎖屏後仍保持登入。
- **他處登入仍踢線**：單裝置原則不變——他處登入仍會 force-logout 踢掉本機（不在此例外範圍）。
- **金鑰不落地、每次重取**：MK 僅存記憶體；每次開啟以 `account_token` 向 `POST /api/v1/mk/fetch` 重新拉取 `wrapped_mk`（密文），於記憶體解封，不持久化明文金鑰。
- **iOS 安全儲存**：解封用 KEK 與 `account_token` 存於 **Keychain**（`biometryCurrentSet` + `whenUnlockedThisDeviceOnly`，FaceID/Secure Enclave 綁定）；拉取資料以密文落地（Data Protection `.completeFileProtection`）。
- **FaceID 解鎖**：使用者可於設定啟用；啟用後冷啟動與回前景需 FaceID，失敗則鎖定可重試、不登出。
- **原生加密本地快取（旗標 `UseNativeLocalCache`，預設關）**：完整 App 可將**後端回傳的密文**快取於原生 Data Protection 儲存（`.completeFileProtection`），供離線讀取／加速啟動。**僅密文落地、明文一律不持久化**（解密仍在記憶體），**登出時清除**。屬「本地零持久化」之窄範圍 iOS 例外（同 secure-session 例外精神）；純 web／App Clip 不適用。詳見 `ios/docs/native-webrtc-migration-plan.md` 之 Tier 評估與 `ios/README.md`。
