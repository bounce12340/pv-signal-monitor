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
