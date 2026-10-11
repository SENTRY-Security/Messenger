# PPTX 規格回歸與合併門檻

追蹤：SEN-2597（總任務）、SEN-2598（靜態）、SEN-2599（播放）、SEN-2600（網路案例／Microsoft 驗收）、SEN-2601（Secretary 整合）。工作分支為 `sen-2597-pptx-conformance`，Messenger 起點為 `aaf5e0824c475b1c72366b213a12c89ac3ee9397`。Word 工作不在這個變更範圍。

**完整驗收尚未通過，Secretary 整合仍受阻。** 有限規格探針、載入成功、建置成功均不能替代 Microsoft 的視覺與播放驗收。

## 可重現的輸入與檢查

[測試入口](../web/tests/pptx/README.md)執行真實 viewer／geometry／charts／playback 模組；只替換外層 logging、i18n 與 UI helper，不替換 FontFace、Canvas、影片或音訊解碼。來源於執行期間改變、空 oracle、案例不符、缺少資產都使證據失效。

[網路 corpus](../web/tests/pptx/corpus/README.md)固定實際取得的公開 PPTX 之 commit、URL、SHA256、大小、頁數及授權 provenance。補充 XLSX 圖表、自行包裝的 oracle deck 和原生網路 PPTX 分別標示。工具驗證所有 ZIP member 的解壓大小與 CRC32；缺檔或錯誤不得略過。

```sh
cd web
npm run build
npm run verify
npm run test:pptx:corpus -- --cache /tmp/sentry-pptx-corpus
node tests/pptx/corpus/fetch-corpus.mjs --manifest tests/pptx/corpus/supplementary-chartml.json --cache /tmp/sentry-chartml-corpus
PPTX_CORPUS_CACHE=/tmp/sentry-pptx-corpus PPTX_CHARTML_CACHE=/tmp/sentry-chartml-corpus npm run test:pptx
```

瀏覽器檢查需要 Playwright 與 Chromium，設定方式見測試入口。原始大型檔案、產生的 PNG／音影片與外部服務 HTML 留在 cache，不提交服務 token 或暫時性存取 URL。

## 驗收證據

| 項目 | 通過條件 | 目前狀態 |
| --- | --- | --- |
| 規格 trait | 可定位的規格條款、非空預期、實際 Canvas／DOM／native media 結果 | 多批局部探針已通過；不是完整規格覆蓋 |
| 網路檔案操作 | 每頁依 presentation relationship 順序載入；桌面及手機無例外、缺頁、資產失敗 | 2026-10-11 04:31 UTC 快照：57 文件／235 頁、114 情境；470 頁畫布全部產生，98 操作通過、16 個未驗證效果／向量圖／相容性門檻失敗；無 JavaScript 例外 |
| Microsoft 靜態 | 相同 pinned PPTX 的真實 Microsoft 頁面、內容身分、頁序、尺寸與 PNG provenance，再比較 candidate | 已取得部分真參考；三份原生 ChartEx、文字及背景頁仍有差異 |
| 動畫與轉場 | 真實 click／automatic sequence、逐字／段落／圖形目標及每個可比時點符合 Microsoft | 尚未通過；部分時間線與 reference 缺口保留 |
| 音訊與影片 | 真 codec 解碼、trim、volume、bookmark、跨頁與 cleanup；可比較的 Microsoft 波形／畫面／時序 | 真 WAV 解碼與進度已觀察，完整比較尚缺 |
| Secretary 整合 | 前述驗收通過、獨立 code review 與隔離整合回歸 | 尚未開始合併 |

01:15 UTC 新快照（443 個來源檔）完成 30 suites／524 個局部檢查，無 trait mismatch、來源異動或空 oracle；完整狀態仍為 `unverified`。建置的 168 file hashes／60 SRI 均通過。55 文件的 110 組桌面／手機測試仍為 106 操作通過、4 組 WMF／EMF 明確失敗，但該版本已實際畫出相關 48／48 與 1／1 頁，未驗證的向量筆刷、字型與精確像素仍保留診斷。22 份真實簡報／164 頁的播放檢查另有動畫濾鏡、變色、時間線及外部媒體來源缺失，不能算作通過。

後續 01:20 UTC 隔離快照驗證 150 個播放 trait、9 個 placeholder trait 與 6 個取消／錯誤傳遞探針全部符合各自預期，包含真正 viewer 入口的 Canvas 故障及可見失敗提示。這些結果不代替 Microsoft 播放基準。

原生網路輸入目前擴至 **57 文件／235 頁／7 個公開 repository**，新增 PowerPoint COM 作者來源的 17 頁 3D 圖表與 1 頁媒體書籤觸發案例；SHA、ZIP CRC、頁數、授權及作者／嵌入影音來源紀錄均保留。新增檔案另行回歸，不能混入先前 55 份的已完成測試數字。

