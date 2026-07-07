[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# 智慧藥品安全監視與訊號偵測平台 (PV AE Master Generator & Signal Monitor)

這是一個現代化的 AI 驅動藥品安全監視 (Pharmacovigilance, PV) 網路應用程式，旨在自動化從藥品仿單中提取不良反應 (AE) 數據，並執行上市後安全訊號偵測與發生率監測。

## 🌟 核心功能

1. **🤖 AI 驅動的不良反應提取 (主檔生成模式)**
   - 支援上傳 PDF、圖片或純文字格式的藥品仿單，可單檔或**多檔批次佇列**解析。
   - 多 AI 供應商支援：**Google Gemini**（結構化輸出）或任何 **OpenAI 相容端點**（OpenRouter、Ollama、LM Studio…）。在應用程式內的「設定」填入供應商、模型與您自己的 API Key——金鑰只存在您的瀏覽器 localStorage，不會打包進程式碼、也不會上傳。
   - 提供可編輯的資料表介面，讓使用者在存入資料庫前進行人工覆核與修改（批次解析結果同樣須逐一覆核後才能存檔）。

2. **📊 訊號偵測與發生率監測 (監測模式)**
   - 根據「銷售數量」與「每日使用量」自動計算季度暴露量 (Exposure / 分母)。
   - 輸入當季 AE 案例數（每列可勾選**嚴重 Serious**），系統將自動計算發生率 (Incidence Rate)。
   - 自動將實際發生率與仿單門檻進行比對，並標記出 **未預期 (Unexpected)**、**異常 (Alert)** 或 **提醒 (Warning)** 訊號；「嚴重＋未預期」組合會以最高層級徽章顯示。
   - **判定規則可設定**（最小案例數、Alert 倍數、緩衝值），每份報表都會記錄當時使用的規則；被噪音抑制的列會明確註記。
   - 未匹配主檔的 AE 名稱會出現模糊比對建議（「是否即為主檔的 X？」一鍵採用）。
   - 分析報表可匯出 CSV，或開啟**列印版季度報告**（可另存 PDF），內含判定規則說明與簽核欄。

3. **🗄️ 主檔與資料庫管理 (資料庫模式)**
   - 集中管理所有已儲存的產品 AE 主檔。
   - 檢視歷史季度監測報告與訊號偵測紀錄。
   - **跨季趨勢分析**：各 AE 發生率逐季折線圖，連續 2 季上升的項目自動標旗。
   - **主檔版本管理**：每次「儲存更新」自動封存舊版主檔，並提供新增／移除／門檻變動的差異比較。
   - **全量 JSON 備份匯出／匯入**（localStorage 資料脆弱，請定期備份）。

4. **🛡️ 稽核軌跡 (稽核日誌模式)**
   - 面向 GVP 的系統操作日誌，採 **SHA-256 雜湊鏈**：每筆紀錄鏈結前一筆，介面會自動驗證鏈完整性，遭修改或刪除即可偵測。
   - 唯讀的稽核軌跡，完整記錄所有 `新增`、`修改`、`刪除`、`匯出`、`匯入` 及 `分析` 動作。

## 🚀 快速開始 (本地端開發)

### 系統需求
- Node.js (建議 v18 以上版本)
- 您所選 AI 供應商的 API Key（Google Gemini、OpenRouter…），或本機執行的 Ollama

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

4. **在應用程式內設定 AI**：點右上角齒輪圖示，填入供應商／模型／API Key。不需要建立 `.env` 檔——金鑰只儲存在您的瀏覽器內。

### 測試

```bash
npm test
```

## 🛠️ 技術架構
- **前端框架:** React 19, Vite, Tailwind CSS v4, Lucide React
- **AI 整合:** Google GenAI SDK (`@google/genai`) 結構化輸出，另支援泛用 OpenAI 相容 REST 端點（OpenRouter / Ollama / LM Studio）
- **資料儲存:** 瀏覽器 LocalStorage 搭配記憶體快取（純前端架構）＋ JSON 備份匯出/匯入
- **測試:** Vitest

## 🔌 AI 供應商注意事項

- **Gemini（預設）：** 完整支援，包含 PDF 直接上傳與結構化 JSON 輸出。
- **OpenAI 相容端點：** 支援文字與圖片輸入；不支援 PDF 直接上傳（請貼上仿單文字或改用圖片）。設定視窗內建 OpenRouter（`https://openrouter.ai/api/v1`）與本機 Ollama（`http://localhost:11434/v1`）快速預設。
- **Ollama（地端／機密資料）：** 在本機執行 Ollama 並選擇支援視覺的模型即可做圖片提取。可能需設定 CORS（`OLLAMA_ORIGINS`）以允許 Vite 開發伺服器的跨域請求。

## ⚠️ 資料保存注意

所有資料都存在瀏覽器的 localStorage，清除網站資料即全部消失——請定期使用「資料庫模式 → 匯出備份」，需要還原時匯入該 JSON 檔即可。
