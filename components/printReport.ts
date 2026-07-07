import type { AnalysisReport } from '../services/analysis';

export interface PrintReportInput {
  productName: string;
  quarter: string;
  exposureVal: string;
  exposureUnit: string;
  salesVolume: string;
  dailyDosage: string;
  report: AnalysisReport;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STATUS_LABEL: Record<string, string> = {
  unexpected: '未預期 (Unexpected)',
  alert: '異常 (Alert)',
  warning: '提醒 (Warning)',
  normal: '正常 (Normal)',
};

// Opens a print-friendly report in a new window and triggers the print dialog
// (users save as PDF from there).
export function openPrintReport(input: PrintReportInput): boolean {
  const { productName, quarter, exposureVal, exposureUnit, salesVolume, dailyDosage, report } = input;
  const r = report.rules;
  const now = new Date();

  const rowsHtml = report.rows.map((row) => `
    <tr class="s-${row.status}">
      <td>${esc(STATUS_LABEL[row.status])}${row.serious ? ' <strong>[嚴重]</strong>' : ''}${row.noise_suppressed ? ` <small>(n&lt;${r.minCaseCount} 噪音抑制)</small>` : ''}</td>
      <td>${esc(row.ae_term)}</td>
      <td>${esc(row.soc)}<br><small>${esc(row.frequency_category)}</small></td>
      <td class="num">${row.count}</td>
      <td class="num">${row.incidence_rate_pct.toFixed(4)}%</td>
      <td class="num">${row.threshold_pct > 0 ? row.threshold_pct + '%' : '–'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>PV 季度訊號監測報告 ${esc(quarter)} — ${esc(productName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif; color: #111; margin: 32px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #555; margin-bottom: 20px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; border: 1px solid #ccc; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; }
  .meta div { display: flex; justify-content: space-between; }
  .meta dt { color: #555; }
  .summary { display: flex; gap: 12px; margin-bottom: 16px; }
  .card { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 8px 12px; text-align: center; }
  .card .n { font-size: 22px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #bbb; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.s-unexpected td { background: #fde8ef; }
  tr.s-alert td { background: #fdecea; }
  tr.s-warning td { background: #fdf6dd; }
  .rules { color: #555; margin-bottom: 24px; }
  .sign { display: flex; gap: 40px; margin-top: 48px; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 6px; text-align: center; color: #333; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>藥品安全監視 — 季度訊號監測報告</h1>
  <div class="sub">Pharmacovigilance Quarterly Signal Monitoring Report</div>

  <div class="meta">
    <div><dt>產品名稱</dt><dd><strong>${esc(productName)}</strong></dd></div>
    <div><dt>監測季度</dt><dd><strong>${esc(quarter)}</strong></dd></div>
    <div><dt>銷售數量</dt><dd>${esc(salesVolume || '–')}</dd></div>
    <div><dt>每日使用量</dt><dd>${esc(dailyDosage || '–')}</dd></div>
    <div><dt>暴露量（分母）</dt><dd>${esc(exposureVal)} ${esc(exposureUnit)}</dd></div>
    <div><dt>報告產生時間</dt><dd>${now.toLocaleString('zh-TW')}</dd></div>
  </div>

  <div class="summary">
    <div class="card"><div>未預期 AE</div><div class="n">${report.unexpected.length}</div></div>
    <div class="card"><div>發生率異常 (Alert)</div><div class="n">${report.alerts.length}</div></div>
    <div class="card"><div>關注提醒 (Warning)</div><div class="n">${report.rows.filter((x) => x.status === 'warning').length}</div></div>
    <div class="card"><div>正常</div><div class="n">${report.rows.filter((x) => x.status === 'normal').length}</div></div>
  </div>

  <table>
    <thead>
      <tr><th>判定</th><th>AE Term</th><th>SOC / 仿單頻率</th><th>案例數</th><th>發生率</th><th>仿單門檻</th></tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#777">本季無不良反應案例</td></tr>'}</tbody>
  </table>

  <div class="rules">
    判定規則：最小案例數 n≥${r.minCaseCount}（低於此數視為統計噪音）；
    Warning：發生率 ≥ 仿單門檻 − ${r.toleranceMarginPct}%；
    Alert：發生率 ≥ 仿單門檻 × ${r.alertMultiplier} − ${r.toleranceMarginPct}%；
    未登載於仿單主檔之 AE 一律列為未預期 (Unexpected)。
  </div>

  <div class="sign">
    <div>製表人 / 日期</div>
    <div>覆核人 / 日期</div>
    <div>藥物安全監視負責人 / 日期</div>
  </div>

  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

  // Open via a Blob URL (avoids document.write; all interpolated values above
  // pass through esc()).
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    return false; // popup blocked
  }
  // Revoke once the window has had ample time to load the document.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
