import { GoogleGenAI, Type } from "@google/genai";
import { settings } from "./settings";
import { extractPdfText } from "./pdfText";
import type { ExtractedMaster } from "../types";

const SYSTEM_INSTRUCTION = `
你是一位高階藥品安全監視（PV）資料擷取專家。請從使用者提供的「仿單」（可能是圖片、PDF文件或純文字）中，建立完整且精確的 AE 主檔 JSON。

**核心任務：**
請掃描整份文件，提取**所有**提及的「不良反應（Adverse Events/Side Effects）」或「副作用」。
**關鍵要求：同時抓取「表格中的精確數值」與「文字段落中的列舉項目」。即使資訊不完整，也請盡量提取，不要遺漏！**

目標輸出結構 (JSON Format):
{
  "product_name": "Name of the drug (若無則填 Unknown)",
  "label_version_date": "Date string (若無則填 Unknown)",
  "frequency_legend": "Original text defining frequencies (若無則填 Unknown)",
  "ae_master": [
    {
      "soc": "System Organ Class (若無則填 Unknown)",
      "ae_term_raw": "Original term",
      "ae_terms_split": ["Term 1", "Term 2"],
      "label_frequency_text": "e.g. Common, 10% (若無則填 Unknown)",
      "label_threshold_upper_pct": 10.0,
      "mapping_rule_note": "Reasoning"
    }
  ]
}

詳細解析規則：

1. **搜尋範圍 (全面覆蓋)**：
   - **統計表格 (Tables)**：這通常包含最精確的數據。
   - **文字段落 (Paragraphs)**：例如「罕見的不良反應包含：A病、B病...」。
   - **上市後經驗 (Post-marketing experience)**：通常為純文字條列，不可遺漏。

2. **頻率與門檻值 (Threshold) 判定邏輯 - 數值優先！**：
   - **最高優先 (表格/文中精確數值)**：若來源提供具體數字（例如 "1.5%"），請直接提取該數字作為 \`label_threshold_upper_pct\` (填入 1.5)。
   - **次要優先 (文字定義/區間)**：
     - 十分常見 (Very Common)：10.0
     - 常見 (Common)：10.0
     - 不常見 (Uncommon)：1.0
     - 罕見 (Rare)：0.1
     - 十分罕見 (Very Rare)：0.01
   - **若完全沒有提及頻率或數值**：請將 \`label_threshold_upper_pct\` 設定為 0。**絕對不要因為找不到頻率就放棄提取該不良反應！**

3. **拆分規則 (Splitting)**：
   - 請將連續列舉的症狀拆分為獨立項目。
   - 分隔符號包含：頓號「、」、逗號「,」、分號「;」、換行符號。

4. **資料清理與容錯**：
   - 確保提取數量最大化，寧可多抓不可遺漏。
   - 若找不到 SOC (系統器官分類)，請填入 "Unknown"。
   - 回傳格式必須為純 JSON，不要包含 Markdown code block。
`;

export interface FileInput {
  data: string;     // Base64 string
  mimeType: string; // e.g., 'image/png', 'application/pdf'
}

// Structured-output schema for Gemini: guarantees parseable JSON, no repair hacks.
const AE_MASTER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    product_name: { type: Type.STRING },
    label_version_date: { type: Type.STRING },
    frequency_legend: { type: Type.STRING },
    ae_master: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          soc: { type: Type.STRING },
          ae_term_raw: { type: Type.STRING },
          ae_terms_split: { type: Type.ARRAY, items: { type: Type.STRING } },
          label_frequency_text: { type: Type.STRING },
          label_threshold_upper_pct: { type: Type.NUMBER },
          mapping_rule_note: { type: Type.STRING },
        },
        required: [
          "soc",
          "ae_term_raw",
          "ae_terms_split",
          "label_frequency_text",
          "label_threshold_upper_pct",
        ],
      },
    },
  },
  required: ["product_name", "label_version_date", "ae_master"],
};

function normalizeResult(data: Partial<ExtractedMaster>): ExtractedMaster {
  return {
    product_name: data.product_name || "Unknown",
    label_version_date: data.label_version_date || "",
    frequency_legend: data.frequency_legend,
    ae_master: Array.isArray(data.ae_master) ? data.ae_master : [],
  };
}

async function extractWithGemini(
  apiKey: string,
  model: string,
  textInput: string,
  fileInput?: FileInput
): Promise<ExtractedMaster> {
  const ai = new GoogleGenAI({ apiKey });
  const parts: Array<Record<string, unknown>> = [];

  if (fileInput) {
    parts.push({ inlineData: { mimeType: fileInput.mimeType, data: fileInput.data } });
  }
  if (textInput) {
    parts.push({ text: textInput });
  }

  const response = await ai.models.generateContent({
    model,
    contents: { role: "user", parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: AE_MASTER_SCHEMA,
      temperature: 0.1,
      maxOutputTokens: 16384,
    },
  });

  const rawText = (response.text || "").trim();
  if (!rawText) throw new Error("模型未回傳內容，請重試或改用較小的檔案。");
  return normalizeResult(JSON.parse(rawText));
}

