// 共用表單元件。
//
// 手機優先的設計約束（整份 AE 通報表單都靠這幾個元件維持一致）：
//   • 輸入框字級固定 text-base(16px) —— iOS Safari 對 <16px 的輸入框會自動放大頁面，破壞版面。
//   • 可點擊元素最小高度 44px —— Apple HIG / WCAG 2.5.5 的觸控目標下限。
//   • 單選、複選一律用「大色塊 chip」而非原生 <select> —— 手機下拉選單難點且看不到全部選項。

import React from 'react';

export interface Option { value: string; zh: string; en: string }

export const pickLabel = (o: Option, lang: 'zh' | 'en') => (lang === 'en' ? o.en : o.zh);

// 刻意沒有 outline-none：焦點原本只靠 border 由 slate-300 變 indigo-600 表示，
// 那是同明度換色，低視力與色弱使用者看不出差別。焦點環改由 index.css 的
// .ae-theme :focus-visible 規則負責（兩圈相反明度，任何底色都有對比），
// 這裡的 focus:border 保留為額外提示。
const inputBase =
  'w-full min-h-[48px] bg-white/80 dark:bg-slate-800/80 border-2 border-slate-300 dark:border-slate-600 ' +
  'rounded-2xl px-4 py-3 text-base transition-all shadow-sm ' +
  'focus:border-brand-600 focus:bg-white dark:focus:bg-slate-800 placeholder-slate-400 dark:placeholder-slate-500';

/**
 * Field 把標籤的 id 傳給底下的控制項。
 *
 * 為什麼不用 <label htmlFor>：這個表單有一欄的 children 是兩個併排的
 * TextInput（起訖日期）。htmlFor 需要唯一 id，一個 Field 配兩個輸入框就會
 * 撞 id——而重複 id 是會靜默壞掉、測試也抓不到的那種錯。改成由控制項側
 * 指 aria-labelledby 回標籤，多個控制項共指同一個標籤完全合法。
 */
interface FieldAria { labelId: string; hintId?: string; required?: boolean }
const FieldContext = React.createContext<FieldAria | null>(null);

/** 取得所屬 Field 的 aria 關聯；呼叫端自行指定時以呼叫端為準。 */
function useFieldAria(props: {
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-required'?: boolean | 'true' | 'false';
}) {
  const ctx = React.useContext(FieldContext);
  if (!ctx) return {};
  return {
    'aria-labelledby': props['aria-labelledby'] ?? ctx.labelId,
    'aria-describedby': props['aria-describedby'] ?? ctx.hintId,
    'aria-required': props['aria-required'] ?? (ctx.required ? true : undefined),
  };
}

export const Field: React.FC<{
  label: string;
  required?: boolean;
  hint?: string;
  /** CIOMS 欄號等對照標記，顯示在標籤右側 */
  tag?: string;
  children: React.ReactNode;
}> = ({ label, required, hint, tag, children }) => {
  const uid = React.useId();
  const labelId = `${uid}-label`;
  const hintId = hint ? `${uid}-hint` : undefined;
  return (
    <FieldContext.Provider value={{ labelId, hintId, required }}>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          {/* 保留 <label> 元素（視覺樣式不變），關聯方向由控制項的
              aria-labelledby 指回來。星號刻意不加 aria-hidden：對 chip 群組
              而言它是唯一的必填提示（group 沒有 aria-required 可用）。 */}
          <label id={labelId} className="text-xs font-bold text-slate-700 dark:text-slate-200 tracking-wide">
            {label}
            {required && <span className="text-danger-700 dark:text-danger-300 ml-1">*</span>}
          </label>
          {tag && (
            <span className="text-xs font-bold text-muted shrink-0">
              {tag}
            </span>
          )}
        </div>
        {children}
        {hint && <p id={hintId} className="text-xs text-muted leading-relaxed">{hint}</p>}
      </div>
    </FieldContext.Provider>
  );
};

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export const TextInput: React.FC<InputProps> = (props) => {
  const aria = useFieldAria(props);
  return <input {...props} {...aria} className={`${inputBase} font-bold ${props.className || ''}`} />;
};

export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => {
  const aria = useFieldAria(props);
  return <textarea {...props} {...aria} className={`${inputBase} font-medium leading-relaxed resize-y ${props.className || ''}`} />;
};

/**
 * 原生下拉選單。手機表單刻意用 ChipGroup 取代 <select>（見檔頭），但後台是
 * 桌機作業、選項多（負責人清單），原生 select 比一排 chip 緊湊也更好用。
 * 共用 inputBase 與 Field 的 aria 關聯，外觀與其他欄位一致。
 */
