PowerPoint for Mac 是有效的 Microsoft 原生桌面基準。Windows COM 是既有自動化工具的限制，不是驗收限定平台。這個目錄提供收集流程、唯讀前置檢查及可攜匯入驗證；目前 Linux 主機未執行 Mac 原生匯出或播放，完整 Microsoft gate 保持 **unverified**。

需要已安裝且可互動使用的正版 Microsoft PowerPoint for Mac、Node.js 20+、已安裝的 Python 3，以及本 repository 的 pinned PPTX cache。不要重新包裝或另存原始簡報。Mac 連線資訊提供之前仍可準備 corpus、來源頁面對應及驗證工具。

在 repository 根目錄執行：

```sh
node web/tests/pptx/corpus/fetch-corpus.mjs --cache /tmp/sentry-pptx-corpus
node web/tests/pptx/mac/preflight.mjs /tmp/mac-preflight.json
node web/tests/pptx/mac/prepare.mjs ChristopherVR__ooxml__media-bookmark-trigger /tmp/mac-bookmark-run /tmp/sentry-pptx-corpus
```

`preflight` 只讀實際 macOS 版本、PowerPoint app bundle／版本／build，以及該 app 的 scripting dictionary SHA。它不啟動 PowerPoint、不請求錄製權限，也不將 dictionary 存在當作匯出成功。可用 `MAC_POWERPOINT_APP` 指定實際 app 路徑；Linux 回報 unavailable。未執行／僅有結構證据的工具以 exit 3 結束，錯誤以 exit 2 結束。`--help` 為 exit 0。

`prepare` 驗證固定來源 SHA／大小及所有 ZIP member CRC，使用 Python XML parser 沿原始 `presentation.xml` 的 `sldIdLst` 與 relationship 取得真頁面順序／ID／part／hidden／Choice 內 timing。它產生 `source-plan.json` 和尚未填寫的 receipt template，不產生 baseline。新 output directory 已存在會拒絕執行，避免混用前次資料。

實際靜態收集流程：

1. 記錄 PowerPoint 和 macOS 實際 version／build、原始檔 SHA256、已安裝字型 inventory 及 font substitution／repair 警示。保留 preflight、操作證據與時間；缺字或修復不算通過。開啟固定 SHA 的原始檔，停用會保存原檔的動作，退出時不要保存。
2. 使用 PowerPoint 原生 **File > Export > PNG > Save Every Slide**。原生匯出視窗的 width／height 必須符合原始投影片比例，例如 source-plan 建議的 960 寬；不要改 Slide Size。不要後製 resize／crop／重取樣。每份來源個別收集並確認全部頁數，含 hidden 頁；頁碼不可從檔名排序或點擊次數猜測。
3. 對每張輸出 PNG，人工確認其內容與 source-plan 的原始頁面相符，填入實際 file、SHA256、pixel width／height 及真 ID／relationship／part。重新計算原始檔 SHA，確認來源 bytes 不變。由實際觀測填妥 `receipt.template.json`，另存 `receipt.json`；不要將 null 未知值補成成功。
4. 執行匯入驗證：

```sh
node web/tests/pptx/mac/import-static.mjs /tmp/mac-bookmark-run/receipt.json /tmp/sentry-pptx-corpus/ChristopherVR__ooxml__media-bookmark-trigger.pptx /tmp/mac-bookmark-run/validation.json
```

匯入工具重新用 authoritative manifest 驗證原始完整 ZIP、所有頁面來源對應、全部 PNG SHA／尺寸／chunk CRC／像素資料長度與 font inventory SHA。相對路徑不可越出 collection directory；漏頁、重複、wrong ID、source 改動及 corrupt PNG 均失敗。只接受本工具明示支援的非 interlaced 8-bit PNG；其他輸出保留 unsupported，不轉換成「通過」。它只產生 `structure-verified-native-provenance-review-required`，不驗證操作者宣稱的真實性、不自動核准 baseline，也不代表像素／字型一致。宣稱 native collection 必須另核原生操作與內容證據。

實際播放、轉場、音影片與 bookmark 收集契約見 [playback-contract.md](playback-contract.md)。PNG 匯出會移除播放行為；Microsoft 明確指出 Mac 的 Export Video 也不播放其他嵌入媒體，因此 MP4 匯出不能代替真 Slide Show 的螢幕與系統音訊紀錄。

Primary 文件於 2026-10-11 線上核對：

- [Microsoft：Mac 匯出 PNG／尺寸及嵌入媒體限制](https://support.microsoft.com/en-us/powerpoint/export-your-powerpoint-for-mac-presentation-as-a-different-file-format)
- [Microsoft：Mac MP4 匯出](https://support.microsoft.com/en-au/powerpoint/save-a-presentation-as-a-movie-file-or-mp4-in-powerpoint-for-mac)
- [Apple：螢幕與系統音訊權限](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac)
- [Apple：實際螢幕錄製與版本對應功能](https://support.apple.com/en-gb/102618)

收集影像、影片、音訊、font inventory、app dictionary、receipt 與結果留在外部 cache／證據目錄，不提交大型資料或任何帳號、token、私人內容。Linux 測試用 PNG 只驗證 validator 行為，不能充當 Mac baseline。
