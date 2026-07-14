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

## 階段：統一 LLM 呼叫層與儲存層（feature/merge-pv-link）

本階段把兩平台各自的 LLM 呼叫與 JSON 容錯解析、以及 localStorage / IndexedDB
兩套儲存收斂成各一份共用模組。全 repo 現只剩一份 `parseJsonLoose`、一份批次
併發實作、一個 IndexedDB 後端。元件層（除 `index.tsx` 開機接線外）零改動——
`db`/`settings` 的同步 API、`sync` 的 push/pull 介面皆保持不變。

### A. LLM 統一（commit：Unify LLM call layer）

- 新增 `services/llm.ts`：唯一 LLM client。`resolveLlm(AiSettings)` 依設定挑三
  來源之一：
  1. **平台預設**——同源相對路徑 `/llm/chat/completions` 代理（`platform:true`，
     `credentials:'same-origin'` 讓 CF Access cookie 隨行，無 Authorization、無
     API key、無 VITE_ 端點變數）。使用者未設定任何 BYO 供應商時的預設。Worker
     端 `/llm` 由下一階段建；本階段前端已寫好，測試以 `resolveLlm` 單元測試涵蓋。
  2. **BYO OpenAI 相容**——沿用宿主設定畫面（provider=openai-compatible + baseUrl）。
  3. **BYO Gemini**——宿主既有（provider=gemini + apiKey）。
  - 傳輸只有兩支：`openaiChat`（OpenAI Chat Completions，平台/BYO 共用）、
    `geminiGenerate`（`@google/genai`，唯一 `new GoogleGenAI` 建構點）。
  - 共用原語：`callModel`、`runBatched`、`mapLimit`、`parseJsonLoose`、`reconcile`、
    `Lang`/`langDirective`/`ProgressFn`。
- `services/ai.ts`：全部呼叫改走 `resolveLlm`/`geminiGenerate`/`openaiChat`。原本
  同檔重複兩次的 fenced-JSON 容錯（原 `ai.ts:197-198`、`ai.ts:290-291`）收斂成單一
  `parseJsonLoose`（經 `parseModelJson` 包裝，解析失敗丟 `SyntaxError` 交由上層轉友善
  訊息）。移除「尚未設定 API Key / Base URL / 模型」三處硬性 throw——改由平台預設接住。
  `extractAEMaster`/`mapTermsToMaster` 對外簽章不變（`GeneratorMode`/`MonitorMode`
  無須改動）。
- `services/literature/llmService.ts`：只留領域 prompt（`scoreRelevance`/
  `generateSummaries`/`extractPVData`/`extractPVDataBatch`），改 import 共用原語；
  刪除死碼 `viaProxy`/`viaDirect`/`callModel`/`mapLimit`/`runBatched`/`parseJsonLoose`/
  `reconcile` 與 `VITE_LLM_*`/`VITE_PV_PROXY_*` env 讀取。
- 新增 `services/literature/pubmed.ts`：PubMed esearch/efetch/XML 解析與 NCBI 節流
  （非 LLM 呼叫）獨立成檔，保留 `VITE_NCBI_API_KEY`（資料源金鑰，非 LLM 端點變數）。
- 測試：`services/literature/llmService.test.ts` 內的 `parseJsonLoose`/`reconcile`
  測試移到新的 `services/llm.test.ts`，並加 `resolveLlm`（4 例三來源）與 `mapLimit`
  併發/順序測試。

去重佐證（全 repo grep，皆唯一）：
- `parseJsonLoose` 定義：`services/llm.ts:243`（唯一）。
- 批次併發：`mapLimit` `services/llm.ts:189`、`runBatched` `services/llm.ts:215`（唯一）。
- `new GoogleGenAI`：`services/llm.ts:147`（唯一）。
- `ai.ts` 內 fenced-regex JSON 解析：0 處（已收斂）。

### B. 儲存統一（commit：Unify storage backend）

