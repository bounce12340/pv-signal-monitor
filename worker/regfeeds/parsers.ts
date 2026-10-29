// Parsers for regulators' public drug-safety publications (see sources.ts for
// which URL feeds which parser). Pure functions over the fetched text, so each
// one is tested against a fixture without the network.
//
// Everything here is untrusted input from third-party sites: titles and
// summaries are stored as plain text (React escapes them on render), and a
// link is kept only if it is an absolute http(s) URL — a `javascript:` href in
// a compromised feed must never reach an <a> in the PV app.

export interface RegItem {
  title: string;
  url: string;
  /** The publication date the regulator states, YYYY-MM-DD; null when it gives none. */
  published: string | null;
  summary: string;
  /** Active substances when the source names them separately from the title. */
  substances: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const pad = (n: string | number) => String(n).padStart(2, '0');

function validDate(y: string, m: string | number, d: string | number): string | null {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * The calendar date as the source wrote it. Timezone offsets are deliberately
 * not applied: a PMDA item dated 2026-10-28T12:00+09:00 is a 28 October notice.
 */
export function toIsoDate(raw: string | null | undefined): string | null {
  const s = (raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO 8601 / YYYY-MM-DD
  if (m) return validDate(m[1], m[2], m[3]);
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/); // RFC 822: "Wed, 23 Sep 2026 09:10:00 +0200"
  if (m && MONTHS[m[2].toLowerCase()]) return validDate(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return validDate(m[1], m[2], m[3]);
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return validDate(m[1], m[2], m[3]);
  return null;
}

/** DD/MM/YYYY (EMA's data files). */
export function dmyToIso(raw: string | null | undefined): string | null {
  const m = (raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? validDate(m[3], m[2], m[1]) : null;
}

/** M-D-YYYY (FDA's Drug Safety Communications table). */
export function mdyToIso(raw: string | null | undefined): string | null {
  const m = (raw || '').trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? validDate(m[3], m[1], m[2]) : null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ent.toLowerCase()] ?? whole;
  });
}

/** Tags out, entities decoded, whitespace collapsed. */
export function plainText(html: string): string {
  return decodeEntities(html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** An absolute http(s) URL resolved against `base`, or null for anything else. */
export function safeUrl(href: string | null | undefined, base?: string): string | null {
  const raw = decodeEntities((href || '').trim());
  if (!raw) return null;
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

function item(title: string, url: string | null, published: string | null, summary = '', substances = ''): RegItem | null {
  const t = plainText(title);
  return t && url ? { title: t.slice(0, 500), url, published, summary: plainText(summary).slice(0, 2000), substances: plainText(substances).slice(0, 500) } : null;
}

const compact = (items: (RegItem | null)[]) => items.filter((i): i is RegItem => i !== null);

/** RSS 2.0 and RSS 1.0 (RDF) items: title, link, pubDate or dc:date, description. */
export function parseRss(xml: string, base?: string): RegItem[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  return compact(blocks.map((b) => item(
    tag(b, 'title'),
    safeUrl(plainText(tag(b, 'link')), base),
    toIsoDate(plainText(tag(b, 'pubDate') || tag(b, 'dc:date'))),
    tag(b, 'description'),
  )));
}

/** GOV.UK Search API response (MHRA Drug Safety Update). */
export function parseGovUkSearch(text: string): RegItem[] {
  const data = JSON.parse(text) as { results?: { title?: string; link?: string; public_timestamp?: string; description?: string }[] };
  if (!Array.isArray(data.results)) throw new Error('GOV.UK search response has no results array');
  return compact(data.results.map((r) => item(
    r.title || '', safeUrl(r.link, 'https://www.gov.uk'), toIsoDate(r.public_timestamp), r.description || '',
  )));
}

/** FDA Drug Safety Communications index: one table, rows of (M-D-YYYY, linked title). */
export function parseFdaDsc(html: string): RegItem[] {
  const rows = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*>\s*(\d{1,2}-\d{1,2}-\d{4})\s*<\/td>\s*<td[^>]*>\s*<a\s[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  if (!rows.length && !/Drug Safety Communications/i.test(html)) throw new Error('FDA page did not look like the DSC index');
  return compact(rows.map((r) => item(r[3], safeUrl(r[2], 'https://www.fda.gov'), mdyToIso(r[1]))));
}

interface EmaDhpcRow {
  category?: string; name_of_medicine?: string; active_substances?: string; dhpc_type?: string;
  regulatory_outcome?: string; other_related_medicines_nationally_authorised?: string;
  dissemination_date?: string; first_published_date?: string; dhpc_url?: string;
}

/** EMA "DHPC" data file (JSON export of the DHPC table, human medicines only). */
export function parseEmaDhpc(text: string): RegItem[] {
  const data = JSON.parse(text) as { data?: EmaDhpcRow[] };
  if (!Array.isArray(data.data)) throw new Error('EMA DHPC file has no data array');
  return compact(data.data.filter((r) => (r.category || 'Human') === 'Human').map((r) => {
    const parts = [
      r.dhpc_type && `DHPC type: ${r.dhpc_type}`,
      r.regulatory_outcome && `Outcome: ${r.regulatory_outcome}`,
      r.other_related_medicines_nationally_authorised && `Nationally authorised: ${r.other_related_medicines_nationally_authorised}`,
    ].filter(Boolean);
    const name = r.name_of_medicine || '';
    return item(
      r.active_substances ? `${name} (${r.active_substances})` : name,
      safeUrl(r.dhpc_url),
      dmyToIso(r.first_published_date) || dmyToIso(r.dissemination_date),
      parts.join('; '),
      r.active_substances || '',
    );
  }));
}

/** PMDA "トップ 安全対策" feed, limited to medicines ([医薬]) and all-product ([全製品]) notices. */
export function parsePmdaRss(xml: string): RegItem[] {
  return parseRss(xml, 'https://www.pmda.go.jp/').filter((i) => /^\[(医薬|全製品)\]/.test(i.title));
}

/**
 * PMDA's 使用上の注意の改訂指示 page: a table of (発出年月日, 一般的名称, 改訂内容 PDF, …),
 * where one date cell spans several substance rows. One item per substance.
 */
export function parsePmdaRevisions(html: string, pageUrl: string): RegItem[] {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error('PMDA revision page has no table');
  const out: (RegItem | null)[] = [];
  let date: string | null = null;
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const d = plainText(row).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (d) date = validDate(d[1], d[2], d[3]);
    const names = [...row.matchAll(/<a\s[^>]*href="[^"]*\/GeneralList\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => plainText(m[1]));
    if (!names.length) continue;
    const pdf = row.match(/<a\s[^>]*href="([^"]+\.pdf)"[^>]*>\s*改訂内容/i)?.[1];
    const url = safeUrl(pdf, pageUrl) || safeUrl(pageUrl);
    for (const name of names) {
      // The same PDF covers every dosage form listed in one cell, so the
      // name keeps those items apart.
      out.push(item(`使用上の注意の改訂指示：${name}`, url && `${url}#${encodeURIComponent(name)}`, date, '', name));
    }
  }
  return compact(out);
}

/** TFDA 藥品安全資訊 list page: rows of (序號, linked title, 發布日期). */
export function parseTfdaList(html: string): RegItem[] {
  const table = html.match(/<table[^>]*class="listTable"[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error('TFDA page has no listTable');
  const rows = [...table.matchAll(/<a\s[^>]*?href="([^"]+)"[^>]*?title="([^"]*)"[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/gi)];
  return compact(rows.map((r) => item(
    plainText(r[2]).replace(/\((?:\.\w+)?下載\)\s*$/, ''),
    safeUrl(r[1], 'https://www.fda.gov.tw/TC/'),
    toIsoDate(r[3]),
  )));
}
