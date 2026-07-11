# docs/claude/ 維護協議

> 產出於 2026-07-03（SEN-153）。本協議自身屬「動前先問」級。

## 1. 權限分級

**弱模型 session 可自行修改（改完在 commit message 註明）**：
- `diagnostics.md` 附錄「踩雷記錄」：只准**追加**，不准改寫正文。
- `project-knowledge.md`：可更新現況段（§6-§9），**每項更新必須附程式碼／指令證據**；§1-§5 架構事實變更需同時附出處行號。
- `prompt-templates.md`：可新增範本；修改既有範本需在該範本頂端註記日期與原因。
- `letter-to-future-sessions.md`：可更新「低信心清單」與「未完成交接」段。

**動前先問使用者（或建 Linear「決策：…」issue 等拍板）**：
- `CLAUDE.md` 本體（任何修改）。
- `judgment-rubrics.md` §3 安全紅線（增删改皆是）。
- `model-dispatch.md` §4 調度表**原則**與升降級規則（新增一列不需問）。注意：§0 查證值的更新走本檔 §4 過期偵測例外——**以 harness 為準直接更新、不需問**，此處「先問」不含它。
- 本檔。

## 2. 踩雷記錄格式（寫入 `diagnostics.md` 附錄）

```
- 【日期】【模型】情境：… ／ 錯誤行為：… ／ 正確做法：… ／ 建議固化到：【rubric 條號或「僅記錄」】
```
一行寫完，不展開。判斷「這值得記嗎」：**同類錯誤可能再犯**才記；一次性手滑不記。

## 3. 精簡閾值

- 單檔 >300 行，或踩雷記錄 >15 條 → 當班 session 負責歸納：可固化的併入 rubric／正文，其餘刪除，並在 commit message 說明。
- `CLAUDE.md` 本體恆 ≤220 行（2026-07-11 依使用者指示加入 Project Identity／Architecture／Status／Decision Log 等章節後自 150 調升）；超過就把內容抽到 `docs/claude/project-knowledge.md` 或 `docs/`，本體只留摘要與索引。

## 4. 過期偵測

- `model-dispatch.md` §0 的模型 ID 若與當前 harness 環境資訊不符（session 環境說明會列出實際模型），**以 harness 為準**，並更新 §0（此項屬可自行修改的例外：更新查證值本身不需問，改調度「原則」才要問）。
- 每次修改本目錄任一檔，檢查 `CLAUDE.md` 索引段是否仍正確。