- 新增 `services/storage.ts`：唯一 IndexedDB 後端（DB `pv-signal-monitor`、單一
  object store `kv`）＋記憶體 cache 鏡像＋localStorage 退路。**設計取捨**：宿主
  `db.ts`/`settings.ts` 全 app 同步呼叫，直接改 async 會波及每個元件；故採「同步
  cache 為讀取來源，寫入即時更新 cache 並背景寫 IndexedDB」。決策為**抽成
  `services/storage.ts`**（而非擴充 `literature/storage.ts`），因宿主 db 與文獻庫兩邊
  都要用它。
  - API：`loadSync`（同步讀 cache，未命中退 localStorage 解析）、`save`（cache +
    背景 IndexedDB，IDB 失敗退 localStorage 同鍵）、`loadAsync`（文獻庫 async 讀）、
    `initStorage(hydrateKeys, migrateKeys)`（開機一次性遷移 + hydrate；永不 reject，
    IDB 不可用時整體退化回 localStorage 同步行為）。
- 遷移：`migrateLocalStorageToKV(keys, deps?)` 首次載入把宿主 5 個 key + 2 個
  settings key 從 localStorage 解析後複製進 IndexedDB；設 `pv_idb_migrated='1'`
  標記；**不刪原 localStorage 資料以便回退**；已在 IDB 的鍵不覆蓋；非 JSON 值略過；
  冪等（旗標已設則整體跳過）。`deps` 可注入，供無 fake-indexeddb 的 node 測試環境
  以純記憶體 fake 驗證（未裝任何新套件）。
- `services/db.ts`：`getFromCacheOrStorage`→`loadSync`、`saveToStorageAndCache`→`save`
  ＋衍生檢視 `monitorBatchesMemo` 由原 cache 物件改成模組區域變數。同步 API 全部不變。
  匯出 `DB_KEY_LIST`。
- `services/settings.ts`：`load` 改讀 `loadSync`、`saveAi`/`saveRules` 改 `save`；
  匯出 `SETTINGS_KEY_LIST`。同步 API 不變。
- `services/literature/storage.ts`：改成薄封裝共用後端（`loadAsync`/`save`），刪除原
  `pv-link` 專屬 IndexedDB 開庫碼、`PV_AUDITOR_MASTER_DB` legacy 遷移、私密模式 LS
  退路（皆由共用層接手；且該 legacy 鍵屬另一來源網域，在合併後網域無資料）。匯出
  `LITERATURE_KEY_LIST`。
- `services/sync.ts` D1 快照：`db.exportAll()` 擴充涵蓋文獻庫 `master_db` /
  `pending_review`（同步讀自 hydrated cache），`importAll()` 一併還原（v1 舊快照缺
  此二欄位時預設空陣列，向下相容）。schema 字串 `pv-signal-monitor-backup` 不變、
  version 1→2；**D1 schema 與 `/api/sync` API 完全不變**（payload 為 JSON blob）。
- `index.tsx`：開機 `initStorage(hydrateKeys, migrateKeys)` 完成後才 render；
  migrateKeys=5 db + 2 settings，hydrateKeys 另含 2 文獻 key。

### 遷移路徑測試證據

`services/storage.test.ts`（6 例，`migrateLocalStorageToKV` 注入記憶體 fake）：
解析後複製 + 設旗標 + 回報遷移鍵；原 localStorage 保留（回退）；旗標已設則跳過；
IDB 已有該鍵不覆蓋；非 JSON 值略過不中斷；全鍵不存在仍設旗標。

### 瀏覽器端實跑驗證（vite dev）

- App 正常開機、console 無錯誤：`initStorage` async gating 生效。
- `indexedDB.databases()` 含 `pv-signal-monitor`；`localStorage.pv_idb_migrated==='1'`。
- 端到端 hydration：對 kv store 植入一筆 `pv_db_products` 後重載，Dashboard 由「尚無
  產品主檔」變為「0 / 1 個產品已完成 / 驗證用藥A / 仿單版本 2026-01-01」——證明
  IndexedDB 為讀取後端、開機 hydrate、同步 db API 自 hydrated cache 供資料全鏈路成立。

### 驗證結果（本階段）

- `npx tsc --noEmit`：0 錯誤。
- `npm test`：**11 test files passed，71 tests passed**（原 60 − 移除的 llmService.test 7
  + 新增 llm.test 12（parseJsonLoose 4 + reconcile 3 + resolveLlm 4 + mapLimit 1）
  + 新增 storage.test 6 = 71）。
