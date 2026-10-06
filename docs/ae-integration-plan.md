# AE 通報功能整合計畫（PV-Link → pv-signal-monitor）

把 PV-Link 的**不良反應通報與收案**（業務手機通報、後台收案、內部工作台）整合到 pv.uic-ai.com。
採「完整搬入」：一個網址、一次登入、一套程式碼。PV-Link 的文獻監測部分先前已併入（見
[`merge-notes.md`](merge-notes.md)），這份文件記錄的是剩下的通報這一段。

- 原始碼來源：PV-Link repo（`bounce12340/PV-Link-Pharmacovigilance-Agent-System`）已於 2026-10-04 刻意刪除，**不要還原、也不要把副本推回 GitHub**。
  PR 2、PR 3 依使用者指示，取自刪除前 clone 的 `main`（`2fa9e2c`）；Josh 另有完整的 git bundle 備份。
  下文提到的「PV-Link 的某檔案」都指那個版本，不再有可點的連結。
- PV-Link 目前部署在 `pvlink.uic-ai.com`，**驗收通過前繼續運作**——通報管道不能中斷。

## 進度

| PR | 內容 | 狀態 |
|---|---|---|
| 1 | Worker：Access JWT 驗證、`/api/ae-reports*`、`/api/me`、AE_DB／AE_FILES 綁定 | [#1](https://github.com/bounce12340/pv-signal-monitor/pull/1) |
| 2 | 服務層：`aeApi`、`aeSubmission`、`caseWork`、`taipeiTime`（CIOMS 匯出已在 `services/literature/cioms.ts`，內容相同） | [#3](https://github.com/bounce12340/pv-signal-monitor/pull/3) |
| 3 | 業務手機通報 `#/report`、角色分流、`/llm/*` 限 pv | [#4](https://github.com/bounce12340/pv-signal-monitor/pull/4) |
| 3a | 個案編號改由 Worker 配發 | [#5](https://github.com/bounce12340/pv-signal-monitor/pull/5) |
| 4 | 後台收案、內部工作台；修「新個案無法建立第一筆工作」 | [#6](https://github.com/bounce12340/pv-signal-monitor/pull/6) |
| 5 | 切換上線（使用者操作） | 清單見 [`ae-cutover.md`](ae-cutover.md)；尚未執行 |

## PR 1 做了什麼

- `worker/ae/`：PV-Link 的 `ae.js`、`work.js`、`schema.sql`、`migrations/` 原樣搬入，只改 import 路徑；測試一併搬入。
- `services/ae/aeReport.ts`、`services/ae/caseWorkModel.js`：前端領域模型。`worker/ae/ae.js` 的嚴重性與到期日規則是它的鏡像，
  `worker/ae/ae.test.ts` 交叉比對兩邊。
- `worker/accessJwt.ts`：驗證 `Cf-Access-Jwt-Assertion`（簽章、`iss`、`aud`、`exp`，固定 RS256）。
- `worker/index.ts`：AE 路徑先驗身分，再只帶 `AE_DB`、`AE_FILES` 交給 AE handler。
- `wrangler.jsonc`：綁定既有 D1 `pv-link-ae` 與 R2 `pv-link-ae-attachments`（與 PV-Link 共用資料，不需搬資料）；
  `ACCESS_AUD` 是 pv.uic-ai.com Access application 的 AUD tag。

PR 1 暫時拿掉兩段依賴 i18n 的測試，搬 i18n 時要加回：PV-Link `tests/aeReport.test.ts` 的「i18n 動態鍵覆蓋率」，
與 `tests/caseWork.test.ts` 的雙語鍵完整性。

## PR 2 做了什麼

服務層搬到 `services/ae/`（`aeApi.ts`、`aeSubmission.ts`、`caseWork.ts`、`taipeiTime.ts`），與 PV-Link 的刻意差異：

- **沒有本機模式**：一律走同源 `/api/ae-reports`。PV-Link 以 `VITE_AE_API_ENDPOINT` 切換遠端／本機，
  本 repo 的 CI 部署不帶這個變數，照搬會讓正式站靜默跑在本機模式。`caseWork.ts` 直接開 IndexedDB 的展示模式一併拿掉。
  PR 3／4 搬元件時，`hasRemoteEndpoint()`、`local` / `local_saved` 相關的分支要跟著刪。
- **不送 `X-PV-Token`**：這裡的 Worker 不檢查它，前端也不放憑證。
- **outbox／草稿**經 `services/ae/storage.ts` → `storage.ts` 新增的 `saveDurable`／`loadDurable`／`removeDurable`
  （寫不進去會拋錯），且刻意不列入 `*_KEY_LIST`、不進 D1 同步快照（見 `CLAUDE.md`）。
- CIOMS 匯出不用搬：`services/literature/cioms.ts` 與 PV-Link `services/cioms.ts` 內容相同。

## PR 3 做了什麼

- `components/ae/`：`Root.tsx`（依角色分流）、`AEReportMobile.tsx`、`ProfileSetup.tsx`、`ui.tsx`、`caseStatus.ts`；
  `i18n/`（只取 `ae.*` 等 AE 用到的鍵）、`theme/ThemeContext.tsx`。heroicons 換成 lucide（以 `as` 別名保留原 JSX）。
- **樣式範圍**：AE 畫面包在 `AEScope`（`.ae-theme`）裡，語意色、indigo 品牌色、系統字型、焦點環、減少動態、暗色都只在框內生效。
  主系統的 brand 是 sky，sky-600 白底只有 4.1:1，所以不把 AE 換成主系統色。暗色、`lang` 也掛在這個外框上，不動 `<html>`。
  以瀏覽器截圖比對 `main` 與本分支的主系統畫面（遮掉建置資訊頁尾），像素差異為 0。
- **語言／主題偏好**經 `services/ae/prefs.ts` → `storage.ts`，開機時 hydrate，不進 D1 同步快照。
- **角色分流與 PV-Link 的差異**：建檔關卡只擋要進通報表單的人（PV 用主系統不必先建檔）；`/api/me` 失敗時直接給通報表單
  （PV-Link 會卡在存不了的建檔畫面）；`vite` 開發伺服器沒有 Worker，失敗時當成 PV（正式 build 不含這個分支）。
- **`/llm/*`、`/ollama-cloud/*` 只放行 PV**（`worker/index.ts` 的 `llmGate`，現已改名 `pvGate` 並同時用於 `/api/sync*`，角色來源與 AE API 相同），fail closed。
  ⚠️ 部署本 PR 前必須先設好 `AE_PV_EMAILS`（或 `ae_users` 已有 pv 紀錄），否則所有人的 AI 功能都會被擋（403）。
  `wrangler dev` 要在 `.dev.vars` 設 `AE_PV_EMAILS=dev@local`。
- PR 1 拿掉的「i18n 動態鍵覆蓋率」測試已加回（`i18n/translations.test.ts`）；caseWork 雙語鍵完整性等 PR 4 搬 `i18n/work.ts` 時加回。

## PR 4 做了什麼

- 主系統導覽列新增「通報收案」（`App.tsx` 的 `aeIntake` 模式）→ `components/ae/AEIntakePage.tsx`：
  載入、儲存、刪除個案、視窗取回焦點時重讀；讀取失敗顯示錯誤而不是空的收件匣。畫面包在 `AEScope embedded` 裡。
- `components/ae/AEIntakeConsole.tsx`（七道關卡的收案處理台）、`CaseWorkBoard.tsx`（內部工作台）、`caseAudit.ts`；
  `i18n/work.ts`。收件匣上已有「開啟業務通報表單」與「複製連結」按鈕，PV 同仁從這裡進 `#/report`。
- 拿掉本機模式：工作台不再逐筆讀本機 IndexedDB，刪除一律軟刪除並要求理由；本機試用的提示字串一併刪除（有測試擋）。
- **修正「新個案無法建立第一筆內部工作」**：個案頁新增「內部工作」按鈕，直接打開該個案的工作編輯器
  （`CaseWorkBoard` 的 `openRequest`）。Worker 對沒有工作紀錄的個案回空白工作（version 0），存下去就是第一筆。
  編輯器有未儲存內容時，不會被這個按鈕蓋掉。
- 後台建立追蹤報告後，畫面顯示 Worker 配發的編號（`<母案>-F<n>`），不是前端自己算的。
- PR 1 拿掉的 caseWork 雙語鍵完整性測試已加回（`i18n/translations.test.ts`）。
- **沒搬的**：PV-Link 把 AE 個案併入文獻的「成分 × PT 訊號聚合」（`aeToSignalRecords`）。本 repo 的訊號聚合是另一套，
  要不要合併、怎麼合併需要另外決定。

## PR 2–4 要搬的檔案（PV-Link 路徑）

| 類別 | 檔案 |
|---|---|
| 服務層 | `services/aeApi.ts`、`services/aeSubmission.ts`、`services/caseWork.ts`、`services/taipeiTime.ts`、`services/cioms.ts` |
| 業務端 | `components/AEReportMobile.tsx`、`components/ProfileSetup.tsx`、`components/Root.tsx`（依角色分流）、`components/ui.tsx`、`components/caseStatus.ts` |
| 後台 | `components/AEIntakeConsole.tsx`、`components/CaseWorkBoard.tsx`、`components/caseAudit.ts` |
| 文字 | `i18n/translations.ts`、`i18n/work.ts`、`i18n/LangContext.tsx`（AE 頁面保留中英雙語） |
| 測試 | `tests/` 下對應的 `*.test.ts`（含無障礙、版面、字級色彩守門測試） |

搬移時要處理的差異：

- **Tailwind 3 → 4**：PV-Link 的 `tailwind.config.js` 定義語意色 `brand`／`danger`／`caution`／`success`、
  CSS 變數色 `canvas`、`muted`，要改寫成 v4 的 `@theme`。字級下限 12px、對比度規則（`tests/designTokens.test.ts`）要一起帶過來。
- **圖示**：heroicons → lucide（本 repo 慣例）。
- **路由**：本 repo 以狀態切換頁面、網址不變；業務需要可存成書籤的 `#/report`。
- **分層**：元件不得自行 fetch 或讀寫儲存（見 `CLAUDE.md`），AE 的 API 呼叫一律經 `services/`。

## 已知缺口

**個案編號重複（PV-Link 既有問題）——新個案已改由 Worker 配號，既有重號待人工決定。**
PV-Link 在前端以「看得到的個案」配號，但手機看不到別人的個案；依程式邏輯推斷，業務送出的個案都會是 `PV-<年>-0001`
（Worker 照存，`case_number` 也沒有唯一限制）。正式資料實際重號多少，請用下方的唯讀查詢確認。現在的做法（`worker/ae/ae.js` 的 `caseNumberSql`）：

- 新個案：`PV-<台北年>-<該年最大號 +1>`，取號與寫入在同一個 INSERT 敘述內（原子），前端送的號碼一律不採用。
  因為取「最大號 +1」，不會再跟既有的 `0001` 撞號。
- PV 建立的追蹤報告：`<母案編號>-F<n>`（沿用後台慣例）。業務送出的不依 `followUpOfId` 配號。
- 既有個案的編號不可改（含 PV 編輯）。送出時存進佇列的個案還沒有編號，完成畫面會說明「送達後配發」。

**還沒處理、需要藥安決定的：**

1. **既有的重號資料。** 不能自動改號：編號可能已經寫進送主管機關的 CIOMS／報告，改了就對不上。
   用下面這個**唯讀**查詢列出重號（結果是真實資料，不要貼進這個公開 repo），由藥安逐案決定是否更正、怎麼留下更正紀錄：
   ```bash
   npx wrangler d1 execute pv-link-ae --remote --command \
     "SELECT case_number, COUNT(*) AS n, GROUP_CONCAT(id) AS ids FROM ae_cases WHERE deleted_at IS NULL GROUP BY case_number HAVING n > 1 ORDER BY case_number"
   ```
   若要更正，透過 API／後台操作留下稽核軌跡，不要直接改 D1（目前 API 刻意不允許改號，需要時另開功能）。
2. **pvlink 在切換前仍會產生 `0001`。** pvlink.uic-ai.com 跑的是 PV-Link 的舊 Worker，與這裡共用同一個 D1，
   repo 已刪除、無法修。切換上線前的新個案仍會重號；越早切換，要人工處理的越少。
3. **唯一限制。** 因為已有重號，現在加不了 `UNIQUE(case_number)`。重號清完、pvlink 撤除後，可再補一個 migration（手動套用）。

**`/api/sync` 沒有角色限制——已修。** 原本業務加進 Access 後，可以直接呼叫 API 在同步用的 `DB` 存一份自己的快照。
現在 `/api/sync*` 與 `/llm/*` 共用 `worker/index.ts` 的 `pvGate`：身分只取驗證過的 Access JWT（不再信任
`Cf-Access-Authenticated-User-Email` 標頭），非 PV 一律 403、不碰 `DB`。快照仍以信箱為鍵：JWT 的 email 與原本標頭的值同樣來自 Access 登入身分，既有快照應可沿用——部署後開同步面板確認看得到原本的雲端快照。

**新個案無法建立第一筆內部工作——PR 4 已修。** 內部工作台只列出「指派給自己、且內部到期日落在所選範圍」的工作
（`worker/ae/work.js` 的 workbench 查詢），編輯器原本只能從列表開啟。現在個案頁有「內部工作」按鈕可直接開啟。

## 切換上線清單（PR 5，使用者操作）

完整步驟、驗收方式與回復方式見 [`ae-cutover.md`](ae-cutover.md)，取代原本這裡的七點摘要。順序重點：

1. 先設 `AE_PV_EMAILS` secret，再部署 `main`（否則所有人的 AI 功能 403）。
2. 藥安帳號在 pv.uic-ai.com 驗收虛擬個案（取代 PV-Link `docs/uat-demo-case.md` 的 pvlink 版）。
3. 決定 `/api/sync` 是否先限制為 PV，再加一個測試業務驗角色分權，之後才逐一加入全體業務。
4. 業務清空 PV-Link 的待補送佇列後，`pvlink.uic-ai.com` 才轉址（目標 `https://pv.uic-ai.com/`，先 302）。
5. 最後撤除 PV-Link 的 Pages 專案與 Worker；共用的 D1 `pv-link-ae`、R2、KV **不可刪**。

## 不可違反的條件

- 稽核軌跡的操作者只來自驗證過的 Access JWT；沒有可信身分一律 401，不匿名寫入。
  也不得直接寫測試資料進正式 D1——那等於偽造操作者。
- `AE_PV_EMAILS` 只用 `wrangler secret put`，不進 `vars`（是真實員工信箱）。
- 個人檔案寫入採白名單，`role` 永遠不可由使用者寫入。
- CI 不執行 D1 migration；schema 變更先備份、手動套用。
- 本 repo 公開：不放真實醫院名稱、員工信箱或個案資料，截圖一律虛構資料。
