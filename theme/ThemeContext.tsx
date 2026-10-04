// AE 畫面的亮暗主題。與 PV-Link 的差異：PV-Link 把 .dark 掛在 <html>，整個網站一起變暗；
// 這裡主系統沒有暗色樣式，所以 .dark 只掛在 AE 畫面的外框（AEScope）上。
// index.css 的 `.ae-theme` 在這個外框內換上 AE 的色彩 token、字型、焦點環與減少動態規則。
import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadTheme, saveTheme, UiTheme } from '../services/ae/prefs';
import { langTag, useLang } from '../i18n/LangContext';

export type Theme = UiTheme;

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => { saveTheme(theme); }, [theme]);
  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);

/** AE 畫面的外框：套用 AE 的樣式範圍、目前主題與語言。 */
export const AEScope: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const { lang } = useLang();
  return (
    <div lang={langTag(lang)} className={`ae-theme${theme === 'dark' ? ' dark' : ''} min-h-[100dvh] bg-canvas text-slate-900 dark:text-slate-100`}>
      {children}
    </div>
  );
};