- `npm run build`：成功（1735 modules transformed）。

### 未盡事項

- 平台預設 `/llm/*` 代理的 **Worker 端尚未實作**（依任務屬下一階段）；本階段前端已就緒
  且以 `resolveLlm` 測試涵蓋，實際 `/llm` 請求在 Worker 建立前會回 404/network error。
- 寫入採 cache 同步 + IndexedDB 背景持久化；分頁於背景 flush 前關閉有極小資料遺失窗口
  （與移植前 `literature/storage.ts` async-only 寫入一致）。localStorage 於成功遷移後
  凍結為回退快照，正常運作下不再寫入。
- `services/literature/types.ts` 仍為孤兒型別檔（沿用前階段狀態，本階段未接線 UI）。

## 階段：文獻監測前端分頁落地（feature/merge-pv-link）— commit `dd7f7c7`

把 PV-Link 801 行單體 `App.tsx` 的三大工作流（PubMed 檢索 → 待核閱 → CIOMS/正式庫）拆成宿主的三個新分頁，元件內不含 fetch/商業邏輯，全部呼叫 `services/literature/*` 與統一 LLM/儲存層。`services/literature/types.ts`（`PVRecord`/`PVStructuredData`）自此不再是孤兒型別檔，供三個新元件做本地型別標註（services 邊界維持 `any`，未擴大本階段 diff）。

### 新分頁元件清單（PV-Link 原功能區 → 新元件）

| 新元件 | 行數 | 對應 PV-Link 原始碼（scratchpad/pv-link-src/App.tsx） | Mode 值 |
|---|---|---|---|
| `components/literature/LiteratureSearchMode.tsx` | 228 | `input` tab 表單（App.tsx:508-542）＋ `runWorkflow`（App.tsx:141-228）＋ 進度條（App.tsx:477-486） | `litSearch` |
| `components/literature/LiteratureReviewMode.tsx` | 277 | `review` tab（App.tsx:544-677）＋ 抽取 `useEffect`（App.tsx:332-356）＋ `handleRegenerate`（App.tsx:360-380）＋ `handleImport`（App.tsx:289-299） | `litReview` |
| `components/literature/CiomsModal.tsx` | 75 | CIOMS 檢視器 modal（App.tsx:832-858） | （ReviewMode 子元件） |
| `components/literature/LiteratureLibraryMode.tsx` | 199 | `database` tab（App.tsx:679-758）＋ `runBatchExtract`（App.tsx:230-259）＋ `exportToCSV`（App.tsx:412-437） | `litLibrary` |

PV-Link 原 `signals` tab（App.tsx:760-822，成分×PT 質化聚合）**未落地為獨立分頁**，改依任務指示併入 `MonitorMode.tsx`（見下）；PV-Link 的 i18n/ThemeContext/`logs` tab 未移植（宿主本身無雙語/暗色模式，且已有結構完整的稽核日誌系統可用）。

### 服務層小幅擴充

- `services/literature/storage.ts`：新增 `loadRecordsSync`（同步讀 cache，鏡射 `services/db.ts` 的存取模式）。兩個文獻 key 已在開機 `hydrateKeys` 內，元件掛載時讀到的資料保證已 hydrate 完成——三個新分頁都採「頁籤切換即重新掛載」模式讀一次到 `useState` 初始值，切分頁天然重新整理，不需額外的 refresh 機制。
- `services/literature/pubmed.ts`：新增 `buildPubMedQuery`（純函式，PubMed 布林查詢組裝，成分 OR、AE 詞 AND、排除詞 NOT），從原本內嵌在 `runWorkflow` 的邏輯抽出，避免元件內出現查詢組裝這種可測試的領域邏輯；新增 `services/literature/pubmed.test.ts`（6 例）。
- `services/db.ts`：`SystemLog.module` 型別加入 `'LITERATURE'`，讓三個新分頁的操作（PubMed 檢索、匯入正式庫、退回、批次抽取、CSV 匯出、從正式庫移除）都寫入既有的雜湊鏈稽核日誌（`AuditMode.tsx` 無需改動，`module` 欄位純顯示不做 switch-case）。
- `types.ts`：`AppMode` 加入 `'litSearch' | 'litReview' | 'litLibrary'`。

