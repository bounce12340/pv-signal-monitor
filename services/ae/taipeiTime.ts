/**
 * 把 ISO 時間戳顯示成產品工作時區（Asia/Taipei）的 YYYY-MM-DD HH:mm。
 *
 * 法規時鐘、工作台的日期範圍與到期判定都以 Asia/Taipei 計算；稽核軌跡與提醒
 * 的時間若照 ISO 原樣顯示（UTC）就會跟畫面上其他日期差 8 小時，台北時間凌晨
 * 0–8 點的事件連日期都會錯一天——查核時對照首次獲知日就會對不上。
 *
 * 無法解析時原樣回傳：稽核資料寧可顯示原文，也不能顯示錯的時間。
 */
export function formatTaipeiDateTime(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
