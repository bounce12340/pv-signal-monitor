[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# 智慧药品安全监视与信号侦测平台 (PV AE Master Generator & Signal Monitor)

这是一个现代化的 AI 驱动药品安全监视 (Pharmacovigilance, PV) 网络应用程序，旨在自动化从药品说明书中提取不良反应 (AE) 数据，并执行上市后安全信号侦测与发生率监测。

## 🌟 核心功能

1. **🤖 AI 驱动的不良反应提取 (主档生成模式)**
   - 支持上传 PDF、图片或纯文本格式的药品说明书。
   - 利用 Google Gemini AI 自动提取系统器官分类 (SOC)、不良反应 (AE) 名称、说明书频率及阈值百分比。
   - 提供可编辑的数据表界面，让用户在存入数据库前进行人工复核与修改。

2. **📊 信号侦测与发生率监测 (监测模式)**
   - 根据“销售数量”与“每日使用量”自动计算季度暴露量 (Exposure / 分母)。
   - 输入当季 AE 案例数，系统将自动计算发生率 (Incidence Rate)。
   - 自动将实际发生率与说明书阈值进行比对，并标记出 **未预期 (Unexpected)**、**异常 (Alert)** 或 **提醒 (Warning)** 信号。
   - 支持将分析报表导出为 CSV 文件。

3. **🗄️ 主档与数据库管理 (数据库模式)**
   - 集中管理所有已保存的产品 AE 主档。
   - 查看历史季度监测报告与信号侦测记录。

4. **🛡️ 稽核轨迹 (稽核日志模式)**
   - 符合 GVP 规范的系统操作日志。
   - 只读的稽核轨迹，完整记录所有 `新增`、`修改`、`删除`、`导出` 及 `分析` 动作。

## 🚀 快速开始 (本地端开发)

### 系统需求
- Node.js (建议 v18 以上版本)
- Google Gemini API Key

### 安装步骤

1. 克隆项目到本地端：
   ```bash
   git clone https://github.com/your-username/pv-signal-monitor.git
   cd pv-signal-monitor
   ```

2. 安装依赖包：
   ```bash
   npm install
   ```

3. 配置环境变量：
   在项目根目录创建一个 `.env` 或 `.env.local` 文件，并填入您的 Gemini API Key：
   ```env
   API_KEY=您的_gemini_api_key
   ```

4. 启动开发服务器：
   ```bash
   npm run dev
   ```

## 🛠️ 技术架构
- **前端框架:** React 19, Vite, Tailwind CSS, Lucide React
- **AI 整合:** Google GenAI SDK (`@google/genai`), Gemini 3 Flash Preview 模型
- **数据存储:** 浏览器 LocalStorage 搭配内存缓存 (纯前端架构)

## 🔌 多 AI 模型对接指南 (OpenAI, Claude, xAI, Ollama, OpenRouter)

目前本项目默认使用 Google 的 `@google/genai` SDK 来调用 Gemini 模型。如果您希望在未来扩展支持多种 AI 来源，可以参考以下的架构指南进行修改：

### 1. 使用统一的 API 网关 (强烈推荐：OpenRouter)
要支持多种模型又不想安装一堆不同的 SDK，最简单的方法是使用 **OpenRouter**。它提供与 OpenAI 完全兼容的 REST API，并能将请求路由给 Claude, xAI, Gemini, Llama 等各大模型。
- 将项目中的 `@google/genai` 替换为标准的 `openai` Node.js SDK。
- 将 API 的 `baseURL` 更改为 `https://openrouter.ai/api/v1`。
- 根据用户的选择，动态传入对应的模型名称字符串 (例如：`anthropic/claude-3.5-sonnet`, `x-ai/grok-2`)。

### 2. 通过 Ollama 运行本地模型 (Local Models)
如果您的药品安全监视 (PV) 数据具备高度机密性，不希望上传至云端，您可以使用 **Ollama** 在本地端运行开源模型。
- 确保 Ollama 已在本地端运行 (默认为 `http://localhost:11434`)。
- 同样使用 `openai` SDK，并将 `baseURL` 指向 `http://localhost:11434/v1`。
- *注意：由于本项目是纯前端 (Vite) 架构，您可能需要配置 Ollama 的环境变量来允许 CORS 跨域请求。*

### 3. 代码重构步骤
若要实现此功能，您需要进行以下修改：
1. **抽象化 AI 服务层：** 将 `services/gemini.ts` 重命名为 `services/ai.ts`。创建一个通用的接口，例如 `extractAEMaster(textInput, fileInput, provider, model, apiKey)`。
2. **UI 设置界面：** 在前端画面新增一个“设置 (Settings)”弹出窗口，让用户可以选择他们偏好的 AI 供应商 (Gemini, OpenAI, Claude, Ollama)、输入指定的模型名称，以及填写他们自己的 API Key。
3. **提示词工程 (Prompt Engineering) 微调：** 不同的模型对于输出 JSON 的理解能力不同。您可能需要根据选择的模型微调 `SYSTEM_INSTRUCTION`，或是针对 OpenAI 兼容的 API 加上强制 JSON 输出的参数 (例如 `response_format: { type: "json_object" }`)。
