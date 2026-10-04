// 首次登入建檔畫面。
//
// 為什麼要有這一頁：CIOMS 表格裡「誰通報的」那一段（姓名、員編、電話、信箱、
// 公司、轄區）對同一位業務每次都一樣。留在通報表單裡，等於每通報一次就要重打
// 六個欄位，而那正是第一屏——手機上最容易讓人放棄的位置。改為建檔一次。
//
// 為什麼是強制而非可跳過：通報驗證要求「可辨識的通報者」與至少一個聯絡方式。
// 檔案沒填，第一次通報就會卡在驗證錯誤上，而那時業務人在客戶端、手上有個真實個案，
// 是最不該讓他停下來填基本資料的時刻。把這件事挪到還沒有時間壓力的第一次登入。
//
// ⚠️ 這裡填的是**顯示用**資料，不是身分憑證。「誰送的」永遠取自 Cloudflare Access
// 的 JWT，把姓名改成同事的名字也動不了稽核軌跡裡的身分。

import React, { useState } from 'react';
import { AEProfile, saveProfile } from '../../services/ae/aeApi';
import { useLang, useT } from '../../i18n/LangContext';
import { useTheme } from '../../theme/ThemeContext';
import { Field, TextInput, Card } from './ui';
import { Check as CheckIcon, RefreshCw as ArrowPathIcon, TriangleAlert as ExclamationTriangleIcon, CircleUser as UserCircleIcon } from 'lucide-react';

const ProfileSetup: React.FC<{
  email: string;
  initial: AEProfile;
  /** 建檔完成；帶回儲存後的檔案供呼叫端更新狀態 */
  onDone: (profile: AEProfile) => void;
  /** 由設定入口進入時可取消；首次建檔時不提供，避免跳過後卡在通報驗證 */
  onCancel?: () => void;
}> = ({ email, initial, onDone, onCancel }) => {
  const t = useT() as (k: string) => string;
  const { lang, setLang } = useLang();
  const { theme, toggle } = useTheme();

  const [profile, setProfile] = useState<AEProfile>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const set = (patch: Partial<AEProfile>) => setProfile(p => ({ ...p, ...patch }));

  // 只擋姓名與電話，因為這正是通報驗證的硬性要求。門檻訂得比驗證規則高，
  // 只會擋住一個其實可以送出通報的人。
  const missingName = !profile.displayName.trim();
  const missingPhone = !profile.phone.trim();
  const invalid = missingName || missingPhone;

  const submit = async () => {
    if (invalid) { setShowErrors(true); return; }
    setSaving(true);
    setError('');
    try {
      const next = await saveProfile(profile);
      onDone(next.profile);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col font-sans text-slate-900 dark:text-slate-100 bg-canvas">
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-[15%] -left-[20%] w-[70%] h-[40%] bg-brand-200/30 dark:bg-brand-500/15 rounded-full blur-[100px]" />
      </div>

      <header className="sticky top-0 z-30 bg-white/92 dark:bg-slate-900/92 backdrop-blur-xl border-b border-white/60 dark:border-white/10">
        <div className="px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-black tracking-tight truncate">{t('ae.profile.title')}</h1>
            <p className="text-xs font-bold text-muted truncate">
              {email}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={toggle} aria-label={t('header.themeToggle')}
              className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/10 border border-white/60 dark:border-white/10 text-sm">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/10 border border-white/60 dark:border-white/10 text-xs font-bold">
              {lang === 'zh' ? 'EN' : '中'}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32 space-y-4">
        <Card className="p-4 flex gap-3 items-start">
          <UserCircleIcon className="w-8 h-8 shrink-0 text-brand-600 dark:text-brand-300" />
          <p className="text-xs font-bold leading-relaxed text-slate-700 dark:text-slate-300">
            {t('ae.profile.intro')}
          </p>
        </Card>

        {showErrors && invalid && (
          <div className="px-4 py-3 rounded-2xl bg-danger-50 dark:bg-danger-500/10 border-2 border-danger-300 dark:border-danger-500/40 space-y-1">
            <p className="text-xs font-bold text-danger-800 dark:text-danger-300 flex items-center gap-1.5">
              <ExclamationTriangleIcon className="w-4 h-4" />{t('ae.profile.required')}
            </p>
            {missingName && <p className="text-xs font-bold text-danger-700 dark:text-danger-300 pl-5">• {t('ae.f.reporterName')}</p>}
            {missingPhone && <p className="text-xs font-bold text-danger-700 dark:text-danger-300 pl-5">• {t('ae.f.reporterPhone')}</p>}
          </div>
        )}

        {error && (
          <div className="px-4 py-3 rounded-2xl bg-danger-50 dark:bg-danger-500/10 border-2 border-danger-300 dark:border-danger-500/40">
            <p className="text-xs font-bold text-danger-800 dark:text-danger-300">{t('ae.profile.saveFailed')}{error}</p>
          </div>
        )}

        <Card className="p-4 space-y-3">
          <Field label={t('ae.f.reporterName')} required tag="CIOMS 26">
            <TextInput value={profile.displayName} autoComplete="name"
              onChange={e => set({ displayName: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('ae.f.reporterEmployeeId')}>
              <TextInput value={profile.employeeId}
                onChange={e => set({ employeeId: e.target.value })} />
            </Field>
            <Field label={t('ae.f.reporterTerritory')}>
              <TextInput value={profile.territory}
                onChange={e => set({ territory: e.target.value })} />
            </Field>
          </div>
          <Field label={t('ae.f.reporterPhone')} required hint={t('ae.profile.phoneHint')}>
            <TextInput type="tel" inputMode="tel" autoComplete="tel" value={profile.phone}
              onChange={e => set({ phone: e.target.value })} />
          </Field>
          <Field label={t('ae.f.reporterEmail')} hint={t('ae.profile.emailHint')}>
            <TextInput type="email" inputMode="email" autoComplete="email" value={profile.contactEmail}
              onChange={e => set({ contactEmail: e.target.value })} />
          </Field>
          <Field label={t('ae.f.reporterOrg')} tag="CIOMS 24a">
            <TextInput value={profile.org} onChange={e => set({ org: e.target.value })} />
          </Field>
        </Card>

        <p className="text-xs font-bold text-muted leading-relaxed">
          {t('ae.profile.identityNote')}
        </p>
      </div>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl border-t border-white/60 dark:border-white/10 px-4 py-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-lg mx-auto flex gap-3">
          {onCancel && (
            <button onClick={onCancel}
              className="min-h-[52px] px-5 rounded-2xl font-black text-sm border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">
              {t('ae.profile.cancel')}
            </button>
          )}
          <button onClick={submit} disabled={saving}
            className="flex-1 min-h-[52px] rounded-2xl bg-brand-600 text-white font-black text-sm shadow-lg flex items-center justify-center gap-2 active:bg-brand-700 disabled:opacity-60">
            {saving
              ? <><ArrowPathIcon className="w-5 h-5 animate-spin" />{t('ae.profile.saving')}</>
              : <><CheckIcon className="w-5 h-5" />{t('ae.profile.save')}</>}
          </button>
        </div>
      </nav>
    </div>
  );
};

export default ProfileSetup;
