# 判斷外化：rubric 與 checklist

> 讀者：弱模型 session。每條 rubric 附判準、一正例、一反例。正反例皆取自本 repo 真實事件（Linear 可查證）。
> 產出於 2026-07-03（SEN-153）。安全紅線（§3）修改前必須問使用者，其餘條文維護規則見 `maintenance.md`。

## §1 何時升級模型（或由主線親自做）

**判準**（任一成立即升級）：
- 涉及 §3 安全紅線的設計或修改。
- 同一子任務依 `model-dispatch.md` §4 的錯誤次數已達升級門檻。
- 需要在 ≥2 個互斥方案間做**不可逆**選擇（架構、schema、協議）。
- 任務描述本身矛盾或缺關鍵資訊，且推不出來——先升級「判斷要不要問使用者」，而不是硬做。

✅ 正例：cache-first 秒開評估——涉及刪除語意（安全紅線），由高階判斷得出 UNSAFE 結論並留決策紀錄（SEN-82）。
❌ 反例：為了「快點修好」讓 haiku 直接改 WS 重連邏輯（踢線語意屬紅線）——省小錢賠大錢。

## §2 何時算「真的完成」

四階段：**Implemented →（合併）Integrated →（實機驗證）Verified →（驗收核對）Done**。
- 程式碼合併＝只到 Integrated；Linear 狀態「待審查」。
- 凡功能在旗標後面（`UseNativeCalls`／`UseNativeAccountSocket`／`UseNativeMediaDownload`／`UseNativeLocalCache`——**皆預設關**）：實機開旗標驗證通過前，**永遠不是完成**。
- 關 issue 前逐項核對：入口可用、串接完成、測試通過、錯誤路徑處理、權限與安全條件、驗收條件逐項、部署／migration、README 是否需同步（CLAUDE.md §8）。

✅ 正例：SEN-79/81/82 程式碼全數合併，仍停「待審查」並寫明「Integrated 待 Verified（實機）」。
❌ 反例：「程式碼看起來已存在」就把 issue 標已完成——被 CLAUDE.md §8 明文禁止。

## §3 安全紅線：停下來問使用者（不問就動＝違規）

以下任一項，**不得自行決定**，建 Linear「決策：…」issue 或直接問：
1. 任何**明文**敏感資料落地（訊息、金鑰、聯絡人）——本 repo 原則是密文-only。
2. **降低 Keychain 保護等級**（如 `whenUnlockedThisDeviceOnly` → `afterFirstUnlock`）。
3. 改變**單裝置／踢線語意**（新登入踢舊、force-logout）。
4. 觸碰**刪除語意**（`deletion_cursors`、hard DELETE、快取回灌風險）。
5. 改動**加密協議層**（X3DH／Double Ratchet／推播預覽 ECDH 設計）或破壞既有 D1 schema。
6. 範圍外 repo 的讀寫；不可逆 git 操作（force push 到共用分支、刪 migration 檔）。

✅ 正例：P4 背景收話評估中，使用者拍板「不降 Keychain 保護」，以決策 issue 留檔（SEN-89）。
❌ 反例：為了背景解密自行把 KEK 改成 `afterFirstUnlock` 再在 PR 描述提一句——紅線行為。

## §4 方向錯的訊號（該換路，不是再試一次)

任一訊號出現 → 停手，改採「收集證據／換方案／問使用者」：
- 同一修法失敗 2 次（第 3 次重試前必須先有新資訊）。
- 修改開始**外溢**到任務範圍外的檔案才能讓方案成立。
- 方案需要**繞過**治理規則（跳過 migration、偷開旗標預設、跳過 Linear）才走得通。
- 還在「猜」根因——缺關鍵證據（log、重現步驟）卻持續改碼。

✅ 正例：SEN-83 掛斷 bug 根因未明（訊號層 vs UI 層），不猜——先合併診斷 log（PR #112），停在「等實機 log」。
❌ 反例：沒有對端 log 就連改三版 `dismissCallUI` 守衛「碰運氣」。

## §5 品質底線 checklist（每次合併前過一遍）

- [ ] 資料表異動走 `data-worker/migrations/`（禁止程式內 `CREATE TABLE IF NOT EXISTS` 建新表）
- [ ] 功能性改動已檢查 `README.md` 是否需同步（同 commit/PR 內）
- [ ] 新功能旗標**預設關**
- [ ] 本地只落**密文**；登出／踢線清除路徑有覆蓋新增的儲存
- [ ] web 版未被 iOS 例外污染（`isNativeApp()` 守衛齊全；App Clip 不套用完整 App 例外）
- [ ] commit／PR 標題含 Linear issue ID（如 `SEN-83`）
- [ ] Linear 已寫驗收三欄：已執行／未執行＋原因／需實機
