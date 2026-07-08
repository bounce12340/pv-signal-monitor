// Extracts the text layer of a PDF in the browser so that providers without
// native PDF support (OpenAI-compatible endpoints) can still read 仿單.
// pdfjs-dist is loaded on demand — it is heavy and most sessions never need it.

const MIN_MEANINGFUL_CHARS = 40;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Returns the concatenated text layer of every page.
 * Throws if the PDF has no usable text layer (e.g. a pure scan).
 */
export async function extractPdfText(base64: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const loadingTask = pdfjs.getDocument({ data: base64ToBytes(base64) });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s{3,}/g, '  ')
        .trim();
      if (text) pages.push(text);
    }

    const full = pages.join('\n\n').trim();
    if (full.length < MIN_MEANINGFUL_CHARS) {
      throw new Error(
        '此 PDF 沒有可用的文字層（可能是掃描檔）。請改用支援影像的模型' +
        '（如 Gemini 或 qwen3.5:397b），或上傳仿單圖片。'
      );
    }
    return full;
  } finally {
    await loadingTask.destroy();
  }
}
