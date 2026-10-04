// AE 畫面的語言切換。與 PV-Link 的差異：
//   • 偏好經 services/ae/prefs.ts 保存，不直接碰 localStorage。
//   • lang 屬性設在 AE 畫面的外框（theme/ThemeContext.tsx 的 AEScope），不改 <html lang>：
//     藥安人員從通報畫面回到主系統時，主系統仍是中文，不能被讀屏用英文念。
//     WCAG 3.1.2 允許以元素的 lang 標示一段內容的語言。
import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations, TransKey, Lang } from './translations';
import { loadLang, saveLang } from '../services/ae/prefs';

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: TransKey) => string }>({
  lang: 'zh', setLang: () => {}, t: (k) => k,
});

export const LangProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Lang>(loadLang);
  useEffect(() => { saveLang(lang); }, [lang]);
  const t = (k: TransKey) => translations[lang][k] ?? translations.zh[k] ?? k;
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
};

export const useLang = () => useContext(LangContext);
export const useT = () => useContext(LangContext).t;

/** BCP 47 標籤，給 AE 畫面外框的 lang 屬性用。 */
export const langTag = (lang: Lang) => (lang === 'en' ? 'en' : 'zh-Hant-TW');
