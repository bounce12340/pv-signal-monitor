// Fixtures follow each regulator's real markup (sampled 2026-10) but the
// content is fictional: "Examplumab", "testostatin" etc. are not real products.
import { describe, expect, it } from 'vitest';
import {
  decodeEntities, dmyToIso, mdyToIso, parseEmaDhpc, parseFdaDsc, parseGovUkSearch, parsePmdaRevisions,
  parsePmdaRss, parseRss, parseTfdaList, safeUrl, toIsoDate,
} from './parsers';

describe('dates', () => {
  it.each([
    ['2026-10-26T14:16:31Z', '2026-10-26'],
    ['2026-10-28T12:00:00+09:00', '2026-10-28'], // the date as PMDA wrote it, not shifted to UTC
    ['Wed, 23 Sep 2026 09:10:00 +0200', '2026-09-23'],
    ['Tue, 1 Sept 2026 08:00:00 GMT', '2026-09-01'],
    ['2026年10月27日', '2026-10-27'],
    ['2026/7/1', '2026-07-01'],
    ['2026-02-30', null],
    ['', null],
    ['next week', null],
  ])('toIsoDate(%j) = %j', (raw, iso) => expect(toIsoDate(raw)).toBe(iso));

  it('reads EMA (DD/MM/YYYY) and FDA (M-D-YYYY) dates the right way round', () => {
    expect(dmyToIso('09/10/2026')).toBe('2026-10-09');
    expect(mdyToIso('9-1-2026')).toBe('2026-09-01');
    expect(dmyToIso('31/02/2026')).toBeNull();
  });
});

describe('safety of stored text and links', () => {
  it('keeps only absolute http(s) links', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('/drugs/x', 'https://www.fda.gov')).toBe('https://www.fda.gov/drugs/x');
    expect(safeUrl('/a?x=1&amp;y=2', 'https://example.test')).toBe('https://example.test/a?x=1&y=2');
    expect(safeUrl('')).toBeNull();
  });

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&#21547;&#x6210; &amp; &Uuml;')).toBe('含成 & &Uuml;');
  });

  it('drops an item whose link is not http(s)', () => {
    const xml = '<rss><channel><item><title>Bad</title><link>javascript:alert(1)</link></item>'
      + '<item><title>Good</title><link>https://example.test/a</link></item></channel></rss>';
    expect(parseRss(xml).map((i) => i.title)).toEqual(['Good']);
  });
});

describe('MHRA (GOV.UK search API)', () => {
  it('maps results to absolute links and the publication day', () => {
    const items = parseGovUkSearch(JSON.stringify({ results: [{
      title: 'Examplumab: risk of test reactions', link: '/drug-safety-update/examplumab',
      public_timestamp: '2026-10-20T09:01:49Z', description: 'Fictional summary.',
    }], total: 1 }));
    expect(items).toEqual([{
      title: 'Examplumab: risk of test reactions', url: 'https://www.gov.uk/drug-safety-update/examplumab',
      published: '2026-10-20', summary: 'Fictional summary.', substances: '',
    }]);
  });

  it('fails loudly on an unexpected payload instead of reporting zero items', () => {
    expect(() => parseGovUkSearch('{"error":"x"}')).toThrow(/results/);
  });
});

describe('FDA Drug Safety Communications', () => {
  const html = `<h1>Drug Safety Communications</h1><table class="table"><thead><tr><th>Date</th><th>Title</th></tr></thead><tbody>
    <tr><td>9-15-2026</td><td><a href="/drugs/drug-safety-communications/examplumab" data-entity-type="node" title="x">FDA adds Boxed Warning for Examplumab &amp; testostatin</a></td></tr>
    <tr><td>3-1-2026</td><td><a href="/drugs/drug-safety-communications/other">Other   communication</a></td></tr>
  </tbody></table>`;
  it('reads every row', () => {
    expect(parseFdaDsc(html)).toEqual([
      { title: 'FDA adds Boxed Warning for Examplumab & testostatin', url: 'https://www.fda.gov/drugs/drug-safety-communications/examplumab', published: '2026-09-15', summary: '', substances: '' },
      { title: 'Other communication', url: 'https://www.fda.gov/drugs/drug-safety-communications/other', published: '2026-03-01', summary: '', substances: '' },
    ]);
  });
  it('throws when the page no longer looks like the index', () => {
    expect(() => parseFdaDsc('<html>Access denied</html>')).toThrow();
  });
});

describe('EMA DHPC data file', () => {
  it('keeps human medicines with substances and outcome', () => {
    const items = parseEmaDhpc(JSON.stringify({ meta: {}, data: [
      { category: 'Human', name_of_medicine: 'Examplix', active_substances: 'examplumab', dhpc_type: 'Adverse event',
        regulatory_outcome: 'Variation', other_related_medicines_nationally_authorised: '', dissemination_date: '08/10/2026',
        first_published_date: '09/10/2026', dhpc_url: 'https://www.ema.europa.eu/en/medicines/dhpc/examplix' },
      { category: 'Veterinary', name_of_medicine: 'Vetexample', active_substances: 'x', first_published_date: '01/01/2026',
        dhpc_url: 'https://www.ema.europa.eu/en/medicines/dhpc/vetexample' },
    ] }));
    expect(items).toEqual([{
      title: 'Examplix (examplumab)', url: 'https://www.ema.europa.eu/en/medicines/dhpc/examplix', published: '2026-10-09',
      summary: 'DHPC type: Adverse event; Outcome: Variation', substances: 'examplumab',
    }]);
  });
});

