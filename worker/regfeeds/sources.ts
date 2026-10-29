// The fixed list of regulators' safety publications the Worker polls. Only
// these URLs are ever fetched: no request content can choose a URL, so the
// poller can't be turned into an open proxy or an SSRF tool.
//
// Why these and not others (verified 2026-10): see docs/regulatory-alerts.md.
// 藥品安全監視管理辦法 第 6 條第 1 項第 3 款 makes a suspension or withdrawal for
// adverse reactions in the US, UK, DE, FR, JP, CH, CA, AU, BE or SE reportable
// within three days of becoming aware of it; UNCOVERED lists which of those
// this poller does not reach, so the page can say so instead of implying
// completeness.

import {
  RegItem, parseEmaDhpc, parseFdaDsc, parseGovUkSearch, parsePmdaRevisions, parsePmdaRss, parseRss, parseTfdaList,
} from './parsers';

export type FetchText = (url: string) => Promise<string>;

export interface RegSource {
  id: string;
  name: string;
  /** ISO 3166 alpha-2, or EU. */
  country: string;
  /** Where a person checks the same list by hand. */
  homepage: string;
  /** What this source does and does not cover, shown next to its status. */
  note: string;
  load(fetchText: FetchText): Promise<RegItem[]>;
}

const one = (url: string, parse: (text: string) => RegItem[]) => async (fetchText: FetchText) => parse(await fetchText(url));

const PMDA_RSS = 'https://www.pmda.go.jp/rss_018.xml';

export const SOURCES: RegSource[] = [
  {
    id: 'mhra',
    name: 'MHRA Drug Safety Update',
    country: 'GB',
    homepage: 'https://www.gov.uk/drug-safety-update',
    note: '經 GOV.UK Search API 取最新 50 筆。',
    load: one(
      'https://www.gov.uk/api/search.json?filter_format=drug_safety_update&order=-public_timestamp&count=50&fields=title,link,public_timestamp,description',
      parseGovUkSearch,
    ),
  },
  {
    id: 'fda-dsc',
    name: 'FDA Drug Safety Communications',
    country: 'US',
    homepage: 'https://www.fda.gov/drugs/drug-safety-and-availability/drug-safety-communications',
    note: '解析官網列表頁（HTML）；不含 MedWatch 回收與仿單一般更新。',
    load: one('https://www.fda.gov/drugs/drug-safety-and-availability/drug-safety-communications', parseFdaDsc),
  },
  {
    id: 'ema-dhpc',
    name: 'EMA DHPC',
    country: 'EU',
    homepage: 'https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/pharmacovigilance-post-authorisation/direct-healthcare-professional-communications-dhpc',
    note: 'EMA 官方 DHPC 資料檔；僅涵蓋歐盟集中審查藥品，多數老藥由各國審查（見 BfArM、ANSM）。不含 PRAC 訊號建議。',
    load: one('https://www.ema.europa.eu/en/documents/report/dhpc-output-json-report_en.json', parseEmaDhpc),
  },
  {
    id: 'pmda',
    name: 'PMDA 安全対策',
    country: 'JP',
    homepage: 'https://www.pmda.go.jp/safety/info-services/drugs/calling-attention/revision-of-precautions/0001.html',
    note: 'PMDA RSS（[医薬]、[全製品]）；「使用上の注意の改訂指示」另拆成每個成分一筆（日文一般名，需在監測成分加片假名）。',
    async load(fetchText) {
      const items = parsePmdaRss(await fetchText(PMDA_RSS));
      // A revision notice links to a cumulative page; the substances are only
      // there. The same page backs every notice, so fetch each one once.
      const pages = [...new Set(items.filter((i) => i.title.includes('使用上の注意の改訂指示')).map((i) => i.url))].slice(0, 2);
      for (const page of pages) items.push(...parsePmdaRevisions(await fetchText(page), page));
      return items;
    },
  },
  {
    id: 'bfarm',
    name: 'BfArM Risikoinformationen',
    country: 'DE',
    homepage: 'https://www.bfarm.de/DE/Arzneimittel/Pharmakovigilanz/Risikoinformationen/_node.html',
    note: 'BfArM 藥物風險資訊 RSS（德文）。',
    load: one('https://www.bfarm.de/SiteGlobals/Functions/RSSFeed/DE/Pharmakovigilanz/Risikoinformation/RSSNewsfeed.xml?nn=471274', (t) => parseRss(t)),
  },
  {
    id: 'ansm',
    name: 'ANSM Informations de sécurité',
    country: 'FR',
    homepage: 'https://ansm.sante.fr/informations-de-securite/',
    note: 'ANSM RSS 只列「當天」的公告（法文），常為 0 筆；晚間才發布的可能漏抓，需人工補看。',
    load: one('https://ansm.sante.fr/rss/informations_securite?produitsSante=medicaments', (t) => parseRss(t, 'https://ansm.sante.fr/')),
  },
  {
    id: 'tfda',
    name: 'TFDA 藥品安全資訊',
    country: 'TW',
    homepage: 'https://www.fda.gov.tw/TC/siteList.aspx?sid=1571',
    note: '解析官網列表第 1 頁（HTML，最新 10 筆）。TFDA 開放資料集停在 2022 年，不能使用。',
    load: one('https://www.fda.gov.tw/TC/siteList.aspx?sid=1571', parseTfdaList),
  },
];

/** 第 6 條十國中本系統未自動監測者，與原因。 */
export const UNCOVERED = [
  { country: 'CH', name: '瑞士 Swissmedic', reason: '官網只連到第三方（fetchrss.com）代轉的 RSS，非官方來源。' },
  { country: 'CA', name: '加拿大 Health Canada', reason: 'RSS 只有最新 3 筆且多為醫材；完整資料檔約 16 MB，不適合每次輪詢下載。' },
  { country: 'AU', name: '澳洲 TGA', reason: '驗證時連線被重置，尚未確認可用的資料來源。' },
  { country: 'BE', name: '比利時 FAMHP', reason: '找不到安全性公告的 RSS 或資料檔。' },
  { country: 'SE', name: '瑞典 MPA', reason: '只有一般新聞 RSS，沒有安全性專用的資料來源。' },
];

export const sourceById = (id: string) => SOURCES.find((s) => s.id === id);
