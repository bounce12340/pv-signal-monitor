# PV-Link 併入 pv-signal-monitor 合併筆記

## 階段：分支驗證 + 原始碼抓取（feature/merge-pv-link）

**分支狀態**
- 目前分支：`feature/merge-pv-link`（已存在，符合預期）
- 工作樹：乾淨（`git status --porcelain` 無輸出）

**抓取範圍與結果**

來源：`bounce12340/PV-Link-Pharmacovigilance-Agent-System`（分支 main）
落地：`C:\Users\BDAIPC\AppData\Local\Temp\claude\C--Users-BDAIPC\627bc897-1d10-4d00-b13d-02ea463b61ab\scratchpad\pv-link-src`（暫存區，非 repo 內）

共 17 檔，行數如下：

| 相對路徑 | 行數 |
|---|---|
| .env.example | 26 |
| App.tsx | 863 |
| index.html | 26 |
| package.json | 29 |
| services/cioms.ts | 129 |
| services/llmService.ts | 321 |
| services/meddra.ts | 319 |
| services/signals.ts | 68 |
| services/storage.ts | 92 |
| services/tools.ts | 4 |
| tests/i18n.test.ts | 17 |
| tests/services.test.ts | 170 |
| tests/theme.test.ts | 17 |
| types.ts | 67 |
| vite.config.ts | 24 |
| worker/index.js | 177 |
| worker/wrangler.toml | 40 |

備註：
- `tests/` 下實際有 3 個測試檔（i18n / services / theme），非原先預期的 1 檔。
- PV-Link 的 `wrangler.toml` 位於 `worker/wrangler.toml`（非 repo 根目錄）。
- 過程中發現暫存區內殘留一批舊、扁平（無子目錄）且缺檔的抓取結果（疑似先前中斷的嘗試），已清除並依正確相對路徑重新抓取，本次結果已核對無 GitHub API 錯誤內容、無 0 byte 檔案。
- 跳過範圍外檔案：`migrated_prompt_history/`、`README.*`、`docs/superpowers/`、`i18n/`、`index.css`、`.env.production`、`.gitignore` 等。

**依賴比對（PV-Link package.json vs 宿主 package.json）**

PV-Link 有、宿主沒有（需決策是否引入，未安裝）：
- `@heroicons/react`（dependencies）— 宿主用 `lucide-react` 作圖示庫，二者選其一，需決策
- `autoprefixer`（devDependencies）
- `jsdom`（devDependencies，PV-Link 測試環境用）
- `postcss`（devDependencies）

版本不一致（兩邊都有，但版本/架構不同，需決策）：
- `tailwindcss`：PV-Link `^3.4.19`（配 postcss + autoprefixer 的傳統 v3 設定）vs 宿主 `^4.3.2`（配 `@tailwindcss/vite` 的 v4 設定）— 屬於不同世代的 Tailwind 設定方式，非單純版本升級，移植時需注意
- `vitest`：PV-Link `^3.0.0` vs 宿主 `^4.1.10`

宿主有、PV-Link 沒有：
- `@google/genai`、`pdfjs-dist`、`lucide-react`（dependencies）
- `@tailwindcss/vite`、`tw-animate-css`（devDependencies）

兩邊相同：`react`、`react-dom`（dependencies）；`@types/node`、`@vitejs/plugin-react`、`typescript`、`vite`（devDependencies）

**未盡事項**
- 尚未安裝任何套件，僅列清單供下一階段決策（依 Pre-Flight 紀律：真需要新套件就停下回報，不擅自安裝）。
- `@heroicons/react` vs `lucide-react` 二選一、`tailwindcss` v3→v4 設定轉換，皆待後續階段決定移植策略。

## 階段：services/literature 落地（feature/merge-pv-link）

**落地範圍**

`services/literature/` 新增 7 個檔案（皆為新增，未修改宿主任何既有檔案）：

