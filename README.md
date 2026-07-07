[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# PV AE Master Generator & Signal Monitor

A modern, AI-powered Pharmacovigilance (PV) web application designed to automate the extraction of Adverse Event (AE) data from drug labels (package inserts) and perform post-marketing signal detection.

## 🌟 Features

1. **🤖 AI-Powered AE Extraction (Generator Mode)**
   - Upload drug labels in PDF, Image, or Text format — single file or **multi-file batch queue**.
   - Multi-provider AI support: **Google Gemini** (structured output) or any **OpenAI-compatible endpoint** (OpenRouter, Ollama, LM Studio...). Configure provider, model, and your own API key in the in-app Settings — keys stay in your browser's localStorage and are never bundled or uploaded.
   - Editable data grid to review and refine AI-extracted data before saving to the database (batch results also require human review before saving).

2. **📊 Signal Detection & Monitoring (Monitor Mode)**
   - Calculate quarterly exposure rates based on sales volume and daily dosage.
   - Input quarterly AE case counts (with per-row **Serious** flag) to automatically calculate incidence rates.
   - Compares real-world incidence rates against label thresholds to flag **Unexpected**, **Alert**, or **Warning** signals; serious + unexpected combinations get top-priority badges.
   - **Configurable signal rules** (minimum case count, alert multiplier, tolerance buffer) — every report records the rules used; noise-suppressed rows are annotated.
   - Fuzzy matching suggests the closest master term for unmatched AE inputs (one-click adopt).
   - Export analysis reports to CSV, or open a **print-friendly quarterly report** (save as PDF) with rule statement and signature blocks.

3. **🗄️ Master Data Management (Library Mode)**
   - Centralized database for managing all saved Product AE Masters.
   - View historical quarterly monitoring reports and signal detection batches.
   - **Cross-quarter trend analysis**: per-AE incidence-rate line chart with automatic flags for terms rising ≥ 2 consecutive quarters.
   - **Master version history**: previous master rows are archived on every update, with an added/removed/threshold-changed diff viewer.
   - **Full JSON backup export / import** (localStorage is fragile — back up regularly).

4. **🛡️ Audit Trail (Audit Mode)**
   - GVP-oriented system logging with a **SHA-256 hash chain**: every entry chains to the previous one, and the UI verifies chain integrity so tampering or deletion is detectable.
   - Read-only audit trail tracking all `CREATE`, `UPDATE`, `DELETE`, `EXPORT`, `IMPORT`, and `ANALYSIS` actions.

## 🚀 Getting Started (Local Development)

### Prerequisites
- Node.js (v18+ recommended)
- An API key for your chosen AI provider (Google Gemini, OpenRouter, ...) — or a local Ollama instance

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/bounce12340/pv-signal-monitor.git
   cd pv-signal-monitor
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Configure your AI provider **in the app**: click the gear icon (top-right) and enter provider / model / API key. No `.env` file is needed — the key is stored only in your browser.

### Tests

```bash
npm test
```

## 🛠️ Tech Stack
- **Frontend:** React 19, Vite, Tailwind CSS v4, Lucide React
- **AI Integration:** Google GenAI SDK (`@google/genai`) with structured output, plus generic OpenAI-compatible REST support (OpenRouter / Ollama / LM Studio)
- **Data Storage:** LocalStorage with In-Memory Caching (Client-side) + JSON backup export/import
- **Testing:** Vitest

## 🔌 AI Provider Notes

- **Gemini (default):** full support including PDF upload and structured JSON output.
- **OpenAI-compatible endpoints:** text and image inputs are supported; PDF upload is not (paste the label text or upload images instead). Quick presets for OpenRouter (`https://openrouter.ai/api/v1`) and local Ollama (`http://localhost:11434/v1`) are built into the Settings dialog.
- **Ollama (local/private data):** run Ollama locally and pick a vision-capable model for image extraction. You may need to configure CORS (`OLLAMA_ORIGINS`) to allow requests from the Vite dev server.

## ⚠️ Data Durability

All data lives in your browser's localStorage. Clearing site data erases everything — use **Library Mode → 匯出備份 (Export Backup)** regularly, and import the JSON file to restore.
