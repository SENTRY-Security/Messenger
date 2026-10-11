Mac 真 Slide Show／音訊時間線收集契約，尚未執行

本契約與靜態 PNG 匯出分開。使用相同 pinned 原始 PPTX、SHA／ZIP guard、PowerPoint／macOS version/build 及 source-plan 頁面對應。不得以影片匯出、另存檔、動畫重建、browser renderer 或 LibreOffice 替代。

實際收集必須保留以下平行證據：

- 真正 PowerPoint Slide Show 的螢幕錄影，記錄 monitor／原生物理像素 bounds、display scaling／refresh rate／HDR／color profile、capture codec／frame rate，以及 slide 區域辨識方法。只裁出的投影片 frame 需保留對應原始完整錄影與 crop bounds；不可縮放。
- 實際系統音訊 recording／loopback stream：sample rate／channel count／sample format／路由裝置／錄製 app 與版本、音量及 mute 狀態、與螢幕錄影的 clock offset／漂移證據。麥克風或字幕不可代替實際系統 PCM／可解碼音訊。錄製權限依 Apple 對該 macOS／錄製 app 的文件和真實能力確認，不能只看 checkbox 推論成功。
- 一致的 monotonic 時鐘與操作 log：正常 pointer／keyboard 或經實際 app dictionary 驗證的控制，記 requested／actual 時間、source slide ID／index、operation 前後畫面及可觀察的 native media player 時間／播放狀態。不能從點擊數推論下一頁，因同一點擊可能只消耗動畫步驟。
- Bookmark BM1=500 ms 等邊界必須記錄真正媒體時鐘的截圖前後值與量測精度。看不到 native media clock 或 precision 不足時，明示 unavailable／unverified；不可用 wall-clock 點擊後 500 ms 冒稱 exact media time。要包含首次播放、前進／返回／seek／pause／resume／replay，以及 bookmark 是否重發的真實觀測。
- 保留全錄影／音訊／事件 log SHA256、原始 source before/after SHA、軟體與字型 inventory、操作和 capture latency。音訊 metadata 存在、clock 前進或影片 decode 成功都不能證明與 Microsoft 聲音／動畫時間線一致。

建議 event log 欄位：`sourceId`, `sourceSHA256`, `pptxSlideId`, `slideIndex`, `shapeId`, `action`, `requestedMonotonicMs`, `actualMonotonicMs`, `mediaTimeBeforeSeconds`, `mediaTimeAfterSeconds`, `mediaClockPrecisionMs`, `screenFrameFile`, `frameSHA256`, `audioStartSample`, `clockOffsetMs`, `observedState`, `uncertainties`。未知值保留 null 並使相應驗收項 unverified。

Gate 分別審查：來源與原生 app 身分、全部頁面內容、PNG 像素／字型、author timing／transition、系統音訊波形、影片解碼與 bookmark／控制行為。逐项真 MS 實測比對完成前，整體狀態保持 unverified；不能因靜態匯出成功而 pass 播放。
