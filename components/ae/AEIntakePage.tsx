// 主系統裡的「通報收案」頁：載入、儲存、刪除個案，並把畫面交給 AEIntakeConsole。
// 對應 PV-Link App.tsx 裡管個案庫的那一段；元件本身不 fetch，一律經 services/ae/aeApi。
//
// 個案庫刻意**不**做「整個陣列一起寫回」：那會在每次判定時把整份清單推上去，覆蓋別人同時間的更新。
// 改一件存一件，後端確認成功才更新畫面——不顯示一個其實沒存進去的狀態。
import React, { useCallback, useEffect, useState } from 'react';
import AEIntakeConsole from './AEIntakeConsole';
import { AEScope } from '../../theme/ThemeContext';
import { useT } from '../../i18n/LangContext';
import { listAECases, saveAECase, deleteAECase, fetchIdentity } from '../../services/ae/aeApi';
import type { AEReport } from '../../services/ae/aeReport';

const AEIntakePage: React.FC = () => {
  const t = useT();
  const [cases, setCases] = useState<AEReport[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  // 只用於樂觀顯示；稽核軌跡的 actor 由後端以 Access JWT 寫入，前端送什麼都不算數。
  const [actor, setActor] = useState('');

  const load = useCallback(async (quiet = false) => {
    try {
      const fresh = await listAECases();
      setCases(prev => (prev && JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh));
      setLoadError('');
    } catch (e: any) {
      // 讀不到時不顯示空清單：空清單會讓藥安人員以為沒有新個案。背景重整失敗則保留現有畫面。
      if (!quiet) setLoadError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    void load();
    let cancelled = false;
    fetchIdentity().then(me => { if (!cancelled) setActor(me.email); }).catch(() => {});
    return () => { cancelled = true; };
  }, [load]);

  // 視窗重新取得焦點時重讀：把業務手機剛送出、或同事剛更新的個案抓進來。
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(true); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const saveCase = async (next: AEReport) => {
    // 清單裡沒有這個 id ＝ 新個案（後台建立的追蹤報告），要用 POST 而非 PATCH。
    const isNew = !(cases || []).some(c => c.id === next.id);
    try {
      const saved = await saveAECase(next, { create: isNew });
      // 版本與個案編號以後端回傳為準（編號由 Worker 配發）。
      const stored = { ...next, version: saved.version, caseNumber: saved.caseNumber || next.caseNumber };
      setCases(prev => {
        const list = prev || [];
        const idx = list.findIndex(c => c.id === stored.id);
        if (idx < 0) return [stored, ...list];
        const copy = list.slice();
        copy[idx] = stored;
        return copy;
      });
      setActionError('');
    } catch (e: any) {
      setActionError(`${t('ae.page.saveFailed')}: ${e?.message || e}`);
    }
  };

  const deleteCase = async (id: string, reason = '') => {
    try {
      await deleteAECase(id, reason);
      setCases(prev => (prev || []).filter(c => c.id !== id));
      setActionError('');
    } catch (e: any) {
      setActionError(`${t('ae.page.deleteFailed')}: ${e?.message || e}`);
    }
  };

  return (
    <AEScope embedded>
      {/* 錯誤要讀得到：role="alert" 讓讀屏立即宣告，而不是只在畫面某處變色。 */}
      {(loadError || actionError) && (
        <div role="alert" className="m-3 px-4 py-3 rounded-2xl border-2 text-sm font-bold bg-danger-50 text-danger-900 border-danger-300 dark:bg-danger-500/10 dark:text-danger-200 dark:border-danger-500/40 flex flex-wrap items-center justify-between gap-3">
          <span>{loadError ? `${t('ae.page.loadFailed')}: ${loadError}` : actionError}</span>
          {loadError && (
            <button type="button" onClick={() => void load()} className="min-h-[44px] px-4 rounded-xl border-2 border-danger-300 dark:border-danger-500/40">
              {t('ae.page.retry')}
            </button>
          )}
        </div>
      )}
      {cases === null
        ? !loadError && <p role="status" className="p-10 text-center text-sm text-muted">{t('app.loading')}</p>
        : (
          <div className="flex flex-col h-[calc(100dvh-12rem)] min-h-[560px]">
            <AEIntakeConsole cases={cases} onSaveCase={saveCase} onDeleteCase={deleteCase} actor={actor || undefined} />
          </div>
        )}
    </AEScope>
  );
};

export default AEIntakePage;
