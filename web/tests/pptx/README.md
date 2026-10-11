# PPTX 獨立 trait 探針

這些測試執行實際 viewer／geometry 模組，驗證明確的規格 trait、Canvas 筆刷及有限像素。通過不表示 ISO/IEC 29500、Microsoft PowerPoint、動畫／音影片或 iOS WKWebView 完整驗收。Microsoft 實際投影片／時間軸基準及裝置測試是另外的 gate；LibreOffice 不可當作 Microsoft 預期來源。

從 repository root 執行：

```sh
node web/tests/pptx/run.cjs --list
node web/tests/pptx/run.cjs
node web/tests/pptx/run.cjs office-color-traits chart-table-regression
```

一般環境使用已安裝的 `playwright` 與其 Chromium。可以指定環境變數：

- `PLAYWRIGHT_MODULE`：可載入的 Playwright package 名稱或絕對 module 路徑。
- `CHROMIUM_EXECUTABLE`：系統 Chromium 路徑；省略時使用 Playwright 管理的瀏覽器。
- `PPTX_RESULTS_DIR`：結果目錄，預設此目錄的 `.results/`，已忽略版本控制。
- `VIEWER_SOURCE`：僅 chart/table 探針保留此歷史診斷覆寫；一般驗收請使用 repository 來源。
- `PPTX_CORPUS_CACHE`：已驗證的原生 PPTX cache；圖表與真實 JPEG DPI 探針需要此輸入。
- `PPTX_CHARTML_CACHE`：已驗證的補充 XLSX cache；圖表探針需要此輸入。
- `PPTX_MODERN_CHART_CACHE`：依 `corpus/supplementary-modern-chart-research.json` 取得的獨立 XLSX cache；地圖壓縮資料探針需要此輸入，不能計作原生 PPTX 或 Microsoft 渲染基準。
- `PNGJS_MODULE`：實際投影片影像檢查使用的 `pngjs` package 名稱或絕對路徑；驗證環境使用 `pngjs@7.0.0`。

先依[網路 corpus 說明](corpus/README.md)取得各份 manifest 的 cache。完整 runner 缺少真實输入時明確失敗，不略過案例。若環境未提供 Playwright，可在獨立測試環境安裝固定版本 `playwright@1.57.0` 並以 `PLAYWRIGHT_MODULE` 指定其 module；一般瀏覽器安裝使用 `npx playwright install chromium`。

例如使用系統瀏覽器：

```sh
CHROMIUM_EXECUTABLE=/usr/bin/chromium node web/tests/pptx/run.cjs
```

先依 repository 的建置流程生成 `web/dist`，再執行 `production-font-assets`；它要求四個 Carlito 字型及兩個授權／作者檔的 source/dist SHA 完全一致。瀏覽器測試的本機虛擬 origin 只提供 repository 中真實的 Carlito 資產，沒有外網依賴。

runner 為每個 suite 建立獨立結果目錄，刪除該 suite 的舊結果，保存 JSON、stdout、stderr 和最小 XML fixture。`summary.json` 中 `fullAcceptance` 固定為 `unverified`。它拒絕空 case、缺失布林 oracle、trait mismatch，以及執行期間 production PPTX／字型來源變更。direct invocation 亦會檢查來源變更。

退出碼：`0` 表示選定 trait 通過；`1` 表示失敗或證據無效；`2` 表示執行／參數錯誤；`3` 表示 probe 明確回傳未驗收。runner 保存 `3`，不把它當成完整通過。

原生網路簡報的完整檢查另外執行：

```sh
PPTX_CORPUS_CACHE=/tmp/sentry-pptx-corpus node web/tests/pptx/corpus-render.cjs
PPTX_CORPUS_CACHE=/tmp/sentry-pptx-corpus node web/tests/pptx/corpus-playback-browser.cjs
PPTX_CORPUS_CACHE=/tmp/sentry-pptx-corpus PPTX_OFFICE_BASELINES_DIR=/tmp/pptx-office-baselines node web/tests/pptx/official-static-compare.cjs
```

`PPTX_CORPUS_IDS` 可用逗號選取 manifest 中的 ID；空選取、未知 ID、SHA／CRC 或頁數不符都會失敗。`PPTX_CORPUS_RESOLVED` 僅提供已驗證檔案的本機路徑，不能覆寫 manifest 的 SHA。靜態檢查涵蓋桌面／手機，操作成功仍標示 Microsoft 視覺未驗收。播放觀察保存真實導航與媒體狀態；它預設的短時間取樣不能證明所有動畫已完成。

`corpus-bookmark-observation` 使用原始網路 PPTX，先核對 p14 相容性分支與真 viewer 模型，再觀察原生影片時鐘、500ms 書籤及 shape 3 淡入；不自行 dispatch 書籤事件。`PPTX_NATIVE_BOOKMARK_INPUT` 可讓 `viewer-playback-regression` 額外執行原始書籤輸入入口檢查，路徑必須是 corpus 中相同 SHA 的 PPTX。這些檢查仍不代表 Microsoft 畫面、聲音或時序完整通過。

Microsoft 比對需要同一輸入的實際 PowerPoint 影像、來源與頁序 provenance、尺寸及人工內容身分核對。缺少參考仍為未驗收，不能提供 candidate 自己生成的 PNG 作為 golden。輸出放在 `PPTX_RESULTS_DIR` 下；播放可另外指定 `PPTX_PLAYBACK_RESULTS_DIR`。

Windows 桌面版基準收集與真投影片播放／音訊擷取要求見 [desktop-baseline-contract.txt](windows/desktop-baseline-contract.txt)。[Collect-PowerPointStatic.ps1](windows/Collect-PowerPointStatic.ps1) 只收集原始 PPTX 的真 COM 靜態 PNG，永遠回傳未驗收，不能拿静態 Export 代替動畫取樣。Node preflight 的原始 SHA／全 ZIP CRC 與負向案例可在 Linux 執行；PowerShell／Office COM 必須另在實際 Windows PowerPoint 環境驗證。

來源及限制：

- `port-provenance.json` 保存移植前審查檔與移植檔的 SHA；移植不放寬原預期。
- `MS-OI29500` 官方 PDF：https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-OI29500/%5bMS-OI29500%5d.pdf 。探針保留所讀版本的節號、摘錄及 review archive 行號。
- 探針中的 `references/*.txt` 是審查時外部 archive 的定位標籤，並非宣稱 repository 已保存該文件，也不在 runtime 讀取。
- ISO 正文例來自 python-pptx 保存的 ISO/IEC 29500-1:2012 PDF 鏡像，非認證官方下載；探針明列此 provenance。Microsoft 實作差異需另外採官方 MS-OI29500 與真 PowerPoint 基準。
- 字型 fallback、動畫完成、影片解碼、音訊可聽見及完整圖形視覺，不因有限 Canvas／DOM trait 通過而驗收。
