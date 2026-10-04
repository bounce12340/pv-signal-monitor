// AE 畫面的介面偏好：語言與亮暗主題。PV-Link 的 LangContext／ThemeContext 直接讀寫 localStorage；
// 本 repo 規定只有 services/storage.ts 能碰儲存，所以改經 loadSync/save。
//
// 兩個鍵列在 AE_PREFS_KEY_LIST，由 index.tsx 開機時 hydrate（否則 save() 寫進 IndexedDB 後，
// 重新整理時同步讀不到）。刻意不進 db.exportAll：這是「這台裝置」的顯示偏好，不必跨裝置同步。
import { loadSync, save } from '../storage';

export type UiLang = 'zh' | 'en';
export type UiTheme = 'light' | 'dark';

export const AE_LANG_KEY = 'ae_lang';
export const AE_THEME_KEY = 'ae_theme';
export const AE_PREFS_KEY_LIST: string[] = [AE_LANG_KEY, AE_THEME_KEY];

/** 未設定或值不合法時一律回預設（中文、亮色），不讓壞資料影響畫面。 */
export const loadLang = (): UiLang => (loadSync<string>(AE_LANG_KEY) === 'en' ? 'en' : 'zh');
export const saveLang = (lang: UiLang): void => save(AE_LANG_KEY, lang);
export const loadTheme = (): UiTheme => (loadSync<string>(AE_THEME_KEY) === 'dark' ? 'dark' : 'light');
export const saveTheme = (theme: UiTheme): void => save(AE_THEME_KEY, theme);
