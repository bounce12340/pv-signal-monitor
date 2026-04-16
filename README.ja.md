[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

---

# PV AE マスタージェネレーター＆シグナルモニター (PV AE Master Generator & Signal Monitor)

医薬品添付文書からの有害事象（AE）データの抽出と、市販後シグナル検出を自動化するために設計された、AIを活用した最新のファーマコビジランス（PV）Webアプリケーションです。

## 🌟 主な機能

1. **🤖 AIによるAE抽出（ジェネレーターモード）**
   - PDF、画像、またはテキスト形式の添付文書をアップロード。
   - GoogleのGemini AIを活用し、器官別大分類（SOC）、有害事象（AE）、発現頻度、および閾値パーセンテージを自動的に抽出します。
   - データベースに保存する前に、AIが抽出したデータを確認・修正できる編集可能なデータグリッドを提供。

2. **📊 シグナル検出とモニタリング（モニターモード）**
   - 販売数量と1日投与量に基づいて、四半期ごとの曝露量（分母）を計算。
   - 四半期ごとのAE症例数を入力すると、システムが自動的に発現率（Incidence Rate）を計算します。
   - 実際の発現率と添付文書の閾値を比較し、**予期せぬ事象 (Unexpected)**、**アラート (Alert)**、または **警告 (Warning)** シグナルをフラグ付けします。
   - 分析レポートをCSV形式でエクスポート可能。

3. **🗄️ マスターデータ管理（ライブラリモード）**
   - 保存されたすべての製品AEマスターを一元管理。
   - 過去の四半期モニタリングレポートとシグナル検出履歴を表示。

4. **🛡️ 監査証跡（監査モード）**
   - GVPガイドラインに準拠したシステム操作ログ。
   - `作成`、`更新`、`削除`、`エクスポート`、`分析` のすべてのアクションを記録する読み取り専用の監査証跡。

## 🚀 はじめに（ローカル開発）

### 前提条件
- Node.js (v18以上を推奨)
- Google Gemini API キー

### インストール手順

1. リポジトリをクローンします：
   ```bash
   git clone https://github.com/your-username/pv-signal-monitor.git
   cd pv-signal-monitor
   ```

2. 依存関係をインストールします：
   ```bash
   npm install
   ```

3. 環境変数を設定します：
   プロジェクトのルートディレクトリに `.env` または `.env.local` ファイルを作成し、Gemini APIキーを追加します：
   ```env
   API_KEY=あなたの_gemini_api_key
   ```

4. 開発サーバーを起動します：
   ```bash
   npm run dev
   ```

## 🛠️ 技術スタック
- **フロントエンド:** React 19, Vite, Tailwind CSS, Lucide React
- **AI 統合:** Google GenAI SDK (`@google/genai`), Gemini 3 Flash Preview モデル
- **データストレージ:** ブラウザの LocalStorage とインメモリキャッシュ（クライアントサイドアーキテクチャ）

## 🔌 マルチAIプロバイダーサポート（OpenAI, Claude, xAI, Ollama, OpenRouter）

現在、このプロジェクトはデフォルトでGoogleの `@google/genai` SDKを使用してGeminiモデルを呼び出しています。将来的に複数のAIプロバイダーを統合したい場合は、以下のアーキテクチャガイドに従って変更できます：

### 1. 統合APIゲートウェイの使用（推奨：OpenRouter）
複数のSDKをインストールせずに複数のモデルをサポートする最も簡単な方法は、**OpenRouter** を使用することです。OpenRouterはOpenAI互換のREST APIを提供し、Claude、xAI、Gemini、Llamaなどのモデルにリクエストをルーティングします。
- プロジェクト内の `@google/genai` SDKを標準の `openai` Node.js SDKに置き換えます。
- `baseURL` を `https://openrouter.ai/api/v1` に変更します。
- ユーザーの選択に基づいて、特定のモデル文字列（例：`anthropic/claude-3.5-sonnet`, `x-ai/grok-2`）を動的に渡します。

### 2. Ollamaによるローカルモデルの実行
ファーマコビジランス（PV）データが機密性が高く、クラウドに送信したくない場合は、**Ollama** を使用してローカルでオープンソースモデルを実行できます。
- Ollamaがローカルで実行されていることを確認します（デフォルトは `http://localhost:11434`）。
- 同様に `openai` SDKを使用し、`baseURL` を `http://localhost:11434/v1` に設定します。
- *注：このプロジェクトは純粋なフロントエンド（Vite）アーキテクチャであるため、CORSリクエストを許可するようにOllamaの環境変数を構成する必要がある場合があります。*

### 3. コードのリファクタリング手順
この機能を実装するには、以下の変更を行う必要があります：
1. **AIサービス層の抽象化：** `services/gemini.ts` の名前を `services/ai.ts` に変更します。`extractAEMaster(textInput, fileInput, provider, model, apiKey)` のような汎用インターフェースを作成します。
2. **UI設定画面：** フロントエンドに「設定（Settings）」モーダルを追加し、ユーザーが好みのAIプロバイダー（Gemini、OpenAI、Claude、Ollama）を選択し、特定のモデル名を入力し、自身のAPIキーを提供できるようにします。
3. **プロンプトエンジニアリングの調整：** モデルによってJSON出力の解釈が異なります。選択したモデルに応じて `SYSTEM_INSTRUCTION` を微調整するか、OpenAI互換APIの場合は強制的にJSONを出力するパラメータ（例：`response_format: { type: "json_object" }`）を追加する必要があるかもしれません。
