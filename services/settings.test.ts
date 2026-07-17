import { describe, it, expect, vi, beforeEach } from 'vitest';

const { kv } = vi.hoisted(() => ({ kv: new Map<string, unknown>() }));

vi.mock('./storage', () => ({
  loadSync: (key: string) => (kv.has(key) ? kv.get(key) : null),
  save: (key: string, value: unknown) => {
    kv.set(key, value);
  },
}));

import { settings, DEFAULT_AI_SETTINGS } from './settings';

describe('settings.getAi retired-model healing', () => {
  beforeEach(() => kv.clear());

  it('已下架的 gemini 模型自動換成現役預設', () => {
    kv.set('pv_settings_ai', {
      provider: 'gemini',
      apiKey: 'AIza-x',
      model: 'gemini-3-flash-preview',
      baseUrl: '',
    });
    expect(settings.getAi().model).toBe(DEFAULT_AI_SETTINGS.model);
  });

  it('使用者自選的現役 gemini 模型不動', () => {
    kv.set('pv_settings_ai', {
      provider: 'gemini',
      apiKey: 'AIza-x',
      model: 'gemini-3.1-pro-preview',
      baseUrl: '',
    });
    expect(settings.getAi().model).toBe('gemini-3.1-pro-preview');
  });

  it('openai-compatible 供應商的模型名不受治癒影響', () => {
    kv.set('pv_settings_ai', {
      provider: 'openai-compatible',
      apiKey: 'sk-x',
      model: 'gemini-3-flash-preview',
      baseUrl: 'https://example.com/v1',
    });
    expect(settings.getAi().model).toBe('gemini-3-flash-preview');
  });

  it('無儲存值時回傳現役預設', () => {
    expect(settings.getAi().model).toBe('gemini-3.5-flash');
  });
});
