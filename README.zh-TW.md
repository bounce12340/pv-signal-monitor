[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# PV AE Master 生成器 & 訊號監測系統

一套現代化、AI 驅動的藥品安全監視（PV）網頁應用程式，專為自動化提取藥品仿單不良反應（AE）資料並執行上市後訊號偵測而設計。

## 🌟 核心功能

### 1. 🤖 AI 驅動的 AE 擷取（Generator 模式）
- 支援上傳 PDF、圖片或文字格式的藥品仿單
- 整合 Google Gemini AI，自動擷取：
  - 器官系統分類（SOC）
  - 不良反應項目（AE）
  - 發生頻率
  - 閾值百分比
- 可編輯的資料表格，便於人工確認後再儲存

### 2. 📊 訊號偵測與監測（Monitor 模式）
- 依銷售量與每日劑量計算每季暴露率
- 輸入每季 AE 案件數，自動計算發生率
- 比對真實發生率與仿單閾值，標記 **Unexpected（意外）**、**Alert（警示）**、**Warning（警告）** 訊號
- 分析報告可匯出為 CSV

### 3. 🗄️ Master 資料管理（Library 模式）
- 集中管理所有已儲存的產品 AE Master 資料庫
- 查閱歷史季度監測報告與訊號偵測批次

### 4. 🛡️ 稽核軌跡（Audit 模式）
- 符合 GVP 規範的系統日誌
- 唯讀稽核軌跡，追蹤所有 `CREATE`、`UPDATE`、`DELETE`、`EXPORT`、`ANALYSIS` 操作

## 🚀 快速開始（本機開發）

### 環境需求
- Node.js（v18+ 建議）
- Google Gemini API Key

### 安裝步驟

1. 複製儲存庫：
   ```bash
   git clone https://github.com/bounce12340/pv-signal-monitor.git
   cd pv-signal-monitor
   ```

2. 安裝相依套件：
   ```bash
   npm install
   ```

3. 設定環境變數：
   在根目錄建立 `.env` 或 `.env.local` 檔案並填入 Gemini API Key：
   ```env
   API_KEY=your_gemini_api_key_here
   ```

4. 啟動開發伺服器：
   ```bash
   npm run dev
   ```

## 🛠️ 技術架構

| 層級 | 技術 |
|------|------|
| 前端框架 | React 19、Vite、Tailwind CSS、Lucide React |
| AI 整合 | Google GenAI SDK、Gemini 3 Flash Preview |
| 資料儲存 | LocalStorage + 記憶體快取（客戶端） |

## 🔌 多 AI 供應商支援（路線圖）

目前使用 Google Gemini。如需整合多個 AI 供應商（OpenAI、Claude、xAI、Ollama、OpenRouter 等），可透過以下方式：

- **OpenRouter**：統一 API 閘道，相容 OpenAI SDK，可路由至 Claude、xAI、Gemini 等模型
- **Ollama**：本地模型部署，適合高度敏感的藥品安全資料，無需傳至雲端

## 📄 授權

MIT License — 免費使用、修改與發佈。
