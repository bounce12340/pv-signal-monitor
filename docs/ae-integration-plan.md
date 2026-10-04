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
| 3 | 業務手機通報 `#/report`、角色分流、`/llm/*` 限 pv | 進行中 |
| 4 | 後台收案、內部工作台；修「新個案無法建立第一筆工作」 | 待做 |
| 5 | 切換上線（使用者操作，見下方清單） | 待做 |

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
- **`/llm/*`、`/ollama-cloud/*` 只放行 PV**（`worker/index.ts` 的 `llmGate`，角色來源與 AE API 相同），fail closed。
  ⚠️ 部署本 PR 前必須先設好 `AE_PV_EMAILS`（或 `ae_users` 已有 pv 紀錄），否則所有人的 AI 功能都會被擋（403）。
  `wrangler dev` 要在 `.dev.vars` 設 `AE_PV_EMAILS=dev@local`。
- PR 1 拿掉的「i18n 動態鍵覆蓋率」測試已加回（`i18n/translations.test.ts`）；caseWork 雙語鍵完整性等 PR 4 搬 `i18n/work.ts` 時加回。

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

**個案編號重複（PV-Link 既有問題，PR 3 照搬未修）。** 前端以 `nextCaseNumber(本機看得到的個案, 今天)` 配號，
但手機看不到別人的個案，等於每次都從空清單起算：所有業務送出的個案都是 `PV-<年>-0001`。
Worker 照存前端給的號碼，`ae_cases.case_number` 也沒有唯一限制。PV-Link 正式站目前就是這樣運作。
建議改由 Worker 在建檔時配號（單一 SQL 敘述內取最大號 +1），需要先決定既有重號資料怎麼處理。

**`/api/sync` 沒有角色限制。** 業務加進 Access 後，可以直接呼叫 API 在同步用的 `DB` 存一份自己的快照
（只限自己的信箱，讀不到別人的）。風險低，但切換上線前宜一併限制為 PV。

**新個案無法建立第一筆內部工作（PR 4 修）。** 正式環境的內部工作台只列出「指派給自己、且內部到期日落在所選範圍」的工作（`worker/ae/work.js` 的 workbench 查詢），
而工作編輯器只能從列表開啟；新個案沒有工作紀錄，因此無法從介面建立第一筆工作。
建議：在個案頁加「內部工作」按鈕，直接開啟該個案的工作編輯器。

## 切換上線清單（PR 5，使用者操作）

1. `npx wrangler secret put AE_PV_EMAILS`（pv-signal-monitor 這支 Worker；逗號分隔的**個人**公司信箱）。
2. 確認 PR 3 的 `/llm/*` 角色限制已部署——之後才能把業務加進 Access，否則業務可用公司的 LLM 額度。
3. pv.uic-ai.com 的 Access policy 加入業務：**逐一列出個人公司信箱**，不可用 `@domain` 或 `@gmail.com` 規則。
4. 依虛擬測試個案文件送一筆測試個案，在 pv.uic-ai.com 驗收：稽核軌跡操作者為驗證過的信箱。
   （PV-Link 的 `docs/uat-demo-case.md` 寫的是 pvlink 網址與舊選單，PR 5 寫清單時改寫成 pv.uic-ai.com 版。）
5. 轉址前請業務打開 PV-Link，確認沒有「N 筆待補送」的提示：outbox 存在各自手機瀏覽器的 pvlink.uic-ai.com 網域底下，
   不會跟著搬到 pv.uic-ai.com，轉址後就補送不了。
6. `pvlink.uic-ai.com` 轉址到 `pv.uic-ai.com/#/report`。
7. 撤除 PV-Link 的 Pages 專案——同時解決 `pv-link-auditor.pages.dev` 未受 Access 保護的缺口。

## 不可違反的條件

- 稽核軌跡的操作者只來自驗證過的 Access JWT；沒有可信身分一律 401，不匿名寫入。
  也不得直接寫測試資料進正式 D1——那等於偽造操作者。
- `AE_PV_EMAILS` 只用 `wrangler secret put`，不進 `vars`（是真實員工信箱）。
- 個人檔案寫入採白名單，`role` 永遠不可由使用者寫入。
- CI 不執行 D1 migration；schema 變更先備份、手動套用。
- 本 repo 公開：不放真實醫院名稱、員工信箱或個案資料，截圖一律虛構資料。
