[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# PV AE Master Generator & Signal Monitor

A modern, AI-powered Pharmacovigilance (PV) web application. It covers the full PV signal-detection workflow: extracting Adverse Event (AE) data from drug labels, running quarterly incidence-rate signal detection against those labels, and — since the recent merge with the PV-Link project — monitoring published literature (PubMed) for new safety signals through to a CIOMS/E2B draft.

## 🌟 Features

The top navigation has 8 entries; **items marked NEW** are the literature-monitoring workflow merged in from PV-Link.

1. **📋 Dashboard (總覽)**
   - Per-product quarterly monitoring progress at a glance, with a shortcut into any product still pending this quarter.
   - **NEW** — surfaces a "literature pending review" reminder (count badge) that jumps straight into Literature Review.

2. **🤖 AI-Powered AE Extraction (Generator Mode)**
   - Upload drug labels in PDF, Image, or Text format — single file or **multi-file batch queue** (sequential extraction with per-file retry).
   - Multi-provider AI support, resolved through a single unified LLM client (`services/llm.ts`): the **platform default** (no key required), **BYO Gemini** (structured output), or any **BYO OpenAI-compatible endpoint** (OpenRouter, Ollama, LM Studio...).
   - Editable data grid to review and refine AI-extracted data before saving to the database (batch results also require human review before saving).

3. **🔎 Literature Search (NEW)**
   - Precise, reproducible **PubMed E-utilities** search (esearch + efetch) built from target active ingredients, AE keywords, and exclusion terms; date filtering is based on PubMed's **entry date (edat)** — when the article was added to PubMed — not the publication date, so a monitoring window reliably catches what newly appeared.
   - AI relevance scoring (0–100) and a Traditional-Chinese summary + conclusion are generated for every hit, batched and run concurrently through the unified LLM client.
   - Search criteria (result cap, date range, AE keywords, exclusions) persist across sessions; only the target ingredient needs to be retyped each round.

4. **✅ Literature Review (NEW)**
   - Queue of AI-scored, AI-summarized articles awaiting human decision; filterable by minimum relevance score.
   - On selection, structured PV data (product, ingredient, verbatim AE, MedDRA PT candidate, seriousness, causality, outcome...) is auto-extracted once per record.
   - **Import into the literature library** or **reject** — both actions write to the audit trail. A **CIOMS-I / E2B(R3) draft** can be generated, viewed, copied, or downloaded per record (deterministic field mapping from the extracted data; explicitly a draft skeleton that still needs PV staff review).

5. **📊 Signal Detection & Monitoring (Monitor Mode)**
   - Calculate quarterly exposure rates from sales volume and daily dosage; input quarterly AE case counts (with per-row **Serious** flag).
   - Compares real-world incidence rates — with an exact (Garwood) **Poisson 95% confidence interval** — against label thresholds to flag **Unexpected**, **Alert**, or **Warning** signals.
   - **Configurable signal rules** (minimum case count, alert multiplier, tolerance buffer) — every report records the rules used; noise-suppressed rows are annotated. Fuzzy matching (plus an AI synonym-normalization pass) suggests the closest master term for unmatched AE inputs.
   - Export to CSV or a print-friendly quarterly report (save as PDF) with rule statement and signature blocks.
   - **NEW** — a second, independent "Literature Signal Monitoring" panel below the quarterly report: aggregates the literature library by **(active ingredient × MedDRA Preferred Term)**, filterable by keyword. This is a qualitative literature-count aggregation, a different methodology from the Poisson CI analysis above (and displayed side-by-side to make that distinction explicit) — not a statistical significance test.

6. **📚 Literature Library (NEW)**
   - Browse, keyword/date-filter, and CSV-export the literature library (imported records from Review Mode).
   - **Batch structured extraction** for any records still missing structured PV data, with a progress indicator.
   - Remove a record from the library (with audit log entry); click through to re-open a record in Review Mode.

7. **🗄️ Master Data Management (Library Mode)**
   - Centralized database for managing all saved Product AE Masters.
   - View historical quarterly monitoring reports and signal detection batches.
   - **Cross-quarter trend analysis**: per-AE incidence-rate line chart with automatic flags for terms rising ≥ 2 consecutive quarters.
   - **Master version history**: previous master rows are archived on every update, with an added/removed/threshold-changed diff viewer.
   - **Full JSON backup export / import** — the backup schema also carries the literature library and pending-review queue, so a single file restores everything.

8. **🛡️ Audit Trail (Audit Mode)**
   - GVP-oriented system logging with a **SHA-256 hash chain**: every entry chains to the previous one, and the UI verifies chain integrity so tampering or deletion is detectable.
   - Read-only audit trail tracking all `CREATE`, `UPDATE`, `DELETE`, `EXPORT`, `IMPORT`, and `ANALYSIS` actions, across all modules including the literature workflow.

**⚙️ Settings** (gear icon, top-right): AI provider / model / key configuration and signal-rule tuning — see **AI Provider Notes** below.

## 🚀 Getting Started (Local Development)

### Prerequisites
- Node.js (v18+ recommended)
- No AI API key is required to try the app — the platform-default proxy needs no key. Bring your own key only if you want to use a specific provider/model (Google Gemini, OpenRouter, a local Ollama, ...).

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

4. (Optional) Configure a BYO AI provider **in the app**: click the gear icon (top-right) and enter provider / model / API key. No `.env` file is needed — the key is stored only in your browser (never bundled or uploaded).

### Tests

```bash
npm test
```

Current suite: **13 test files, 94 tests**, all passing (`vitest run`).

## 🛠️ Tech Stack
- **Frontend:** React 19, Vite, Tailwind CSS v4, Lucide React
- **AI Integration:** a single unified LLM client (`services/llm.ts`) resolves one of three sources per request — the platform-default same-origin proxy, Google GenAI SDK (`@google/genai`, structured output), or a generic OpenAI-compatible REST call (OpenRouter / Ollama / LM Studio) — plus one shared JSON-repair parser and batched-concurrency helper used by both the AE-master extraction and the literature pipeline
- **Literature retrieval:** PubMed E-utilities (esearch/efetch + XML parsing), independent of the LLM layer
- **PV vocabulary:** a MedDRA PT → SOC seed dictionary (offline lookup; not a licensed full MedDRA distribution) for signal aggregation and CIOMS/E2B field mapping
- **Data Storage:** IndexedDB (single database, single key-value object store) with an in-memory cache for synchronous reads, a localStorage fallback when IndexedDB is unavailable, and a one-time migration from the pre-IndexedDB localStorage tables
- **Backend:** a single Cloudflare Worker — static assets, `/llm/*` platform LLM proxy, `/ollama-cloud/*` compatibility alias, `/api/*` cross-device sync (D1), KV-backed rate limiting
- **Testing:** Vitest

## 🔌 AI Provider Notes

Three sources, chosen in Settings:

- **Platform default (no key needed):** when no BYO provider is configured, requests go same-origin to `/llm/*`, which the Worker proxies to the configured upstream (OpenAI-compatible) and — only when the browser sends no `Authorization` header itself — injects a server-side key. Nothing to configure; rate-limited per IP.
- **BYO OpenAI-compatible:** supply a base URL (+ optional key); the model list is fetched live from the endpoint's `GET /models` and offered as a picker. Text and image inputs are supported; PDFs are handled by extracting the text layer in the browser (pdf.js) — **a pure scanned PDF (image-only, no text layer) still needs a vision-capable model**. Quick presets for OpenRouter, a local Ollama, and the platform's Ollama-Cloud alias are built into the Settings dialog.
- **BYO Gemini:** full support including native PDF upload and schema-constrained structured JSON output (no repair step needed).

## ⚠️ Data Durability

The primary store is your browser's **IndexedDB** (one database, one object store), mirrored by an in-memory cache for synchronous reads; if IndexedDB is unavailable the app degrades to localStorage. On first load after upgrading, existing localStorage data is migrated into IndexedDB once (the original localStorage values are left in place as a rollback snapshot).

Use **Library Mode → 匯出備份 (Export Backup)** regularly, and import the JSON file to restore — the backup includes the literature library and pending-review queue alongside the AE-master data. When deployed on Cloudflare (below), the sync widget in the nav bar additionally pushes snapshots to D1 (last 20 kept per user), enabling cross-device sync and point-in-time recovery.

## ☁️ Deployment (Cloudflare Workers)

The app deploys as a single Worker with static assets (`wrangler.jsonc`):

```bash
npm run build
npx wrangler deploy
```

Components:

- **Static assets + SPA fallback** served directly; only `/llm/*` (platform LLM proxy), `/ollama-cloud/*` (compatibility alias), and `/api/*` (sync) invoke the Worker.
- **Server-side LLM key:** `npx wrangler secret put OLLAMA_API_KEY` lets the platform-default and Ollama-Cloud-alias routes authenticate to the upstream without any client-side key. This is only safe because the deployment sits entirely behind an access-control layer in front of the custom domain — `workers_dev` is intentionally left **disabled** in `wrangler.jsonc`, since a `workers.dev` URL would bypass that layer and turn the Worker into an open proxy for the injected key.
- **Rate limiting:** a KV-backed fixed-window limiter caps requests per IP per minute on the `/llm/*` and `/ollama-cloud/*` routes (fails open if the KV namespace is unavailable).
- **Cross-device sync:** requires a D1 database (`npx wrangler d1 create pv-signal-monitor`, then create the `snapshots` table — see `worker/index.ts`) and an access-control layer in front of the domain; user identity comes from the `Cf-Access-Authenticated-User-Email` header injected by that layer.
- **CI/CD:** `.github/workflows/ci.yml` runs typecheck/tests/build on every push and auto-deploys `main` when the `CLOUDFLARE_API_TOKEN` (+ optional `CLOUDFLARE_ACCOUNT_ID`) repo secrets are set.