export const SelectInput: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => {
  const aria = useFieldAria(props);
  return <select {...props} {...aria} className={`${inputBase} font-bold ${props.className || ''}`} />;
};

/** 單選 chip 群組。value 為空字串代表未選。 */
export const ChipGroup: React.FC<{
  options: readonly Option[];
  value: string;
  onChange: (v: string) => void;
  lang: 'zh' | 'en';
  /** 再次點選已選項目時清空（適合非必填欄位） */
  clearable?: boolean;
  cols?: 1 | 2;
}> = ({ options, value, onChange, lang, clearable = true, cols = 2 }) => {
  const labelId = React.useContext(FieldContext)?.labelId;
  return (
  // role=group + aria-labelledby：少了這個，螢幕閱讀器逐一讀到「男」「女」
  // 這些 chip 時不會說它們屬於哪一題。
  <div role="group" aria-labelledby={labelId}
    className={`grid gap-2 ${cols === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
    {options.map(o => {
      const active = value === o.value;
      return (
        <button
          key={o.value}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(active && clearable ? '' : o.value)}
          className={`min-h-[48px] px-3 py-3 rounded-2xl text-sm font-black border-2 text-left transition-all ${
            active
              ? 'bg-brand-600 text-white border-brand-600 shadow-md'
              : 'bg-white/70 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 active:bg-brand-50 dark:active:bg-slate-700'
          }`}
        >
          {pickLabel(o, lang)}
        </button>
      );
    })}
  </div>
  );
};

/** 複選 chip 群組（嚴重性準則用）。危險語意採紅色，讓誤勾一眼看得出來。 */
export const CheckGroup: React.FC<{
  options: readonly Option[];
  values: string[];
  onChange: (v: string[]) => void;
  lang: 'zh' | 'en';
  tone?: 'brand' | 'danger';
}> = ({ options, values, onChange, lang, tone = 'brand' }) => {
  const labelId = React.useContext(FieldContext)?.labelId;
  const on = tone === 'danger'
    ? 'bg-danger-600 text-white border-danger-600 shadow-md'
    : 'bg-brand-600 text-white border-brand-600 shadow-md';
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      {options.map(o => {
        const active = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={active}
            onClick={() => onChange(active ? values.filter(v => v !== o.value) : [...values, o.value])}
            className={`w-full min-h-[48px] px-4 py-3 rounded-2xl text-sm font-black border-2 flex items-center gap-3 text-left transition-all ${
              active ? on : 'bg-white/70 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
            }`}
          >
            {/* 勾選狀態已由 aria-checked 表達，這個方框純裝飾，不要讓讀屏重複唸 */}
            <span aria-hidden="true" className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center text-xs ${
              active ? 'bg-white/25 border-white' : 'border-slate-400 dark:border-slate-500'
            }`}>{active ? '✓' : ''}</span>
            <span className="flex-1">{pickLabel(o, lang)}</span>
          </button>
        );
      })}
    </div>
  );
};

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white/60 dark:bg-white/[0.07] backdrop-blur-xl rounded-3xl border border-white/60 dark:border-white/10 shadow-lg ${className}`}>
    {children}
  </div>
);

/** 徽章語意。與 tailwind.config.js 的色彩 token 一一對應（neutral＝slate）。 */
export type Tone = 'neutral' | 'success' | 'caution' | 'danger' | 'brand';

/** 狀態徽章。tone 是受控列舉而非任意 class：顏色在這套介面裡是資訊，不是裝飾。 */
export const Badge: React.FC<{ children: React.ReactNode; tone?: Tone }> = ({ children, tone = 'neutral' }) => {
  const map: Record<Tone, string> = {
    neutral: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/40',
    success: 'bg-success-100 text-success-700 border-success-300 dark:bg-success-500/20 dark:text-success-300 dark:border-success-500/40',
    caution: 'bg-caution-100 text-caution-800 border-caution-300 dark:bg-caution-500/20 dark:text-caution-200 dark:border-caution-500/40',
    danger: 'bg-danger-100 text-danger-700 border-danger-300 dark:bg-danger-500/20 dark:text-danger-300 dark:border-danger-500/40',
    brand: 'bg-brand-100 text-brand-700 border-brand-300 dark:bg-brand-500/20 dark:text-brand-300 dark:border-brand-500/40',
  };
  // 12px 是全站字級下限；py-0.5 讓徽章在 12px 下仍與原本 10px 時差不多高，不撐開表格列與卡片標頭
  return <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap ${map[tone]}`}>{children}</span>;
};