04:31:52 UTC 隔離快照（450 個檔案）已實測上述 57 份全部桌面／手機情境。新出現的明確失敗包含原先沒有揭露的文字 run 效果與 ChartEx fallback，不能刪除診斷來恢復舊的「操作通過」數字。23 份含播放設定的原生簡報另觀察 138 頁；keyframes 第 2 頁的轉場／準備期間仍同時顯示舊頁，該次回歸提前中斷，不能聲稱已觀察該文件所有頁面。

04:42:56 UTC 隔離快照（455 個檔案）驗證 7 suites／353 個局部檢查，所有非空 trait 符合預期；部分 suite 明確回傳 `unverified`。包含 196 個播放、21 個真 viewer 入口（含原生書籤）、108 個圖表、9 個地圖，以及 7 個原始書籤輸入／原生影片時鐘探針。`mc:Choice Requires="p14"` 原先被切到沒有書籤觸發的 fallback，已修正為依實作能力選擇；真影片在 BM1 500ms 觸發 shape 3 淡入，保留實際事件與媒體時鐘。影片有播放不能替代 Microsoft 書籤時序驗收。

原生 SDK ChartEx 的真 viewer 解析結果現在必須包含實際 `chart` 與 mark 證據，不能拿嵌入預覽圖片當新 renderer 的驗收。相同 Microsoft 靜態參考、720×405、零 RGBA 容差：Waterfall 有 35,229 個不同像素；Sunburst 由 43,340 經排序、布局及標題修正降至 10,809；新取得的 Box & Whisker 有 27,949。三者仍是失敗。Waterfall 的實際 PowerPoint Download 另核對為原始 58,675 bytes、SHA256 `563b633c6a696faa6efe058b15a6bd6f3fa955c2286e4fe0160ef8a7e998e976`，不能把版面差異推定為下載檔被改寫。

04:52:28 UTC 隔離快照驗證 9 suites／384 個局部檢查符合各自預期，包含播放 prepare／start 與原生書籤入口；完整狀態仍為未驗收。04:58:14 UTC 快照的 113 個圖表 trait 符合預期，4 份原始 PPTX 的真 ChartEx pipeline 分別產生 Waterfall 8、Box 9、Sunburst 25、Funnel 4 個 mark，沒有備援診斷或例外。Box 的原生軸線／標題修正將相同 Microsoft baseline 的差異降至 25,982 像素，Sunburst 仍為 10,809；均未通過。

05:00:44 UTC 快照建置與驗證通過 168 file hashes／60 SRI；204 個播放 trait、3 個原生轉場取消探針符合預期，保留前版取消／dispose 後晚啟動 WAAPI 的兩個失敗。13 個原始 drawing effect owner 中，12 個形狀效果在四種尺寸／旋轉／非等比群組條件下，整體與播放圖層重組 RGBA 差異均為零；文字 default reflection 仍保留 typed UNVERIFIED，僅「不默默略過」的負向診斷符合預期。漸層另外保留 1 個通道的原生 Canvas 裁切相位差異，精確門檻不放寬。延遲 WAV 關閉的 URL 清理符合預期，但舊 layer host 移除失敗另有修正及待回歸版本，不計為整組通過。

隔離的 PulseAudio monitor 已取得原始 EmbeddedAudio 案例經實際 viewer 控制播放的 48kHz／雙聲道原生輸出，RMS 0.06153558、peak 0.40579224，清理後媒體與未釋放 URL 均為零。這是實際輸出取證，不是抽出原始音檔作為播放基準。Microsoft 的同檔實際輸出與事件時序仍待比對；EmbeddedVideo 自帶的 AAC 幾乎靜音（原檔平均約 −91dB），微量非零樣本不能當作已驗收可聽見聲音。

後續已用 Microsoft 公開 viewer 的原生 audio control、正常 Space 鍵啟動同一原始 EmbeddedAudio，記錄 3.195646 秒真媒體時鐘、音量 0.8 與 48kHz／雙聲道 loopback。兩邊保留原始錄音；不重採樣、不正規化或改音量，僅以整數相關偏移作診斷對齊：相關係數 0.99961817、有效樣本 RMS 差異 0.00188812，303,992 個通道樣本仍不同。這不構成 authored 開始時序、trim、fade 或跨頁驗收，不算完整音訊通過。

05:03:08 UTC 快照的完整 37 suites／689 traits 回歸有 1 個原生 chart-slide-bg 案例失敗，其餘符合各自預期；真正空 `a:effectLst` 的效果繼承清除與 callback 需求正另行修正，不能刪除來源案例。原生播放入口 30 個案例含慢 WAV 關閉及原始書籤均符合預期。新 full-corpus 靜態結果是 100 操作通過／14 明確門檻失敗，114 情境、470 畫布、零 JavaScript 例外。

