import React, { useState, useEffect } from 'react';
import { DetailModal } from './DetailModal';
import { db } from '../services/db';
import {
  settings, AiSettings, SignalRuleConfig,
  DEFAULT_AI_SETTINGS, DEFAULT_RULE_CONFIG,
} from '../services/settings';
import { KeyRound, SlidersHorizontal, Check } from 'lucide-react';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const OLLAMA_URL = 'http://localhost:11434/v1';

export const SettingsModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [ai, setAi] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [rules, setRules] = useState<SignalRuleConfig>(DEFAULT_RULE_CONFIG);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAi(settings.getAi());
      setRules(settings.getRules());
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    settings.saveAi(ai);
    settings.saveRules(rules);
    // Never write the API key itself into the audit trail.
    db.addLog(
      'UPDATE', 'SYSTEM',
      `Updated settings (provider=${ai.provider}, model=${ai.model}, ` +
      `rules: minN=${rules.minCaseCount}, alertX=${rules.alertMultiplier}, buffer=${rules.toleranceMarginPct}%)`
    );
    setSaved(true);
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-brand-500 outline-none text-sm';
  const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

  return (
    <DetailModal isOpen={isOpen} onClose={onClose} title="系統設定">
      <div className="space-y-6">
        {/* AI Provider */}
        <section className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
          <h4 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            <KeyRound size={16} className="text-brand-600" /> AI 供應商與金鑰
          </h4>
          <p className="text-xs text-slate-500">
            金鑰只儲存在您這台電腦的瀏覽器 (localStorage)，不會寫入程式碼或上傳到任何伺服器。
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>供應商</label>
              <select
                value={ai.provider}
                onChange={(e) => {
                  const provider = e.target.value as AiSettings['provider'];
                  setAi({
                    ...ai,
                    provider,
                    model: provider === 'gemini' ? DEFAULT_AI_SETTINGS.model : '',
                    baseUrl: provider === 'gemini' ? '' : ai.baseUrl,
                  });
                }}
                className={`${inputCls} bg-white`}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai-compatible">OpenAI 相容 (OpenRouter / Ollama...)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>模型名稱</label>
              <input
                value={ai.model}
                onChange={(e) => setAi({ ...ai, model: e.target.value })}
                placeholder={ai.provider === 'gemini' ? 'gemini-3-flash-preview' : 'anthropic/claude-sonnet-5'}
                className={`${inputCls} font-mono`}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>API Key</label>
            <input
              type="password"
              value={ai.apiKey}
              onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
              placeholder={ai.provider === 'openai-compatible' ? '本地 Ollama 可留空' : 'AIza...'}
              className={`${inputCls} font-mono`}
            />
          </div>
          {ai.provider === 'openai-compatible' && (
            <div>
              <label className={labelCls}>API 端點 (Base URL)</label>
              <input
                value={ai.baseUrl}
                onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
                placeholder={OPENROUTER_URL}
                className={`${inputCls} font-mono`}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setAi({ ...ai, baseUrl: OPENROUTER_URL })}
                  className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
                >
                  OpenRouter
                </button>
                <button
                  onClick={() => setAi({ ...ai, baseUrl: OLLAMA_URL })}
                  className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
                >
                  Ollama (本機)
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Signal Rules */}
        <section className="bg-white p-4 rounded-lg border border-slate-200 space-y-4">
          <h4 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
            <SlidersHorizontal size={16} className="text-brand-600" /> 訊號判定規則
          </h4>
          <p className="text-xs text-slate-500">
            每份儲存的報表都會記錄當時使用的規則參數，供稽核追溯。
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>最小案例數 (統計噪音門檻)</label>
              <input
                type="number" min={1} step={1}
                value={rules.minCaseCount}
                onChange={(e) => setRules({ ...rules, minCaseCount: parseInt(e.target.value, 10) || 1 })}
                className={`${inputCls} font-mono`}
              />
              <p className="text-[10px] text-slate-400 mt-1">案例數低於此值一律判「正常」；報表會註記。</p>
            </div>
            <div>
              <label className={labelCls}>Alert 倍數</label>
              <input
                type="number" min={1} step={0.5}
                value={rules.alertMultiplier}
                onChange={(e) => setRules({ ...rules, alertMultiplier: parseFloat(e.target.value) || 1 })}
                className={`${inputCls} font-mono`}
              />
              <p className="text-[10px] text-slate-400 mt-1">發生率 ≥ 門檻 × 此倍數 − 緩衝 → Alert。</p>
            </div>
            <div>
              <label className={labelCls}>緩衝 (%)</label>
              <input
                type="number" min={0} step={0.01}
                value={rules.toleranceMarginPct}
                onChange={(e) => setRules({ ...rules, toleranceMarginPct: parseFloat(e.target.value) || 0 })}
                className={`${inputCls} font-mono`}
              />
              <p className="text-[10px] text-slate-400 mt-1">讓訊號提早於硬門檻觸發的容差。</p>
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className={`px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors ${
              saved ? 'bg-green-100 text-green-700' : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
          >
            {saved ? <><Check size={16} /> 已儲存</> : '儲存設定'}
          </button>
        </div>
      </div>
    </DetailModal>
  );
};
