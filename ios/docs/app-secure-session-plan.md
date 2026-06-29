# iOS App 安全 Session：保持登入 + 安全儲存 + FaceID

> 狀態：設計（自動登出調整已實作；Keychain/FaceID/金鑰重取 待實作）
> 範圍：**僅 iOS 原生 App**。所有行為以 `isNativeApp()`（web）與 bundle 判斷（native）守衛，
> **純 web 版完全不受影響**。

---

## 1. 需求（使用者確認版）

1. **隱藏背景自動登出設定**（iOS）。
2. **iOS 不做背景計時自動登出**，使用者保持登入；但**他處登入仍要踢掉本機**（保留單裝置 force-logout）。
3. 從伺服器拉取的資料以**密文**安全儲存在 iOS 適當空間，**不存明文**。
4. **每次重開重新從伺服器 fetch 金鑰**（MK 不落地，只在記憶體）。
5. iOS 設定可選擇**回到 App 的解鎖方式**：**關閉 / FaceID / 感應 NFC 卡**（統一單選，避免衝突）。
6. 啟用任一鎖定後，已登入時**冷啟動重開**與**從背景回前景**都需解鎖；**失敗則停在鎖定畫面可重試、不登出**。
7. 須使用 **iOS 安全儲存機制**（Keychain / Secure Enclave / Data Protection）。

### 1.1 解鎖方式（lock mode）

| 模式 | 條件 | 強度 | 備註 |
|------|------|------|------|
| `none` | 直接進入 | — | 預設 |
| `faceid` | LAContext 生物辨識 | 你是誰 + 裝置 | 方便；不需實體卡 |
| `nfc` | 感應 NTAG424 卡片 | **你有什麼**（實體卡）+ 每次新 CMAC + 伺服器驗證 | 最強；回前景時感應即可，且 SDM 交換自然重取 `wrapped_mk` |

- **NFC 模式運作**：回前景/冷啟動 → 跳系統 NFC 感應 → 取得 SDM URL → 後端 SDM 交換驗證 CMAC → 解出 `account_digest` 與目前登入帳號比對；相符才解鎖，不符/取消則停在鎖定畫面。
- **限制**：Core NFC 僅前景可發起、iPhone 7+ 才支援（`readingAvailable` 為 false 時該選項隱藏或退回 FaceID）。
- **冷啟動 vs 回前景**：回前景時 MK 仍在記憶體，感應僅作「卡片在場」驗證即解鎖；冷啟動 MK 已清，NFC 取回 `wrapped_mk` 後仍需 KEK（Keychain）或密碼解封。

---

## 2. 現有金鑰流程（研究結論）

- 登入：感應 NTAG424（`/api/v1/auth/sdm/exchange`）→ 回傳 `wrapped_mk` + `account_token` + `account_digest`；
  再以密碼（OPAQUE + argon2id）在本地**解封** MK（`unwrapMKWithPasswordArgon2id`）。
- MK 目前**僅記憶體**（`_MK_RAW`，`core/store.js`），登出 `clearSecrets`/`resetAll` 清除。
- `wrapped_mk` 只在 **SDM 交換（需卡）** 時回傳；**沒有任何用 token 取回 wrapped_mk 的端點**。
- `account_token`（`accounts.account_token` + hash，migration 0012）可認證 `devkeys/fetch`、`mk/update` 等端點。

→ 結論：要做「免感應卡 + FaceID 重新取金鑰」，需**新增一個 token 認證的取金鑰端點**，並在裝置端保留解封用 KEK。

---

## 3. 目標安全模型

| 項目 | 儲存位置 | 保護 |
|------|----------|------|
| MK（明文金鑰） | **僅記憶體** | 不落地；每次開啟重新取得 |
| `wrapped_mk`（密文） | **不落地**，每次開啟向伺服器拉取 | 伺服器可撤銷（刪除即無法再取） |
| 解封 KEK（argon2id 導出） | **iOS Keychain** | `biometryCurrentSet` + `WhenUnlockedThisDeviceOnly`，Secure Enclave/FaceID 綁定 |
| `account_token` / `account_digest` | iOS Keychain | 同上 |
| 拉下來的資料（聯絡人/訊息等） | 原生加密檔（Data Protection `.completeFileProtection`） | 靜態為密文；MK 不落地故無法離線解密 |
| FaceID 啟用偏好 | Keychain / UserDefaults | — |

安全性權衡（使用者已知悉並同意）：
- 重開不再需要**實體卡片**；安全性改為「裝置 + FaceID + Keychain KEK + 伺服器可撤銷」。
- 新的取金鑰端點使「持 token 可取回 wrapped_mk」成立，但 **token 單獨無用**——仍需裝置上的 Keychain KEK（受 FaceID 保護）才能解封。