播放 corpus 工具另揭露自身初始化競態：原靜態標籤為「N 投影片」，Play 尚在非同步準備時解析成非頁碼後誤按 Next，造成 5 份文件跳過起始頁。這批僅觀察 80 頁，不能替換舊的 138 頁為覆蓋完成。修正只等待公開 DOM 的真頁碼、唯一可見頁與頁面本身轉場結束；不停止子圖形動畫、自動換頁或媒體時鐘，須新快照重跑。

05:08:30 UTC 快照已重跑全部 23 份播放文件／165 頁，零 JavaScript 例外、來源異動為零，仍是 FAIL。保留的條目包含 64 頁未取得 Microsoft speed／duration 對應、46 個 additive 行為、外部本機音影片來源缺失、AnimationRewind 的 repeat／autoReverse／relative scale，以及 6 個尚未支援濾鏡和 4 個連續公式取樣條目。起始頁競態已消除，覆蓋完成不代表時序／影音驗收通過。

05:11:38 UTC 快照新增實際文字 run 的外陰影／光暈／內陰影初步路徑，以及原生圖表 primitive 效果；尚未縮小未驗收診斷。12 suites 定向回歸中，既有文字／字形／形狀、入口關閉及原始書籤條目符合預期；新 120 個 chart traits 有 3 個 callback 條目失敗，4 個 chart effect 情境有 2 個矩陣條目失敗，均保留原輸出並繼續修正。該快照建置 168 hashes／60 SRI 驗證通過。這是可推送的進度快照，不能合併 main 或 Secretary。

05:27:33 UTC 快照的 6 suites／396 個檢查保留 6 個失敗：3 個圖表 callback、2 個群組／裁切 CTM，以及 1 個新 additive X/Y 動畫數量探針。最後一項尚未證明實際位置錯誤，需以非零雙軸起點、中點及終點區分播放與探針問題。新增原生 Box category gap 的兩個 trait 符合預期；相同原檔、相同 720×405 Microsoft baseline、零 RGBA 容差，像素差異由 25,938 降至 18,732，仍為 FAIL。獨立原生 Canvas 對照確認圖表移除／重套 affine frame 的多次量化造成 CTM 差異，不採放寬精度處理。

05:44:27 UTC 快照完成 43 suites／762 個局部檢查，來源未異動。圖表 124 項與 4 個效果情境符合預期，效果回呼使用原始 CTM 與明確裁切原點，六個係數及來源圖層 RGBA 與獨立原生對照一致；播放 226 項包含非零雙軸位置、持續 hold 與多 owner 清理，來源 46 個節點的原始 XML／SHA／CRC 另逐項核對。段尾格式的 8 個獨立對照符合預期，底線效果例外已修正。建置 168 hashes／60 SRI 通過。

該次完整局部回歸仍為 FAIL：新文字 owner 12 項有 10 個失敗、native reference 12 項有 11 個失敗、非預設文字 context 4 項與寬描邊 3 項失敗，共 28 個。有些為實際圖層裁切／合成差異，有些參照的 native CTM 相位及多階段 alpha 合成仍待獨立釐清；不得把所有失敗直接歸因於產品，也不得更換寬鬆門檻消除。原始失敗快照保留，後續修正須以新來源重跑。這批可作進度推送，完整 Microsoft 驗收仍未通過。

Mac 收集流程、唯讀 preflight、原始頁面計畫及 PNG 匯入校驗已備妥，見 [Mac README](../web/tests/pptx/mac/README.md)。20 個 guard assertions 在 Linux 使用真 pinned PPTX 通過，Linux preflight 如實回報 unavailable；沒有 Mac 原生收集或播放證據。原始 customGeo 第 6／18 頁另已透過公開控制取得 Microsoft 與候選原生畫面，保留真頁碼、逐帧 SHA 及擷取時間區間；Writing 段落終點邊界一致，字型像素與 callout 裁切仍有差異，不算整份簡報或完整時序通過。

PowerPoint for Mac 也可作為 Microsoft 原生桌面比對基準；先前收集環境限定 Windows 只是現有 COM 程式的限制。Mac／Windows 基準須各自記錄 PowerPoint 版本、作業系統、字型、顯示尺寸及媒體支援，不假定兩者完全相同。使用者將稍後提供 Mac 環境，目前尚無 Mac 執行證據。

