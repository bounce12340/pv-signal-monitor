// PubMed retrieval via NCBI E-utilities (esearch + efetch + XML parsing).
// This is not an LLM call, so it lives apart from the unified LLM client.

// NCBI E-utilities API key (optional). Set it to raise the rate limit to
// 10 req/s. This is a data-source key, not an LLM endpoint variable.
const NCBI_API_KEY: string = (import.meta as any).env?.VITE_NCBI_API_KEY || '';

// Max PMIDs pulled per efetch page (paged retrieval).
const EFETCH_CHUNK = 100;

function ncbiFetch(url: string): Promise<Response> {
  return fetch(NCBI_API_KEY ? `${url}&api_key=${NCBI_API_KEY}` : url);
}

function ncbiPause(): Promise<void> {
  // NCBI guidance: 3 req/s without a key, 10 req/s with one.
  return new Promise((r) => setTimeout(r, NCBI_API_KEY ? 110 : 350));
}

export interface PubMedQueryInput {
  ingredients: string[];
  aeTerms: string[];
  exclusions: string[];
}

/**
 * Assemble a PubMed boolean query string from the search form's parsed
 * fields: ingredients OR'd together, AE terms AND'd in (OR'd among
 * themselves), exclusions NOT'd out. A term containing `*` (truncation) or
 * `"` (an explicit phrase) is passed through unquoted; everything else is
 * wrapped in quotes as an exact phrase.
 */
export function buildPubMedQuery({ ingredients, aeTerms, exclusions }: PubMedQueryInput): string {
  const quote = (t: string) => (/[*"]/.test(t) ? t : `"${t}"`);
  const ingredientsClause = ingredients.map((i) => `("${i}")`).join(' OR ');
  const aeClause = aeTerms.length > 0 ? ` AND (${aeTerms.map(quote).join(' OR ')})` : '';
  const exclusionClause = exclusions.map((t) => ` NOT (${quote(t)})`).join('');
  return `(${ingredientsClause})${aeClause}${exclusionClause}`;
}

/**
 * Precise, reproducible PubMed search via NCBI E-utilities.
 * maxResults: max records returned (paged; default 100).
 */
export async function performPubMedSearch(
  query: string,
  _ingredient: string,
  dateWindow: { from: string; to: string },
  maxResults = 100
): Promise<any[]> {
  // 1. esearch → PMIDs (up to maxResults).
  const minDate = dateWindow.from.replace(/-/g, '/');
  const maxDate = dateWindow.to.replace(/-/g, '/');
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&mindate=${minDate}&maxdate=${maxDate}&datetype=pdat&retmode=json&retmax=${maxResults}`;

  const searchRes = await ncbiFetch(searchUrl);
  if (!searchRes.ok) throw new Error(`PubMed esearch 失敗 (HTTP ${searchRes.status})`);
  const searchData = await searchRes.json();
  const pmids: string[] = searchData.esearchresult?.idlist || [];
  if (pmids.length === 0) return [];

  // 2. efetch in pages (EFETCH_CHUNK per call), pausing between pages.
  const results: any[] = [];
  for (let start = 0; start < pmids.length; start += EFETCH_CHUNK) {
    const chunk = pmids.slice(start, start + EFETCH_CHUNK);
    await ncbiPause();
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${chunk.join(',')}&retmode=xml`;
    const fetchRes = await ncbiFetch(fetchUrl);
    if (!fetchRes.ok) throw new Error(`PubMed efetch 失敗 (HTTP ${fetchRes.status})`);
    const xmlText = await fetchRes.text();
    results.push(...parseArticles(xmlText));
  }
  return results;
}

/** Parse the efetch XML into article fields. */
export function parseArticles(xmlText: string): any[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('PubMed 回傳的 XML 無法解析');
  }
  const articles = xmlDoc.getElementsByTagName('PubmedArticle');

  const results = [];
  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const pmid = article.querySelector('PMID')?.textContent?.trim();
    const title = article.querySelector('ArticleTitle')?.textContent?.trim();

    // Assemble the abstract (some are segmented; keep labels for clarity).
    const abstractTexts = article.getElementsByTagName('AbstractText');
    let abstract = '';
    for (let j = 0; j < abstractTexts.length; j++) {
      const label = abstractTexts[j].getAttribute('Label');
      const text = abstractTexts[j].textContent?.trim() || '';
      abstract += (label ? `${label}: ` : '') + text + ' ';
    }

    // Journal name: read Journal > Title explicitly to avoid MeSH <Title>.
    const journal =
      article.querySelector('Journal > Title')?.textContent?.trim() ||
      article.querySelector('MedlineJournalInfo > MedlineTA')?.textContent?.trim() ||
      '';

    const date = extractPubDate(article);

    if (pmid && title) {
      results.push({
        pmid,
        title,
        date,
        journal,
        summary: abstract.trim(),
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      });
    }
  }
  return results;
}

/** Parse the publication date from a PubmedArticle node, handling MedlineDate /
 *  Season / numeric or English month / missing day. */
export function extractPubDate(article: Element): string {
  const pubDate =
    article.querySelector('Article JournalIssue PubDate') || article.querySelector('PubDate');
  if (!pubDate) return '';

  // MedlineDate e.g. "2025 Jan-Feb" or "2025 Spring": only the year is reliable.
  const medline = pubDate.querySelector('MedlineDate')?.textContent?.trim();
  if (medline) {
    const y = medline.match(/\d{4}/)?.[0];
    return y ? `${y}-01-01` : '';
  }

  const year = pubDate.querySelector('Year')?.textContent?.trim();
  if (!year) return '';
  const monthRaw = pubDate.querySelector('Month')?.textContent?.trim() || '01';
  const dayRaw = pubDate.querySelector('Day')?.textContent?.trim() || '01';

  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const month =
    monthMap[monthRaw.slice(0, 3).toLowerCase()] ||
    (/^\d{1,2}$/.test(monthRaw) ? monthRaw.padStart(2, '0') : '01');
  const day = /^\d{1,2}$/.test(dayRaw) ? dayRaw.padStart(2, '0') : '01';

  return `${year}-${month}-${day}`;
}