| 檔案 | 說明 |
|---|---|
| `services/literature/types.ts` | 從 PV-Link 根目錄 `types.ts` 抽出文獻相關型別：`PVInput`、`PVRecord`、`PVStructuredData`、`WorkflowStep`。`PVRecord.cioms_draft` 的 import path 由原本 `'./services/cioms'`（PV-Link 以 repo 根為基準）改為 `'./cioms'`（同目錄相對路徑）。目前無任何 service 檔案 import 此檔（5 個 service 原始碼皆用 `record: any`），故編譯上是孤立但自洽的型別檔，供後續接線階段使用。 |
| `services/literature/meddra.ts` | 逐字複製，無需改動（無本地 import）。 |
| `services/literature/cioms.ts` | 逐字複製，`import { lookupMeddra } from './meddra'` 路徑不變（同目錄）。 |
| `services/literature/signals.ts` | 逐字複製，`import { lookupMeddra } from './meddra'` 路徑不變。 |
| `services/literature/storage.ts` | 逐字複製（IndexedDB 層，無本地 import）。 |
| `services/literature/llmService.ts` | 逐字複製，含 `import.meta.env` 讀取（PROXY_ENDPOINT/LLM_BASE_URL 等），因整段被 cast 為 `(import.meta as any).env`，在宿主 `moduleResolution: "bundler"` + `module: "ESNext"` 下編譯無誤，未修改任何邏輯。**尚未接上宿主的 `services/settings.ts`**（宿主走 localStorage BYO-Key 表單，PV-Link 走 build-time env var），此為後續「層統一」階段的工作，本階段刻意不動。 |
| （未搬）`tools.ts` | PV-Link 原始碼中的 `services/tools.ts`（僅 4 行、`now()` 工具函式）未被任一移植檔案 import（grep 確認），任務清單也未列入，依「小 diff」原則不搬。 |

**測試移植（決策：拆成對應模組測試檔）**

PV-Link 原始 `tests/services.test.ts`（單檔、170 行，混合測試 4 個模組）依宿主慣例（`services/*.test.ts`，每個 service 一個同名 `.test.ts`，見既有 `analysis.test.ts`/`db.test.ts`/`trends.test.ts`/`versions.test.ts`/`stats.test.ts`/`dashboard.test.ts`）拆成 4 檔：

- `services/literature/llmService.test.ts`（`parseJsonLoose`、`reconcile`，7 個 it）
- `services/literature/meddra.test.ts`（`lookupMeddra`，8 個 it）
- `services/literature/cioms.test.ts`（`buildCIOMS`/`ciomsToText`，3 個 it）
- `services/literature/signals.test.ts`（`aggregateSignals`，5 個 it）

`tests/i18n.test.ts`、`tests/theme.test.ts`（PV-Link 原始碼另有的 2 檔）不在本階段任務範圍內，未搬移。

**驗證結果**

- `npx tsc --noEmit`：0 錯誤。
- `npm test`（vitest run）：**10 test files passed (10)，60 tests passed (60)**。以 `vitest run --reporter=verbose` 逐檔核實：宿主原有 37 個測試（`analysis`12 + `db`6 + `trends`5 + `versions`3 + `stats`8 + `dashboard`3）+ 移植的 23 個（`llmService`7 + `meddra`8 + `cioms`3 + `signals`5）= 60。
- `npm run build`：成功（`vite build` 產出 dist/，1732 modules transformed，無錯誤；`services/literature/` 尚未被 App.tsx import，故不影響 bundle 內容，符合「不接線」要求）。
- `git status --porcelain`：僅 `docs/`、`services/literature/` 兩個新增（untracked）目錄，宿主既有追蹤檔案零修改。

**未盡事項**

- `services/literature/types.ts` 目前無任何檔案引用（孤兒型別檔），待後續接線階段把 `llmService.ts`/`cioms.ts`/`signals.ts` 內部的 `any` 型別替換為 `PVRecord`/`PVStructuredData` 時才會用上。
- `llmService.ts` 的 provider 設定（env var 版）與宿主 `services/settings.ts`（localStorage BYO-Key 版）尚未統一，兩套並存，留待「層統一」階段決策合併策略。
- 未安裝任何新套件（`jsdom` 未裝）：本次移植的 4 個測試檔皆不觸發 `llmService.ts` 內的 `DOMParser`/`performPubMedSearch` 路徑（該邏輯無測試涵蓋，PV-Link 原始測試本就不含），故 vitest 預設 `environment: 'node'` 就能跑，未升級 vitest 測試環境設定。
