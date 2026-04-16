[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# PV AE 마스터 생성기 및 시그널 모니터 (PV AE Master Generator & Signal Monitor)

의약품 첨부문서(설명서)에서 이상사례(AE) 데이터 추출을 자동화하고 시판 후 시그널 탐지를 수행하도록 설계된 AI 기반 최신 약물감시(PV) 웹 애플리케이션입니다.

## 🌟 주요 기능

1. **🤖 AI 기반 AE 추출 (생성기 모드)**
   - PDF, 이미지 또는 텍스트 형식의 의약품 첨부문서를 업로드합니다.
   - Google의 Gemini AI를 활용하여 신체기관분류(SOC), 이상사례(AE), 발생 빈도 및 임계값 비율을 자동으로 추출합니다.
   - 데이터베이스에 저장하기 전에 AI가 추출한 데이터를 검토하고 수정할 수 있는 편집 가능한 데이터 그리드를 제공합니다.

2. **📊 시그널 탐지 및 모니터링 (모니터 모드)**
   - 판매량과 1일 투여량을 기반으로 분기별 노출량(분모)을 계산합니다.
   - 분기별 AE 발생 건수를 입력하면 시스템이 자동으로 발생률(Incidence Rate)을 계산합니다.
   - 실제 발생률을 첨부문서의 임계값과 비교하여 **예상치 못한 사례(Unexpected)**, **주의(Alert)** 또는 **경고(Warning)** 시그널을 표시합니다.
   - 분석 보고서를 CSV 형식으로 내보낼 수 있습니다.

3. **🗄️ 마스터 데이터 관리 (라이브러리 모드)**
   - 저장된 모든 제품 AE 마스터를 중앙에서 관리합니다.
   - 과거 분기별 모니터링 보고서 및 시그널 탐지 기록을 확인합니다.

4. **🛡️ 감사 추적 (감사 모드)**
   - GVP 가이드라인을 준수하는 시스템 작업 로그.
   - `생성`, `업데이트`, `삭제`, `내보내기` 및 `분석` 등 모든 작업을 기록하는 읽기 전용 감사 추적.

## 🚀 시작하기 (로컬 개발)

### 사전 준비
- Node.js (v18 이상 권장)
- Google Gemini API 키

### 설치 방법

1. 저장소를 클론합니다:
   ```bash
   git clone https://github.com/your-username/pv-signal-monitor.git
   cd pv-signal-monitor
   ```

2. 종속성을 설치합니다:
   ```bash
   npm install
   ```

3. 환경 변수를 구성합니다:
   프로젝트 루트 디렉토리에 `.env` 또는 `.env.local` 파일을 만들고 Gemini API 키를 추가합니다:
   ```env
   API_KEY=당신의_gemini_api_key
   ```

4. 개발 서버를 시작합니다:
   ```bash
   npm run dev
   ```

## 🛠️ 기술 스택
- **프론트엔드:** React 19, Vite, Tailwind CSS, Lucide React
- **AI 통합:** Google GenAI SDK (`@google/genai`), Gemini 3 Flash Preview 모델
- **데이터 저장소:** 브라우저 LocalStorage 및 인메모리 캐싱 (클라이언트 사이드 아키텍처)

## 🔌 다중 AI 프로바이더 지원 (OpenAI, Claude, xAI, Ollama, OpenRouter)

현재 이 프로젝트는 기본적으로 Google의 `@google/genai` SDK를 사용하여 Gemini 모델을 호출합니다. 향후 여러 AI 프로바이더를 통합하려는 경우 다음 아키텍처 가이드를 따를 수 있습니다:

### 1. 통합 API 게이트웨이 사용 (권장: OpenRouter)
수많은 SDK를 설치하지 않고 여러 모델을 지원하는 가장 쉬운 방법은 **OpenRouter**를 사용하는 것입니다. OpenRouter는 OpenAI 호환 REST API를 제공하며 Claude, xAI, Gemini, Llama 등의 모델로 요청을 라우팅합니다.
- 프로젝트의 `@google/genai` SDK를 표준 `openai` Node.js SDK로 교체합니다.
- `baseURL`을 `https://openrouter.ai/api/v1`로 변경합니다.
- 사용자의 선택에 따라 특정 모델 문자열(예: `anthropic/claude-3.5-sonnet`, `x-ai/grok-2`)을 동적으로 전달합니다.

### 2. Ollama를 통한 로컬 모델 실행
약물감시(PV) 데이터가 매우 민감하여 클라우드로 전송하고 싶지 않은 경우 **Ollama**를 사용하여 로컬에서 오픈 소스 모델을 실행할 수 있습니다.
- Ollama가 로컬에서 실행 중인지 확인합니다(기본값 `http://localhost:11434`).
- 동일하게 `openai` SDK를 사용하고 `baseURL`을 `http://localhost:11434/v1`로 설정합니다.
- *참고: 이 프로젝트는 순수 프론트엔드(Vite) 아키텍처이므로 CORS 요청을 허용하도록 Ollama의 환경 변수를 구성해야 할 수 있습니다.*

### 3. 코드 리팩토링 단계
이 기능을 구현하려면 다음을 수정해야 합니다:
1. **AI 서비스 계층 추상화:** `services/gemini.ts`의 이름을 `services/ai.ts`로 변경합니다. `extractAEMaster(textInput, fileInput, provider, model, apiKey)`와 같은 일반 인터페이스를 만듭니다.
2. **UI 설정 화면:** 프론트엔드에 "설정(Settings)" 모달을 추가하여 사용자가 선호하는 AI 프로바이더(Gemini, OpenAI, Claude, Ollama)를 선택하고 특정 모델 이름을 입력하며 자신의 API 키를 제공할 수 있도록 합니다.
3. **프롬프트 엔지니어링 조정:** 모델마다 JSON 출력을 해석하는 방식이 다릅니다. 선택한 모델에 따라 `SYSTEM_INSTRUCTION`을 미세 조정하거나 OpenAI 호환 API의 경우 강제로 JSON을 출력하는 매개변수(예: `response_format: { type: "json_object" }`)를 추가해야 할 수 있습니다.
