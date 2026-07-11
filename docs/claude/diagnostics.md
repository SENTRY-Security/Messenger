# 快速診斷：本 harness 三大失效模式與修法

> 讀者：未來所有 Claude session（含 Sonnet/Haiku 等級）。每條附「可直接照做」的修法。
> 產出於 2026-07-03（claude-fable-5 session，SEN-153）。維護規則見 `maintenance.md`。

## 1. Token 洩漏：主線直接讀大檔、全量拉 Linear

**症狀**：`web/src/` 下有近兩千行的大檔（如 `web/src/app/ui/mobile/call-overlay.js`，1999 行）；`mcp__Linear__list_issues` 不帶過濾會回整個 team 的肥 payload；主線自己掃 repo 把 context 塞爆，後半 session 品質下降。

**修法（照做）**：
- 讀碼一律 **先 Grep 定位行號，再 Read 帶 `offset`/`limit`（單次 ≤150 行）**。禁止對 >500 行的檔案做整檔 Read。
- 需要跨 **3 個以上檔案**的搜索／盤點 → 派 `Explore` subagent，只回「結論＋`檔案:行號`」。
- Linear 查詢一律帶 `project` ＋ `limit`（≤50）。session 起手爬一次後，**把結論記在對話裡不重查**；要更新才用 `get_issue` 單抓。

## 2. 失焦：驗證幻覺（CI 只能編譯，實機行為不可代驗）

**症狀**：模型宣稱「測試通過／功能正常」但其實只有編譯過；或試圖在雲端容器裡「驗證」iOS 推播、通話、背景下載而空轉燒 token；或因「程式碼看起來對」就關 Linear issue。

**修法（照做）**：
- 本 repo 的 CI **只能證明編譯通過**。凡涉及：通話、推播、背景下載、WS 重連、Keychain、FaceID、快取清除——**一律標「需使用者實機驗證」**，issue 停在「待審查」，不得關閉（CLAUDE.md §8）。
- 完成回報固定三欄：**已執行的驗證／未執行＋原因／需使用者實機的項目**（CLAUDE.md §9）。缺一欄就是沒寫完。
- 想驗證卡住超過 2 次嘗試 → 停止，改為「加診斷 log ＋ 留 issue 等實機證據」（範例：SEN-83 掛斷 bug 的處理方式）。

## 3. 出錯：多份 AI 規範衝突＋治理步驟漏做

**症狀**：歷史上 repo 根目錄曾存在 `AGENTS.md`、`SKILL.md`（舊 messages-flow 重構時代寫給 Codex 的規範，含與現況矛盾的敘述，如「不依賴測試自動化」），弱模型撞到會隨機採信。**已於 2026-07-04 經使用者拍板廢除刪檔**。另一常見錯誤：跳過 Linear 治理步驟直接改碼。

**修法（照做）**：
- **優先序：`CLAUDE.md` ＞ `docs/claude/*`**。舊分支、git 歷史或既有文件（如 `plan.ephemeral-e2ee.md`）若引用 `AGENTS.md`/`SKILL.md`，其規範內容一律不再遵循；其中仍然成立的硬規則（不破壞 schema、不動加密協議）已收進 `judgment-rubrics.md` §3 安全紅線。
- session 起手固定順序（缺步即補）：
  1. `list_issues`（Messenger iOS / Messenger iOS Web，帶 project 過濾）比對現況（§13）
  2. 動工前搜尋既有 issue，禁重複建檔（§2）
  3. 改碼前 `save_issue` 設進行中＋寫執行計畫（§5）
  4. 結束前同步：狀態＋驗收三欄＋commit/PR 連結（§9/§10/§11）
- 判斷不了「該不該做」時，查 `judgment-rubrics.md`；判斷不了「派誰做」時，查 `model-dispatch.md`。

## 附錄：踩雷記錄

> 格式與寫入規則見 `maintenance.md`。新記錄往下加，滿 15 條由當班 session 歸納進上方正文或 rubric 後清空。

- 【2026-07-11】【fable】情境：知識同步爬 Linear ／ 錯誤行為：（他方自動化）SEN-83 描述被郵件摘要文字整段覆寫，技術脈絡遺失 5 天無人察覺 ／ 正確做法：起手爬取時比對 issue 描述與已知脈絡，發現被覆寫立即依留言/git 證據復原並註記 ／ 建議固化到：僅記錄（若再犯考慮寫入 rubric §5）