async function extractWithOpenAiCompatible(
  apiKey: string,
  model: string,
  baseUrl: string,
  textInput: string,
  fileInput?: FileInput
): Promise<ExtractedMaster> {
  // OpenAI-compatible endpoints cannot take a PDF directly; feed them the
  // text layer instead (throws with guidance when the PDF is a pure scan).
  if (fileInput && fileInput.mimeType === "application/pdf") {
    const pdfText = await extractPdfText(fileInput.data);
    textInput = [textInput, `【仿單 PDF 文字內容】\n${pdfText}`]
      .filter(Boolean)
      .join("\n\n");
    fileInput = undefined;
  }

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

  const content: ContentPart[] = [];
  if (fileInput) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${fileInput.mimeType};base64,${fileInput.data}` },
    });
  }
  content.push({
    type: "text",
    text: textInput || "請依系統指示，從附件仿單中提取 AE 主檔 JSON。",
  });

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API 回應 ${res.status}：${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const text: string = json?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("模型未回傳內容。");

  // Some models still wrap JSON in a code fence despite response_format.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return normalizeResult(JSON.parse(fenced ? fenced[1] : text));
}

// --- AI term normalization (synonym-level mapping to master terms) ---

const MAPPING_INSTRUCTION = `你是藥品安全監視（PV）詞彙對應專家。使用者提供「主檔詞彙清單」與「待對應詞彙」。
對每個待對應詞彙，判斷它是否為主檔中某個詞彙的同義詞、俗名、簡寫或錯字（語意上指同一個不良反應，例如「拉肚子」→「腹瀉」）。
- 是 → 回該主檔詞彙（必須逐字取自主檔清單，不可自創）。
- 否或不確定 → 回 null，不要勉強配對。
回傳純 JSON：{"mappings":[{"input":"...","master":"主檔詞彙或 null"}]}`;

const MAPPING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mappings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          input: { type: Type.STRING },
          master: { type: Type.STRING, nullable: true },
        },
        required: ["input"],
      },
    },
  },
  required: ["mappings"],
};

/**
 * Asks the configured model to map unmatched AE terms onto master terms at
 * synonym level. Returns input → master term (or null). Any answer not
 * literally present in `masterTerms` is discarded, so the model cannot
 * invent vocabulary.
 */
export async function mapTermsToMaster(
  inputs: string[],
  masterTerms: string[]
): Promise<Record<string, string | null>> {
  const ai = settings.getAi();
  if (!ai.apiKey && ai.provider === "gemini") {
    throw new Error("尚未設定 API Key。請點右上角「設定」填入您的金鑰。");
  }
  if (ai.provider === "openai-compatible" && !ai.baseUrl) {
    throw new Error("尚未設定 API 端點 (Base URL)。請點右上角「設定」。");
  }
  if (!ai.model) throw new Error("尚未設定模型名稱。請點右上角「設定」。");

  const userText =
    `主檔詞彙清單：\n${masterTerms.join("、")}\n\n待對應詞彙：\n${inputs.join("、")}`;

  let rawText: string;
  if (ai.provider === "gemini") {
    const genai = new GoogleGenAI({ apiKey: ai.apiKey });
    const response = await genai.models.generateContent({
      model: ai.model,
      contents: { role: "user", parts: [{ text: userText }] },
      config: {
        systemInstruction: MAPPING_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: MAPPING_SCHEMA,
        temperature: 0,
      },
    });
    rawText = (response.text || "").trim();
  } else {
    const url = `${ai.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: MAPPING_INSTRUCTION },
          { role: "user", content: userText },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API 回應 ${res.status}：${body.slice(0, 300)}`);
    }
    const json = await res.json();
    rawText = json?.choices?.[0]?.message?.content || "";
  }
  if (!rawText) throw new Error("模型未回傳內容。");

  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const parsed = JSON.parse(fenced ? fenced[1] : rawText) as {
    mappings?: Array<{ input?: unknown; master?: unknown }>;
  };

  const lookup = new Map(masterTerms.map((t) => [t.toLowerCase().trim(), t]));
  const out: Record<string, string | null> = {};
  inputs.forEach((t) => { out[t] = null; });
  (parsed.mappings || []).forEach((m) => {
    if (!m || typeof m.input !== "string" || !(m.input in out)) return;
    const hit =
      typeof m.master === "string"
        ? lookup.get(m.master.toLowerCase().trim())
        : undefined;
    out[m.input] = hit ?? null;
  });
  return out;
}

export async function extractAEMaster(
  textInput: string,
  fileInput?: FileInput
): Promise<ExtractedMaster> {
  if (!textInput && !fileInput) {
    throw new Error("No input provided");
  }

  const ai = settings.getAi();
  if (!ai.apiKey && ai.provider === "gemini") {
    throw new Error("尚未設定 API Key。請點右上角「設定」填入您的金鑰。");
  }
  if (ai.provider === "openai-compatible" && !ai.baseUrl) {
    throw new Error("尚未設定 API 端點 (Base URL)。請點右上角「設定」。");
  }
  if (!ai.model) {
    throw new Error("尚未設定模型名稱。請點右上角「設定」。");
  }

  try {
    if (ai.provider === "gemini") {
      return await extractWithGemini(ai.apiKey, ai.model, textInput, fileInput);
    }
    return await extractWithOpenAiCompatible(
      ai.apiKey,
      ai.model,
      ai.baseUrl,
      textInput,
      fileInput
    );
  } catch (error) {
    console.error("AI extraction error:", error);
    if (error instanceof SyntaxError) {
      throw new Error("模型輸出不是有效 JSON，請重試（或換用支援結構化輸出的模型）。");
    }
    throw new Error(error instanceof Error ? error.message : "解析失敗，請重試。");
  }
}
