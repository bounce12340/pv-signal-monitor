# PV AE Master Generator & Signal Monitor
*(智慧藥品安全監視與訊號偵測平台)*

A modern, AI-powered Pharmacovigilance (PV) web application designed to automate the extraction of Adverse Event (AE) data from drug labels (package inserts) and perform post-marketing signal detection.

[**繁體中文說明 (Traditional Chinese)**](#繁體中文說明)

---

## 🌟 Features

1. **🤖 AI-Powered AE Extraction (Generator Mode)**
   - Upload drug labels in PDF, Image, or Text format.
   - Leverages Google's Gemini AI to automatically extract System Organ Class (SOC), Adverse Events, frequencies, and threshold percentages.
   - Editable data grid to review and refine AI-extracted data before saving to the database.

2. **📊 Signal Detection & Monitoring (Monitor Mode)**
   - Calculate quarterly exposure rates based on sales volume and daily dosage.
   - Input quarterly AE case counts to automatically calculate incidence rates.
   - Compares real-world incidence rates against label thresholds to flag **Unexpected**, **Alert**, or **Warning** signals.
   - Export analysis reports to CSV.

3. **🗄️ Master Data Management (Library Mode)**
   - Centralized database for managing all saved Product AE Masters.
   - View historical quarterly monitoring reports and signal detection batches.

4. **🛡️ Audit Trail (Audit Mode)**
   - GVP-compliant system logging.
   - Read-only audit trail tracking all `CREATE`, `UPDATE`, `DELETE`, `EXPORT`, and `ANALYSIS` actions.

## 🚀 Getting Started (Local Development)

### Prerequisites
- Node.js (v18+ recommended)
- A Google Gemini API Key

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/pv-signal-monitor.git
   cd pv-signal-monitor
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Create a `.env` or `.env.local` file in the root directory and add your Gemini API Key:
   ```env
   API_KEY=your_gemini_api_key_here
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## 🛠️ Tech Stack
- **Frontend:** React 19, Vite, Tailwind CSS, Lucide React
- **AI Integration:** Google GenAI SDK (`@google/genai`), Gemini 3 Flash Preview
- **Data Storage:** LocalStorage with In-Memory Caching (Client-side)

## 🔌 Multi-AI Provider Support (Roadmap/Guide)

Currently, this project uses Google's `@google/genai` SDK to interact with Gemini models. If you wish to integrate multiple AI providers (such as OpenAI, Claude, xAI, Ollama, or OpenRouter), you can follow this architectural guide:

### 1. Use a Unified API Gateway (Recommended: OpenRouter)
The easiest way to support multiple models without installing dozens of SDKs is to use **OpenRouter**. OpenRouter provides an OpenAI-compatible REST API that routes requests to Claude, xAI, Gemini, Llama, and more.
- Replace the `@google/genai` SDK with the standard `openai` Node.js SDK.
- Change the `baseURL` to `https://openrouter.ai/api/v1`.
- Pass the specific model string (e.g., `anthropic/claude-3.5-sonnet`, `x-ai/grok-2`) dynamically based on user selection.

### 2. Local Models via Ollama
If you want to process highly sensitive Pharmacovigilance data locally without sending it to the cloud, you can use **Ollama**.
- Ensure Ollama is running locally (`http://localhost:11434`).
- Use the `openai` SDK and set the `baseURL` to `http://localhost:11434/v1`.
- *Note: You may need to configure CORS in Ollama to allow requests from your Vite frontend.*

### 3. Code Refactoring Steps
To implement this in the codebase:
1. **Abstract the AI Service:** Modify `services/gemini.ts` (rename it to `services/ai.ts`). Create a generic interface `extractAEMaster(textInput, fileInput, provider, model, apiKey)`.
2. **UI Configuration:** Add a "Settings" modal in the UI where users can select their preferred AI Provider (Gemini, OpenAI, Claude, Ollama), input the specific Model Name, and provide their API Key.
3. **Prompt Engineering:** Different models parse JSON differently. You may need to adjust the `SYSTEM_INSTRUCTION` or use specific JSON-mode flags (like `response_format: { type: "json_object" }` for OpenAI) depending on the selected provider.

---

<h1 id="繁體中文說明">繁體中文說明</h1>

# 智慧藥品安全監視與訊號偵測平台

這是一個現代化的 AI 驅動藥品安全監視 (Pharmacovigilance, PV) 網路應用程式，旨在自動化從藥品仿單中提取不良反應 (AE) 數據，並執行上市後安全訊號偵測與發生率監測。

## 🌟 核心功能

1. **🤖 AI 驅動的不良反應提取 (主檔生成模式)**
   - 支援上傳 PDF、圖片或純文字格式的藥品仿單。
   - 利用 Google Gemini AI 自動提取系統器官分類 (SOC)、不良反應 (AE) 名稱、仿單頻率及門檻百分比。
   - 提供可編輯的資料表介面，讓使用者在存入資料庫前進行人工覆核與修改。

2. **📊 訊號偵測與發生率監測 (監測模式)**
   - 根據「銷售數量」與「每日使用量」自動計算季度暴露量 (Exposure / 分母)。
   - 輸入當季 AE 案例數，系統將自動計算發生率 (Incidence Rate)。
   - 自動將實際發生率與仿單門檻進行比對，並標記出 **未預期 (Unexpected)**、**異常 (Alert)** 或 **提醒 (Warning)** 訊號。
   - 支援將分析報表匯出為 CSV 檔。

3. **🗄️ 主檔與資料庫管理 (資料庫模式)**
   - 集中管理所有已儲存的產品 AE 主檔。
   - 檢視歷史季度監測報告與訊號偵測紀錄。

4. **🛡️ 稽核軌跡 (稽核日誌模式)**
   - 符合 GVP 規範的系統操作日誌。
   - 唯讀的稽核軌跡，完整記錄所有 `新增`、`修改`、`刪除`、`匯出` 及 `分析` 動作。

## 🚀 快速開始 (本地端開發)

### 系統需求
- Node.js (建議 v18 以上版本)
- Google Gemini API Key

### 安裝步驟

1. 複製專案到本地端：
   ```bash
   git clone https://github.com/your-username/pv-signal-monitor.git
   cd pv-signal-monitor
   ```

2. 安裝依賴套件：
   ```bash
   npm install
   ```

3. 設定環境變數：
   在專案根目錄建立一個 `.env` 或 `.env.local` 檔案，並填入您的 Gemini API Key：
   ```env
   API_KEY=您的_gemini_api_key
   ```

4. 啟動開發伺服器：
   ```bash
   npm run dev
   ```

## 🛠️ 技術架構
- **前端框架:** React 19, Vite, Tailwind CSS, Lucide React
- **AI 整合:** Google GenAI SDK (`@google/genai`), Gemini 3 Flash Preview 模型
- **資料儲存:** 瀏覽器 LocalStorage 搭配記憶體快取 (純前端架構)

## 🔌 多 AI 模型串接指南 (OpenAI, Claude, xAI, Ollama, OpenRouter)

目前本專案預設使用 Google 的 `@google/genai` SDK 來呼叫 Gemini 模型。如果您希望在未來擴充支援多種 AI 來源，可以參考以下的架構指南進行修改：

### 1. 使用統一的 API 網關 (強烈推薦：OpenRouter)
要支援多種模型又不想安裝一堆不同的 SDK，最簡單的方法是使用 **OpenRouter**。它提供與 OpenAI 完全相容的 REST API，並能將請求路由給 Claude, xAI, Gemini, Llama 等各大模型。
- 將專案中的 `@google/genai` 替換為標準的 `openai` Node.js SDK。
- 將 API 的 `baseURL` 更改為 `https://openrouter.ai/api/v1`。
- 根據使用者的選擇，動態傳入對應的模型名稱字串 (例如：`anthropic/claude-3.5-sonnet`, `x-ai/grok-2`)。

### 2. 透過 Ollama 執行地端模型 (Local Models)
如果您的藥品安全監視 (PV) 資料具備高度機密性，不希望上傳至雲端，您可以使用 **Ollama** 在本地端執行開源模型。
- 確保 Ollama 已在本地端運行 (預設為 `http://localhost:11434`)。
- 同樣使用 `openai` SDK，並將 `baseURL` 指向 `http://localhost:11434/v1`。
- *注意：由於本專案是純前端 (Vite) 架構，您可能需要設定 Ollama 的環境變數來允許 CORS 跨域請求。*

### 3. 程式碼重構步驟
若要實作此功能，您需要進行以下修改：
1. **抽象化 AI 服務層：** 將 `services/gemini.ts` 重新命名為 `services/ai.ts`。建立一個通用的介面，例如 `extractAEMaster(textInput, fileInput, provider, model, apiKey)`。
2. **UI 設定介面：** 在前端畫面新增一個「設定 (Settings)」彈出視窗，讓使用者可以選擇他們偏好的 AI 供應商 (Gemini, OpenAI, Claude, Ollama)、輸入指定的模型名稱，以及填寫他們自己的 API Key。
3. **提示詞工程 (Prompt Engineering) 微調：** 不同的模型對於輸出 JSON 的理解能力不同。您可能需要根據選擇的模型微調 `SYSTEM_INSTRUCTION`，或是針對 OpenAI 相容的 API 加上強制 JSON 輸出的參數 (例如 `response_format: { type: "json_object" }`)。
