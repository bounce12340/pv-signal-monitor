[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# 智慧藥品安全監視與訊號偵測平台 (PV AE Master Generator & Signal Monitor)

這是一個現代化的 AI 驅動藥品安全監視 (Pharmacovigilance, PV) 網路應用程式，涵蓋完整的 PV 訊號偵測工作流程：從藥品仿單提取不良反應 (AE) 數據、針對仿單執行季度發生率訊號偵測，以及——在近期與 PV-Link 專案合併後——監測已發表文獻（PubMed）中的新安全訊號，直到產出 CIOMS/E2B 草稿為止。

## 🌟 核心功能

頂端導覽列共有 8 個項目；**標示 NEW 的項目**為從 PV-Link 併入的文獻監測工作流程。

1. **📋 總覽 (Dashboard)**
   - 一覽各產品的季度監測進度，並提供捷徑直接前往本季尚未完成監測的產品。
   - **NEW** — 顯示「文獻待核閱」提醒（數量徽章），點擊可直接跳轉至文獻核閱。

2. **🤖 AI 驅動的不良反應提取 (主檔生成模式)**
   - 支援上傳 PDF、圖片或純文字格式的藥品仿單——可單檔或**多檔批次佇列**解析（依序提取，每檔可個別重試）。
   - 多 AI 供應商支援，統一經由單一 LLM client（`services/llm.ts`）解析：**平台預設**（免填金鑰）、**自備 Gemini**（結構化輸出），或任何**自備 OpenAI 相容端點**（OpenRouter、Ollama、LM Studio……）。
   - 提供可編輯的資料表介面，讓使用者在存入資料庫前檢視並修正 AI 提取的資料（批次解析結果同樣須經人工覆核後才能存檔）。

3. **🔎 文獻檢索 (NEW)**
   - 以目標活性成分、AE 關鍵字與排除詞組成精確、可重現的 **PubMed E-utilities** 檢索（esearch + efetch）；日期篩選採 PubMed 的**收錄日 (entry date, edat)**——即文獻被收錄進 PubMed 的日期——而非出版日期，讓監測時間窗能可靠捕捉到新出現的文獻。
   - 每筆檢索結果都會透過統一 LLM client 批次、並行產生 AI 相關性評分（0–100）與繁體中文摘要＋結論。
   - 檢索條件（筆數上限、起訖日期、AE 關鍵字、排除詞）會跨工作階段持久化保存，每輪只需重新輸入目標成分即可。

4. **✅ 文獻核閱 (NEW)**
   - 已由 AI 完成評分與摘要、待人工決定的文獻佇列，可依最低相關性分數篩選。
   - 選取文獻後，系統會為該筆記錄自動抽取一次結構化 PV 資料（產品、成分、不良反應原文、MedDRA PT 候選詞、嚴重性、因果關係、結果……）。
   - 可**匯入文獻庫**或**退回**——兩者皆會寫入稽核軌跡。每筆記錄都可產生、檢視、複製或下載 **CIOMS-I / E2B(R3) 草稿**（由抽取資料做確定性欄位對映；明確標示為草稿骨架，仍需藥物警戒人員審閱）。

5. **📊 訊號偵測與發生率監測 (監測模式)**
   - 根據「銷售數量」與「每日使用量」自動計算季度暴露量；輸入當季 AE 案例數（每列可勾選**嚴重 (Serious)** 標記）。
   - 以精確（Garwood）**Poisson 95% 信賴區間**，將實際發生率與仿單門檻比對，標記出**未預期 (Unexpected)**、**異常 (Alert)** 或**提醒 (Warning)** 訊號。
   - **判定規則可設定**（最小案例數、Alert 倍數、緩衝值）——每份報表都會記錄當時使用的規則；被噪音抑制的列會明確註記。未匹配主檔的 AE 輸入會出現模糊比對建議（並經 AI 同義詞正規化處理），推薦最接近的主檔術語。
   - 可匯出 CSV，或開啟列印版季度報告（可另存 PDF），內含判定規則說明與簽核欄。
   - **NEW** — 季度報告下方新增第二個獨立的「文獻訊號監測」面板：依**（活性成分 × MedDRA 首選術語）**聚合文獻庫，可用關鍵字篩選。此為質化的文獻筆數聚合，與上方 Poisson 信賴區間分析屬不同方法論（並列顯示以明確區別二者）——並非統計顯著性檢定。

6. **📚 文獻庫 (NEW)**
   - 瀏覽、以關鍵字／日期篩選文獻庫（從核閱模式匯入的記錄），並可匯出 CSV。
   - 對尚缺結構化 PV 資料的記錄執行**批次結構化抽取**，並顯示進度指示。
   - 從文獻庫移除記錄（會寫入稽核日誌）；亦可點擊記錄回到核閱模式重新開啟。

7. **🗄️ 主檔與資料庫管理 (資料庫模式)**
   - 集中管理所有已儲存的產品 AE 主檔。
   - 檢視歷史季度監測報告與訊號偵測批次紀錄。
   - **跨季趨勢分析**：各 AE 發生率逐季折線圖，連續 ≥ 2 季上升的項目自動標旗。
   - **主檔版本歷程**：每次更新皆封存舊版主檔列，並提供新增／移除／門檻變動的差異檢視器。
   - **完整 JSON 備份匯出／匯入**——備份格式亦涵蓋文獻庫與待核閱佇列，單一檔案即可還原全部資料。

8. **🛡️ 稽核軌跡 (稽核日誌模式)**
   - 面向 GVP 的系統操作日誌，採 **SHA-256 雜湊鏈**：每筆紀錄鏈結前一筆，介面會自動驗證鏈完整性，遭竄改或刪除即可偵測。
   - 唯讀的稽核軌跡，完整記錄所有 `CREATE`、`UPDATE`、`DELETE`、`EXPORT`、`IMPORT` 及 `ANALYSIS` 動作，涵蓋包含文獻工作流程在內的所有模組。

**⚙️ 設定**（右上角齒輪圖示）：AI 供應商／模型／金鑰設定與訊號判定規則調整——詳見下方**AI 供應商注意事項**。

## 🚀 快速開始 (本地端開發)

### 系統需求
- Node.js（建議 v18 以上版本）
- 試用本應用程式不需要任何 AI API Key——平台預設代理無需金鑰。只有想使用特定供應商／模型（Google Gemini、OpenRouter、本機 Ollama……）時才需要自備金鑰。

### 安裝步驟

1. 複製專案到本地端：
   ```bash
   git clone https://github.com/bounce12340/pv-signal-monitor.git
   cd pv-signal-monitor
   ```

2. 安裝依賴套件：
   ```bash
   npm install
   ```

3. 啟動開發伺服器：
   ```bash
   npm run dev
   ```

4.（選用）**在應用程式內**設定自備 AI 供應商：點右上角齒輪圖示，填入供應商／模型／API Key。不需要建立 `.env` 檔——金鑰只存在您的瀏覽器內（不會打包進程式碼、也不會上傳）。

### 測試

```bash
npm test
```

目前測試套件：**13 個測試檔、94 個測試**，全部通過（`vitest run`）。

## 🛠️ 技術架構
- **前端框架：** React 19、Vite、Tailwind CSS v4、Lucide React
- **AI 整合：** 單一統一 LLM client（`services/llm.ts`）依請求解析三種來源之一——同源的平台預設代理、Google GenAI SDK（`@google/genai`，結構化輸出），或泛用的 OpenAI 相容 REST 呼叫（OpenRouter／Ollama／LM Studio）——並共用一份 JSON 容錯解析器與批次併發輔助函式，同時供 AE 主檔提取與文獻管線使用。
- **文獻檢索：** PubMed E-utilities（esearch/efetch ＋ XML 解析），獨立於 LLM 層之外。
- **PV 詞彙：** MedDRA PT → SOC 種子詞典（離線查詢；非授權的完整 MedDRA 詞典），用於訊號聚合與 CIOMS/E2B 欄位對映。
- **資料儲存：** IndexedDB（單一資料庫、單一鍵值物件儲存區），搭配記憶體快取供同步讀取，IndexedDB 不可用時退回 localStorage，並會從舊版 localStorage 資料表一次性遷移。
- **後端：** 單一 Cloudflare Worker——靜態資產、`/llm/*` 平台 LLM 代理、`/ollama-cloud/*` 相容別名、`/api/*` 跨裝置同步（D1）、KV 限流。
- **測試：** Vitest

## 🔌 AI 供應商注意事項

三種來源，於「設定」中選擇：

- **平台預設（免填金鑰）：** 當使用者未設定任何自備供應商時，請求會同源送往 `/llm/*`，由 Worker 代理轉發至設定好的上游端點（OpenAI 相容）——只有在瀏覽器本身未帶 `Authorization` 標頭時，才會由伺服器端注入金鑰。無需任何設定；依 IP 限流。
- **自備 OpenAI 相容端點：** 提供 base URL（＋選填金鑰）；模型清單會即時從該端點的 `GET /models` 抓取並提供選單。支援文字與圖片輸入；PDF 則在瀏覽器內抽取文字層處理（pdf.js）——**純掃描版 PDF（僅圖片、無文字層）仍需具視覺能力的模型**。設定視窗內建 OpenRouter、本機 Ollama 與平台 Ollama-Cloud 別名的快速預設。
- **自備 Gemini：** 完整支援，包含原生 PDF 上傳與 schema 約束的結構化 JSON 輸出（免容錯步驟）。

## ⚠️ 資料保存注意

主要儲存位置是瀏覽器的 **IndexedDB**（單一資料庫、單一物件儲存區），並以記憶體快取鏡射供同步讀取；若 IndexedDB 不可用，應用程式會退化為使用 localStorage。升級後首次載入時，既有的 localStorage 資料會一次性遷移進 IndexedDB（原始 localStorage 資料仍保留原位，作為回退快照）。

請定期使用**資料庫模式 → 匯出備份 (Export Backup)**，需要還原時匯入該 JSON 檔即可——備份內容除了 AE 主檔資料外，還包含文獻庫與待核閱佇列。部署到 Cloudflare 時（見下文），導覽列的同步元件還會額外把快照推送到 D1（每位使用者保留最近 20 份），提供跨裝置同步與時間點回復。

## ☁️ 部署 (Cloudflare Workers)

本應用程式以單一 Worker 搭配靜態資產部署（`wrangler.jsonc`）：

```bash
npm run build
npx wrangler deploy
```

組成元件：

- **靜態資產＋SPA fallback** 直接提供服務；只有 `/llm/*`（平台 LLM 代理）、`/ollama-cloud/*`（相容別名）與 `/api/*`（同步）會呼叫 Worker。
- **伺服器端 LLM 金鑰：** `npx wrangler secret put OLLAMA_API_KEY` 讓平台預設與 Ollama-Cloud 別名路由能在不帶任何用戶端金鑰的情況下向上游驗證身分。這之所以安全，是因為部署完全位於自訂網域前方的存取控制層之後——`wrangler.jsonc` 刻意將 `workers_dev` 設為**停用**，因為 `workers.dev` 網址會繞過該存取控制層，讓 Worker 變成注入金鑰的開放代理。
- **限流：** 以 KV 為後端的固定窗限流器，對 `/llm/*` 與 `/ollama-cloud/*` 路由限制每 IP 每分鐘的請求數（KV 命名空間不可用時會 fail open，不阻擋請求）。
- **跨裝置同步：** 需要一個 D1 資料庫（`npx wrangler d1 create pv-signal-monitor`，再建立 `snapshots` 資料表——見 `worker/index.ts`）以及網域前方的存取控制層；使用者身分來自該控制層注入的 `Cf-Access-Authenticated-User-Email` 標頭。
- **CI/CD：** `.github/workflows/ci.yml` 會在每次推送時執行型別檢查／測試／建置，並在設定好 `CLOUDFLARE_API_TOKEN`（＋選填 `CLOUDFLARE_ACCOUNT_ID`）repo secrets 後自動部署 `main` 分支。
