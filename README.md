[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# PV AE Master Generator & Signal Monitor

A modern, AI-powered Pharmacovigilance (PV) web application designed to automate the extraction of Adverse Event (AE) data from drug labels (package inserts) and perform post-marketing signal detection.

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