已準備[真 Windows PowerPoint 靜態基準收集器](../web/tests/pptx/windows/Collect-PowerPointStatic.ps1)及[桌面播放／音訊取證契約](../web/tests/pptx/windows/desktop-baseline-contract.txt)。收集器驗證 pinned SHA／全 ZIP CRC、原始頁序與 COM SlideID，記錄 Office 版本並直接 Export PNG；目前 Linux 環境沒有執行 Windows COM。靜態 Export 不執行動畫、轉場或影音，桌面畫面與實際系統音訊仍須另外取得。[Microsoft 的 Mac 匯出說明](https://support.microsoft.com/en-us/powerpoint/export-your-powerpoint-for-mac-presentation-as-a-different-file-format)指出影片匯出可能不播放其他內嵌媒體，因此匯出影片不能代替完整的真放映取證。網頁版與桌面版不能互相假定完整功能相同；未觀察到書籤效果不等於證實桌面版沒有該效果。

Microsoft 參考必須來自 PowerPoint 的實際 rendering，不能以 LibreOffice、另一個 JS viewer、SDK 範例 XML 或 model 數值作替代。Office Online 的 bootstrap 回應也不能當作渲染成功。服務無法開啟檔案、網路失敗和 viewer 本身不符分別保留紀錄；參考不可取得時狀態維持未驗收。

01:04 快照在獨立 worktree 以 434 個來源／測試／資產檔的複製前後 SHA 確认，再執行建置與驗證（168 file hashes、60 SRI 都通過）。它保留原 clone HEAD，未提交的程式由來源 SHA 定位，不能代表後來的工作目錄修改。該版本 viewer SHA 為 `e0b29f26967cacced0f76e8d813a3e12f8263828025bb9cfe3f79f16a46048c6`。

该快照 23 suites／440 traits 中，placeholder 索引清單探針失敗：內部 type alias 被誤算為 indexed entry。後續修正探針與 placeholder schema default／priority 檢查後，8 個案例均通過；新增來源仍需完整快照重測。先前漸層零高度 shape、主題圖片 owner／色彩 context、表格複雜填充，以及點陣 EMF 的故障已通過定向回歸。WMF／EMF 原生向量入口、畫框映射、font resolver、未知 record 拒絕及未驗收診斷另行追蹤；不能只計算載入頁數便當作視覺通過。

已觀察到真 Microsoft 影片原生播放至結束（3.199966 秒、480×270、音量 0.8），並修正 viewer 的初始化音量；此證據沒有涵蓋音訊波形或所有互動／跨頁語義。另取得 SDK waterfall／sunburst 的真 Microsoft 靜態頁並人工核對原始 chart XML 身分，兩者仍有像素差異。字幕動畫已在真 viewer 觀察逐字淡入，但 Microsoft 對該檔的布局與 source 存在待核對差異，不能藉畫面估值修改正式預設字級。

01:21 UTC 由實際 PowerPoint Download 控制取得字幕案例 8085 bytes，SHA256 `1c149b931d5af839726b77f4ad1527d5ec5c5ce2ec3e9585bbdf1c29659adf11` 與 pinned 原檔一致。Microsoft 字級、換行及色彩差異仍須正式條款或實作證據解釋；字幕實際白色 glyph 約 y197–220，與 source 位置及 inset 相容，不應誤判為 y100 的位置差異。不能將猜測的來源修復當作已證實原因。

比對保留原始畫布尺寸，不重新縮放 golden PNG。圖片或字型抗鋸齒不同與實質布局／色彩錯誤均保留診斷；不得靠更換 oracle 或寬鬆閾值把故障變成通過。

## 已處理與仍待回歸的差異

已處理項目包含 presentation 頁序、Strict namespace／相容性選擇、placeholder／master／layout cascade、group affine geometry、187 preset geometry、直接 noFill／格式覆寫、文字尺寸與 baseline、表格樣式與合併、圖表快取與真 workbook、嵌入 EOT 字型、圖片 DPI／平鋪／主題輪廓、主題 hyperlink 顏色，以及播放 lifecycle／序列／trim／transition audio。每項仍需其真實來源案例和 Microsoft reference；實作存在不表示驗收通過。

仍待完成包括所有未覆蓋或未匹配的文字與圖形效果、精確 gradient 與字型渲染、部分 SmartArt 布局、3D／ChartEx 樣式及實際案例覆蓋、複雜文字動畫與時間線、影片與音訊完整播放 reference、跨頁／互動導航語義及手機實際執行環境。缺失媒體來源必須明確診斷，不能宣稱原檔不存在的媒體已成功播放。

## 來源與授權

規範使用 Microsoft 官方 [MS-OI29500](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/)、[MS-PPTX](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/) 與 [MS-ODRAWXML](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/)，ISO 鏡像的 provenance 另行標示。Office 實作差異優先按官方規格與真 PowerPoint 證據判斷。

Carlito 字型使用 OFL；builtin table／MTX decompressor 的 MPL 與 pattern 資料的 LGPL 各自保留 license、作者、對應 source 及 provenance。產品建置需帶入對應授權與 source 資產，不將全部資料泛稱為單一授權。測試 corpus 的來源授權與第三方歷史附件保留在 manifest 中，不能因此當作產品素材發布。
