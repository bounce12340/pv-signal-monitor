// App-level settings persisted in localStorage (never bundled into the build).

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
  model: 'gemini-3-flash-preview',
  baseUrl: '',
};

export const DEFAULT_RULE_CONFIG: SignalRuleConfig = {
  minCaseCount: 3,
  alertMultiplier: 2,
  toleranceMarginPct: 0.05,
};

const AI_KEY = 'pv_settings_ai';
const RULES_KEY = 'pv_settings_rules';

function load<T>(key: string, fallback: T): T {
  try {
    const str = localStorage.getItem(key);
    if (!str) return { ...fallback };
    return { ...fallback, ...JSON.parse(str) };
  } catch {
    return { ...fallback };
  }
}

export const settings = {
  getAi: (): AiSettings => load(AI_KEY, DEFAULT_AI_SETTINGS),
  saveAi: (s: AiSettings) => localStorage.setItem(AI_KEY, JSON.stringify(s)),

  getRules: (): SignalRuleConfig => load(RULES_KEY, DEFAULT_RULE_CONFIG),
  saveRules: (r: SignalRuleConfig) => localStorage.setItem(RULES_KEY, JSON.stringify(r)),
};
