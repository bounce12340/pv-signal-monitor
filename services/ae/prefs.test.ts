import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLocalStorage } from './testStorage';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('localStorage', memoryLocalStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe('AE screen preferences', () => {
  it('defaults to Chinese and light, and ignores invalid stored values', async () => {
    localStorage.setItem('ae_lang', JSON.stringify('fr'));
    localStorage.setItem('ae_theme', JSON.stringify('neon'));
    const { loadLang, loadTheme } = await import('./prefs');
    expect(loadLang()).toBe('zh');
    expect(loadTheme()).toBe('light');
  });

  it('round-trips a saved choice', async () => {
    const { loadLang, saveLang, loadTheme, saveTheme } = await import('./prefs');
    saveLang('en');
    saveTheme('dark');
    expect(loadLang()).toBe('en');
    expect(loadTheme()).toBe('dark');
  });

  it('is hydrated at boot but kept out of the D1 sync snapshot', async () => {
    const { AE_PREFS_KEY_LIST } = await import('./prefs');
    const { db } = await import('../db');
    const indexSrc = (await import('node:fs')).readFileSync(new URL('../../index.tsx', import.meta.url), 'utf8');
    expect(indexSrc).toMatch(/hydrateKeys = \[[^\]]*\.\.\.AE_PREFS_KEY_LIST/);
    for (const key of AE_PREFS_KEY_LIST) expect(Object.keys(db.exportAll())).not.toContain(key);
  });
});