describe('PMDA', () => {
  const rss = `<?xml version="1.0" encoding="UTF-8" ?><rdf:RDF xmlns="http://purl.org/rss/1.0/">
    <channel rdf:about="https://www.pmda.go.jp/top_rss.rdf"><title>PMDA：トップ 安全対策</title></channel>
    <item><title>[医薬]使用上の注意の改訂指示通知（医薬品）2026年10月27日付（厚生労働省より発出）を掲載しました</title>
      <link>https://www.pmda.go.jp/safety/info-services/drugs/calling-attention/revision-of-precautions/0999.html</link>
      <dc:date>2026-10-27T12:00:00+09:00</dc:date></item>
    <item><title>[医療]医療機器の回収</title><link>https://www.pmda.go.jp/x.html</link><dc:date>2026-10-27T12:00:00+09:00</dc:date></item>
  </rdf:RDF>`;
  it('keeps only medicines and all-product notices', () => {
    const items = parsePmdaRss(rss);
    expect(items).toHaveLength(1);
    expect(items[0].published).toBe('2026-10-27');
  });

  const page = `<table class="normal-table"><tbody>
    <tr><th>発出年月日</th><th>一般的名称</th><th>改訂内容</th><th>調査結果</th></tr>
    <tr><td rowspan="2">2026年10月27日<br /><a href="/files/0001.pdf"><span lang="ja">医薬安発1027第1号</span></a></td>
      <td><a href="https://www.pmda.go.jp/PmdaSearch/iyakuDetail/GeneralList/1">テストスタチン</a></td>
      <td><a href="/files/0002.pdf">改訂内容<br />[61.3KB]</a></td><td><a href="/files/0003.pdf">報告書</a></td></tr>
    <tr><td><a href="https://www.pmda.go.jp/PmdaSearch/iyakuDetail/GeneralList/2">エグザンプルマブ（経口剤）</a><br />
      <a href="https://www.pmda.go.jp/PmdaSearch/iyakuDetail/GeneralList/3">エグザンプルマブ（注射剤）</a></td>
      <td><a href="/files/0004.pdf">改訂内容</a></td></tr>
    <tr><td>2026年10月2日<br /><a href="/files/0005.pdf">医薬安発1002第1号</a></td>
      <td><a href="https://www.pmda.go.jp/PmdaSearch/iyakuDetail/GeneralList/4">サンプリン</a></td>
      <td><a href="/files/0006.pdf">改訂内容</a></td></tr>
  </tbody></table>`;
  it('splits a revision page into one item per substance, carrying the spanned date', () => {
    const items = parsePmdaRevisions(page, 'https://www.pmda.go.jp/safety/rev.html');
    expect(items.map((i) => [i.substances, i.published])).toEqual([
      ['テストスタチン', '2026-10-27'],
      ['エグザンプルマブ（経口剤）', '2026-10-27'],
      ['エグザンプルマブ（注射剤）', '2026-10-27'],
      ['サンプリン', '2026-10-02'],
    ]);
    expect(items[0].url.startsWith('https://www.pmda.go.jp/files/0002.pdf#')).toBe(true);
    // Two dosage forms share one PDF but stay two items.
    expect(new Set(items.map((i) => i.url)).size).toBe(4);
  });
});

describe('RSS 2.0 (BfArM, ANSM)', () => {
  it('reads title, link, date and an entity-encoded description', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title>Testostatin: &#220;berpr&#252;fung</title><link>https://www.bfarm.de/x.html</link>
      <pubDate>Wed, 23 Sep 2026 09:10:00 +0200</pubDate><description><![CDATA[<p>Der Nutzen &amp; die Risiken.</p>]]></description></item>
    </channel></rss>`;
    expect(parseRss(xml)).toEqual([{
      title: 'Testostatin: Überprüfung', url: 'https://www.bfarm.de/x.html', published: '2026-09-23',
      summary: 'Der Nutzen & die Risiken.', substances: '',
    }]);
  });
  it('returns nothing (not an error) for an empty channel', () => {
    expect(parseRss('<rss version="2.0"><channel><title>Informations du jour</title></channel></rss>')).toEqual([]);
  });
});

describe('TFDA list page', () => {
  const enc = (s: string) => [...s].map((c) => (c.charCodeAt(0) > 127 ? `&#${c.charCodeAt(0)};` : c)).join('');
  const html = `<table width="100%" class="listTable"><thead><tr><th>序號</th><th>標題</th><th>發布日期</th></tr></thead><tbody>
    <tr><td class='alignCenter' >1</td><td  ><img src="images/icon/new.gif" alt="new"> <a href="/tc/includes/GetFile.ashx?id=f1&amp;type=2"  title="${enc('含testostatin成分藥品安全資訊風險溝通表(.pdf下載)')}" >${enc('含testostatin成分藥品安全資訊風險溝通表')}<img src="images/icon/icon_pdf.png" alt="x"></a></td><td class='alignCenter' >2026-10-28</td>
    <tr><td class='alignCenter' >2</td><td  ><a href="siteContent.aspx?sid=1&amp;id=2"  title="${enc('一般公告')}" >${enc('一般公告')}</a></td><td class='alignCenter' >2026-10-01</td>
  </tbody></table>`;
  it('reads titles (without the download suffix), absolute links and dates', () => {
    expect(parseTfdaList(html)).toEqual([
      { title: '含testostatin成分藥品安全資訊風險溝通表', url: 'https://www.fda.gov.tw/tc/includes/GetFile.ashx?id=f1&type=2', published: '2026-10-28', summary: '', substances: '' },
      { title: '一般公告', url: 'https://www.fda.gov.tw/TC/siteContent.aspx?sid=1&id=2', published: '2026-10-01', summary: '', substances: '' },
    ]);
  });
  it('throws when the list table is gone', () => {
    expect(() => parseTfdaList('<html>maintenance</html>')).toThrow(/listTable/);
  });
});
