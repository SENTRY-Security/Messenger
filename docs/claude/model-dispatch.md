# 模型調度守則

> 讀者：主對話（指揮官）session，任何等級模型皆適用。目標：貴模型的判斷力只花在刀口，機械工作全部下放。
> 產出於 2026-07-03（SEN-153）。

## 0. 查證後的實際值（2026-07-03 查證於 Claude Code 遠端 harness）

- 模型 ID（session 級，`/model` 切換）：`claude-fable-5`（最高階）、`claude-opus-4-8`、`claude-sonnet-5`、`claude-haiku-4-5-20251001`。
- `Agent` 工具 `model` 參數只接受：`sonnet` | `opus` | `haiku` | `fable`；**省略＝繼承主線模型**（預設建議：明確指定，避免無意間用高階模型跑雜活）。
- `Workflow` 的 `agent()` 支援 `effort`：`low` | `medium` | `high` | `xhigh` | `max`；省略＝繼承 session。機械階段用 `low`，僅最難的 verify/judge 階段升高。（**harness 相依**：`Workflow` 工具並非每個環境都暴露，使用前先確認當前 session 工具清單有它。）
- subagent 類型（`subagent_type`）：`general-purpose`（可改檔）、`Explore`（唯讀搜索）、`Plan`（唯讀規劃）。
- **未確認（不得當事實引用，待使用者至 usage 儀表板實測）**：各模型費率；Fable 訂閱制期限（傳聞 7/7 後改量計費，未查證）；被安全機制導向 Opus 的請求是否消耗 Fable 額度。

## 1. 指揮官不下場

主對話**只做**：(a) 拍板與判斷、(b) Linear／git 操作（含 session 起手爬取 CLAUDE.md §13 與結尾同步 §11）、(c) 涉及 ≤2 個檔案且 ≤50 行的小修。
以下一律派 subagent，主對話只收結論：
- 跨 ≥3 檔的讀取／掃 repo／盤點 → `Explore`（model: `haiku`；範圍複雜才 `sonnet`）
- 網頁研究、文件彙整 → `general-purpose`（model: `sonnet`）
- 批次改檔、機械性重構 → `general-purpose`（model: `sonnet`）
- 驗證與審查 → 見 §5，**必須是 fresh-context agent，不得自驗**

## 2. 任務交辦三要素（缺一不發）

1. **目標與動機**：要什麼＋為什麼（讓 subagent 能在邊界內自行取捨）。
2. **驗收條件**：可檢查的完成定義（例：「回傳每個呼叫點的 `檔案:行號`」而非「找找看」）。
3. **回報格式**：明確規定輸出形狀（見 §3）。
範本見 `prompt-templates.md`，照抄填空即可。

## 3. 回報合約

- subagent 只回：**結論＋證據（`檔案:行號`）＋未解事項**。禁止貼整段檔案內容回主線。
- 長產物（報告、大 diff 說明）寫入 `outputs/` 下的檔案，回傳路徑。
- 主對話收報告後只轉述結論給使用者，不重複執行 subagent 已做的搜索。

## 4. 調度表與升降級

| 任務型態 | model | 說明 |
|---|---|---|
| 檔案定位、grep 彙整、清單盤點 | `haiku` | 機械性，錯了便宜重跑 |
| 常規實作、修 bug、寫測試、文件 | `sonnet` | 預設工作馬 |
| 跨模組架構、安全敏感（金鑰／Keychain／刪除語意／踢線）、複雜除錯 | `opus` | 判斷密度高 |
| 新架構決策、多次卡關的難題 | 主線親自（當前最高階模型） | 稀缺額度當預算管理 |

升降級路徑：
- `haiku` 同一子任務**錯 1 次** → 升 `sonnet`。
- `sonnet` 同一子任務**連錯 2 次** → 帶完整失敗軌跡（做了什麼、輸出、為何不對）升 `opus`。
- 高階模型解出「模式」後 → 把模式寫成規則，降回 `sonnet`/`haiku` 批次套用。
- 同一件事**最多重試兩輪**；還不行改走 `judgment-rubrics.md` §4（換路或問使用者）。

安全紅線任務（見 `judgment-rubrics.md` §3）：至少 `opus` 執行，且結論需第二意見（§5）。

## 5. 驗證不自驗

- **檔案產出**：派 fresh-context agent read-back——只給檔案路徑與驗收條件，不給原始對話，回報「完整／缺漏清單」。
- **程式碼**：本 repo **沒有 `npm test` 腳本**（`package.json` scripts 僅 deploy 用）。web 改動可跑 `node web/build.mjs` 確認可編譯；iOS 實機行為（通話、推播、背景、Keychain）一律標「需使用者實機」，不得宣稱已驗證。
- **高風險判斷**：第二意見——換一個 model 或換一個提問角度再問一次；兩答不一致時主線裁決或問使用者。
- 驗證者發現問題 → 修 → **再驗**，直到乾淨；驗證通過才可在 Linear 寫驗收紀錄。
