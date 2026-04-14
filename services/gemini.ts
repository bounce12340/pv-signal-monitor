import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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

export async function extractAEMaster(textInput: string, fileInput?: FileInput) {
  const parts: any[] = [];

  if (fileInput) {
    parts.push({
      inlineData: {
        mimeType: fileInput.mimeType,
        data: fileInput.data
      }
    });
  }

  if (textInput) {
    parts.push({ text: textInput });
  }

  if (parts.length === 0) {
    throw new Error("No input provided");
  }

  // Use a model capable of multimodal understanding (images and PDFs)
  const modelId = "gemini-3-flash-preview";

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        role: 'user',
        parts: parts
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        temperature: 0.1, // Low temperature for factual extraction
        maxOutputTokens: 8192, // Increased from default to handle large AE lists
      }
    });

    // Cleanup response text in case it contains Markdown code blocks
    let rawText = response.text || "{}";
    rawText = rawText.trim();
    
    // More robust markdown stripping
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      rawText = match[1].trim();
    } else if (rawText.startsWith("```")) {
      // Handle case where the closing ``` is missing (truncated)
      rawText = rawText.replace(/^```(?:json)?\s*/, "").trim();
    }

    // Attempt to parse
    try {
      return JSON.parse(rawText);
    } catch (parseError) {
      console.error("JSON Parse Error. Raw Text:", rawText);
      
      // Attempt a basic repair if it looks like a truncated JSON array/object
      try {
        if (rawText.endsWith(",")) {
           rawText = rawText.slice(0, -1);
        }
        // Very naive repair for truncated JSON
        let openBraces = (rawText.match(/\{/g) || []).length;
        let closeBraces = (rawText.match(/\}/g) || []).length;
        let openBrackets = (rawText.match(/\[/g) || []).length;
        let closeBrackets = (rawText.match(/\]/g) || []).length;
        
        let repairedText = rawText;
        if (openBraces > closeBraces || openBrackets > closeBrackets) {
           // Try to close strings if necessary
           if ((repairedText.match(/"/g) || []).length % 2 !== 0) {
              repairedText += '"';
           }
           while (openBraces > closeBraces || openBrackets > closeBrackets) {
              if (openBrackets > closeBrackets) {
                 repairedText += ']';
                 closeBrackets++;
              } else if (openBraces > closeBraces) {
                 repairedText += '}';
                 closeBraces++;
              }
           }
           return JSON.parse(repairedText);
        }
      } catch (repairError) {
         // Ignore repair errors and throw the original error
      }
      
      throw new Error(`Failed to parse AI response. The model output might be incomplete. (Length: ${rawText.length})`);
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(error.message || "Failed to process the document. Please try again.");
  }
}