---

## 4. 流程

### 4.1 首次登入（感應卡 + 密碼）
1. 既有流程取得 MK。
2. 由 argon2id KEK（解封 `wrapped_mk` 用）→ 經 bridge 存入 Keychain（FaceID 綁定）。
3. `account_token` / `account_digest` 存入 Keychain。
4. **不存** MK、不存密碼。

### 4.2 重開 / 回前景（已登入 + 啟用 FaceID）
1. 原生顯示鎖定遮罩蓋住 WebView。
2. `LAContext` FaceID 驗證；失敗 → 停在鎖定畫面可重試（不登出）。
3. 成功 → 自 Keychain 取出 KEK + token。
4. web 經 bridge 取得 token → 呼叫**新端點** `POST /api/v1/mk/fetch`（token 認證）→ 取回 `wrapped_mk`（密文，不落地）。
5. 以 Keychain KEK 在記憶體解封 MK → 注水還原。
6. 移除鎖定遮罩。

### 4.3 他處登入
- WS 偵測 stale session（409/StaleSession）→ `secureLogout` 踢掉本機（**保留**），並清除 Keychain（呼叫 bridge `clearSecureSession`）。

---

## 5. 需要的改動

### 5.1 後端（data-worker）
- **新端點** `POST /api/v1/mk/fetch`：以 `account_token`(+`account_digest`) 認證，回傳 `accounts.wrapped_mk_json`。
  - 僅回傳密文（伺服器無法解密）；遵守 E2E。
  - 速率限制 / 記錄；帳號清除或他處登入後應使其失效（沿用既有 token 驗證/撤銷）。

### 5.2 原生（iOS，僅完整 App）
- `KeychainStore.swift`：存取 KEK / token / digest（`kSecAttrAccessControl` = `.biometryCurrentSet`、`kSecAttrAccessible` = `.whenUnlockedThisDeviceOnly`）。
- `BiometricGate.swift`：`LAContext` FaceID；鎖定遮罩 view 蓋住 WebView，冷啟動 + `applicationWillEnterForeground` 觸發；失敗可重試不登出。
- `SecureFileStore.swift`：資料密文落地（Data Protection `.completeFileProtection`）。
- 設定畫面：啟用 FaceID 開關（偏好存 Keychain/UserDefaults）。

### 5.3 Bridge
- JS → 原生：`secureStore`(kek/token/digest)、`secureLoad`、`clearSecureSession`、`biometricUnlock`、`setFaceIDEnabled`、`persistData`/`loadData`（密文）。
- 原生 → JS：`secureSessionLoaded`、`biometricResult`、`faceIDSettingChanged`。

### 5.4 Web（僅 `isNativeApp()`，web 版不變）
- 隱藏背景自動登出設定 ✅（settings-modal）。
- 停用背景計時登出 ✅（app-mobile `handleBackgroundAutoLogout`）；保留他處登入踢線 ✅。
- 登入成功後把 KEK/token 經 bridge 存入 Keychain；金鑰/資料持久化改走原生。
- 開啟時：若 Keychain 有 session，跳過 SDM 交換 → `mk/fetch` 取 wrapped_mk → 解封注水。
- 登出：呼叫 `clearSecureSession`。

### 5.5 文件
- `CLAUDE.md`：新增「App 模式安全 session」例外說明（對「本地零持久化／登出清除」的 App 模式調整與安全模型）。
- `ios/README.md`：bridge 表、FaceID/安全儲存段落。

---

## 6. 分階段

| 階段 | 內容 | 狀態 |
|------|------|------|
| S0 | iOS 關背景計時登出 + 隱藏設定（保留他處踢線） | ✅ 已實作 |
| S1 | 原生 Keychain/Biometric/SecureFile + 設定畫面 | ⏳ |
| S2 | Bridge action/event 串接 | ⏳ |
| S3 | 後端 `mk/fetch` 端點 | ⏳ |
| S4 | Web（isNativeApp）登入存 Keychain、重開金鑰重取、登出清除 | ⏳ |
| S5 | 文件 + 實機驗證（FaceID、冷啟動取金鑰、他處踢線清 Keychain） | ⏳ |

---

## 7. 待確認 / 風險
- **`mk/fetch` 端點契約**：認證僅 `account_token` 是否足夠？是否要綁 device_id / 加 HMAC？（影響後端安全）
- WKWebView 載入遠端 web → 所有 Keychain/資料持久化都須跨 bridge，注意非同步時序與失敗回退。
- 冷啟動「FaceID → 取 KEK → fetch wrapped_mk → 解封注水」端到端時序需實機驗證。
- App Clip 不適用（無 FaceID/Keychain session 流程）。
