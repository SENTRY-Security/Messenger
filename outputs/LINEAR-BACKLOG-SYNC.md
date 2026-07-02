# Linear Backlog Sync — 待辦交接（給下一個 Session）

> 用途：本 session（2026-07-02）建立 CLAUDE.md「Linear 開發治理規範（13 條）」並完成本輪原生遷移的 Linear 建檔，但 **session 後段 Linear MCP 斷線**，尚有 issue 回填未完成。此文件讓**全新 session 不依賴當時對話**即可接手。
>
> 依 `CLAUDE.md`「§11 Session 結束前完整同步」：待辦不得只留在對話，故落成此檔。**待辦本體仍以 Linear 為唯一真相來源**——本檔僅為交接索引，完成後即可刪除或標記 done。

## 0. 先決條件（阻擋中）

- ⚠️ **Linear MCP 需重新授權**才能操作（`mcp__Linear__*`）。非交互環境無法跑 OAuth。
- 新 session 起手先確認 Linear 工具可用：`ToolSearch "select:mcp__Linear__list_issues,mcp__Linear__save_issue,mcp__Linear__save_comment,mcp__Linear__get_issue"`。搜不到 → 請使用者到 claude.ai 連接器設定 / `claude mcp` 重新授權 Linear，再繼續。

## 1. Linear 座標（實際值）

- **Team**：`SENTRY 核心團隊`（issue 前綴 `SEN`，id `fbebc7ee-da86-4276-8f8e-3f26d53bb9b3`）
- **Initiative**：`SENTRY Messenger`
- **Projects**：
  - `Messenger iOS`（id `ba80ded1-8f7e-4acc-a1c8-e87bc3a08a96`）— 完整 App + App Clip + 後端對應功能
  - `Messenger iOS Web`（id `4da496b8-12f6-4de2-a24c-1ca609ddf39c`）— web（iOS Safari／PWA）
- **常用 label**：`Engineering`、`類型／功能`、`類型／錯誤`、`類型／決策`、`範圍／前端`、`Security Critical`

## 2. 本輪已建檔 issue（現況快照）

| Issue | 標題 | 狀態 | 備註 |
|---|---|---|---|
| SEN-78 | 原生 WebRTC 通話 P0–P3（UseNativeCalls） | 已完成 | 實機雙機驗證通過 |
| SEN-79 | 原生帳號 WS（Option B, UseNativeAccountSocket） | 待審查 | 程式已合併，待開旗標實機驗證 |
| SEN-80 | Tier 1 NSE 原生解密推播預覽 | 已完成 | |
| SEN-81 | Tier 2 背景媒體下載（URLSession background） | 待審查 | 待開旗標實機驗證 |
| SEN-82 | Tier 3 原生加密本地快取（UseNativeLocalCache） | 待審查 | 含 cache-first UNSAFE 決策；待驗證 |
| SEN-83 | Bug：原生視訊掛斷未同步到對端 | 進行中 | 等未掛斷端 `[NativeCall]` log |
| SEN-86 | 原生視訊 face-blur v1 微調 | 進行中 | 等實機 orientation/mirroring/scale 回饋 |
| SEN-87 | 內嵌 Web Bundle（CORS 未解） | 待辦 | Low，暫緩理由已寫明 |
| SEN-88 | App Clip NFC 入口與完整化 | 已完成 | |
| SEN-89 | 決策：P4 不降 Keychain 保護 | 已完成 | |
| SEN-91 | Web 端原生模式整合（getUserMedia 閘門／WS 介接） | 已完成 | project = Messenger iOS Web |

> 注意：以上 id 依當時建立為準；接手時務必先 `list_issues` / `get_issue` 核對現況（可能已被他人更新），**禁止重複建檔**（CLAUDE.md §2）。

## 3. 待補的 Linear 同步工作（本 session 未完成）

### 3.1 回填驗收紀錄 + commit/PR 連結（CLAUDE.md §8、§9、§10）
對三張「待審查」issue，逐一以 `save_comment` 補上具體紀錄，不得只寫「已完成」：

- **SEN-79 / SEN-81 / SEN-82** 各補：
  - 已執行的驗證（CI 僅編譯，未做實機/通話/推播/WS/快取驗證——需明確標示「未執行的測試及原因」）
  - 對應 branch、commit SHA、PR 連結（見 §4）
  - 依 `Implemented → Integrated → Verified → Done`，目前皆停在 **Integrated，待 Verified（實機）**——留言標明階段
  - 可能回歸風險、是否需部署後觀察、旗標預設值（皆預設關）

### 3.2 SEN-83（掛斷 bug）補執行計畫（CLAUDE.md §5）
- 設為進行中（已是），留言補「等未掛斷端 `[NativeCall] tearDown / dismissCallUI` log 判定訊號層 vs UI 層」的**執行計畫**與 blocked 說明，關聯 PR #112（診斷 log）。

### 3.3 新建決策 issue（CLAUDE.md §7、§12）
- 標題：**「決策：導入 Claude Code × Linear 開發治理規範」**
- Project：`Messenger iOS`（或視為 team 級；擇一並註明）
- 內容：背景（Linear 定為唯一真相來源）、選項/結論（13 條規範已上線）、關聯 **PR #114**、commit `138fe8e`
- 關係：`Related to` 上述所有 SEN-78~91（治理規範適用全體）

## 4. 相關 commit / PR（供回填）

- **PR #113**（已合併，`5d16c84`）：CLAUDE.md 加入 Linear 進度追蹤（5 條初版）
- **PR #114**（已合併，`138fe8e`）：擴充為「Linear 開發治理規範（13 條）」——**治理規範正式上線**
- 本輪原生遷移 PR：#87/#90/#91/#92/#94/#97（通話）、#95/#96（帳號 WS）、#99（Tier1）、#100（Tier2）、#101/#102（Tier3）、#103/#104（安裝/內嵌修）、#105/#107/#108/#110/#111（沒聲音/視訊修復鏈）、#112（face-blur + 掛斷診斷）
- 開發分支：`claude/qr-code-stored-value-routing-vcwnyw`

## 5. 仍需使用者決策 / 無法由 AI 代完成

1. **Linear 重新授權**（阻擋所有 issue 操作，最優先）。
2. **實機驗證**：SEN-79/81/82 從「待審查 → 已完成」需開對應旗標做實機驗證（通話音訊/視訊、推播預覽、背景 WS、加密快取）。CI 只編譯不能測，AI 無法代驗——需使用者實機執行並回報，才可依 §8 逐項核對後關閉。
3. **face-blur（SEN-86）/ 掛斷（SEN-83）** 需實機回饋（log / 視覺）才能收斂。

## 6. 完成後動作

- 依 CLAUDE.md §11 做完整同步後，本檔可刪除（`git rm outputs/LINEAR-BACKLOG-SYNC.md`）或在頂端標記 `✅ DONE` 並記錄完成 session 日期。