### 相對 PV-Link 原始行為的刻意調整

- **搜尋不再覆蓋待核閱清單**：原始碼 `runWorkflow` 每次執行都 `setRecords([])` 整批覆蓋（App.tsx:143-144, 214-218）。三個分頁分開後使用者可能搜尋完不立刻核閱，覆蓋會遺失資料，故改為「新結果與既有待核閱清單合併（依 pmid 去重）」，僅追加真正的新文獻。
- **新增「退回」動作**：PV-Link 原始碼從未在 UI 上真正把 `is_excluded` 設為 true（型別存在但無按鈕），任務要求核閱頁要有「入庫/退回」，故在 `LiteratureReviewMode` 加入「退回」按鈕：confirm 後把該筆從待核閱清單移除並寫入稽核日誌（`DELETE`/`LITERATURE`）。

### App.tsx / DashboardMode / MonitorMode 接線

- `App.tsx`：新增 2 個 state（`selectedLiteratureRecordId`、`pendingLitCount`，後者由既有 `useEffect([activeMode, dbUpdateTrigger])` 一併算出）、3 個 nav 按鈕（重編號：`1. AE 主檔生成` → `2. 文獻檢索` → `3. 文獻核閱`（待核閱數量徽章）→ `4. 訊號監測` → `文獻庫` → 既有的 `資料庫管理`/`稽核日誌`）、3 個 render 區塊。淨增量：**+66 / −4 行**（`git diff --stat`），遠低於 150 行門檻，未觸碰既有分頁的 props 介面。
- `DashboardMode.tsx`：新增 `pendingLitCount` prop，跟隨既有「本季尚未監測」amber 提醒的樣式，加一條「文獻待核閱：N 篇」提醒按鈕（點擊跳轉 `litReview`）。
- `MonitorMode.tsx`：在既有 Poisson exact 95% CI 分析報表下方新增「文獻訊號監測（成分 × MedDRA PT 聚合）」卡片，呼叫 `aggregateSignals`（`services/literature/signals.ts`，質化計數，非統計顯著性檢定），關鍵字篩選成分/PT，並列顯示兩種方法論的名稱以資區別；資料來源為文獻庫（獨立於本頁的季度通報數據）。

### 驗證結果

- `npx tsc --noEmit`：**0 錯誤**。
- `npm test`：**12 test files / 77 tests passed**（原 71 + 新增 `pubmed.test.ts` 6 例）。
- `npm run build`：成功（1744 modules transformed；既有的 >500KB chunk 警告為 pdfjs-dist/lucide-react 既有依賴造成，非本階段新增問題）。
- 瀏覽器端實跑（`npm run dev`，vite 6.4.3 @ localhost:3001）：逐一點擊全部 8 個分頁按鈕，console 皆無錯誤；`文獻庫`→點擊既有測試資料列→正確帶入 `litReview` 並預選該筆；結構化抽取因 `/llm` 平台代理 Worker 尚未建立而優雅降級為 `Missing` 骨架（非阻斷性錯誤，符合前一階段紀錄的已知缺口）；CIOMS 草稿 modal 正確開啟並渲染完整表單。

### 未盡事項

- PV-Link 原 `signals` tab 的獨立頁面/成分過濾 UI 未整頁搬遷，改以 `MonitorMode` 內嵌卡片＋純文字關鍵字篩選取代（無法依「產品」自動篩選，因 `Product` 型別無 `ingredient` 欄位可供對應）。
- 平台預設 `/llm/*` 代理 Worker 仍未建立（沿用前一階段的已知缺口），三個新分頁的 AI 呼叫在該 Worker 上線前會走平台預設模式並收到端點錯誤；已在瀏覽器測試中確認錯誤會被各處的 try/catch 吞下並顯示保守預設值，不會讓 UI 崩潰。
- 未新增元件層測試（三個新分頁皆為容器型 UI，邏輯已在 `services/literature/*` 的既有測試中覆蓋；`buildPubMedQuery` 已補測試）。
