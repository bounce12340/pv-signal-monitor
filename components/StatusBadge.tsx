import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react';

// 訊號判定的顯示：圖示＋文字＋淺底深字，不讓顏色（或 RED／YELLOW 這類色名）單獨承載意義。
// 「訊號監測」的即時分析用 alert／warning，存進資料庫的歷史紀錄用 red／yellow（services/db.ts），
// 兩邊在這裡對到同一組字與樣式。主系統是單語中文、不經過 i18n/（那裡只有 AE 畫面的字串）。
export type SignalStatus = 'unexpected' | 'alert' | 'warning' | 'normal';

// 對比（WCAG，文字對徽章底色）：rose-800/rose-100 6.59、red-800/red-200 5.75、
// yellow-800/yellow-200 5.88、green-800/green-100 6.49。
const STATUS: Record<SignalStatus, { label: string; cls: string; Icon: typeof AlertTriangle }> = {
  unexpected: { label: '未預期', cls: 'bg-rose-100 text-rose-800 font-bold', Icon: OctagonAlert },
  alert: { label: '異常', cls: 'bg-red-200 text-red-800 font-bold', Icon: AlertTriangle },
  warning: { label: '提醒', cls: 'bg-yellow-200 text-yellow-800 font-bold', Icon: AlertCircle },
  normal: { label: '正常', cls: 'bg-green-100 text-green-800 font-medium', Icon: CheckCircle2 },
};

const FROM_STORED: Record<string, SignalStatus> = { red: 'alert', yellow: 'warning' };

export const StatusBadge: React.FC<{ status: SignalStatus | 'red' | 'yellow' }> = ({ status }) => {
  const { label, cls, Icon } = STATUS[FROM_STORED[status] ?? (status as SignalStatus)] ?? STATUS.normal;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs whitespace-nowrap ${cls}`}>
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
};

// 「含嚴重案例」標記。原本只有一個字母 S 加 title；title 在觸控裝置與讀屏上都靠不住，所以直接寫出來。
// rose-800 on rose-100：6.59:1。
export const SeriousBadge: React.FC = () => (
  <span
    className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200 whitespace-nowrap"
    title="含嚴重案例"
  >
    嚴重
  </span>
);
