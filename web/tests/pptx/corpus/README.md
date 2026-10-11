這份 corpus 為 SEN-2600／SEN-2597 的可重現驗收來源，共 57 份從公開 repository 實際取得的 PPTX、235 頁，涵蓋 7 個專案。每份檔案固定來源 commit、下載 URL、SHA256、大小、頁數、特徵及授權來源。Aspose 的公開 vendor 範例輸出亦是測試輸入，不能作為 Microsoft 渲染基準。

`manifest.json` 只列原生 PPTX。`supplementary-chartml.json` 另列 18 份真實 XLSX ChartML／ChartEx 資料；它們不計入 57 份 PPTX，也不能把重新包裝的投影片標為網路原生 PPTX。特徵統計包含 layout／master 部件，因此 timing／transition 數量不一定等於頁數。

下載與驗證需要 Node.js 20 以上及 `curl`。從 repository 根目錄執行：

```sh
node web/tests/pptx/corpus/fetch-corpus.mjs --cache /tmp/sentry-pptx-corpus
node web/tests/pptx/corpus/fetch-corpus.mjs --cache /tmp/sentry-pptx-corpus --verify-only
```

預設 cache 為系統暫存目錄的 `sentry-pptx-corpus`，亦可設 `PPTX_CORPUS_CACHE`。只驗證一個案例可加 `--id scanny__python-pptx__txt-text`；報告會明示選取數量及全 manifest 數量，子集不能代替全量驗收。補充 XLSX 必須明確選擇另一份 manifest：

```sh
node web/tests/pptx/corpus/fetch-corpus.mjs --manifest web/tests/pptx/corpus/supplementary-chartml.json --cache /tmp/sentry-chartml-corpus
```

工具保留 `curl` 繼承的 HTTP(S) proxy 與 CA trust，不繞過 proxy 或關閉 TLS 檢查。每份下載需匹配 pinned SHA256／byte count，所有 ZIP member 均驗證 CRC32 與解壓大小，另核對 OPC 核心部件及 PPTX 頁數。ZIP64、多磁碟、加密或非 stored／deflate 的 ZIP 會明確失敗。失敗案例保留在報告，工具以非零狀態結束，不跳過或算作通過。

Cache 內產生 `<manifest-name>-fetch-report.json` 與 `<manifest-name>-resolved.json`。後者保留 manifest 欄位，另提供每份檔案的 `path`，讓渲染 harness 使用設定的 cache；它不應提交至 git。這些工具與 manifest 不依賴任何特定 workspace 絕對路徑。大型 PPTX／XLSX、Office 服務 HTML、含服務 token 的資料和原始影音都不提交至本目錄。

目前完整 Microsoft 驗收狀態為 **unverified**。下載成功、package／CRC 檢查成功、建置成功或替代 renderer 的畫面，都不能代表 Microsoft 渲染／播放一致。驗收仍需逐頁官方畫面精確比對、字型與嵌入字型檢查，以及實際動畫、轉場、音影片時間線證據；基準不可取得時保留缺口，不刪案例。已取得原生 ChartEx funnel、waterfall、boxWhisker 與 sunburst；Microsoft Open XML SDK 的公開原生 fixture 也是測試輸入，不是 Microsoft 渲染輸出。已加入原生 surface3D 與具有 p14:bmk／bmkTgt 的 PowerPoint COM fixture；原生 surface、treemap、histogram、paretoLine、regionMap 圖表仍缺實際 PPTX 來源，現有 XLSX 補充資料不掩蓋此缺口。

各專案的 license／NOTICE 全文保存在 `licenses/`，fixture 的 `license_files` 指向對應檔案。Repository 授權不自動證明歷史第三方附件或媒體使用完全相同授權；這些資料限作測試來源，保留原作者與附件 provenance，勿當作產品素材重新發布。
