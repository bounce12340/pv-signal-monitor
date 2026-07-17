// App-level settings persisted in the unified storage backend (IndexedDB, with
// a localStorage fallback). Never bundled into the build.

import { loadSync, save } from './storage';

export type AiProvider = 'gemini' | 'openai-compatible';

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  model: string;
  // Only used by openai-compatible providers (OpenRouter, Ollama, LM Studio...)
  baseUrl: string;
}

// Signal detection rule parameters. Recorded into every saved report so an
// auditor can tell which rules produced a given judgement.
export interface SignalRuleConfig {
  // Counts below this are treated as statistical noise (status stays normal).
  minCaseCount: number;
  // Alert fires at threshold * alertMultiplier - toleranceMarginPct.
  alertMultiplier: number;
  // Buffer subtracted from thresholds so signals fire slightly early (in %).
  toleranceMarginPct: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-3.5-flash',
  baseUrl: '',
};

// Gemini model ids Google has retired server-side (requests 410). Stored
// settings are healed to the current default at read time so users migrated
// from older builds don't keep hitting a dead model.
const RETIRED_GEMINI_MODELS = new Set(['gemini-3-flash-preview']);

export const DEFAULT_RULE_CONFIG: SignalRuleConfig = {
  minCaseCount: 3,
  alertMultiplier: 2,
  toleranceMarginPct: 0.05,
};

const AI_KEY = 'pv_settings_ai';
const RULES_KEY = 'pv_settings_rules';

// Settings keys that carried localStorage data before the IndexedDB backend;
// hydrated and migrated at boot alongside the db tables.
export const SETTINGS_KEY_LIST: string[] = [AI_KEY, RULES_KEY];

function load<T>(key: string, fallback: T): T {
  const stored = loadSync<Partial<T>>(key);
  return stored ? { ...fallback, ...stored } : { ...fallback };
}

export const settings = {
  getAi: (): AiSettings => {
    const s = load(AI_KEY, DEFAULT_AI_SETTINGS);
    if (s.provider === 'gemini' && RETIRED_GEMINI_MODELS.has(s.model)) {
      s.model = DEFAULT_AI_SETTINGS.model;
    }
    return s;
  },
  saveAi: (s: AiSettings) => save(AI_KEY, s),

  getRules: (): SignalRuleConfig => load(RULES_KEY, DEFAULT_RULE_CONFIG),
  saveRules: (r: SignalRuleConfig) => save(RULES_KEY, r),
};
